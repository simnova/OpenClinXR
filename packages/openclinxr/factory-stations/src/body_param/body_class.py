from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from constants import DRIVEN_BONE, DRIVEN_ROTATION_DEG
from garment_ops import (
    _LIMB_BONE_RE,
    _bone_dominant_vertex_indices,
    apply_body_hide_material_region,
    apply_scalp_hair_material_region,
    clip_hide_mask_below_joint,
    clip_hide_mask_to_garment_footprint,
    _fit_one_garment,
    fit_upper_hem_to_waistband,
    scalp_placeholder_retired_for,
    scope_hide_mask_away_from_hands,
    transfer_weights_body_to_garment,
    trim_garment_hand_region,
)
from mesh_io import (
    align_body_to_reference,
    apply_object_transforms,
    choose_grade_engine,
    export_objects_glb,
    force_z_up_standing,
    import_obj,
    make_material,
    render_png,
    stature_meters,
    torso_girth_proxy,
    world_bounds,
)
from mpfb_body import apply_macros, load_mpfb_face_shape_keys, strip_helper_geometry
from paths import garment_coverage as _gc
from phenotype_macros import derive_macro_dict_from_authored_phenotype
from rig_bind import bind_meshes_to_canonical_armature, create_mpfb_mixamo_rig, measure_pose_deformation
from stature_solve import solve_height_macro_from_stature

try:
    import bpy
except ImportError:
    bpy = None

