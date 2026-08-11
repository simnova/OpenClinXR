#!/usr/bin/env python3
"""#324 — embed a fitted CC0 MakeClothes shoe into body-param library GLBs.

#219/#212/#295: the procedural footwear shells were 86 vertices per shoe over
~4,280 foot vertices — a resolution defect, not a fit defect (#324, measured on the
shipped bytes: 2 prims / 172 verts per rail). This stage replaces the procedural
shell with a real MakeClothes `.mhclo` shoe fitted through the SAME
`ClothesService.fit_clothes_to_human` the upper (#322 toigo t-shirt) and lower
(#220 cargo pants) channels use (D1 — wire the proven path, do not write a second
fitter).

Why the fit runs against a reconstructed reference rather than the shipped GLB
body: the GLB body is re-imported from a material-split glTF export, so its vertex
indexing does not match the `.mhclo` body-vertex references (measured: the re-import
merges the skin/hidden/scalp primitives into 53,672 verts vs 13,380 in the source
basemesh — a fit by index would read the wrong vertices). The reference is the same
MPFB `base.obj` the body_param stage consumes, with the body class's phenotype
macros re-applied as live shape keys — the fit reads the from-mix shape exactly as
the stage does. The fitted shoe is then placed onto the GLB body by foot landmarks
(scale 0.1 dm->m + sole/x-y anchor translation) and baked into world space.

The licence is recorded from the shoe's OWN `.mhclo` header (passed in by the CLI,
which reads it with `readMhcloLicense`). A generated shell has no header to cite;
subdividing the old blob would produce a smoother shell with no provenance — clause
(2) of the contract refuses that (#322's catalog bug: CC-BY attributed to a
procedural shell).

Usage:
  blender --background --python embed_library_footwear.py -- \\
    --glb apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb \\
    --out  <same> \\
    --role family \\
    --mh-base-obj <MPFB data/3dobjs/base.obj> \\
    --phenotype-json '{"weight":0.18,"gender":0.0,"age":0.5,"muscle":0.45,"height":0.5,"proportions":0.5}' \\
    --shoe-mhclo <provider-cache/.../toigo_flats.mhclo> \\
    --shoe-obj <provider-cache/.../flats.obj> \\
    --shoe-kind flats \\
    --shoe-license-token CC0 \\
    --shoe-license-source 'mhclo_header:...; license=CC0' \\
    --report <path.json>

claimScope: fitted library footwear on body-param library GLBs, weighted to foot.L/R,
  licence recorded from the shoe's own .mhclo header.
notEvidenceFor: lower-body garment channel, clinical costume realism, production readiness,
  quest readiness, hiding the body under the shoe (the hide mask covers upper/lower only).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import bpy
from mathutils import Vector

# MPFB base units are decimetres; the shipped GLBs are in metres. The stage uses the
# same 0.1 conversion (MH_UNITS_TO_METRES in body_param_stage.py).
MH_UNITS_TO_METRES = 0.1
# Helper vertices start at index 13,380 on the hm08 basemesh (19,158 verts total).
# The staged CC0 shoes reference only body-surface verts (< 13,380), so they fit the
# helper-stripped body. The reference foot anchor must use the body-surface verts too.
BODY_SURFACE_VERT_COUNT = 13380


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="#324 embed fitted library footwear into library GLB")
    p.add_argument("--glb", required=True, help="Input library GLB path")
    p.add_argument("--out", required=True, help="Output GLB path (may overwrite input)")
    p.add_argument(
        "--role",
        default="family",
        help="Actor role for footwear kind/color (family→casual_shoe, nurse→clinical, …)",
    )
    p.add_argument("--report", default="", help="Optional JSON report path")
    # -- #324 -- the fitted shoe source + licence (the CLI reads the licence from the
    # shoe's OWN .mhclo header and passes the token/source in — never invented here).
    p.add_argument("--mh-base-obj", required=True, help="MPFB data/3dobjs/base.obj (hm08)")
    p.add_argument(
        "--phenotype-json",
        required=True,
        help='Body-class phenotype for the fit reference macros, e.g. {"weight":0.88,...}',
    )
    p.add_argument("--shoe-mhclo", required=True, help="Staged shoe .mhclo (provider cache)")
    p.add_argument("--shoe-obj", required=True, help="Staged shoe .obj companion")
    p.add_argument("--shoe-kind", required=True, help="Shoe kind used in mesh/material names")
    p.add_argument("--shoe-license-token", default="", help="Licence token from the shoe .mhclo header")
    p.add_argument(
        "--shoe-license-source",
        default="",
        help="Licence source string (mhclo_header:...; license=...) from readMhcloLicense",
    )
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def enable_mpfb() -> bool:
    try:
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        return "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
    except Exception:
        return False


def import_glb(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def import_obj(path: str, name: str) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    created = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not created:
        raise RuntimeError(f"OBJ import produced no mesh: {path}")
    obj = created[0]
    obj.name = name
    return obj


def find_body_and_armature() -> Tuple[bpy.types.Object, Optional[bpy.types.Object]]:
    body = None
    arm = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            arm = obj
        if obj.type == "MESH":
            name = (obj.name or "").lower()
            if "footwear" in name or "shoe" in name or "slipper" in name:
                continue
            if "garment" in name or "scrub" in name or "makeclothes" in name:
                continue
            if body is None or "basemesh" in name or "hm08" in name or "body" in name:
                if body is None or "basemesh" in name or "hm08" in name:
                    body = obj
    if body is None:
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if not meshes:
            raise RuntimeError("no mesh in imported GLB")
        body = max(meshes, key=lambda m: len(m.data.vertices))
    return body, arm


def create_material(name: str, color: Tuple[float, float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.55
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.diffuse_color = color
    try:
        mat.viewport_display.color = color[:3]
    except Exception:
        pass
    return mat


def footwear_color(actor_role: str) -> Tuple[float, float, float, float]:
    role = (actor_role or "").lower()
    if "nurse" in role or "clinical" in role:
        return (0.08, 0.09, 0.10, 1.0)
    if "patient" in role and "family" not in role and "spouse" not in role:
        return (0.18, 0.42, 0.78, 1.0)
    if any(k in role for k in ("parent", "family", "guardian", "spouse")):
        return (0.12, 0.08, 0.05, 1.0)
    return (0.10, 0.09, 0.08, 1.0)


def foot_anchor(
    obj: bpy.types.Object,
    band: float,
    max_index: Optional[int] = None,
) -> Tuple[Vector, int]:
    """Sole (min Z) + X/Y centre of the foot region of `obj`.

    Band is a Z height above the sole. `max_index` restricts to body-surface verts
    (index < 13,380) so helper geometry that extends below the foot cannot drag the
    sole anchor (measured: the base.obj helpers reach ~0.09 dm below the foot sole).
    """
    verts = list(obj.data.vertices)
    if max_index is not None:
        verts = [v for v in verts if v.index < max_index]
    if not verts:
        raise RuntimeError("foot_anchor: no vertices")
    zmin = min(v.co.z for v in verts)
    sel = [v for v in verts if v.co.z <= zmin + band]
    if not sel:
        sel = verts
    cx = sum(v.co.x for v in sel) / len(sel)
    cy = sum(v.co.y for v in sel) / len(sel)
    return Vector((cx, cy, zmin)), len(sel)


def apply_phenotype_macros(reference: bpy.types.Object, phenotype: dict) -> None:
    """#324 — re-apply the body class's phenotype macros to the fit reference.

    Mirrors `apply_macros` in body_param_stage.py exactly (same TargetService path,
    macros as LIVE shape keys) so the shoe fit reads the same from-mix foot shape the
    stage's upper/lower fits read. The GLB body carries these macros baked, so the
    fitted shoe matches the shipped foot rather than the neutral basemesh.
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

    macro = TargetService.get_default_macro_info_dict()
    for key in ("gender", "age", "muscle", "weight", "proportions", "height", "cupsize", "firmness"):
        if key in phenotype:
            macro[key] = float(phenotype[key])
    if isinstance(phenotype.get("race"), dict):
        macro["race"].update({k: float(v) for k, v in phenotype["race"].items()})

    for key in macro:
        if key != "race":
            HumanObjectProperties.set_value(key, macro[key], entity_reference=reference)
    for key, val in macro["race"].items():
        HumanObjectProperties.set_value(key, val, entity_reference=reference)

    TargetService.reapply_macro_details(reference, remove_zero_weight_targets=False)
    bpy.context.view_layer.update()


