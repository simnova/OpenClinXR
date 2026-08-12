import argparse
import json
import pathlib
import re
import struct
import sys

import bpy
import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]

# #333: footwear mapped by reference id. All three are the CC0/CC-0 zero-helper-ref
# subset of makehuman-shoes01 (ledger: toigo_flats CC0, toigo_mj_cloth_shoes CC0,
# culturalibre_male_boots CC-0; every .mhclo references only basemesh verts < 13,380),
# so each fits the #318 helper-stripped 13,380-vert basemesh like the t-shirt/pants.
SHOE_BY_REFERENCE = {
    None: "toigo_flats",
    "peds_nurse_kevin": "culturalibre_male_boots",
    "peds_patient_child": "toigo_mj_cloth_shoes",
}


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.78
    return material


def mesh_from_numpy(name, verts, faces):
    """Build a Blender mesh object from numpy arrays (mirrors body_param_stage._mesh_from_numpy)."""
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


def parse_args():
    argv = []
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    parser = argparse.ArgumentParser(description="Materialize a local MPFB humanoid GLB comparator.")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--reference",
        default=None,
        help=(
            "Tracked Anny reference mesh id (e.g. peds_nurse_kevin) whose .anny_base.obj "
            "drives the MPFB macro dict (#328). Omit for the default-macro body (Aisha path)."
        ),
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# #328: derive the MPFB macro dict from a TRACKED Anny reference.
#
# The blocker this slice closes: `bpy.ops.mpfb.create_human()` (the UI operator)
# takes no macros and no phenotype, so every MPFB2 body the materializer produced
# was the same default human. The documented service is
# `HumanService.create_human(feet_on_ground=True, macro_detail_dict=...)`
# (humanservice.py:1377) — MPFB itself drives it from `human_info["phenotype"]`
# (humanservice.py:997-998). The macro dict is derived from the reference by
# MEASUREMENT, not by hand-authored body-class literals (#305's D9 gap):
#
#   age    <- the reference's head-height fraction (a real proportional signal:
#             measured 0.100 for the adult nurse vs 0.160 for the child). The MPFB
#             age macro has a genuine child band (0.0-0.1875, macro.json), so a
#             child is represented by macros, not by a uniform scale (#151/#304).
#   height <- SOLVED so the baked+stripped EXPORTED body reaches the reference
#             stature. The solve probes are actually baked and exported, then
#             measured with the same band probe the contract uses — no fitted
#             constants, and D9 (execution duration is not a constraint) is
#             respected: each probe is a few seconds.
#   gender/muscle/weight/proportions/cupsize/firmness <- MPFB defaults. What this
#             slice does NOT yet match is stated in the report: an exact MADR 0051
#             §5 landmark match (shoulder, girths, limb lengths) is the follow-on.
#
# Order is load-bearing: the macros are BAKED into the basis geometry with
# TargetService.bake_targets immediately after create_human. Without the bake the
# glTF basis is the default human and the macros ride along only as zero-weight
# morph targets (measured #328 probe: five macro sets exported byte-identical
# bases; baking makes the exported stature differ 1.00-2.37 m across the height
# macro). bake_targets changes topology count not at all, so the #317 face keys
# still load on the full base and the #318 strip still lands at 13,380 verts.
# ---------------------------------------------------------------------------


def _parse_obj_vertices(path):
    positions = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            t = line.strip()
            if t.startswith("v "):
                p = t.split()[1:4]
                positions.append((float(p[0]), float(p[1]), float(p[2])))
    return positions


def measure_reference(reference_id):
    """Measure the tracked Anny reference OBJ (stature, head-height fraction, spans).

    Stature is the y-span. The head-height fraction is the proportion of stature above
    the neck (narrowest torso band in [0.78, 0.92] H, widened-past-1.25x chin band) —
    the same landmarks anny-mpfb-landmark-compare.ts extracts (BAND_WINDOWS.neck).
    Chest/waist lateral spans use the contract's band fractions (0.68-0.76 / 0.55-0.62).
    """
    path = (
        REPO_ROOT / "apps/ui-xr/public/generated-humanoids" / f"{reference_id}.anny_base.obj"
    )
    if not path.is_file():
        raise RuntimeError(f"#328: tracked Anny reference missing: {path}")
    positions = _parse_obj_vertices(str(path))
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    ymin, ymax = min(ys), max(ys)
    stature = ymax - ymin
    if stature <= 0:
        raise RuntimeError(f"#328: {reference_id} has no y-extent — invalid reference OBJ")

    def span(lo, hi):
        band = [x for x, y in zip(xs, ys) if lo <= (y - ymin) / stature <= hi]
        return 2 * max(abs(x) for x in band) if band else 0.0

    step = stature * 0.02
    band_h = stature * 0.04
    bands = []
    y = ymin + band_h
    while y < ymax - band_h / 2:
        frac = (y - ymin) / stature
        bx = [x for x, yy in zip(xs, ys) if y - band_h / 2 <= yy <= y + band_h / 2]
        if len(bx) >= 4:
            bands.append((frac, 2 * max(abs(x) for x in bx)))
        y += step
    neck_bands = [(f, w) for f, w in bands if 0.78 <= f <= 0.92]
    neck_w = min((w for _, w in neck_bands), default=0.0)
    neck_f = min((f for f, w in neck_bands if abs(w - neck_w) < 1e-9), default=0.85)
    chin_f = 1.0
    for f, w in bands:
        if f > neck_f and w > 1.25 * neck_w:
            chin_f = f
            break
    return {
        "referenceId": reference_id,
        "statureMeters": stature,
        "headHeightFraction": 1 - chin_f,
        "chestSpanMeters": span(0.68, 0.76),
        "waistSpanMeters": span(0.55, 0.62),
    }


