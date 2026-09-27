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
import os
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

# Photo-texture sources for the ward realism pass (imagine-multiview reference,
# asset-licence-records row-31; crops cut by the ward-finish-chain dispatch).
# Resolved relative to this file so the Blender-spawned stage stays
# self-contained. Fail closed at compose time when a file is absent.
# The ceiling has no photo texture in this worktree (flat trim paint); only
# floor and door are photo-textured.
TEXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
FLOOR_TEXTURE_FILE = "floor-vinyl.jpg"
DOOR_TEXTURE_FILE = "door-maple.jpg"
# Object-space tiling scale. floor-vinyl.jpg is a representative sheet-vinyl
# patch, so one repeat spans 1.2 m (same convention as the ward-finish
# lineage's FLOOR_OBJECT_SCALE).
FLOOR_OBJECT_SCALE = 1.0 / 1.2


def _texture_path(filename: str) -> str:
    path = os.path.join(TEXTURE_DIR, filename)
    if not os.path.exists(path):
        raise SystemExit("room_clinic_finish texture missing: %s" % path)
    return path


def _load_photo_image(path: str):
    """Load a photo texture with sRGB colour space (Blender runtime only)."""
    import bpy  # type: ignore[import-not-found]

    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    return img


def _photo_object_material(name: str, filename: str, scale_xy: float, roughness: float):
    """Photo material with Object-space tiling: no UV layer required, the
    Mapping scale sets the real-world repeat. The vinyl floor field uses this.
    """
    import bpy  # type: ignore[import-not-found]

    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = _load_photo_image(_texture_path(filename))
    tex.extension = "REPEAT"
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale_xy, scale_xy, scale_xy)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = float(roughness)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _photo_uv_material(name: str, filename: str, roughness: float):
    """Photo material with UV mapping: one full-frame image per face (the mesh
    carries a full 0..1 UV layer via _uv_full_face). The maple door leaf uses
    this.
    """
    import bpy  # type: ignore[import-not-found]

    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = _load_photo_image(_texture_path(filename))
    tex.extension = "EXTEND"
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = float(roughness)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _uv_full_face(obj_name: str, front_poly: int = 2) -> None:
    """UVs for photo-textured finish boxes (Blender runtime only).

    The hero face (front_poly index into new_box polygon order: 0 bottom,
    1 top, 2..5 sides) carries the whole photo once. Every other face gets
    its own thin strip island so baked lighting from several faces never
    shares texels. A real (non-degenerate) UV layer also survives the room
    bake's ensure_uv instead of being smart-projected away.
    """
    import bpy  # type: ignore[import-not-found]

    obj = bpy.data.objects.get(obj_name)
    if obj is None or obj.type != "MESH":
        raise SystemExit("room_clinic_finish: mesh missing for UVs: %s" % obj_name)
    mesh = obj.data
    layer = mesh.uv_layers.get("openclinxr_photo")
    if layer is None:
        layer = mesh.uv_layers.new(name="openclinxr_photo")
    mesh.uv_layers.active = layer
    corners = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    others = [index for index in range(len(mesh.polygons)) if index != front_poly]
    for position, poly in enumerate(mesh.polygons):
        if position == front_poly:
            for corner_pos, loop_index in enumerate(poly.loop_indices):
                layer.data[loop_index].uv = corners[corner_pos % 4]
            continue
        slot = others.index(position)
        u0, v0 = 0.985, slot * 0.19
        for corner_pos, loop_index in enumerate(poly.loop_indices):
            corner = corners[corner_pos % 4]
            layer.data[loop_index].uv = (u0 + corner[0] * 0.015, min(1.0, v0 + corner[1] * 0.18))


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
    # Photo-texture finish materials. Built by the _photo_* builders above,
    # never by mat_for, so the flat-paint loop in apply_finish() cannot stomp
    # them (it only assigns wall/trim materials to base-shell meshes;
    # openclinxr_ finish meshes are skipped). Floor: sheet-vinyl crop with
    # Object-space tiling at a 1.2 m repeat, slight vinyl sheen (0.45). Door
    # leaf: maple crop mapped full-face via _uv_full_face (front_poly=2 is the
    # room-facing y-min side of the slab box), satin maple (0.48).
    floor_photo_m = _photo_object_material("openclinxr_finish_floor_photo", FLOOR_TEXTURE_FILE,
                                           FLOOR_OBJECT_SCALE, 0.45)
    door_photo_m = _photo_uv_material("openclinxr_finish_door_photo", DOOR_TEXTURE_FILE, 0.48)
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
        # Finish dressing, not hull: survives glTF export as node extras (needs
        # export_extras=True at export) and lands in three.js as
        # object.userData.openClinXrFinishDecoration so roomInteriorAndHull can
        # exclude it from the interior/hull unions.
        obj["openClinXrFinishDecoration"] = True
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
    new_box("openclinxr_floor_field", cx, cy, minz + 0.03, w, d, 0.05, floor_photo_m)
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
    new_box("openclinxr_door_slab", door_x, maxy - 0.06, door_cz, door_w, 0.08, door_h, door_photo_m)
    counts["door"] += 1
    _uv_full_face("openclinxr_door_slab")
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

    if not os.path.exists(args.input):
        raise SystemExit("input GLB not found: %s" % args.input)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=args.input)

    # Idempotent re-entry guard: the station runs in-place (work GLB is both
    # input and output), so a second run would import the previous run's
    # finish meshes. Drop any stale openclinxr_-prefixed objects from a prior
    # run before regenerating.
    for obj in list(bpy.data.objects):
        if obj.name.startswith("openclinxr_"):
            bpy.data.objects.remove(obj, do_unlink=True)

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
        # Same finish-dressing marker as new_box meshes: signage anchors are
        # station-emitted openclinxr_ nodes, so they carry the flag for a
        # total pipeline invariant (exported via export_extras=True).
        empty["openClinXrFinishDecoration"] = True
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
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_extras=True)

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
