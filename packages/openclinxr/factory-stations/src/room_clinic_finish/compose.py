"""room_clinic_finish compose stage: paint wall/trim materials + stamp signage anchors.

Reads the recipe JSON written by run.ts (--recipe-json), applies the palette
to wall/trim mesh materials (matched by name), and creates one EMPTY per
signage anchor at the wall positions. Never moves geometry; materials only.

Usage (spawned by run.ts, never by hand):
  blender --background --python compose.py -- --input work.glb --output work.glb \
      --recipe-json recipe.json --report report.json
"""

from __future__ import annotations

import argparse
import json
import sys

RECIPE_SCHEMA_VERSION = "openclinxr.room-clinic-finish.v1"

EXPECTED_MODULE_VERSIONS = {
    "ceiling": "clinic-finish-ceiling-v1",
    "floor": "clinic-finish-floor-v1",
    "door": "clinic-finish-door-v1",
    "corridor_cues": "clinic-finish-corridor-cues-v1",
}

TRIM_NAME_RE_PARTS = ("skirt", "casing", "door", "window", "trim", "baseboard")
WALL_NAME_RE_PARTS = ("wall", "partition")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clinic room finish compose stage")
    parser.add_argument("--input", required=True, help="input GLB path")
    parser.add_argument("--output", required=True, help="output GLB path")
    parser.add_argument("--recipe-json", required=True, help="recipe JSON from run.ts")
    parser.add_argument("--report", required=True, help="report JSON output path")
    return parser.parse_args(argv)


def load_recipe(recipe_path: str) -> dict:
    with open(recipe_path, "r", encoding="utf-8") as handle:
        recipe = json.load(handle)
    if not isinstance(recipe, dict):
        raise ValueError("recipe JSON must be an object")
    if recipe.get("schemaVersion") != RECIPE_SCHEMA_VERSION:
        raise ValueError(
            "recipe schemaVersion must be %s, got %r" % (RECIPE_SCHEMA_VERSION, recipe.get("schemaVersion"))
        )
    palette = recipe.get("palette")
    if not isinstance(palette, dict):
        raise ValueError("recipe.palette must be an object")
    modules = recipe.get("modules")
    if not isinstance(modules, list) or not modules:
        raise ValueError("recipe.modules must be a non-empty list")
    seen: set[str] = set()
    for entry in modules:
        if not isinstance(entry, dict):
            raise ValueError("recipe.modules entries must be objects")
        name = entry.get("module")
        version = entry.get("version")
        expected = EXPECTED_MODULE_VERSIONS.get(name) if isinstance(name, str) else None
        if expected is None or version != expected or not isinstance(name, str):
            raise ValueError("module %r must carry version %r, got %r" % (name, expected, version))
        seen.add(name)
    if seen != set(EXPECTED_MODULE_VERSIONS):
        raise ValueError("recipe.modules must cover ceiling, floor, door, corridor_cues")
    for key in ("wallAlbedo", "trimAlbedo", "accentAlbedo"):
        albedo = palette.get(key)
        if (
            not isinstance(albedo, list)
            or len(albedo) != 3
            or not all(isinstance(channel, (int, float)) for channel in albedo)
        ):
            raise ValueError("recipe.palette.%s must be [r, g, b]" % key)
    return recipe


def classify_mesh(name: str) -> str:
    lowered = name.lower()
    if any(part in lowered for part in TRIM_NAME_RE_PARTS):
        return "trim"
    if any(part in lowered for part in WALL_NAME_RE_PARTS):
        return "wall"
    return "other"


def apply_finish() -> int:
    args = parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    recipe = load_recipe(args.recipe_json)
    palette = recipe["palette"]
    anchors = palette.get("signageAnchors", [])

    import bpy  # type: ignore[import-not-found]  # Blender runtime only

    bpy.ops.object.select_all(action="DESELECT")
    painted = {"wall": 0, "trim": 0, "other": 0}

    def ensure_material(name: str, albedo: list) -> object:
        material = bpy.data.materials.get(name)
        if material is None:
            material = bpy.data.materials.new(name=name)
            material.use_nodes = True
        principled = None
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    principled = node
                    break
        if principled is not None:
            r, g, b = (float(channel) for channel in albedo)
            principled.inputs["Base Color"].default_value = (r, g, b, 1.0)
            roughness = palette.get("roughness", 0.85)
            if "Roughness" in principled.inputs:
                principled.inputs["Roughness"].default_value = float(roughness)
        return material

    wall_material = ensure_material("openclinxr_finish_wall", palette["wallAlbedo"])
    trim_material = ensure_material("openclinxr_finish_trim", palette["trimAlbedo"])

    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        kind = classify_mesh(obj.name)
        target = wall_material if kind == "wall" else trim_material if kind == "trim" else None
        if target is None:
            painted["other"] += 1
            continue
        data = obj.data
        if len(data.materials) == 0:
            data.materials.append(target)
        else:
            data.materials[0] = target
        painted[kind] += 1

    stamped: list[str] = []
    for anchor in anchors:
        empty_name = "openclinxr_signage_%s" % anchor
        empty = bpy.data.objects.get(empty_name)
        if empty is None:
            empty = bpy.data.objects.new(empty_name, None)
            bpy.context.scene.collection.objects.link(empty)
        empty.empty_display_type = "PLAIN_AXES"
        stamped.append(empty_name)

    bpy.ops.wm.save_as_mainfile(filepath=args.output.replace(".glb", ".blend"))
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB")

    report = {
        "schemaVersion": RECIPE_SCHEMA_VERSION,
        "environmentId": recipe.get("environmentId"),
        "preset": recipe.get("preset"),
        "painted": painted,
        "signageAnchors": stamped,
        "movedGeometry": False,
    }
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print("room_clinic_finish: painted=%r anchors=%r" % (painted, stamped))
    return 0


if __name__ == "__main__":
    raise SystemExit(apply_finish())