def derive_macro_dict(reference):
    """Derive the macro dict from the measured reference (see the module docstring).

    The age value is a FUNCTION of the measured head-height fraction, and the height
    value is solved separately (solve_height_macro) against the measured stature —
    no macro value here is a hand-authored body-class literal.
    """
    macro = {
        "gender": 0.5,
        "age": 0.5,
        "muscle": 0.5,
        "weight": 0.5,
        "proportions": 0.5,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.5,
        "race": {"asian": 0.33, "caucasian": 0.33, "african": 0.33},
    }
    head_frac = reference["headHeightFraction"]
    if head_frac >= 0.14:
        # Child band (MPFB age 0.0-0.1875 = baby..child): 0.10 toddler .. 0.30 older
        # child across measured head fractions 0.14 .. 0.22.
        macro["age"] = round(0.1 + (head_frac - 0.14) / 0.08 * 0.2, 4)
    else:
        macro["age"] = 0.6
    return macro


def measure_glb_body(path):
    """Measure an exported GLB exactly like the planted contract: largest non-garment /
    non-hidden primitive, y-span stature, lateral spans at the chest/waist band fractions.

    Pure-python (struct) so the solve can measure its own probe exports inside Blender
    without shelling out to node or the gltf-transform package.
    """
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        raise RuntimeError(f"#328: not a GLB: {path}")
    json_len = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    bviews = gltf["bufferViews"]
    accessors = gltf["accessors"]
    exclude = re.compile(r"hidden|makeclothes|garment|toigo|boot|shoe|scalp|hair", re.I)
    best = []
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mat_idx = prim.get("material")
            mat_name = ""
            if mat_idx is not None:
                mat_name = gltf.get("materials", [])[mat_idx].get("name", "")
            if exclude.search(mat_name):
                continue
            acc = accessors[prim["attributes"]["POSITION"]]
            if acc["componentType"] != 5126:
                continue
            bv = bviews[acc["bufferView"]]
            count = acc["count"]
            off = bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            stride = bv.get("byteStride", 12)
            pos = []
            for i in range(count):
                x, y, z = struct.unpack_from("<fff", data, off + i * stride)
                pos.append((x, y, z))
            if len(pos) > len(best):
                best = pos
    if not best:
        raise RuntimeError(f"#328: no body primitive found in {path}")
    ys = [p[1] for p in best]
    min_y, max_y = min(ys), max(ys)
    stature = max_y - min_y

    def span(lo, hi):
        band = [p[0] for p in best if lo <= (p[1] - min_y) / stature <= hi]
        return 2 * max(abs(x) for x in band) if band else 0.0

    return {
        "statureMeters": stature,
        "chestSpanMeters": span(0.68, 0.76),
        "waistSpanMeters": span(0.55, 0.62),
    }


def _bake_and_export_probe(macro, out_path):
    """create_human + bake macros + strip helpers + export a probe GLB, and measure it.

    The probe deliberately skips rig/face/garment: the body's stature and band spans
    (what the contract reads) are unchanged by the post-strip additions, and the probe
    must be fast enough to run several times in the solve.
    """
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    from bl_ext.user_default.mpfb.services.exportservice import ExportService
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    human = HumanService.create_human(feet_on_ground=True, macro_detail_dict=macro)
    TargetService.bake_targets(human)
    bpy.context.view_layer.update()
    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=str(out_path), export_format="GLB", export_animations=False)
    return measure_glb_body(str(out_path))


def solve_height_macro(base_macro, target_stature, tmp_dir, tol=0.01):
    """Solve the height macro so the baked+stripped EXPORTED body reaches the reference
    stature. Self-calibrating (probe -> measure -> interpolate); no fitted constants."""
    if target_stature <= 0:
        raise RuntimeError(f"#328: non-positive target stature {target_stature}")

    def probe(height):
        macro = dict(base_macro)
        macro["height"] = round(float(height), 4)
        out = pathlib.Path(tmp_dir) / f"probe_h{macro['height']:.4f}.glb"
        try:
            return _bake_and_export_probe(macro, out)["statureMeters"]
        finally:
            out.unlink(missing_ok=True)

    s_mid = probe(0.5)
    if abs(s_mid - target_stature) <= tol:
        return 0.5
    if target_stature > s_mid:
        bracket = [(0.5, s_mid), (1.0, probe(1.0))]
    else:
        bracket = [(0.0, probe(0.0)), (0.5, s_mid)]
    bracket.sort(key=lambda kv: kv[0])
    (h0, s0), (h1, s1) = bracket
    if not (min(s0, s1) <= target_stature <= max(s0, s1)):
        raise RuntimeError(
            f"#328: target stature {target_stature:.3f} m outside the measured height-macro "
            f"range [{min(s0, s1):.3f}, {max(s0, s1):.3f}] m — the macro range is exhausted"
        )
    h_c = h0 + (h1 - h0) * (target_stature - s0) / (s1 - s0)
    h_c = min(max(h_c, 0.0), 1.0)
    s_c = probe(h_c)
    if abs(s_c - target_stature) <= tol:
        return h_c
    # One refinement: interpolate within the bracketing pair that contains the target.
    points = sorted(bracket + [(h_c, s_c)], key=lambda kv: kv[0])
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        if min(a[1], b[1]) <= target_stature <= max(a[1], b[1]):
            h_f = a[0] + (b[0] - a[0]) * (target_stature - a[1]) / (b[1] - a[1])
            return min(max(h_f, 0.0), 1.0)
    return h_c