def build_one_body_class(
    *,
    body_class: dict,
    class_index: int,
    mhclo_path: str,
    garment_obj_path: str,
    mh_base_obj: str,
    out_dir: Path,
    garment_prefix: str,
    body_prefix: str,
    anny_obj: str,
    ClothesService,
    Mhclo,
    ObjectService,
    GeneralObjectProperties,
    lower_mhclo_path: str = "",
    lower_garment_obj_path: str = "",
    lower_garment_prefix: str = "makeclothes_library_cargo_pants",
) -> dict:
    """Build one body class.

    Order measured in issue-151 fit-orient probe:
      1) load base.obj exactly as #215 (import_obj, NOT create_human)
      2) set Basemesh tag + apply macros as live shape keys
      3) ClothesService.fit while shape keys are LIVE (fit reads a from-mix key)
      4) bake macro targets into vertices, then re-load MPFB face keys for morph export
      5) Anny foot/centre align + girth recording with garment parented (NOT stature —
         #304: stature comes from the macros; the reference is placement-only), then
         unparent + apply
      6) bind armature + export WITH skins and morphs
    Baking BEFORE fit rotated/collapsed the scrub (probe: garment Z extent ~2.6 vs
    good no-macro fit Z ~5.1 on the same basemesh).

    #221: per-class `annyObj` on the body_class dict overrides the CLI default so male/female
    references stay aligned (age/size/gender via Anny-as-reference → MPFB match).

    #275: per-class `garment` on the body_class dict drives the UPPER garment from the
    CASE DEFINITION. `kind=library` fits the given .mhclo (the scrub shirt today); the
    CLI falls back to that for any role without a case-definition garment. `kind=cover_shell`
    builds the deterministic body-derived cover shell (#277's factory fallback mechanism)
    over the torso band — used when the case definition selects a garment the .mhclo
    library cannot provide (civilian/family layers). The stage default is the fallback.
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    body_class_id = str(body_class["bodyClassId"])
    # Prefer per-class Anny reference (#221); fall back to stage-wide anny_obj.
    class_anny = str(body_class.get("annyObj") or anny_obj or "").strip()
    anny_reference_asset = str(body_class.get("annyReferenceAsset") or "").strip() or None
    phenotype = {
        "weight": float(body_class.get("weight", 0.5)),
        "gender": float(body_class.get("gender", 0.5)),
        "age": float(body_class.get("age", 0.5)),
        "muscle": float(body_class.get("muscle", 0.5)),
        "height": float(body_class.get("height", 0.5)),
        "proportions": float(body_class.get("proportions", 0.5)),
    }
    # #329 — the macros must come from the CASE, not from hand-authored body-class
    # literals. When the body class carries the case's authored phenotype (resolved
    # by the CLI from buildActorPhenotypeExport), derive every macro from it and
    # solve the height against MPFB's own measured body. A body whose own band cannot
    # reach the authored height REFUSES loudly with the measured band recorded — the
    # planted contract's clause (1) accepts a recorded refusal, never a silently
    # short body. The legacy literal path stays as the fallback for a body class
    # with no authored phenotype (counterweight).
    macro_source = "authored_body_class_literals"
    macro_derivation: dict = {}
    phenotype_solve: dict = {}
    authored_phenotype = body_class.get("authoredPhenotype")
    if isinstance(authored_phenotype, dict) and authored_phenotype:
        base_macro, macro_derivation = derive_macro_dict_from_authored_phenotype(
            authored_phenotype
        )
        target_cm = authored_phenotype.get("height_cm")
        if isinstance(target_cm, (int, float)) and float(target_cm) > 0:
            tmp_solve = Path(out_dir).parent / f".{body_class_id}.height-solve"
            try:
                solved = solve_height_macro_from_stature(
                    base_macro, float(target_cm) / 100.0, tmp_solve
                )
            finally:
                import shutil

                shutil.rmtree(tmp_solve, ignore_errors=True)
            base_macro["height"] = solved["heightMacro"]
            phenotype = base_macro
            macro_source = "case_authored_phenotype_issue_329"
            phenotype_solve = {
                "authoredHeightCm": float(target_cm),
                "solvedHeightMacro": solved["heightMacro"],
                "measuredStatureM": round(solved["measuredStatureM"], 4),
                "reachableBandCm": solved["reachableBandCm"],
                "heightHonoured": abs(solved["measuredStatureM"] * 100.0 - float(target_cm)) <= 1.0,
            }
        else:
            phenotype = {k: base_macro[k] for k in ("gender", "age", "muscle", "weight", "proportions")}
            phenotype["height"] = base_macro.get("height", 0.5)
            macro_source = "case_authored_phenotype_issue_329_no_height_target"

    # ── #275 per-class upper garment selection (case definition → garment) ────────
    # The CLI resolves the garment from the cast role; this stage only executes it.
    # `library` = fit the given .mhclo via ClothesService (fallback: scrub shirt).
    # `cover_shell` = deterministic body-derived shell over the torso band (no .mhclo
    # invented — a garment id pointing at a missing .mhclo is the #256 trap).
    garment_spec = body_class.get("garment") or {}
    garment_kind = str(garment_spec.get("kind") or "library")
    if garment_kind not in ("library", "cover_shell"):
        raise ValueError(
            f"body class {body_class_id}: garment.kind '{garment_kind}' — library or cover_shell only"
        )
    use_mhclo = str(garment_spec.get("mhcloPath") or mhclo_path)
    use_garment_obj = str(garment_spec.get("objPath") or garment_obj_path)
    use_garment_prefix = str(garment_spec.get("meshNamePrefix") or garment_prefix)
    garment_band = (
        float(garment_spec.get("bandLowFraction") or 0.53),
        float(garment_spec.get("bandHighFraction") or 0.85),
    )

    clear_scene()
    enable_mpfb()

    body_mesh_name = f"{body_prefix}_{body_class_id}"
    # #215 body load path — raw base.obj import (create_human placement is wrong here)
    basemesh = import_obj(mh_base_obj, body_mesh_name, force_z=False)
    basemesh.data.materials.clear()
    basemesh.data.materials.append(make_material(f"skin_{body_class_id}", BODY_COLORS[class_index % 2]))
    GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=basemesh)

    # issue-307 — wire the MPFB-shipped CC0 rig + weight map HERE, on the RAW mesh
    # (before macros/bake): MPFB's rig-position strategies read joint-* marker verts
    # from the current mesh state, and `bake_targets` MANGLES those markers (measured:
    # joint-head moves from z≈6.97 to z≈−0.48, a 0.75 m drop) — a rig created after
    # the bake lands flattened into the hip plane with the head at the chest. On the
    # raw mesh the markers are at their MakeHuman-anatomical positions, so the bones
    # come out correct and stay there while the body morphs around them.
    rig_created = create_mpfb_mixamo_rig(basemesh)
    armature = bpy.data.objects.get(rig_created["armatureObjectName"])
    if armature is None:
        raise RuntimeError(
            f"issue-307: armature {rig_created['armatureObjectName']} missing after rig creation"
        )
    bpy.context.view_layer.update()

    applied = apply_macros(basemesh, phenotype)
    bpy.context.view_layer.update()
    girth_pre = torso_girth_proxy(basemesh)

    # Fit while macros are LIVE shape keys — ClothesService builds a from-mix key.
    # #220: fit UPPER then LOWER before baking macros so both mhclo maps read phenotype shape.
    garment_mesh_name = f"{use_garment_prefix}_{body_class_id}"
    garment: bpy.types.Object | None = None
    fit_s = 0.0
    if garment_kind == "library":
        garment, fit_s = _fit_one_garment(
            mhclo_path=use_mhclo,
            garment_obj_path=use_garment_obj,
            garment_mesh_name=garment_mesh_name,
            basemesh=basemesh,
            color=GARMENT_COLORS[class_index % 2],
            ClothesService=ClothesService,
            Mhclo=Mhclo,
        )
    else:
        # cover_shell: built from the FINAL body surface at the coverage gate, after
        # macro bake + helper strip + Anny align. Nothing is fitted here.
        print(f"[body_param] {body_class_id}: upper garment = deterministic cover shell "
              f"(case-driven, no .mhclo) band={garment_band[0]:.2f}..{garment_band[1]:.2f}")

    lower_garment: bpy.types.Object | None = None
    lower_mesh_name: str | None = None
    lower_fit_s = 0.0
    if lower_mhclo_path and lower_garment_obj_path:
        if not Path(lower_mhclo_path).is_file() or not Path(lower_garment_obj_path).is_file():
            raise RuntimeError(
                f"lower garment paths missing: mhclo={lower_mhclo_path} obj={lower_garment_obj_path}"
            )
        lower_mesh_name = f"{lower_garment_prefix}_{body_class_id}"
        lower_garment, lower_fit_s = _fit_one_garment(
            mhclo_path=lower_mhclo_path,
            garment_obj_path=lower_garment_obj_path,
            garment_mesh_name=lower_mesh_name,
            basemesh=basemesh,
            color=LOWER_GARMENT_COLORS[class_index % 2],
            ClothesService=ClothesService,
            Mhclo=Mhclo,
        )

    # Bake macros into body vertices AFTER all fits so skinning binds the phenotype shape.
    # Face keys are re-loaded after bake for morph export (#221 A2) — bake would drop them.
    TargetService.bake_targets(basemesh)
    bpy.context.view_layer.update()

    # #221 A2 — load face targets on FULL base topology (MPFB indices), THEN strip helpers.
    # Blender updates shape-key blocks when helper verts are deleted; face deltas on body
    # surface verts survive. Loading after strip would mis-index targets.
    face_keys = load_mpfb_face_shape_keys(basemesh, min_count=20)
    bpy.context.view_layer.update()
    helper_strip = strip_helper_geometry(basemesh)
    bpy.context.view_layer.update()

    def _ensure_parented(child: bpy.types.Object) -> None:
        if child.parent is not basemesh:
            child.parent = basemesh
            child.matrix_parent_inverse = basemesh.matrix_world.inverted()

    def _unparent_apply(child: bpy.types.Object) -> None:
        mw_g = child.matrix_world.copy()
        child.parent = None
        child.matrix_world = mw_g
        apply_object_transforms(child)

    outfit: list[bpy.types.Object] = [g for g in [garment, lower_garment] if g is not None]

    # Foot/centre align to Anny + girth recording (0044 path; NOT stature — #304:
    # stature comes from the macros, the reference is placement-only) while garments
    # are still parented. issue-307: the mixamo armature gets the SAME scale + translate
    # so its bones stay inside the skinned body.
    align_info: dict = {"skipped": True}
    anny_ref_used: str | None = None
    if class_anny and Path(class_anny).is_file():
        anny = import_obj(class_anny, "anny_stature_reference", force_z=True)
        anny.data.materials.clear()
        anny.data.materials.append(make_material("anny_ref", (0.82, 0.68, 0.56, 1.0)))
        for g in outfit:
            _ensure_parented(g)
        align_info = align_body_to_reference(basemesh, anny, armature=armature)
        bpy.context.view_layer.update()
        apply_object_transforms(basemesh)
        apply_object_transforms(armature)
        for g in outfit:
            _unparent_apply(g)
        bpy.data.objects.remove(anny, do_unlink=True)
        anny_ref_used = anny_reference_asset or class_anny
        align_info["annyObj"] = class_anny
        align_info["annyReferenceAsset"] = anny_ref_used
    else:
        basemesh.scale = (MH_UNITS_TO_METRES,) * 3
        armature.scale = (MH_UNITS_TO_METRES,) * 3
        bpy.context.view_layer.update()
        for g in outfit:
            _ensure_parented(g)
        apply_object_transforms(basemesh)
        for g in outfit:
            _unparent_apply(g)
        feet_z = world_bounds(basemesh)["min"][2]
        basemesh.location.z -= feet_z
        armature.location.z -= feet_z
        apply_object_transforms(basemesh)
        apply_object_transforms(armature)
        align_info = {"uniformScale": 0.1, "path": "mpfb_default_0_1_without_anny"}

    girth_post = torso_girth_proxy(basemesh)
    body_bounds = world_bounds(basemesh)
    garment_bounds = world_bounds(garment) if garment is not None else None

    basemesh.name = body_mesh_name
    basemesh.data.name = body_mesh_name
    if garment is not None:
        garment.name = garment_mesh_name
        garment.data.name = garment_mesh_name
    if lower_garment is not None and lower_mesh_name:
        lower_garment.name = lower_mesh_name
        lower_garment.data.name = lower_mesh_name

    # ── issue-272 garment region coverage gate (clothing_consume) ────────────────
    # Library fits place garments coincident with the skin (measured median ≈ 0.7 mm,
    # half the surface behind the body surface → the translucent/z-fighting patch), and a
    # sparse library asset cannot cover the region it claims (the 392-triangle cargo
    # trouser: 71% leg coverage, 32 open edges — the "see-through legs"). Every fitted
    # garment is measured against the body region it claims; a garment that does not
    # cover is replaced by a deterministic body-derived cover shell (covers by
    # construction), and accepted garments get a uniform outward cloth standoff so they
    # sit OUTSIDE the skin. Nothing here touches triangle counts (D9 / meshoptimizer).
    coverage_gate: dict = {"enabled": True, "upper": None, "lower": None, "note": ""}
    # issue-320 — how the upper garment's hem meets the lower garment's waistband.
    # Populated by the cover-shell band derivation and/or the fitted-hem push below.
    coverage_gate["waistMeet"] = {"enabled": True, "upper": None}

    def _numpy_mesh(obj: bpy.types.Object):
        # Triangulate polygons: OBJ imports and the MPFB basemesh are quad/n-gon
        # meshes (scrub shirt 4,692 quads = 9,384 tris; basemesh 13,378 quads =
        # 26,756 tris), while the coverage predicate assumes triangle faces.
        # Feeding raw polygons made the closed shirt read 13,400 boundary edges
        # and garbled the raycast (issue-277, measured on the first gate run).
        verts = np.array([v.co for v in obj.data.vertices], dtype=float)
        faces: list[tuple[int, int, int]] = []
        for p in obj.data.polygons:
            iv = list(p.vertices)
            if len(iv) == 3:
                faces.append((int(iv[0]), int(iv[1]), int(iv[2])))
            else:
                # fan triangulation from vertex 0; preserves edge sharing so a
                # closed quad shell still welds to 0 boundary edges.
                for i in range(1, len(iv) - 1):
                    faces.append((int(iv[0]), int(iv[i]), int(iv[i + 1])))
        return verts, np.array(faces, dtype=np.int64)

    body_verts, body_faces = _numpy_mesh(basemesh)

    def _mesh_from_numpy(name: str, verts, faces) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(
            [tuple(float(x) for x in v) for v in verts],
            [],
            [tuple(int(x) for x in f) for f in faces],
        )
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    # #295 — garments do not claim the hands: exclude arm/forearm/hand-dominant body
    # faces from every cover shell the stage materializes. The band selection alone
    # wraps the A-pose hands, which hang at the same height as the torso and legs
    # (measured: 3,450 hand-dominant verts in the heavy-male lower fallback — the
    # "blue mitten" #295 graded from the pixels). Derived from the body's own
    # vertex-to-bone attribution (D1), never authored per-body coordinates.
    shell_limb_exclude = None
    if garment_kind == "cover_shell" or lower_garment is not None:
        limb_verts = _bone_dominant_vertex_indices(basemesh, armature, _LIMB_BONE_RE)
        shell_limb_exclude = np.array(
            [any(int(vi) in limb_verts for vi in f) for f in body_faces],
            dtype=bool,
        )
    if garment is None:
        if garment_kind != "cover_shell":
            raise RuntimeError(f"body class {body_class_id}: no upper garment materialized")
        bz = body_bounds
        zmin = float(bz["min"][2])
        body_h = float(bz["size"][2])
        band_lo = zmin + garment_band[0] * body_h
        band_hi = zmin + garment_band[1] * body_h
        shell = _gc.build_cover_shell(
            body_verts,
            body_faces,
            band_lo,
            band_hi,
            standoff=_gc.CLOTH_STANDOFF_M,
            label=f"{use_garment_prefix}_{body_class_id}",
            height_axis=2,
            exclude_faces=shell_limb_exclude,
        )
        shell_obj = _mesh_from_numpy(
            garment_mesh_name,
            np.asarray(shell["position"]).reshape(-1, 3),
            np.asarray(shell["indices"]).reshape(-1, 3),
        )
        shell_obj.data.materials.clear()
        shell_obj.data.materials.append(
            make_material(f"mat_{shell_obj.name}", GARMENT_COLORS[class_index % 2])
        )
        shell_obj.name = garment_mesh_name
        shell_obj.data.name = garment_mesh_name
        garment = shell_obj
        garment_bounds = world_bounds(garment)
        coverage_gate["note"] = (
            "case-selected upper garment has no .mhclo in the library; "
            "deterministic body-derived cover shell materialized (#275)"
        )
    # After the block above the upper garment always exists (fitted, or shell built,
    # or the code above raised). The assertion is for static checkers, not a runtime gate.
    assert garment is not None

    # ── #295: terminate every garment at the wrist ───────────────────────────────
    # Both the fitted .mhclo shell and the body-derived cover shell place garment
    # geometry over the hand (measured 2026-08-11: 17,345 hand-dominant upper-shell
    # verts on the lean-female body, and 3,450 on the heavy-male cargo pants — the
    # "blue mitten" #295 graded from the pixels). The garment's weights do not exist
    # until the bind, so run the SAME weight projection the bind will run, classify
    # each garment vertex by its dominant bone, and delete the hand-dominated ones.
    # The shell then terminates exactly where the hand bones' influence ends — derived
    # from the garment's own vertex-to-bone attribution (D1), not authored per-body
    # coordinates. The coverage gate and the hide mask below then measure the trimmed
    # garment; the later bind recomputes weights on the trimmed mesh (the projection is
    # position-based, so the remaining verts keep their non-hand classification).
    hand_trim: dict = {"enabled": True, "upper": None, "lower": None}
    if garment is not None:
        hand_trim["upper"] = {
            **transfer_weights_body_to_garment(basemesh, garment, armature),
            "trim": trim_garment_hand_region(garment, armature, slot="upper"),
        }
    if lower_garment is not None:
        hand_trim["lower"] = {
            **transfer_weights_body_to_garment(basemesh, lower_garment, armature),
            "trim": trim_garment_hand_region(lower_garment, armature, slot="lower"),
        }
    bpy.context.view_layer.update()

    # ── issue-322: fitted garments are measured at their SHIPPING position ─────────
    # The raw MakeClothes fit is coincident with the skin — the cloth_offset docstring
    # records "median ≈ 0.7 mm; half the surface behind the body surface" — so outward
    # rays from the body surface miss every OPEN fitted garment. Measured on the fitted
    # toigo_basic_tucked_t-shirt via the shared garment_coverage module: coverage 0.47
    # on the raw fit vs 0.97 at the 1.5 cm shipping standoff, while the closed scrub
    # passes the raw fit by closure alone (0.47 too). The evidence module measures the
    # shipped GLB, which IS offset; the gate must measure the same geometry or it
    # refuses honest open-shell garments. Cover shells are already built at the standoff
    # and skip this.
    if garment_kind != "cover_shell":
        ugv_pre, _ = _numpy_mesh(garment)
        ugv_off = _gc.cloth_offset(ugv_pre, body_verts, body_faces, _gc.CLOTH_STANDOFF_M)
        for i, v in enumerate(garment.data.vertices):
            v.co = tuple(float(x) for x in ugv_off[i])
        bpy.context.view_layer.update()

    garment_bounds = world_bounds(garment)

    # Upper garment: torso band = its own extent, laterally bounded by the garment's
    # own silhouette (issue-283: the arms hang through any torso band and are not part
    # of a shirt's claim — a closed shell once read 14-35% coverage for exactly that
    # reason, and now reads its honest claim ~0.93-1.00). Band axis is Z: the stage
    # scene is Z-up (height along Z) at gate time — the evidence module reads the exported
    # Y-up GLB and uses Y for the same physical band (issue-277, measured).
    ugv, ugf = _numpy_mesh(garment)
    upper_rep = _gc.coverage_report(
        body_verts,
        body_faces,
        ugv,
        ugf,
        float(garment_bounds["min"][2]) + 0.02,
        float(garment_bounds["max"][2]) - 0.02,
        garment_label="upper",
        height_axis=2,
    )
    if upper_rep["verdict"] == "does_not_cover":
        # A dense library upper garment passes on closure; firing here means the fit is
        # genuinely degenerate. Refuse loudly rather than ship a bare torso.
        raise RuntimeError(f"upper garment failed the issue-272 coverage gate: {upper_rep}")
    # The garment was already offset to its shipping standoff above; the gate measured
    # that geometry. Cover shells are built at the standoff and never re-offset.
    coverage_gate["upper"] = upper_rep

    if lower_garment is not None:
        lgv, lgf = _numpy_mesh(lower_garment)
        hem_z = float(garment_bounds["min"][2])  # upper garment hem (Z-up stage frame)
        ankle_z = float(body_bounds["min"][2]) + 0.10  # shoes/feet begin below
        lower_rep = _gc.coverage_report(
            body_verts,
            body_faces,
            lgv,
            lgf,
            ankle_z,
            hem_z,
            garment_label="lower",
            height_axis=2,
        )
        if lower_rep["verdict"] == "does_not_cover":
            # Sparse/open library fit (issue-272: 392-tri cargo trouser). Replace with
            # the body-derived cover shell: the body's own leg surface offset outward —
            # covers the region by construction (D2: procedural clothing, no LLM).
            shell = _gc.build_cover_shell(
                body_verts,
                body_faces,
                ankle_z,
                hem_z,
                standoff=_gc.CLOTH_STANDOFF_M,
                label=f"{lower_garment_prefix}_fallback_{body_class_id}",
                height_axis=2,
                exclude_faces=shell_limb_exclude,
            )
            fallback_obj = _mesh_from_numpy(
                lower_mesh_name or f"{lower_garment_prefix}_fallback_{body_class_id}",
                np.asarray(shell["position"]).reshape(-1, 3),
                np.asarray(shell["indices"]).reshape(-1, 3),
            )
            fallback_obj.data.materials.append(
                make_material(f"mat_{fallback_obj.name}", LOWER_GARMENT_COLORS[class_index % 2])
            )
            lower_garment = fallback_obj
            lower_mesh_name = fallback_obj.name
            lower_rep["fallback"] = "body_derived_cover_shell"
            lower_rep["fallbackVertexCount"] = shell["vertexCount"]
            lower_rep["fallbackFaceCount"] = shell["faceCount"]
            coverage_gate["note"] = (
                coverage_gate["note"] + "; "
                if coverage_gate.get("note")
                else ""
            ) + "library lower fit did not cover its region; replaced with body-derived cover shell"
        else:
            lgv_off = _gc.cloth_offset(lgv, body_verts, body_faces, _gc.CLOTH_STANDOFF_M)
            for i, v in enumerate(lower_garment.data.vertices):
                v.co = tuple(float(x) for x in lgv_off[i])
        coverage_gate["lower"] = lower_rep
    bpy.context.view_layer.update()

    # ── issue-320: the upper garment's hem must MEET the lower garment's waistband ─
    # The #295-grade ragged band of bare skin at the waist is a GAP BETWEEN TWO GARMENT
    # EDGES, not poke-through — no face pokes through anything, and the coverage gate
    # is structurally blind to it (§6t). Runs HERE, after the lower coverage gate, so
    # `lower_garment` is the geometry that SHIPS (a sparse library fit is replaced by
    # the body-derived cover shell in the gate above; measuring before it reads a
    # mesh that never reaches the export). The upper hem's bottom rim band is pushed
    # down per angular bucket until the bucket's lowest vertex clears the lower
    # garment's highest waistband vertex by WAIST_OVERLAP_MARGIN_M. The terminus is
    # DERIVED from the lower garment's own waistband rim (D1) — never an authored
    # per-body coordinate. A garment that already meets is a no-op; the known-good
    # scrub column lands ~5 mm of overlap instead of +0.1 mm (the issue names
    # "several millimetres" as the robust target).
    if lower_garment is not None and garment is not None:
        coverage_gate["waistMeet"]["upper"] = fit_upper_hem_to_waistband(garment, lower_garment)
    elif coverage_gate["waistMeet"].get("upper") is None:
        coverage_gate["waistMeet"]["upper"] = {
            "skipped": True,
            "note": "no lower garment — nothing to meet",
        }

    # ── issue-285: body-part hiding (the §6s research answer) ──────────────────
    # The body-derived cover shell offset along vertex normals self-intersects at the
    # concave hip/waist crease — the body surface renders in front of / z-fights the
    # shell there ("skin through the blue shell at the flanks", measured: 34.5% of the
    # female upper claim region is within 3 mm of the shell surface, and the fitted
    # scrub shirt carries the same coincidence). NO outward offset fixes a concave
    # fold; the industry answer is to HIDE the body under the garment (alpha mask).
    # Every accepted garment paints the body faces that poke it (signed clearance <
    # HIDE_EPSILON_M, same pure-numpy predicate the evidence test drives) with an
    # invisible material. Deterministic, no balloon (#121), and the geometry is
    # untouched — the coverage gate and the sparse-trouser refusal are unchanged
    # (counterweight). The evidence test proves the mask covers the pokes on the
    # shipped GLBs without re-running this bake.
    def _hide_under_garment(garment_obj: bpy.types.Object | None, slot: str) -> dict:
        if garment_obj is None:
            return {"slot": slot, "enabled": True, "hiddenFaceCount": 0, "note": "no garment"}
        hgv, hgf = _numpy_mesh(garment_obj)
        hb = world_bounds(garment_obj)
        mask_info = _gc.body_hide_mask(
            body_verts,
            body_faces,
            hgv,
            hgf,
            float(hb["min"][2]),
            float(hb["max"][2]),
            hide_epsilon_m=_gc.HIDE_EPSILON_M,
            height_axis=2,
        )
        # issue-287 — the per-face mask is consumed by apply_body_hide_material_region
        # below and must NOT ride into the stage report: it is a numpy bool array and
        # json.dumps raises "Object of type ndarray is not JSON serializable" (the #285
        # bake report serialization defect that made the re-bake fail at the last step).
        # Report the counts only; the mask itself lives in the exported GLB's materials.
        hide_mask = mask_info.pop("hideMask")
        if mask_info["hiddenFaceCount"] == 0:
            return {
                **mask_info,
                "slot": slot,
                "enabled": True,
                "note": "no poking body faces — nothing to hide",
            }
        # #295 — scope the mask to the covered region. The garments now terminate at
        # the wrist (trim_garment_hand_region), so a body face whose vertices are
        # dominated by a hand/finger joint is a BARE hand; leaving it under the
        # alpha-MASK would discard it and show a stump where the sleeve was. Derived
        # from the body's own CC0 weight attribution (never authored coordinates).
        hide_mask, hand_faces_unhidden = scope_hide_mask_away_from_hands(
            basemesh, hide_mask, armature
        )
        # #326 — clip the mask to the garment's footprint (the SHARED over-reach fix,
        # carried by all three rails: the signed-clearance test admits body faces just
        # outside the garment silhouette, and their discarded verts render as slivers).
        hide_mask, footprint_clipped = clip_hide_mask_to_garment_footprint(
            hide_mask, basemesh, world_bounds(garment_obj)
        )
        applied = apply_body_hide_material_region(basemesh, hide_mask, slot=slot)
        return {
            **mask_info,
            "slot": slot,
            "enabled": True,
            "applied": applied,
            "handFacesUnhidden": hand_faces_unhidden,
            "footprintClippedFaces": footprint_clipped,
            "note": (
                "body faces under the garment hidden (alpha mask), "
                "hands + outside-footprint faces excluded"
            ),
        }

    body_hide: dict = {"enabled": True, "upper": None, "lower": None}
    body_hide["upper"] = _hide_under_garment(garment, "upper")
    if lower_garment is not None:
        body_hide["lower"] = _hide_under_garment(lower_garment, "lower")
    coverage_gate["bodyHide"] = body_hide
    bpy.context.view_layer.update()

    # #279 — wire the proven bounds-derived scalp/hair material region (Anny rail) onto
    # the hm08 body. Both hm08 library bodies shipped bald (zero scalp/hair materials);
    # the region function was wired to Anny natively and MPFB via #222 but never to this
    # rail. Runs AFTER the coverage gate so the region is measured on the final
    # (aligned, helper-stripped, Z-up standing, face at -Y) body and BEFORE the armature
    # bind so skinning never touches the material indices.
    # RULE: placeholder scalp is suppressed only when this stage itself fits hair.
    # The hm08 library rail embeds hair later (body-param-cli finish step), so
    # fitted_hair_present stays False and this call site's behaviour is unchanged.
    if scalp_placeholder_retired_for(body_class_id):
        scalp_hair_region = {"retired": True, "figureId": body_class_id}
    else:
        scalp_hair_region = apply_scalp_hair_material_region(basemesh)

    # #216/#220/#307 — bind body + upper (+ lower) to the mixamo_unity armature
    # (the body's skin is the shipped CC0 weight map from create_mpfb_mixamo_rig).
    extra = [lower_garment] if lower_garment is not None else None
    rig_info = bind_meshes_to_canonical_armature(
        basemesh,
        garment,
        weight_mode="auto",
        extra_garments=extra,
        armature=armature,
    )
    arm = bpy.data.objects.get(rig_info["armatureName"])
    if arm is None:
        raise RuntimeError(f"armature missing after bind: {rig_info['armatureName']}")
    rig_info["rigCreated"] = rig_created

    deform = measure_pose_deformation(
        basemesh,
        garment,
        arm,
        bone_name=DRIVEN_BONE,
        rotation_deg=DRIVEN_ROTATION_DEG,
    )

    glb_path = out_dir / f"body_param_{body_class_id}.glb"
    export_objects = [arm, basemesh, garment]
    if lower_garment is not None:
        export_objects.append(lower_garment)
    # Export armature + skinned meshes with skins + morphs (face keys)
    export_objects_glb(
        export_objects,
        str(glb_path),
        export_skins=True,
        export_morph=True,
    )

    morph_names: list[str] = []
    if basemesh.data.shape_keys:
        morph_names = [
            kb.name
            for kb in basemesh.data.shape_keys.key_blocks
            if kb.name != "Basis"
        ]

    lower_info: dict = {
        "lowerGarmentMeshName": lower_mesh_name,
        "lowerGarmentTriangleEstimate": (
            sum(len(p.vertices) - 2 for p in lower_garment.data.polygons)
            if lower_garment is not None
            else 0
        ),
        "lowerGarmentVertexCount": (
            len(lower_garment.data.vertices) if lower_garment is not None else 0
        ),
        "lowerFitWallClockS": round(lower_fit_s, 4) if lower_garment is not None else None,
        "lowerGarmentFittedToBodyClass": body_class_id if lower_garment is not None else None,
        "outfitSteps": (
            ["fit_upper_garment", "fit_lower_garment_outfit"]
            if lower_garment is not None
            else ["fit_upper_garment"]
        ),
        # hm08 library basemesh has no painted lower-body region (paint is Anny-rail only).
        # When a lower mesh arrives, painted lower tris must stay 0 — muddy double forbidden.
        "lowerPaintTriangleCount": 0,
    }

    return {
        "bodyClassId": body_class_id,
        "phenotype": phenotype,
        "appliedMacro": applied,
        "macroBakedBeforeFit": False,
        "macroBakedAfterFit": True,
        "helperStrip": helper_strip,
        "faceShapeKeys": face_keys,
        "morphTargetCount": len(morph_names),
        "morphTargetNames": morph_names,
        "bodyLoadPath": "import_obj_base.obj_like_215",
        "glbPath": str(glb_path),
        "bodyMeshName": body_mesh_name,
        "bodyVertexCount": body_bounds["vertexCount"],
        "heightMeters": girth_post["heightMeters"],
        "torsoGirthProxyMeters": girth_post["torsoGirthProxyMeters"],
        "torsoGirthPreAlign": girth_pre,
        "torsoGirthPostAlign": girth_post,
        "bodyBounds": body_bounds,
        "garmentMeshName": garment_mesh_name,
        "garmentFittedToBodyClass": body_class_id,
        "garmentId": str(garment_spec.get("garmentId") or ""),
        "garmentKind": garment_kind,
        "garmentMhcloPath": use_mhclo if garment_kind == "library" else None,
        "garmentBandLowFraction": None if garment_kind == "library" else garment_band[0],
        "garmentBandHighFraction": None if garment_kind == "library" else garment_band[1],
        "garmentBounds": garment_bounds,
        "garmentVertexCount": len(garment.data.vertices),
        "garmentPolygonCount": len(garment.data.polygons),
        "garmentTriangleEstimate": sum(len(p.vertices) - 2 for p in garment.data.polygons),
        "clothesServiceApi": "ClothesService.fit_clothes_to_human",
        "fitWallClockS": round(fit_s, 4),
        "annyStatureAlign": align_info,
        "annyReferenceAsset": anny_ref_used,
        "annyObj": class_anny or None,
        # #329 — where this body class's macros came from: the case-authored
        # phenotype (with the height solved against MPFB's own body) or the legacy
        # hand-authored body-class literals. `macroDerivation` records which authored
        # key drove which macro, so bmi/build/gender_presentation are visible in the
        # report instead of dying at the materializer.
        "macroSource": macro_source,
        "macroDerivation": macro_derivation,
        "phenotypeSolve": phenotype_solve,
        "authoredPhenotype": authored_phenotype if isinstance(authored_phenotype, dict) else None,
        "rig": rig_info,
        "deformation": deform,
        "skinExport": True,
        "morphExport": True,
        "producedByStage": STAGE_ID,
        "coverageGate": coverage_gate,
        # issue-320 — how the upper hem met the lower waistband (band derivation for
        # cover shells, per-bucket push for fitted .mhclo garments).
        "waistMeet": coverage_gate.get("waistMeet"),
        "scalpHairRegion": scalp_hair_region,
        # #295 — per-garment hand-region trim counts (0 removed = no hand geometry).
        "garmentHandTrim": hand_trim,
        **lower_info,
    }


def _tag_mesh_materials(obj: bpy.types.Object, body_class_id: str, class_index: int) -> None:
    name_l = (obj.name + " " + (obj.data.name or "")).lower()
    if any(k in name_l for k in ("cargo", "pant", "trouser", "lower", "skirt", "short")):
        obj.data.materials.clear()
        obj.data.materials.append(
            make_material(f"lg_{body_class_id}", LOWER_GARMENT_COLORS[class_index % 2])
        )
    elif "scrub" in name_l or "garment" in name_l or "makeclothes" in name_l or "cloth" in name_l:
        obj.data.materials.clear()
        obj.data.materials.append(
            make_material(f"g_{body_class_id}", GARMENT_COLORS[class_index % 2])
        )
    else:
        obj.data.materials.clear()
        obj.data.materials.append(
            make_material(f"b_{body_class_id}", BODY_COLORS[class_index % 2])
        )


def render_grade_sheet(class_results: list[dict], grade_path: str, out_dir: Path) -> str:
    """Re-import exported GLBs side-by-side with distinct materials for pixel grade.

    Returns the render engine used. Prefer EEVEE so body vs garment colour is visible
    (#215 Workbench monochrome trap).
    """
    clear_scene()
    placed = []
    spacing = 1.1
    for i, cr in enumerate(class_results):
        glb = cr["glbPath"]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=glb)
        created = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        # Shift whole group (armatures + meshes)
        roots = [o for o in bpy.data.objects if o not in before]
        for obj in roots:
            obj.location.x += (i - 0.5 * (len(class_results) - 1)) * spacing
        for obj in created:
            _tag_mesh_materials(obj, cr["bodyClassId"], i)
            placed.append(obj)
        bpy.context.view_layer.update()

    # Frame camera on both
    if placed:
        # rough center height
        zs = []
        for obj in placed:
            b = world_bounds(obj)
            zs.extend([b["min"][2], b["max"][2]])
        mid_z = 0.5 * (min(zs) + max(zs)) if zs else 0.95
        setup_camera_front(target_z=mid_z, distance=3.6, center_x=0.0)
    else:
        setup_camera_front()
    return render_png(grade_path, res_x=1280, res_y=720)


def render_posed_deformation_grade(
    class_result: dict,
    grade_path: str,
) -> dict:
    """#216 — lit rest | posed side-by-side of one skinned body+garment.

    EEVEE so Principled Base Color is visible (Workbench ignores it — #215).
    Rest on the left, driven-bone pose on the right. Frame full figure + arms.
    """
    clear_scene()
    glb = class_result["glbPath"]
    spacing = 1.45

    def import_at_x(x_off: float, pose: bool) -> list[bpy.types.Object]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=glb)
        created = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in created if o.type == "MESH"]
        arms = [o for o in created if o.type == "ARMATURE"]
        # Move only scene roots so armature children keep relative TRS
        roots = [o for o in created if o.parent is None or o.parent not in created]
        for obj in roots:
            obj.location.x += x_off
        for obj in meshes:
            _tag_mesh_materials(obj, class_result["bodyClassId"], 0)
        if pose and arms:
            arm = arms[0]
            bpy.context.view_layer.objects.active = arm
            bpy.ops.object.mode_set(mode="POSE")
            pb = arm.pose.bones.get(DRIVEN_BONE)
            if pb is not None:
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (math.radians(DRIVEN_ROTATION_DEG), 0.0, 0.0)
            bpy.context.view_layer.update()
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.update()
        return meshes

    left = import_at_x(-spacing * 0.5, pose=False)
    right = import_at_x(spacing * 0.5, pose=True)
    placed = left + right
    if placed:
        zs: list[float] = []
        xs: list[float] = []
        for obj in placed:
            b = world_bounds(obj)
            zs.extend([b["min"][2], b["max"][2]])
            xs.extend([b["min"][0], b["max"][0]])
        zmin, zmax = min(zs), max(zs)
        # Aim slightly above mid-height so arms/shoulders dominate the frame
        mid_z = zmin + 0.58 * (zmax - zmin)
        stature = max(zmax - zmin, 0.5)
        dist = max(3.2, stature * 2.4)
        setup_camera_front(target_z=mid_z, distance=dist, center_x=0.0)
        # Slightly wider FOV so both full figures fit
        if bpy.context.scene.camera and bpy.context.scene.camera.data:
            try:
                bpy.context.scene.camera.data.lens = 35.0
            except Exception:
                pass
    else:
        setup_camera_front()
    engine = render_png(grade_path, res_x=1400, res_y=780)
    return {
        "gradePng": grade_path,
        "gradeRenderEngine": engine,
        "drivenBone": DRIVEN_BONE,
        "rotationDegrees": DRIVEN_ROTATION_DEG,
        "bodyClassId": class_result["bodyClassId"],
        "visualChecklistSlots": {
            "limb_moved": "ungraded",
            "garment_followed": "ungraded",
            "no_torn_geometry": "ungraded",
            "materials_distinct": "ungraded",
        },
        "note": "orchestrator fills yes|no from posed-deformation-grade.png (EEVEE lit)",
    }