def apply_object_transforms(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def force_z_up_standing(obj: bpy.types.Object) -> None:
    """Make the reference basemesh Z-up standing with its sole at z=0.

    Mirrors `force_z_up_standing` in fit_stage.py. `wm.obj_import` keeps the MakeHuman
    OBJ Y-up (height along Blender Y — measured: base.obj vert 791/881 land at
    z=0.85/0.70, y=6.16/8.49, not the other way round). Garment fits are
    body-vertex-driven and barely notice, but the SHOE's height comes from the `.mhclo`
    offset scales, which assume a Z-up body — fitting a Y-up reference inflated the
    fitted shoe ~4.4x (measured on #324's first bake). Rotating the reference first
    makes the fit's x_size/y_size/z_size land at ~1.0 (verified: 1.058 for the flats).
    """
    apply_object_transforms(obj)
    b = {a: (min(getattr(v.co, a) for v in obj.data.vertices), max(getattr(v.co, a) for v in obj.data.vertices)) for a in "xyz"}
    size = [b[a][1] - b[a][0] for a in "xyz"]
    axis = max(range(3), key=lambda i: size[i])
    if axis == 1:
        obj.rotation_euler[0] = math.radians(90.0)
    elif axis == 0:
        obj.rotation_euler[1] = math.radians(-90.0)
    bpy.context.view_layer.update()
    apply_object_transforms(obj)
    b2 = {a: (min(getattr(v.co, a) for v in obj.data.vertices), max(getattr(v.co, a) for v in obj.data.vertices)) for a in "xyz"}
    if abs(b2["z"][0]) > abs(b2["z"][1]) and b2["z"][0] < -0.1:
        obj.rotation_euler[0] = math.radians(180.0)
        bpy.context.view_layer.update()
        apply_object_transforms(obj)
    obj.location.z -= min(v.co.z for v in obj.data.vertices)
    bpy.context.view_layer.update()
    apply_object_transforms(obj)


def build_fit_reference(mh_base_obj: str, phenotype: dict) -> bpy.types.Object:
    """hm08 basemesh with the class macros applied — the fit target (intact vertex order).

    Imported via `wm.obj_import` (intact OBJ vertex order), then rotated Z-up so the
    `.mhclo` offset scales (which assume a Z-up body) land at ~1.0, then macros applied
    as live shape keys. The macros must run AFTER the rotation bake so the fit reads the
    macro shape in the same frame the offsets expect.
    """
    from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties

    ref = import_obj(mh_base_obj, "openclinxr_footwear_fit_reference")
    force_z_up_standing(ref)
    GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=ref)
    apply_phenotype_macros(ref, phenotype)
    return ref


