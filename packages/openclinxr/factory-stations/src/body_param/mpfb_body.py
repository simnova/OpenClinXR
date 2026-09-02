from __future__ import annotations

try:
    import bpy
    from mathutils import Vector
except ImportError:
    bpy = None
    Vector = None
import numpy as np
import traceback
from pathlib import Path


def enable_mpfb() -> dict:
    status: dict = {
        "module": "bl_ext.user_default.mpfb",
        "enabled": False,
        "error": None,
    }
    try:
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        status["enabled"] = "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
        home = Path.home()
        manifest = (
            home
            / "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/blender_manifest.toml"
        )
        if manifest.is_file():
            status["manifestPath"] = str(manifest)
            text = manifest.read_text(encoding="utf-8", errors="replace")
            for line in text.splitlines():
                if "SPDX:" in line:
                    status["licenseSpdxFromManifest"] = (
                        line.strip().strip(",").strip('"').replace("SPDX:", "")
                    )
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-2000:]
    return status



def apply_macros(basemesh: bpy.types.Object, phenotype: dict) -> dict:
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
            HumanObjectProperties.set_value(key, macro[key], entity_reference=basemesh)
    for key, val in macro["race"].items():
        HumanObjectProperties.set_value(key, val, entity_reference=basemesh)

    TargetService.reapply_macro_details(basemesh, remove_zero_weight_targets=False)
    bpy.context.view_layer.update()
    return TargetService.get_macro_info_dict_from_basemesh(basemesh)


def load_mpfb_face_shape_keys(basemesh: bpy.types.Object, *, min_count: int = 24) -> dict:
    """Load native MPFB face/expression/mouth targets AFTER macro bake (#221 A2).

    Does NOT invent viseme_* names or a runtime name map — exports MakeHuman-family names
    so the inspect can measure intersects vs disjoint_measured against the runtime vocabulary.
    Targets come from the user MPFB extension data/targets tree (not vendored).
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    status: dict = {
        "loaded": 0,
        "names": [],
        "error": None,
        "targetsRoot": None,
    }
    try:
        home = Path.home()
        targets_root = (
            home
            / "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/targets"
        )
        if not targets_root.is_dir():
            status["error"] = f"MPFB targets dir missing: {targets_root}"
            return status
        status["targetsRoot"] = str(targets_root)

        # Prefer expression + mouth + eyes/eyebrows/cheek/chin — face-relevant, ≥20 names.
        subdirs = ("expression", "mouth", "eyes", "eyebrows", "cheek", "chin", "nose", "forehead")
        candidates: list[Path] = []
        for sub in subdirs:
            d = targets_root / sub
            if not d.is_dir():
                continue
            for p in sorted(d.rglob("*.target.gz")):
                candidates.append(p)
            for p in sorted(d.rglob("*.target")):
                candidates.append(p)

        # Cap load so export stays bounded; need ≥ min_count for disjoint_measured evidence.
        loaded_names: list[str] = []
        for path in candidates:
            if len(loaded_names) >= max(min_count + 8, 32):
                break
            try:
                name = TargetService.filename_to_shapekey_name(path.name, encode_name=False)
                TargetService.load_target(basemesh, str(path), weight=0.0, name=name)
                loaded_names.append(name)
            except Exception:
                continue

        # Zero all non-basis keys so export defaults are rest.
        if basemesh.data.shape_keys:
            for kb in basemesh.data.shape_keys.key_blocks:
                if kb.name != "Basis":
                    kb.value = 0.0

        status["loaded"] = len(loaded_names)
        status["names"] = loaded_names
        if len(loaded_names) < min_count:
            status["error"] = (
                f"only {len(loaded_names)} face targets loaded (need ≥{min_count})"
            )
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


def strip_helper_geometry(basemesh: bpy.types.Object) -> dict:
    """Remove MH helper/joint vertices so grade/export is body surface, not the long-skirt helper shell.

    #215 library export kept helpers (~74k verts); for body_param grade the helpers bury the
    fitted scrub. ClothesService mhclo maps to body verts — helpers are not required after fit
    for a static library GLB without rig weights.
    """
    before = len(basemesh.data.vertices)
    # Ensure vertex groups exist (import_obj alone does not assign them)
    try:
        from bl_ext.user_default.mpfb.services.objectservice import ObjectService

        if not basemesh.vertex_groups:
            ObjectService.assign_vertex_groups(basemesh, ObjectService.get_base_mesh_vertex_group_definition(), None)
    except Exception:
        pass

    helper_names = [
        g.name
        for g in basemesh.vertex_groups
        if str(g.name).startswith("helper-")
        or str(g.name).startswith("joint-")
        or str(g.name).lower() in {"helpergeometry", "helpers"}
    ]
    if not helper_names:
        return {"stripped": False, "vertexCountBefore": before, "vertexCountAfter": before}

    bpy.ops.object.select_all(action="DESELECT")
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    # Select verts with any weight in helper groups
    for vg_name in helper_names:
        vg = basemesh.vertex_groups.get(vg_name)
        if vg is None:
            continue
        for v in basemesh.data.vertices:
            try:
                if vg.weight(v.index) > 0.05:
                    v.select = True
            except RuntimeError:
                pass
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    after = len(basemesh.data.vertices)
    return {
        "stripped": True,
        "helperGroups": helper_names[:20],
        "helperGroupCount": len(helper_names),
        "vertexCountBefore": before,
        "vertexCountAfter": after,
    }


# Distinct body vs garment colours so grade PNG is not monochrome (#215 lesson)
BODY_COLORS = {
    0: (0.78, 0.58, 0.48, 1.0),  # warm skin
    1: (0.62, 0.48, 0.40, 1.0),  # cooler skin
}
GARMENT_COLORS = {
    0: (0.08, 0.52, 0.95, 1.0),  # vivid blue (upper)
    1: (0.10, 0.62, 0.28, 1.0),  # vivid green (upper)
}
# #220 lower garment — scrub/teal distinct from upper + skin
LOWER_GARMENT_COLORS = {
    0: (0.12, 0.38, 0.42, 1.0),  # teal scrub pants
    1: (0.18, 0.28, 0.40, 1.0),  # slate clinical pants
}

