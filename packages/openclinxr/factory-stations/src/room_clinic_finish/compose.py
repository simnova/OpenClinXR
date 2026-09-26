"""room_clinic_finish compose stage: paint wall/trim materials + stamp signage anchors.

Reads the recipe JSON written by run.ts (--recipe-json), applies the palette
to wall/trim mesh materials (matched by name), and creates one EMPTY per
signage anchor at the wall positions. Emits finish geometry (ceiling field,
floor field, T-bar grid, wall-seated paneled door kit, crash rail, exit sign,
exam table) as real meshes.

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


def _emit_finish_geometry(seed: int = 7, palette: dict | None = None, bounds: dict | None = None) -> dict:
    """Build real finish meshes: ceiling, floor, T-bar grid, paneled door kit, crash rail, exit sign."""
    import bpy  # type: ignore[import-not-found]

    # Anchor all placements to the measured base-shell bounds so finish
    # geometry lands inside the actual room instead of fixed coordinates
    # sized for a different shell.
    b = bounds or {"x": [-3.0, 3.0], "y": [-2.4, 2.4], "z": [0.0, 2.8]}
    minx, maxx = b["x"]
    miny, maxy = b["y"]
    minz, maxz = b["z"]
    cx, cy = (minx + maxx) / 2.0, (miny + maxy) / 2.0
    w, d, h = maxx - minx, maxy - miny, maxz - minz
    TBAR_Z = maxz - 0.06
    created: list[str] = []
    counts = {"ceiling": 0, "floor": 0, "tbar": 0, "door": 0, "rail": 0, "sign": 0, "table": 0}

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
    new_box("openclinxr_ceiling_field", cx, cy, TBAR_Z + 0.04, w, d, 0.05, trim_m)
    counts["ceiling"] += 1
    new_box("openclinxr_floor_field", cx, cy, minz + 0.03, w, d, 0.05, floor_m)
    counts["floor"] += 1
    # T-bar grid strips at ceiling height, scaled to room size
    nx, nz = max(2, int(round(w / 1.2))), max(2, int(round(d / 1.2)))
    for ix in range(nx):
        for iz in range(nz):
            new_box("openclinxr_tbar_%d_%d" % (ix, iz), minx + (ix + 0.5) * w / nx, miny + (iz + 0.5) * d / nz, TBAR_Z, 0.05, d / nz, 0.05, tbar_m)
            counts["tbar"] += 1
    # Door kit seated flush in the back wall (y=maxy plane): frame jambs +
    # header surround the slab so it reads as an opening, not a floating panel.
    door_h = min(2.1, h * 0.75)
    door_cz = minz + door_h / 2.0
    door_w = min(0.92, w * 0.3)
    door_x = cx + min(0.5, w * 0.15)
    new_box("openclinxr_door_jamb_l", door_x - door_w / 2 - 0.05, maxy - 0.04, door_cz, 0.1, 0.12, door_h + 0.1, trim_m)
    new_box("openclinxr_door_jamb_r", door_x + door_w / 2 + 0.05, maxy - 0.04, door_cz, 0.1, 0.12, door_h + 0.1, trim_m)
    new_box("openclinxr_door_header", door_x, maxy - 0.04, minz + door_h + 0.07, door_w + 0.2, 0.12, 0.15, trim_m)
    counts["door"] += 3
    new_box("openclinxr_door_slab", door_x, maxy - 0.06, door_cz, door_w, 0.08, door_h, door_m)
    counts["door"] += 1
    for iy in range(2):
        for iz in range(2):
            new_box("openclinxr_door_panel_%d_%d" % (iy, iz), door_x - door_w / 4 + iy * door_w / 2, maxy - 0.11, minz + door_h * 0.28 + iz * door_h * 0.44, door_w * 0.36, 0.02, door_h * 0.34, door_m)
            counts["door"] += 1
    new_box("openclinxr_door_lever", door_x + door_w / 2 - 0.1, maxy - 0.13, minz + door_h * 0.48, 0.16, 0.04, 0.04, trim_m)
    new_box("openclinxr_door_kick", door_x, maxy - 0.11, minz + 0.15, door_w * 0.87, 0.02, 0.25, tbar_m)
    counts["door"] += 2
    # Crash rail along corridor wall
    new_box("openclinxr_crash_rail", cx, miny + 0.02, minz + h * 0.32, w * 0.67, 0.08, 0.15, rail_m)
    counts["rail"] += 1
    # Exit sign box above door, on the back wall face
    new_box("openclinxr_exit_sign", door_x, maxy - 0.12, minz + door_h + 0.25, 0.4, 0.1, 0.15, sign_m)
    counts["sign"] += 1
    # Exam table volume: base cabinet + cushion + raised backrest, center-room
    exam_m = mat_for("openclinxr_finish_exam_base", [0.78, 0.80, 0.79], 0.7)
    cushion_m = mat_for("openclinxr_finish_exam_cushion", [0.30, 0.55, 0.68], 0.8)
    tbl_w, tbl_l = min(0.7, w * 0.3), min(1.9, d * 0.5)
    new_box("openclinxr_exam_base", cx - w * 0.1, cy - d * 0.05, minz + 0.45, tbl_w, tbl_l, 0.9, exam_m)
    counts["table"] += 1
    new_box("openclinxr_exam_cushion", cx - w * 0.1, cy - d * 0.12, minz + 0.96, tbl_w + 0.04, tbl_l * 0.68, 0.12, cushion_m)
    counts["table"] += 1
    new_box("openclinxr_exam_backrest", cx - w * 0.1, cy + d * 0.2, minz + 1.15, tbl_w + 0.04, tbl_l * 0.3, 0.12, cushion_m)
    counts["table"] += 1
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
        kind = "wall" if kind == "other" else kind
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

    # Measure base-shell bounds so emitted finish lands inside the real room.
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("openclinxr_"):
            continue
        for v in obj.data.vertices:
            wv = obj.matrix_world @ v.co
            xs.append(wv.x); ys.append(wv.y); zs.append(wv.z)
    shell = {"x": [min(xs), max(xs)], "y": [min(ys), max(ys)], "z": [min(zs), max(zs)]} if xs else None
    emitted = _emit_finish_geometry(seed=int(recipe.get("seed", 7)), palette=palette, bounds=shell)

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