def fit_shoe(
    shoe_mhclo: str,
    shoe_obj: str,
    reference: bpy.types.Object,
    mesh_name: str,
) -> Tuple[bpy.types.Object, float]:
    """#324 — the SAME ClothesService.fit_clothes_to_human path the upper/lower channels use."""
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

    shoe = import_obj(shoe_obj, mesh_name)
    mhclo = Mhclo()
    mhclo.load(shoe_mhclo)
    try:
        mhclo.clothes = shoe
    except Exception:
        pass
    t_fit = time.perf_counter()
    ClothesService.fit_clothes_to_human(shoe, reference, mhclo=mhclo, set_parent=False)
    fit_s = time.perf_counter() - t_fit
    bpy.context.view_layer.update()
    return shoe, fit_s


def place_shoe_on_body(shoe: bpy.types.Object, body: bpy.types.Object, reference: bpy.types.Object) -> dict:
    """Scale the fitted shoe from MH units into the GLB body frame and translate by foot anchors.

    The fit placed the shoe in the reference basemesh's local frame (dm, feet at the
    reference sole). The GLB body is in metres with feet planted at z=0. The transfer
    is scale 0.1 + a sole/x-y anchor translation computed from the actual foot
    geometry of both meshes — never authored coordinates (D1).
    """
    ref_foot, ref_n = foot_anchor(reference, band=1.2, max_index=BODY_SURFACE_VERT_COUNT)
    body_foot, body_n = foot_anchor(body, band=0.11)

    for v in shoe.data.vertices:
        v.co *= MH_UNITS_TO_METRES
    bpy.context.view_layer.update()

    shoe_foot, shoe_n = foot_anchor(shoe, band=0.06)
    delta = body_foot - shoe_foot
    for v in shoe.data.vertices:
        v.co += delta
    bpy.context.view_layer.update()

    return {
        "referenceFootAnchorDm": [round(x, 5) for x in ref_foot],
        "referenceFootVertexCount": ref_n,
        "bodyFootAnchorM": [round(x, 5) for x in body_foot],
        "bodyFootVertexCount": body_n,
        "shoeFootAnchorM": [round(x, 5) for x in shoe_foot],
        "placementDeltaM": [round(x, 6) for x in delta],
    }