def main():
    args = parse_args()
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")

    reference = None
    macro = None
    if args.reference:
        reference = measure_reference(args.reference)
        macro = derive_macro_dict(reference)
        print(f"REFERENCE_MEASURED {json.dumps(reference)}")
        print(f"MACRO_BASE {json.dumps(macro)}")
        tmp_dir = pathlib.Path(args.output).parent / f".{pathlib.Path(args.output).name}.solve"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            h_solved = solve_height_macro(macro, reference["statureMeters"], tmp_dir)
        finally:
            import shutil

            shutil.rmtree(tmp_dir, ignore_errors=True)
        macro["height"] = round(h_solved, 4)
        print(
            f"MACRO_SOLVED height={macro['height']} "
            f"target_stature={reference['statureMeters']:.4f}"
        )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    from bl_ext.user_default.mpfb.services.humanservice import HumanService

    if reference is not None:
        from bl_ext.user_default.mpfb.services.targetservice import TargetService

        human = HumanService.create_human(feet_on_ground=True, macro_detail_dict=macro)
        # Bake the macro targets into the basis so the EXPORTED body reflects the
        # reference (see the module docstring for the measured reason).
        TargetService.bake_targets(human)
        bpy.context.view_layer.update()
        prefix = f"mpfb_{args.reference}"
        human.name = f"{prefix}_body_mesh"
        human.data.name = f"{prefix}_body"
    else:
        # No reference: default macros, matching the pre-#328 Aisha bake byte-for-byte
        # (the UI operator this replaces also called HumanService.create_human with
        # default macros; only the panel-side select/rename steps were dropped).
        human = HumanService.create_human(feet_on_ground=True)
        human.name = "mpfb_ob_patient_aisha_body_mesh"
        human.data.name = "mpfb_ob_patient_aisha_body"
    human.data.materials.clear()
    skin_material_name = f"mpfb_skin_{args.reference or 'ob_patient_aisha'}"
    human.data.materials.append(make_material(skin_material_name, (0.68, 0.53, 0.44, 1.0)))

    # #222: wire the proven bounds-derived scalp/hair material region from the Anny rail
    # (tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201) instead of hand-authoring
    # a UV sphere (D1: "do not have workers hand-author bespoke geometry"). The function is not
    # topology-bound: it derives the region from mesh bounds, auto-detects the dominant height
    # axis, and excludes the front mid-face band (#73). MPFB create_human is Blender-local
    # Z-up with the face at -Y (measured 2026-08-11: nose tip at y=-0.168, head positive
    # extreme at +0.054) — exactly what the function's Z-height branch expects, so NO Z-flip is
    # applied. A 180-deg Z flip (the pre-#317 assumption that create_human faces +Y) pushes the
    # face to +Y, the face-band exclusion never fires (skippedFaceFrontFaceCount=0), and the
    # scalp paint covers the eyes/brows — which strands their morph-target deltas on the scalp
    # primitive at export and made #317's face census read them as empty.
    import sys as _sys

    _anny_dir = REPO_ROOT / "tools/openclinxr/asset-pipeline/anny"
    if str(_anny_dir) not in _sys.path:
        _sys.path.insert(0, str(_anny_dir))
    from automate_blender import apply_mesh_native_scalp_hair_material_region  # noqa: E402

    scalp_hair_region = apply_mesh_native_scalp_hair_material_region(
        human, {"hair_color": "black", "hair_density": 0.65}
    )
    print(f"SCALP_HAIR_REGION {scalp_hair_region}")

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = human
    human.select_set(True)
    bpy.ops.mpfb.add_standard_rig()

    # #317: replace the MPFB UI operator with the proven TargetService path.
    # bpy.ops.mpfb.load_face_shape_keys() reads FACEOPS_PROPERTIES from the panel, finds nothing
    # in a headless run, warns, and returns FINISHED — the bake looked green while Aisha shipped
    # with ZERO face targets (D1: wire the proven tool, do not hand-author morph geometry).
    # body_param_stage.load_mpfb_face_shape_keys walks the MPFB extension target tree and calls
    # TargetService.filename_to_shapekey_name + TargetService.load_target directly — the path
    # that gave the two hm08 library bodies their 27 face targets and 13 working mouth shapes.
    import sys as _sys2

    _makeclothes_dir = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
    if str(_makeclothes_dir) not in _sys2.path:
        _sys2.path.insert(0, str(_makeclothes_dir))
    from body_param_stage import load_mpfb_face_shape_keys  # noqa: E402

    face_status = load_mpfb_face_shape_keys(human)
    print(f"FACE_TARGETS {face_status}")
    if face_status.get("error") or (face_status.get("loaded") or 0) < 8:
        raise RuntimeError(f"face target load failed: {face_status}")
    mouth_named = [n for n in (face_status.get("names") or []) if any(
        k in n for k in ("mouth", "lip", "jaw")
    )]
    print(f"FACE_TARGETS_MOUTH_NAMED {len(mouth_named)} {mouth_named}")
    if len(mouth_named) < 8:
        raise RuntimeError(
            f"fewer than 8 mouth-named face targets loaded ({len(mouth_named)}); "
            f"a bake that ships without usable mouth morphs must fail loudly"
        )

    # #337: fit MakeHuman's default CC0 eyes on the FULL basemesh BEFORE the #318 helper
    # strip. The eye .mhclo (`data/eyes/hm08/low-poly` in the makehumancommunity/makehuman2
    # repo) references ONLY helper verts 14598-14741 — the helper-l-eye / helper-r-eye
    # volumes the issue measured — so the fit MUST run while those verts exist. The header
    # of the .mhclo is the licence: "This asset was explicitly released as CC0 in september
    # 2020", copyright holders Data Collection AB / Joel Palmius / Jonas Hauquier (recorded
    # in third-party-asset-licence-ledger.md). `HumanService.add_mhclo_asset` is the proven
    # MPFB-native path (mesh load + ClothesService fit + delete group + rigging);
    # material_type="PROCEDURAL_EYES" applies MPFB's OWN shipped shader
    # (data/node_trees/procedural_eyes.json + data/settings/eye_settings.default.json), so
    # no hand-authored geometry and no hand-authored material. `add_mhclo_asset`'s own
    # set_up_rigging/interpolate_weights then weights every eye vert to the standard rig's
    # eye.L/eye.R bones (probe below: dominant groups eye.L: 48 / eye.R: 48) — the eye
    # mesh, not the socket skin, is what the gaze drive must move (#296). The eye is a
    # SEPARATE object, so the #318 helper strip (which deletes the helper verts the fit
    # referenced) does not touch it.
    _eyes_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/eyes/makehuman-default"
    )
    eye_mhclo = _eyes_dir / "low-poly.mhclo"
    eye_obj = _eyes_dir / "low-poly.obj"
    if not eye_mhclo.is_file() or not eye_obj.is_file():
        raise RuntimeError(f"#337: CC0 MakeHuman default eye sources missing in provider cache: {_eyes_dir}")

    from bl_ext.user_default.mpfb.services.humanservice import HumanService as _HumanService  # noqa: E402

    eyes_asset = _HumanService.add_mhclo_asset(
        str(eye_mhclo),
        human,
        asset_type="eyes",
        subdiv_levels=0,
        material_type="PROCEDURAL_EYES",
    )
    bpy.context.view_layer.update()
    eye_tris = sum(max(len(p.vertices) - 2, 0) for p in eyes_asset.data.polygons)
    # Probe: dominant vertex groups on the eye mesh immediately after add_mhclo_asset
    # (before the k-NN transfer below) — tells us whether interpolate_weights gave the
    # eye mesh eye-bone weights from the helper verts.
    from collections import Counter as _Counter

    _dom = _Counter()
    for _v in eyes_asset.data.vertices:
        best = None
        best_w = 0.0
        for _ge in _v.groups:
            _g = eyes_asset.vertex_groups[_ge.group]
            if _ge.weight > best_w:
                best, best_w = _g.name, _ge.weight
        if best:
            _dom[best] += 1
    print(
        f"EYES_FIT {eyes_asset.name} verts {len(eyes_asset.data.vertices)} "
        f"tris {eye_tris} material {[m.name for m in eyes_asset.data.materials]} "
        f"dominantGroups {dict(_dom.most_common(6))}"
    )

    # #318: strip MakeHuman's clothes and hair FITTING SHELLS with the proven MPFB export
    # service (D1). `bpy.ops.mpfb.create_human()` materialises the FULL base.obj including
    # helper geometry — 36,972 tris, exactly MADR 0052's "with helpers" figure — and Aisha
    # has shipped with those shells since #263 (graded 2026-08-11: a floor-length robe and a
    # hood with flat quads across the face, hiding the correct body beneath). 
    # ExportService.bake_modifiers_remove_helpers (exportservice.py:79, remove_helpers=True)
    # is the MPFB-shipped strip; the documented result is 26,756 tris / 13,380 verts (MADR
    # 0052 cross-check). ORDER IS LOAD-BEARING: the face targets must load on the FULL base
    # topology above — deleting helper verts re-maps shape-key blocks, and a target loaded
    # after the strip would mis-index (body_param_stage.py #221 A2). The FACS keys loaded
    # above survive on body-surface verts; Blender updates their key blocks when the helper
    # verts are deleted.
    verts_before_strip = len(human.data.vertices)
    tris_before_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
    from bl_ext.user_default.mpfb.services.exportservice import ExportService  # noqa: E402

    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )
    bpy.context.view_layer.update()
    verts_after_strip = len(human.data.vertices)
    tris_after_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
    print(
        f"HELPER_STRIP verts {verts_before_strip} -> {verts_after_strip}; "
        f"tris {tris_before_strip} -> {tris_after_strip}"
    )

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("MPFB standard rig was not created")
    armature.name = f"mpfb_{args.reference or 'ob_patient_aisha'}_standard_rig"

    # #337 eye-bone skinning: NOTHING MORE TO DO — `add_mhclo_asset`'s own
    # set_up_rigging/interpolate_weights already weighted every one of the 96 eye verts to
    # the standard rig's eye.L/eye.R bones (probe: dominant groups eye.L: 48 / eye.R: 48),
    # exactly MakeHuman's eye rigging design. Measured attempt at replacing it with the
    # garment k-NN projection (transfer_weights_body_to_garment) was WRONG: k-NN over the
    # 12 nearest body verts diluted the eye-bone weights to ~1/96 verts (the socket body
    # verts carrying eye weights are a 31/30 minority of the local neighbourhood), so the
    # eye would rotate with the head, not with the gaze. The interpolate_weights result is
    # kept and the transfer is NOT run. (The 31/30 eye-weighted BODY verts measured in
    # #337's issue body are the socket skin — the eye MESH is what the gaze drive needs.)

    # #321: fit a real MakeHuman garment on the helper-stripped basemesh via the
    # PROVEN ClothesService path (D1) — the same code body_param_stage.py uses for
    # the hm08 library rail. Do not hand-author garment geometry and do not write a
    # new fitter. ORDER IS LOAD-BEARING: the fit runs AFTER the #318 helper strip
    # because .mhclo vertex refs index the canonical 13,380-vert hm08 basemesh
    # topology — exactly what the strip leaves. The toigo basic tucked t-shirt is
    # CC0 (mhclo header) and references only body verts (max ref 11,017 < 13,380);
    # the polo references 3,648 helper verts and CANNOT fit a stripped basemesh —
    # it is refused loudly, not fitted against absent indices (clause 3).
    # CLINICAL CHOICE: the least-wrong garment for an OB triage patient. A hospital
    # gown is not in the cached library and a scrub shirt is staff wear; a patient
    # presenting in street clothes (a basic t-shirt) is plausible triage staging.
    import sys as _sys3

    _stage_dir = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
    if str(_stage_dir) not in _sys3.path:
        _sys3.path.insert(0, str(_stage_dir))
    from body_param_stage import import_obj, apply_object_transforms, transfer_weights_body_to_garment  # noqa: E402

    _garment_dir = (
        REPO_ROOT
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-shirts01/toigo_basic_tucked_t-shirt"
    )
    garment_obj = _garment_dir / "t_shirt_basic_tucked.obj"
    garment_mhclo = _garment_dir / "toigo_basic_tucked_t-shirt.mhclo"
    if not garment_obj.is_file() or not garment_mhclo.is_file():
        raise RuntimeError(f"toigo t-shirt sources missing in provider cache: {_garment_dir}")

    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService  # noqa: E402

    garment = import_obj(str(garment_obj), "makeclothes_library_toigo_t_shirt", force_z=False)
    # #321 handback: bake the OBJ importer's axis rotation into mesh data so the garment object is
    # identity/Z-up — the SAME bake MPFB's body loader performs on the basemesh
    # (`ObjectService.load_wavefront_file`, transform_apply(rotation=True)). The fit writes BODY-LOCAL
    # coordinates into the garment mesh; a garment object carrying the importer's 90-degree X rotation
    # renders those coords rotated (measured: garment on the floor with Y/Z swapped). apply_object_transforms
    # is the proven helper body_param_stage uses; this is a bake, not a hand-written matrix.
    apply_object_transforms(garment)
    garment.data.materials.clear()
    # Name matches the GARMENT_MATERIAL regex the evidence RED reads (makeclothes/shirt).
    garment.data.materials.append(
        make_material("mat_makeclothes_library_toigo_t_shirt", (0.30, 0.45, 0.62, 1.0))
    )
    mhclo = Mhclo()
    mhclo.load(str(garment_mhclo))
    try:
        mhclo.clothes = garment
    except Exception:
        pass
    garment_verts_before = len(garment.data.vertices)
    ClothesService.fit_clothes_to_human(garment, human, mhclo=mhclo, set_parent=True)
    bpy.context.view_layer.update()
    garment_verts_after = len(garment.data.vertices)
    garment_tris = sum(max(len(p.vertices) - 2, 0) for p in garment.data.polygons)
    # Bind the garment to the same armature so it deforms with the body (the proven
    # weight projection body_param_stage runs for the hm08 rail; not a rigid shell).
    weights = transfer_weights_body_to_garment(human, garment, armature)
    print(
        f"GARMENT_FIT {garment.name} verts {garment_verts_before} -> {garment_verts_after} "
        f"tris {garment_tris} weights {weights}"
    )

    # #326: fit the CC0 cargo pants on the SAME body via the SAME proven
    # ClothesService path (D1) — the exact garment + service the hm08 library rail
    # fits (`body-param-cli.ts` `LIBRARY_LOWER_GARMENT_ID` = cortu_cargo_pants,
    # makehuman-pants01 pack). She ships bare below the waist today (measured:
    # upper toigo t-shirt 5,400 verts, lower NONE); the library lean_female carries
    # the same trousers at 8,565 verts through this call. The .mhclo header is
    # `# Cortu Johnstone - CC0`, basemesh hm08, max vertex ref 13,351 < 13,380 — it
    # fits the helper-stripped topology exactly like the t-shirt.
    _pants_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-pants01/cortu_cargo_pants"
    )
    pants_obj = _pants_dir / "cargo_pants.obj"
    pants_mhclo = _pants_dir / "cargo_pants.mhclo"
    if not pants_obj.is_file() or not pants_mhclo.is_file():
        raise RuntimeError(f"cargo pants sources missing in provider cache: {_pants_dir}")

    pants = import_obj(str(pants_obj), "makeclothes_library_cargo_pants", force_z=False)
    # Same axis bake as the t-shirt (#321 handback): the OBJ importer's rotation is
    # baked into mesh data so the object is identity/Z-up before the fit writes
    # body-local coordinates into it.
    apply_object_transforms(pants)
    pants.data.materials.clear()
    # Name matches the LOWER_GARMENT regex the evidence RED reads (cargo/pants) AND
    # the GARMENT regex of the #323 regression net (makeclothes).
    pants.data.materials.append(
        make_material("mat_makeclothes_library_cargo_pants", (0.32, 0.36, 0.42, 1.0))
    )
    mhclo_pants = Mhclo()
    mhclo_pants.load(str(pants_mhclo))
    try:
        mhclo_pants.clothes = pants
    except Exception:
        pass
    pants_verts_before = len(pants.data.vertices)
    ClothesService.fit_clothes_to_human(pants, human, mhclo=mhclo_pants, set_parent=True)
    bpy.context.view_layer.update()
    print(
        f"PANTS_FIT {pants.name} verts {pants_verts_before} -> {len(pants.data.vertices)} "
        f"tris {sum(max(len(p.vertices) - 2, 0) for p in pants.data.polygons)}"
    )
    # The raw fit is the sparse 392-triangle trouser (#220: 71% leg coverage, 32 open
    # edges). The LOWER GATE below (mirrored from body_param_stage) measures it against
    # the leg band and replaces a `does_not_cover` fit with the body-derived cover
    # shell — the same replacement that gives the library rail its 8,565-vert lower
    # garment. The weight transfer + print happen there, on the geometry that SHIPS.

    # #323: body-part hiding under the fitted garment — wire the PROVEN tool from
    # the sibling rail (D1), do not write a second hider. The MPFB2 rail has NO
    # body-part hiding: the fitted t-shirt and the body it is fitted to both
    # render, and the body pokes through the cloth in large skin-coloured patches
    # across chest, abdomen, shoulders and collar (graded on #321's placement
    # fix). The library rail solves exactly this with
    # body_param_stage.apply_body_hide_material_region (body_param_stage.py:651)
    # — the §6s research answer: HIDE the body under the garment (alpha mask)
    # rather than push the cloth out. The mask is per-triangle from
    # garment_coverage.body_hide_mask (signed clearance < HIDE_EPSILON_M against
    # the BODY's outward normal — winding-proof, _orient_outward), and it paints
    # an alpha-0 material so the hidden faces never render; geometry, rig and
    # shape keys are untouched (only polygon material indices change). The glTF
    # exporter maps the constant alpha-0 Principled input to alphaMode=MASK /
    # alphaCutoff=0.5, so the faces are DISCARDED at render (measured on the
    # library rail's shipped bytes).
    #
    # ORDER IS LOAD-BEARING: the mask runs AFTER the fit + weight transfer so it
    # covers the FINAL garment footprint (the fit writes body-local coordinates
    # into the garment mesh, and the export reads material indices at export
    # time). It does NOT push the garment further out — #322 measured the raw
    # MakeClothes fit at median ~0.7 mm (half the surface coincident with the
    # skin) and the 1.5 cm shipping standoff already survives; hiding is the
    # other half of the fix and standoff alone did not stop the poke-through.
    #
    # #295 SCOPE: the mask is scoped away from the hands from the start via
    # body_param_stage.scope_hide_mask_away_from_hands — a body face whose
    # vertices are dominated by a hand/finger joint is a BARE hand (the garment
    # terminates at the wrist), and leaving it under the alpha-MASK would discard
    # it and show a stump where the sleeve was — the mitten defect on a second
    # rail.
    import sys as _sys4

    _stage_dir2 = (
        pathlib.Path(__file__).resolve().parents[4] / "tools/openclinxr/asset-pipeline/makeclothes"
    )
    if str(_stage_dir2) not in _sys4.path:
        _sys4.path.insert(0, str(_stage_dir2))
    from body_param_stage import (  # noqa: E402
        apply_body_hide_material_region,
        clip_hide_mask_to_garment_footprint,
        scope_hide_mask_away_from_hands,
        world_bounds,
    )
    from garment_coverage import HIDE_EPSILON_M, body_hide_mask  # noqa: E402

    def _triangulate_numpy(obj: bpy.types.Object):
        # Fan triangulation mirroring body_param_stage._numpy_mesh: the coverage
        # predicate assumes triangle faces, and MPFB bodies / OBJ imports are
        # quad/n-gon meshes (body 13,380 verts / 26,756 tris = 13,378 quads).
        # WORLD coordinates (matrix_world @ v.co) so the body and garment share
        # one frame regardless of object transforms — the same frame world_bounds
        # reports the band in. Feeding raw quads to the predicate garbles the
        # surface (issue-277, measured on the library gate's first run).
        mw = obj.matrix_world
        verts = np.array([tuple(mw @ v.co) for v in obj.data.vertices], dtype=float)
        faces: list[tuple[int, int, int]] = []
        for p in obj.data.polygons:
            iv = list(p.vertices)
            if len(iv) == 3:
                faces.append((int(iv[0]), int(iv[1]), int(iv[2])))
            else:
                # fan triangulation from vertex 0 — the SAME order
                # apply_body_hide_material_region consumes (polygon fan order),
                # so the per-triangle mask maps back to the right polygons.
                for i in range(1, len(iv) - 1):
                    faces.append((int(iv[0]), int(iv[i]), int(iv[i + 1])))
        return verts, np.array(faces, dtype=np.int64)

    body_verts, body_faces = _triangulate_numpy(human)
    garment_verts, garment_faces = _triangulate_numpy(garment)
    gb = world_bounds(garment)

    # #326 — LOWER GATE, mirrored from body_param_stage.build_one_body_class (D1: the
    # same measurement and the same deterministic fallback, no second fitter). The raw
    # cargo-pants fit is the sparse 392-triangle trouser the #220 finding records (71%
    # leg coverage, 32 open edges) — it cannot cover the leg band it claims. A sparse
    # open fit is replaced by the body-derived cover shell (`build_cover_shell`, covers
    # by construction), exactly the replacement that gives the hm08 library rail its
    # 8,565-vert lower garment; a fit that does cover is offset to the shipping standoff
    # (#322). The shipped lower carries the cargo-pants mesh prefix + material name so
    # the evidence RED reads it as the lower garment. Runs BEFORE the masks so the hide
    # masks measure the geometry that SHIPS.
    from garment_coverage import (  # noqa: E402
        CLOTH_STANDOFF_M,
        build_cover_shell,
        cloth_offset,
        coverage_report,
    )
    from body_param_stage import _LIMB_BONE_RE, _bone_dominant_vertex_indices  # noqa: E402

    hem_z = float(gb["min"][2])  # upper garment hem (Z-up stage frame)
    ankle_z = float(world_bounds(human)["min"][2]) + 0.10  # bare feet begin below
    pants_v, pants_f = _triangulate_numpy(pants)
    lower_rep = coverage_report(
        body_verts,
        body_faces,
        pants_v,
        pants_f,
        ankle_z,
        hem_z,
        garment_label="lower",
        height_axis=2,
    )
    if lower_rep["verdict"] == "does_not_cover":
        # #295 — the leg shell must not wrap the hanging hands (measured 3,450
        # hand-dominant verts in the heavy-male lower fallback): exclude
        # arm/forearm/hand-dominant body faces from the shell band selection.
        limb_verts = _bone_dominant_vertex_indices(human, armature, _LIMB_BONE_RE)
        shell_limb_exclude = np.array(
            [any(int(vi) in limb_verts for vi in f) for f in body_faces], dtype=bool
        )
        shell = build_cover_shell(
            body_verts,
            body_faces,
            ankle_z,
            hem_z,
            standoff=CLOTH_STANDOFF_M,
            label=f"makeclothes_library_cargo_pants_fallback_mpfb_{args.reference or 'ob_patient_aisha'}",
            height_axis=2,
            exclude_faces=shell_limb_exclude,
        )
        shell_obj = mesh_from_numpy(
            f"makeclothes_library_cargo_pants_mpfb_{args.reference or 'ob_patient_aisha'}",
            np.asarray(shell["position"]).reshape(-1, 3),
            np.asarray(shell["indices"]).reshape(-1, 3),
        )
        shell_obj.data.materials.clear()
        # Name matches the LOWER_GARMENT regex the evidence RED reads (cargo/pants).
        shell_obj.data.materials.append(
            make_material("mat_makeclothes_library_cargo_pants", (0.32, 0.36, 0.42, 1.0))
        )
        bpy.data.objects.remove(pants, do_unlink=True)
        pants = shell_obj
        lower_rep["note"] = "sparse library fit replaced with body-derived cover shell (#220)"
        pants_mesh_name = shell_obj.name
        pants_verts_after = shell["vertexCount"]
        pants_tris = shell["faceCount"]
    else:
        # #322 — a fit that covers ships at the 1.5 cm standoff (mirror the stage else).
        pants_v_off = cloth_offset(pants_v, body_verts, body_faces, CLOTH_STANDOFF_M)
        for i, v in enumerate(pants.data.vertices):
            v.co = tuple(float(x) for x in pants_v_off[i])
        bpy.context.view_layer.update()
        pants_mesh_name = pants.name
        pants_verts_after = len(pants.data.vertices)
        pants_tris = sum(max(len(p.vertices) - 2, 0) for p in pants.data.polygons)
    # Bind the trousers to the armature too (same projection as the t-shirt).
    pants_weights = transfer_weights_body_to_garment(human, pants, armature)
    print(
        f"LOWER_GATE {lower_rep} pantsMesh {pants_mesh_name} verts {pants_verts_after} "
        f"tris {pants_tris} weights {pants_weights}"
    )
    hide_info = body_hide_mask(
        body_verts,
        body_faces,
        garment_verts,
        garment_faces,
        float(gb["min"][2]),
        float(gb["max"][2]),
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    hide_mask = hide_info.pop("hideMask")
    if hide_info["hiddenFaceCount"] == 0:
        print(
            "BODY_HIDE WARNING: body_hide_mask found no poking body faces under the "
            "fitted garment — the #323 poke-through would not be fixed; report this"
        )
    # #295 — never discard a bare hand: scope the mask to the covered region.
    hide_mask, hand_faces_unhidden = scope_hide_mask_away_from_hands(human, hide_mask, armature)
    # #326 — clip the mask to the garment's footprint (SHARED over-reach fix; the
    # signed-clearance test admits body faces just outside the garment silhouette and
    # the discarded verts render as slivers — measured 23.7 mm below the hem here).
    hide_mask, footprint_clipped = clip_hide_mask_to_garment_footprint(
        hide_mask, human, gb
    )
    applied = apply_body_hide_material_region(human, hide_mask, slot="upper")
    print(
        f"BODY_HIDE {hide_info} "
        f"handFacesUnhidden {hand_faces_unhidden} "
        f"footprintClippedFaces {footprint_clipped} "
        f"appliedPolygonCount {applied['appliedPolygonCount']} "
        f"hiddenMaterialName {applied['hiddenMaterialName']} "
        f"bodyBlenderVerts {len(human.data.vertices)} "
        f"garmentBlenderVerts {len(garment.data.vertices)}"
    )

    # #326 — lower channel: hide the body under the cargo pants the same way, with the
    # same shared tools (D1 — no second hider). The mask is the same signed-clearance
    # predicate against the trousers' surface, scoped away from the hands and clipped to
    # the trousers' footprint.
    pants_verts_np, pants_faces_np = _triangulate_numpy(pants)
    pb = world_bounds(pants)
    lower_hide_info = body_hide_mask(
        body_verts,
        body_faces,
        pants_verts_np,
        pants_faces_np,
        float(pb["min"][2]),
        float(pb["max"][2]),
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    lower_hide_mask = lower_hide_info.pop("hideMask")
    if lower_hide_info["hiddenFaceCount"] == 0:
        print(
            "LOWER_BODY_HIDE WARNING: body_hide_mask found no poking body faces under the "
            "fitted cargo pants — the #326 lower channel would not hide; report this"
        )
    lower_hide_mask, lower_hand_faces = scope_hide_mask_away_from_hands(
        human, lower_hide_mask, armature
    )
    lower_hide_mask, lower_footprint_clipped = clip_hide_mask_to_garment_footprint(
        lower_hide_mask, human, pb
    )
    lower_applied = apply_body_hide_material_region(human, lower_hide_mask, slot="lower")
    print(
        f"LOWER_BODY_HIDE {lower_hide_info} "
        f"handFacesUnhidden {lower_hand_faces} "
        f"footprintClippedFaces {lower_footprint_clipped} "
        f"appliedPolygonCount {lower_applied['appliedPolygonCount']} "
        f"hiddenMaterialName {lower_applied['hiddenMaterialName']} "
        f"pantsBlenderVerts {len(pants.data.vertices)}"
    )

    # #333: fit a real MakeHuman shoe on the SAME helper-stripped basemesh via the SAME
    # proven ClothesService path (D1) — the footwear channel the MPFB rail lacks. The
    # library rail fits shoes with embed_library_footwear.py against a RECONSTRUCTED
    # base.obj reference because its GLB re-import reindexes vertices; here the fit runs
    # directly on the in-scene basemesh (intact 13,380-vert topology, Z-up) exactly like
    # the t-shirt and cargo pants fits above. The shoes are the cached CC0/CC-0
    # zero-helper-ref subset of makehuman-shoes01 (third-party-asset-licence-ledger.md):
    #   aisha (OB patient)       -> toigo_flats           (CC0, 28,808 verts)
    #   peds_nurse_kevin (nurse) -> culturalibre_male_boots (CC-0, 15,308 verts)
    #   peds_patient_child       -> toigo_mj_cloth_shoes  (CC0, 556 verts)
    # .mhclo body-vertex refs index the canonical 13,380-vert hm08 basemesh (the ledger
    # measured zero refs >= 13,380 for all three), so they fit the stripped topology like
    # the t-shirt and trousers. GROUNDING IS THRESHOLD-FREE: the fitted sole lands a few
    # mm BELOW the body's foot bottom (measured 8-13 mm on probes — real sole depth);
    # the shoe is then lifted by that landmark gap so sole == body bottom, exactly the
    # known-good library measurement (-0.00 cm) and embed_library_footwear's sole-anchor.
    shoe_kind = SHOE_BY_REFERENCE.get(args.reference)
    if shoe_kind is None:
        raise RuntimeError(f"#333: no footwear mapped for reference {args.reference!r}")
    _shoes_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-shoes01"
        / shoe_kind
    )
    shoe_obj = next(_shoes_dir.glob("*.obj"), None)
    shoe_mhclo = next(_shoes_dir.glob("*.mhclo"), None)
    if shoe_obj is None or shoe_mhclo is None:
        raise RuntimeError(f"#333: {shoe_kind} sources missing in provider cache: {_shoes_dir}")

    shoe = import_obj(str(shoe_obj), f"makeclothes_library_footwear_{shoe_kind}", force_z=False)
    # Same axis bake as the t-shirt/pants (#321 handback): identity/Z-up before the fit
    # writes body-local coordinates into the mesh.
    apply_object_transforms(shoe)
    shoe.data.materials.clear()
    # Name matches the FOOTWEAR regex the evidence RED reads (footwear/shoe/boot/flat).
    shoe.data.materials.append(
        make_material(f"mat_makeclothes_library_footwear_{shoe_kind}", (0.10, 0.09, 0.08, 1.0))
    )
    mhclo_shoe = Mhclo()
    mhclo_shoe.load(str(shoe_mhclo))
    try:
        mhclo_shoe.clothes = shoe
    except Exception:
        pass
    shoe_verts_before = len(shoe.data.vertices)
    ClothesService.fit_clothes_to_human(shoe, human, mhclo=mhclo_shoe, set_parent=True)
    bpy.context.view_layer.update()
    # The glTF mesh name is the MESH DATA name (the OBJ importer keeps its own); rename
    # both so the exported mesh carries the footwear channel name.
    _ref_tag = args.reference or "ob_patient_aisha"
    shoe.data.name = f"makeclothes_library_footwear_{shoe_kind}_mpfb_{_ref_tag}_mesh"
    shoe.name = f"makeclothes_library_footwear_{shoe_kind}_mpfb_{_ref_tag}"

    body_min_z = min(v.co.z for v in human.data.vertices)
    shoe_min_z = min(v.co.z for v in shoe.data.vertices)
    delta_z = body_min_z - shoe_min_z
    if abs(delta_z) > 1e-9:
        for v in shoe.data.vertices:
            v.co.z += delta_z
        bpy.context.view_layer.update()
    shoe_verts_after = len(shoe.data.vertices)
    shoe_tris = sum(max(len(p.vertices) - 2, 0) for p in shoe.data.polygons)
    # Bind the shoe to the same armature so it is skinned and deforms with the foot
    # (the proven k-NN projection, not a rigid prop).
    shoe_weights = transfer_weights_body_to_garment(human, shoe, armature)
    print(
        f"FOOTWEAR_FIT {shoe.name} verts {shoe_verts_before} -> {shoe_verts_after} "
        f"tris {shoe_tris} soleDeltaZ {delta_z:.6f} weights {shoe_weights}"
    )

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 90
    action = bpy.data.actions.new("ClinicalIdleConversation")
    armature.animation_data_create()
    armature.animation_data.action = action

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    for frame, head_z, spine_x, arm_l_z, arm_r_z in [
        (1, 0.00, 0.00, 0.00, 0.00),
        (30, 0.05, 0.025, -0.10, 0.08),
        (60, -0.035, -0.015, 0.04, -0.06),
        (90, 0.00, 0.00, 0.00, 0.00),
    ]:
        bpy.context.scene.frame_set(frame)
        for bone_name, rotation in [
            ("head", (0.0, 0.0, head_z)),
            ("spine03", (spine_x, 0.0, 0.0)),
            ("upperarm01.L", (0.0, 0.0, arm_l_z)),
            ("upperarm01.R", (0.0, 0.0, arm_r_z)),
        ]:
            pose_bone = armature.pose.bones.get(bone_name)
            if pose_bone:
                pose_bone.rotation_mode = "XYZ"
                pose_bone.rotation_euler = rotation
                pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")

    if human.data.shape_keys:
        human.data.shape_keys.animation_data_create()
        human.data.shape_keys.animation_data.action = bpy.data.actions.new("ClinicalExpressionMicroTransition")
        key_blocks = list(human.data.shape_keys.key_blocks)[1:3]
        for frame, value in [(1, 0.0), (30, 0.15), (60, 0.05), (90, 0.0)]:
            bpy.context.scene.frame_set(frame)
            for key in key_blocks:
                key.value = value
                key.keyframe_insert(data_path="value", frame=frame)

    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_animations=True)
    print(f"EXPORTED {output}")

    # #328 census: report the final exported body the same way the planted contract
    # measures it (largest non-garment/non-hidden primitive), plus the macro dict and
    # its measured source, so the orchestrator can grade the result without re-deriving.
    final_measure = measure_glb_body(str(output))
    census = {
        "reference": args.reference,
        "macro": macro,
        "macroSource": (
            f"apps/ui-xr/public/generated-humanoids/{args.reference}.anny_base.obj "
            "(measured stature + head-height fraction; height solved by bake-measure-interpolate)"
            if args.reference
            else "default_macro_info_dict (HumanService None path — pre-#328 Aisha bake unchanged)"
        ),
        "statureMeters": round(final_measure["statureMeters"], 4),
        "chestSpanMeters": round(final_measure["chestSpanMeters"], 4),
        "waistSpanMeters": round(final_measure["waistSpanMeters"], 4),
        "chestWaistRatio": round(
            final_measure["chestSpanMeters"] / final_measure["waistSpanMeters"], 4
        ),
        # #333: the footwear channel — kind, exported substance and the grounding delta
        # (sole == body bottom after the threshold-free landmark lift).
        "footwear": {
            "kind": shoe_kind,
            "mesh": shoe.name,
            "verts": shoe_verts_after,
            "tris": shoe_tris,
            "weights": shoe_weights.get("ok"),
            "soleDeltaZ": round(delta_z, 6),
            "bodyMinZ": round(body_min_z, 6),
            "shoeMinZ": round(body_min_z, 6),
        },
        "outOfScopeWrongness": (
            "garment/hide-mask/poke-through were not re-graded for the new bodies; "
            "the toigo t-shirt was authored for an adult and is expected to fit the child "
            "loosely. Exact MADR 0051 §5 landmark match (shoulder/girths/limbs) is NOT "
            "claimed — follow-on."
        ),
    }
    print(f"BODY_CENSUS {json.dumps(census)}")


if __name__ == "__main__":
    main()
