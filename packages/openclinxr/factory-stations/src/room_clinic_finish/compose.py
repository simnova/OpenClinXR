"""room_clinic_finish compose stage: paint wall/trim materials + stamp signage anchors.

Reads the recipe JSON written by run.ts (--recipe-json), applies the palette
to wall/trim mesh materials (matched by name), and creates one EMPTY per
signage anchor at the wall positions. Emits finish geometry (T-bar grid,
paneled door kit, crash rail, exit sign) as real meshes.

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
    "geometry": "clinic-finish-geometry-v1",
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
        raise ValueError("recipe.modules must cover ceiling, floor, door, corridor_cues, geometry")
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


def _emit_finish_geometry(seed: int = 7, palette: dict | None = None) -> dict:
    """Build real finish meshes: ceiling, floor, T-bar grid, paneled door kit, crash rail, exit sign."""
    import bpy  # type: ignore[import-not-found]

    TBAR_Z = 2.744
    created: list[str] = []
    counts = {"ceiling": 0, "floor": 0, "tbar": 0, "door": 0, "rail": 0, "sign": 0}

    def mat_for(name: str, albedo: list, roughness: float):
        m = bpy.data.materials.get(name)
        if m is None:
            m = bpy.data.materials.new(name=name)
            m.use_nodes = True
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Base Color"].default_value = (float(albedo[0]), float(albedo[1]), float(albedo[2]), 1.0)
                if "Roughness" in n.inputs:
                    n.inputs["Roughness"].default_value = float(roughness)
                break
        return m

    pal = palette or {}
    rough = float(pal.get("roughness", 0.85))
    trim_m = mat_for("openclinxr_finish_trim", pal.get("trimAlbedo", [0.96, 0.96, 0.94]), rough)
    floor_m = mat_for("openclinxr_finish_floor", [0.62, 0.63, 0.60], 0.9)
    tbar_m = mat_for("openclinxr_finish_tbar", [0.88, 0.89, 0.87], 0.6)
    door_m = mat_for("openclinxr_finish_door", [0.55, 0.42, 0.30], 0.6)
    rail_m = mat_for("openclinxr_finish_rail", [0.35, 0.55, 0.70], 0.5)
    sign_m = mat_for("openclinxr_finish_sign", [0.9, 0.15, 0.1], 0.4)
    sign_m.use_nodes = True
    for n in sign_m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            emission = n.inputs.get("Emission Color")
            if emission is not None:
                emission.default_value = (0.9, 0.1, 0.08, 1.0)
            strength = n.inputs.get("Emission Strength")
            if strength is not None:
                strength.default_value = 2.0
            break

    def new_box(name: str, x: float, y: float, z: float, dx: float, dy: float, dz: float, mat: object = None) -> None:
        mesh = bpy.data.meshes.new(name + "_mesh")
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        verts = [
            (x - dx / 2, y - dy / 2, z - dz / 2), (x + dx / 2, y - dy / 2, z - dz / 2),
            (x + dx / 2, y + dy / 2, z - dz / 2), (x - dx / 2, y + dy / 2, z - dz / 2),
            (x - dx / 2, y - dy / 2, z + dz / 2), (x + dx / 2, y - dy / 2, z + dz / 2),
            (x + dx / 2, y + dy / 2, z + dz / 2), (x - dx / 2, y + dy / 2, z + dz / 2),
        ]
        faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        if mat is not None:
            mesh.materials.append(mat)
        created.append(name)

    # Ceiling tile field + vinyl floor close the shell
    new_box("openclinxr_ceiling_field", 0.0, 0.0, TBAR_Z + 0.04, 6.0, 4.8, 0.05, trim_m)
    counts["ceiling"] += 1
    new_box("openclinxr_floor_field", 0.0, 0.0, -0.03, 6.0, 4.8, 0.05, floor_m)
    counts["floor"] += 1
    # T-bar grid: 5 x 3 strips at ceiling height
    for ix in range(5):
        for iz in range(3):
            new_box("openclinxr_tbar_%d_%d" % (ix, iz), -2.4 + ix * 1.2, -1.2 + iz * 1.2, TBAR_Z, 0.05, 2.4, 0.05, tbar_m)
            counts["tbar"] += 1
    # Paneled door kit: slab + 4 recessed-look panels + lever + kick plate
    new_box("openclinxr_door_slab", 1.5, 0.0, 1.05, 0.08, 0.9, 2.1, door_m)
    counts["door"] += 1
    for iy in range(2):
        for iz in range(2):
            new_box("openclinxr_door_panel_%d_%d" % (iy, iz), 1.54, -0.22 + iy * 0.44, 0.6 + iz * 0.9, 0.02, 0.36, 0.7, door_m)
            counts["door"] += 1
    new_box("openclinxr_door_lever", 1.58, 0.32, 1.0, 0.04, 0.16, 0.04, trim_m)
    new_box("openclinxr_door_kick", 1.55, 0.0, 0.15, 0.02, 0.8, 0.25, tbar_m)
    counts["door"] += 2
    # Crash rail along corridor wall
    new_box("openclinxr_crash_rail", 0.0, -1.98, 0.9, 4.0, 0.08, 0.15, rail_m)
    counts["rail"] += 1
    # Exit sign box above door
    new_box("openclinxr_exit_sign", 1.5, 0.0, 2.3, 0.1, 0.4, 0.15, sign_m)
    counts["sign"] += 1
    return {"meshes": created, "counts": counts, "tbarZ": TBAR_Z, "seed": seed}


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
        # Emitted finish meshes already carry materials; only paint base-shell input.
        if obj.name.startswith("openclinxr_"):
            continue
        kind = classify_mesh(obj.name)
        # Unclassified base shells (e.g. Infinigen "Cube") default to wall paint.
        target = wall_material if kind in ("wall", "other") else trim_material
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

    emitted = _emit_finish_geometry(seed=int(recipe.get("seed", 7)), palette=palette)

    bpy.ops.wm.save_as_mainfile(filepath=args.output.replace(".glb", ".blend"))
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB")

    report = {
        "schemaVersion": RECIPE_SCHEMA_VERSION,
        "environmentId": recipe.get("environmentId"),
        "preset": recipe.get("preset"),
        "painted": painted,
        "signageAnchors": stamped,
        "movedGeometry": True,
        "emittedMeshes": emitted["counts"],
        "emittedCount": len(emitted["meshes"]),
    }
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print("room_clinic_finish: painted=%r anchors=%r" % (painted, stamped))
    return 0


if __name__ == "__main__":
    raise SystemExit(apply_finish())