def split_shoe_halves(shoe: bpy.types.Object, kind: str) -> Dict[str, bpy.types.Object]:
    """Split the two-feet fitted shoe mesh into L (X>=0) and R (X<0) halves.

    The MakeClothes shoe `.mhclo` covers BOTH feet as one mesh; the contract needs
    two footwear primitives (one per rail). Left/right shoe islands do not share
    faces across X=0 (measured), so a bmesh vertex delete splits them cleanly.
    """
    import bmesh

    halves: Dict[str, bpy.types.Object] = {}
    for side, keep in (("L", lambda x: x >= 0.0), ("R", lambda x: x < 0.0)):
        bm = bmesh.new()
        bm.from_mesh(shoe.data)
        bm.verts.ensure_lookup_table()
        to_delete = [v for v in bm.verts if not keep(v.co.x)]
        bmesh.ops.delete(bm, geom=to_delete, context="VERTS")
        mesh = bpy.data.meshes.new(f"openclinxr_footwear_{kind}_{side}_mesh")
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(f"openclinxr_footwear_{kind}_{side}", mesh)
        bpy.context.collection.objects.link(obj)
        for poly in obj.data.polygons:
            poly.use_smooth = True
        halves[side] = obj
    return halves


def weight_half_to_foot(obj: bpy.types.Object, arm: bpy.types.Object, side: str) -> str:
    """Weight one half 100% to its foot bone + armature modifier (same as the old shell)."""
    bone_names = [b.name for b in arm.data.bones]
    mixamo_name = f"mixamorig:{'Left' if side == 'L' else 'Right'}Foot"
    candidates = [mixamo_name, f"foot.{side}", f"foot{side}"]
    bone = next((b for b in candidates if b in bone_names), None)
    if bone is None:
        raise RuntimeError(f"#324 footwear: armature missing foot bone for side {side}")
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("openclinxr_footwear_armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    mod.use_bone_envelopes = False
    # Skinned meshes export cleanly as children of the armature.
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    return bone


def export_glb(path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type in ("MESH", "ARMATURE"):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_skins=True,
        export_animations=False,
        # #226: preserve face morph targets when re-exporting after footwear embed.
        export_morph=True,
    )


def main() -> None:
    args = parse_args()
    glb = Path(args.glb).resolve()
    out = Path(args.out).resolve()
    if not glb.is_file():
        raise SystemExit(f"missing glb: {glb}")

    if not enable_mpfb():
        raise SystemExit("#324 footwear: MPFB addon failed to load — ClothesService unavailable")

    clear_scene()
    import_glb(str(glb))
    body, arm = find_body_and_armature()
    print(f"[blender] #324 body={body.name} arm={arm.name if arm else None} role={args.role}")
    if arm is None:
        raise RuntimeError("#324 footwear: no armature in GLB")

    # Strip any prior footwear shells so re-bake is idempotent.
    for obj in list(bpy.data.objects):
        n = (obj.name or "").lower()
        if obj.type == "MESH" and ("footwear" in n or "shoe" in n or "slipper" in n):
            bpy.data.objects.remove(obj, do_unlink=True)

    try:
        phenotype = json.loads(args.phenotype_json)
    except Exception as exc:
        raise SystemExit(f"#324 footwear: bad --phenotype-json: {exc}") from exc

    # Fit the shoe to a macro-applied base.obj reference (intact vertex order), then
    # place it onto the shipped GLB body by foot landmarks. Do NOT try to fit the GLB
    # body directly — the glTF round-trip reindexes vertices (measured: 53,672 vs
    # 13,380), and the .mhclo maps by index.
    reference = build_fit_reference(args.mh_base_obj, phenotype)
    mesh_name = f"makeclothes_library_footwear_{args.shoe_kind}"
    shoe, fit_s = fit_shoe(args.shoe_mhclo, args.shoe_obj, reference, mesh_name)
    placement = place_shoe_on_body(shoe, body, reference)
    bpy.data.objects.remove(reference, do_unlink=True)

    halves = split_shoe_halves(shoe, args.shoe_kind)
    shoe_color = footwear_color(args.role)
    shells: List[Dict[str, Any]] = []
    total_faces = 0
    for side, obj in halves.items():
        mat = create_material(f"openclinxr_footwear_{args.shoe_kind}_{side}_mat", shoe_color)
        obj.data.materials.append(mat)
        bone = weight_half_to_foot(obj, arm, side)
        zs = [v.co.z for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        meta = {
            "side": side,
            "objectName": obj.name,
            "meshName": obj.data.name,
            "faceCount": len(obj.data.polygons),
            "vertexCount": len(obj.data.vertices),
            "weightedBones": [bone],
            "minZ": round(min(zs), 6),
            "maxZ": round(max(zs), 6),
            "minY": round(min(ys), 6),
            "maxY": round(max(ys), 6),
        }
        total_faces += meta["faceCount"]
        shells.append(meta)
        print(
            f"[blender] #324 footwear {side} kind={args.shoe_kind} faces={meta['faceCount']} "
            f"verts={meta['vertexCount']} z=[{meta['minZ']},{meta['maxZ']}] bone={bone}"
        )
    bpy.data.objects.remove(shoe, do_unlink=True)

    body_bounds = {a: (min(getattr(v.co, a) for v in body.data.vertices), max(getattr(v.co, a) for v in body.data.vertices)) for a in "xyz"}
    meta_out = {
        "mode": "makeclothes_library_fit_via_clothesservice_v1",
        "revision": "issue_324_fitted_cc0_mhclo_not_procedural_blob",
        "shoeId": f"{args.shoe_kind}_hm08",
        "kind": args.shoe_kind,
        "licenseToken": args.shoe_license_token,
        "licenseSource": args.shoe_license_source,
        "clothesServiceApi": "ClothesService.fit_clothes_to_human",
        "fitWallClockS": round(fit_s, 4),
        "fittedAgainst": "mpfb_base_obj_with_body_class_phenotype_macros",
        "placement": placement,
        "shells": shells,
        "totalFaceCount": total_faces,
        "bodyHeight": round(body_bounds["z"][1] - body_bounds["z"][0], 6),
        "bodyMinZ": round(body_bounds["z"][0], 6),
        "bodyMaxZ": round(body_bounds["z"][1], 6),
        "role": (args.role or "").lower(),
        "makeclothesShoeSearch": "makehuman-shoes01_cc0_subset_zero_helper_refs",
        "claimScope": "fitted_library_footwear_on_library_body_param_glb_with_mhclo_header_licence",
        "notEvidenceFor": [
            "lower_body_garment_channel",
            "clinical_costume_realism",
            "production_asset_readiness",
            "quest_readiness",
            "body_under_shoe_hidden",
        ],
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(out))
    print(f"[blender] #324 wrote {out} totalFaces={total_faces}")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                {
                    "schemaVersion": "openclinxr.library-footwear-embed.v1",
                    "input": str(glb),
                    "output": str(out),
                    "role": args.role,
                    "footwearRegion": meta_out,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"[blender] #324 report {report_path}")


if __name__ == "__main__":
    main()
