#!/usr/bin/env python3
"""
#596 — replace the Anny-rail peds_upper `hospital_gown` shell with the CC0 lab-coat
stand-in on an MPFB subject (D1: wire ClothesService, do not author geometry).

Was (#480): invoke `apply_role_clothing_material_regions` with
`phenotype.garmentLayers=["hospital_gown"]`, which authors
`openclinxr_real_garment_peds_upper_v1_mesh` and paints material `hospital_gown` —
relabelled geometry, not a gown.

Now: fit `crudelabcoatopen.mhclo` (makehuman-community-crude-labcoat-female, CC0,
Joel Palmius; max interpolation ref 13,351 < 13,380) via the SAME
`ClothesService.fit_clothes_to_human` path the physician bake already uses. Name the
mesh so `/real_garment/` matches the planted contract, keep the 1-tri
`declared_upper_layers__hospital_gown` marker, strip lower garments (#487).

REGENERATION:
  blender --background --python tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py -- \\
      --input-glb apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb \\
      --output-glb apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb

FORBIDDEN: crudegown.mhclo (evening_dress). STOP if fit refs exceed 13,380 or fit throws.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

import bpy
from mathutils import Matrix

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_MAKECLOTHES_DIR = REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"
_ANNY_DIR = REPO_ROOT / "tools/openclinxr/asset-pipeline/anny"
for _p in (_MAKECLOTHES_DIR, _ANNY_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from body_param_stage import (  # noqa: E402
    apply_object_transforms,
    import_obj,
    transfer_weights_body_to_garment,
)
from automate_blender import garment_shell_color  # noqa: E402

GEN = REPO_ROOT / "apps/ui-xr/public/generated-humanoids"
COAT_DIR = (
    REPO_ROOT
    / ".openclinxr-local/provider-cache/garments/sources/makehuman-community-crude-labcoat-female"
)
COAT_OBJ = COAT_DIR / "crudelabcoatopen.obj"
COAT_MHCLO = COAT_DIR / "crudelabcoatopen.mhclo"
HELPER_STRIP_CEILING = 13_380

LOWER_GARMENT_RE = re.compile(r"(cargo_pants|_pants|trouser)", re.IGNORECASE)
PEDS_UPPER_RE = re.compile(r"real_garment_peds_upper|peds_upper_v1", re.IGNORECASE)
MIN_REAL_GARMENT_VERTS = 100
REAL_GARMENT_MESH_NAME = "openclinxr_real_garment_labcoat_crudelabcoatopen_mesh"
DECL_MESH_NAME = "openclinxr_declared_upper_layers__hospital_gown_mesh"


def _strip_named(predicate):
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            continue
        if predicate(o):
            print(f"STRIP {o.name!r} verts={len(o.data.vertices)}")
            bpy.data.objects.remove(o, do_unlink=True)


def _find_body():
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.endswith("_body"):
            return o
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh objects after import")
    return max(meshes, key=lambda o: len(o.data.materials) if o.data.materials else 0)


def _find_armature():
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            return o
    raise RuntimeError("no armature after import")


def _read_licence(mhclo_path: pathlib.Path):
    """Mirror materialize `read_hair_mhclo_licence` — AGPL/unspecified refuse."""
    header = mhclo_path.read_text(encoding="utf-8", errors="replace")[:4000]
    raw = None
    for line in header.splitlines():
        m = re.match(r"^#\s*license:?\s*(.+)$", line.strip(), re.I)
        if m:
            raw = m.group(1).strip()
            break
    if not raw:
        return False, None
    if re.search(r"agpl", raw, re.I):
        return False, raw
    if re.search(r"cc\s*[-_ ]?0", raw, re.I) or re.search(r"cc[\s_-]*by", raw, re.I):
        return True, raw
    return False, raw


def _max_mhclo_ref(mhclo_path: pathlib.Path) -> int:
    """Largest basemesh vertex index referenced by verts / x_scale / y_scale / z_scale."""
    text = mhclo_path.read_text(encoding="utf-8", errors="replace")
    max_ref = -1
    for line in text.splitlines():
        ls = line.strip()
        if not ls or ls.startswith("#"):
            continue
        parts = ls.split()
        if not parts:
            continue
        if parts[0] in ("x_scale", "y_scale", "z_scale") and len(parts) >= 3:
            for tok in parts[1:3]:
                if tok.isdigit():
                    max_ref = max(max_ref, int(tok))
            continue
        # vertex rows: three ints then floats
        if len(parts) >= 3 and parts[0].lstrip("-").isdigit() and parts[1].lstrip("-").isdigit():
            for tok in parts[:3]:
                if tok.lstrip("-").isdigit():
                    max_ref = max(max_ref, abs(int(tok)))
    return max_ref


def _ensure_declaration_marker(body):
    if bpy.data.objects.get(DECL_MESH_NAME) is not None:
        return
    # Degenerate micro-tri — same pattern automate_blender.py:3579 uses.
    xs = [v.co.x for v in body.data.vertices]
    ys = [v.co.y for v in body.data.vertices]
    zs = [v.co.z for v in body.data.vertices]
    cx = 0.5 * (min(xs) + max(xs))
    cz = 0.5 * (min(zs) + max(zs))
    ym = min(ys) + (max(ys) - min(ys)) * 0.55
    mesh = bpy.data.meshes.new(DECL_MESH_NAME)
    mesh.from_pydata(
        [(cx, ym, cz), (cx + 1e-4, ym, cz), (cx, ym + 1e-4, cz)],
        [],
        [(0, 1, 2)],
    )
    mesh.update()
    obj = bpy.data.objects.new(DECL_MESH_NAME, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = body
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.hide_render = True
    obj["openClinXrDeclaredUpperGarmentLayers"] = "hospital_gown"
    obj["openClinXrDeclaredUpperLayerCount"] = 1
    print(f"DECL_MARKER {DECL_MESH_NAME}")


def _stamp_mesh_extras(obj, source_mhclo: str, garment_class: str, licence: str):
    """Blender custom props → glTF mesh extras when export_extras=True."""
    obj.data["sourceMhclo"] = source_mhclo
    obj.data["garmentClass"] = garment_class
    obj.data["licence"] = licence
    obj["sourceMhclo"] = source_mhclo
    obj["garmentClass"] = garment_class
    obj["licence"] = licence


def main() -> None:
    ap = argparse.ArgumentParser(description="#596 bake MPFB gown stand-in (CC0 lab coat)")
    ap.add_argument("--input-glb", default=str(GEN / "mpfb-gown-adult-patient.glb"))
    ap.add_argument("--output-glb", default=str(GEN / "mpfb-gown-adult-patient.glb"))
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:])

    if not COAT_OBJ.is_file() or not COAT_MHCLO.is_file():
        raise RuntimeError(f"#596 lab coat sources missing: {COAT_DIR}")

    lic_ok, lic_raw = _read_licence(COAT_MHCLO)
    if not lic_ok:
        raise RuntimeError(
            f"#596 lab coat licence NOT permitted per its own .mhclo header: {lic_raw!r} "
            "— hard refusal (AGPL/copyleft or unspecified)"
        )
    max_ref = _max_mhclo_ref(COAT_MHCLO)
    if max_ref >= HELPER_STRIP_CEILING:
        raise RuntimeError(
            f"#596 STOP: crudelabcoatopen max basemesh ref {max_ref} >= {HELPER_STRIP_CEILING}; "
            "next candidate is Scrub_Shirt.mhclo (CC-BY) — do not silently fall back"
        )
    print(f"COAT_LICENCE {lic_raw!r} maxRef={max_ref}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    bpy.ops.import_scene.gltf(filepath=str(REPO_ROOT / args.input_glb))
    bpy.context.view_layer.update()

    body = _find_body()
    armature = _find_armature()
    print(f"IMPORTED body={body.name!r} verts={len(body.data.vertices)} armature={armature.name!r}")

    # Remove trousers and the cheated peds_upper gown shell.
    _strip_named(
        lambda o: len(o.data.vertices) >= MIN_REAL_GARMENT_VERTS
        and bool(LOWER_GARMENT_RE.search(o.name))
    )
    _strip_named(lambda o: bool(PEDS_UPPER_RE.search(o.name) or PEDS_UPPER_RE.search(o.data.name)))
    bpy.context.view_layer.update()

    # Live MPFB human for ClothesService vertex-index fit (imported GLB indices are scrambled).
    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService  # noqa: E402
    from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402

    fit_human = HumanService.create_human(feet_on_ground=True)
    fit_human.name = "__gown_standin_fit_human"
    bpy.context.view_layer.update()
    print(f"FIT_HUMAN verts={len(fit_human.data.vertices)}")

    coat = import_obj(str(COAT_OBJ), "makeclothes_library_lab_coat", force_z=False)
    apply_object_transforms(coat)
    coat.data.materials.clear()
    # Locked white coat colour — same kind the physician bake uses.
    colour = garment_shell_color("lab_coat", "patient", {"fabricPalette": "hospital_gown_blue_pattern"})
    mat = bpy.data.materials.new("mat_makeclothes_library_lab_coat")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*colour[:3], 1.0)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    coat.data.materials.append(mat)

    mhclo = Mhclo()
    mhclo.load(str(COAT_MHCLO))
    try:
        mhclo.clothes = coat
    except Exception:
        pass
    try:
        ClothesService.fit_clothes_to_human(coat, fit_human, mhclo=mhclo, set_parent=False)
    except Exception as exc:
        raise RuntimeError(
            f"#596 STOP: ClothesService.fit_clothes_to_human raised on patient basemesh: {exc!r}. "
            "Next candidate is Scrub_Shirt.mhclo (CC-BY) — do not silently fall back."
        ) from exc
    bpy.context.view_layer.update()

    # Bake any leftover object transform into mesh data, then drop the throwaway fit human.
    apply_object_transforms(coat)
    coat.parent = None
    coat.matrix_parent_inverse = Matrix.Identity(4)
    for mod in list(coat.modifiers):
        coat.modifiers.remove(mod)

    coat.data.name = REAL_GARMENT_MESH_NAME
    coat.name = REAL_GARMENT_MESH_NAME
    # Project skin weights from the SHIPPED body (world-space k-NN), bind to shipped armature.
    weights = transfer_weights_body_to_garment(body, coat, armature)
    _stamp_mesh_extras(coat, "crudelabcoatopen.mhclo", "labcoat", lic_raw or "CC0")
    print(
        f"COAT_FIT {coat.name} verts={len(coat.data.vertices)} "
        f"tris={sum(max(len(p.vertices) - 2, 0) for p in coat.data.polygons)} "
        f"weights={weights}"
    )

    bpy.data.objects.remove(fit_human, do_unlink=True)
    _ensure_declaration_marker(body)
    bpy.context.view_layer.update()

    bpy.ops.object.select_all(action="SELECT")
    out_path = REPO_ROOT / args.output_glb
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_skins=True,
        export_morph=True,
        export_texcoords=True,
        export_normals=True,
        export_extras=True,
    )
    print(
        f"EXPORTED {out_path} {out_path.stat().st_size} bytes "
        + json.dumps({"sourceMhclo": "crudelabcoatopen.mhclo", "garmentClass": "labcoat", "licence": lic_raw})
    )


if __name__ == "__main__":
    main()
