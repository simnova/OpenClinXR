"""room_clinic_finish compose stage: paint wall/trim materials + stamp signage anchors.

Reads the recipe JSON written by run.ts (--recipe-json), applies the palette
to wall/trim mesh materials (matched by name), textures Infinigen's own kept
door leaf with the maple photo material, and creates one EMPTY per signage
anchor at the wall positions. Emits finish geometry (the vinyl floor field,
the S6 acoustic-tile ceiling field plus one flush troffer, plus the crash
rail only when recipe options.crashRail is true).

S5 scope: the DUAL90 corridor props are gone (exam table, exit sign), the
hand-built door kit is replaced by the real Infinigen leaf/casing/skirting
kept through the strip+extract, and the flat ceiling field + T-bar grid are
deleted (S6 rebuilds the ceiling grid properly, in _emit_finish_geometry
below: a textured acoustic-tile field plus one flush troffer, both anchored
to the shell ceiling mesh's own room-facing plane, never the pooled
cross-shell maxz).

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
# S5 wires floor vinyl and the real-leaf maple. S6 wires the ceiling grid +
# troffer below, so all four staged photos are now in use.
TEXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
FLOOR_TEXTURE_FILE = "floor-vinyl.jpg"
DOOR_TEXTURE_FILE = "door-maple.jpg"
CEILING_TEXTURE_FILE = "ceiling-acoustic-tile.jpg"
TROFFER_TEXTURE_FILE = "troffer-light.jpg"
# Object-space tiling scale. floor-vinyl.jpg is a representative sheet-vinyl
# patch, so one repeat spans 1.2 m (same convention as the ward-finish
# lineage's FLOOR_OBJECT_SCALE). Only the kept door leaf still uses
# Object-space mapping; floor and ceiling bake real per-vertex UV0 instead
# (glTF has no Object-space coordinate: the exporter dropped the Mapping
# scale into a KHR_texture_transform on a missing UV channel, which renders
# as one stretched texel -- measured 2026-09-28 on a real work GLB: floor
# primitive carried POSITION+NORMAL only, no TEXCOORD).
FLOOR_OBJECT_SCALE = 1.0 / 1.2
# Real-world repeats for the baked UV0 coordinates (U = x_m / REPEAT).
FLOOR_REPEAT_M = 1.2
CEILING_MODULE_M = 0.6
# ceiling-acoustic-tile.jpg photographs a 4x4 tile field with its own T-bar
# lines (1024 px, grid pitch ~256 px measured 2026-09-28), so one repeat
# spans 4 modules: each photographed tile renders at the 0.6 m module.
CEILING_TILES_PER_REPEAT = 4
CEILING_REPEAT_M = CEILING_MODULE_M * CEILING_TILES_PER_REPEAT
# 2x4 troffer lens: spans two 0.6 m cells by one.
TROFFER_LONG_M = 1.2
TROFFER_SHORT_M = 0.6
# T-bar suspension drop below the measured ceiling plane. Mirrors the
# ceiling recipe fragment's TBAR_DROP_M (ceiling.py); the troffer-face and
# grid assertions pin this value against the export, so a drift fails loud.
CEILING_TBAR_DROP_M = 0.06
# Troffer lens readout: emissive strength over the troffer-light photo.
TROFFER_EMISSION_STRENGTH = 2.0


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
    Mapping scale sets the real-world repeat. Only the kept door leaf uses
    this now; floor and ceiling bake real UVs via _photo_uv_material (the
    exporter cannot carry Object-space coordinates into glTF).
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


def _photo_uv_material(name: str, filename: str, roughness: float,
                       emissive: bool = False, emission_strength: float = 1.0):
    """Photo material fed by the mesh's own UV layer (TexCoord "UV" output,
    no Mapping node), so the tiling the exporter writes is exactly the UV0
    coordinates baked onto the mesh -- no KHR_texture_transform, nothing the
    exporter can silently drop. Floor and ceiling use this; the caller must
    bake matching UVs (_assign_world_xy_uv / _assign_top_unit_uv) or the
    texture reads stretched. With emissive=True the photo also drives the
    Principled Emission Color (troffer lens); no Blender light object.
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
    nt.links.new(coord.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if emissive:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = float(emission_strength)
    bsdf.inputs["Roughness"].default_value = float(roughness)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _ensure_uv_layer(obj) -> object:
    """Fetch or create the mesh's UVMap layer and make it active, so the
    glTF exporter writes it as TEXCOORD_0 (Blender runtime only)."""
    mesh = obj.data
    uv = mesh.uv_layers.get("UVMap")
    if uv is None:
        uv = mesh.uv_layers.new(name="UVMap")
    mesh.uv_layers.active = uv
    return uv


def _assign_world_xy_uv(obj, scale: float) -> None:
    """Bake real-world tiling into UV0: U = x_m * scale, V = y_m * scale.
    new_box verts are absolute (object transform is identity), so loop-vertex
    coordinates are already room meters. The matching _photo_uv_material
    carries no Mapping scale, so the export shows a genuine repeat.
    """
    mesh = obj.data
    uv = _ensure_uv_layer(obj)
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (co.x * scale, co.y * scale)


def _assign_top_unit_uv(obj, x0: float, x1: float, y0: float, y1: float) -> None:
    """Map the top (+Z) face loops once across 0..1 (troffer lens photo is a
    single fixture, not a tiling field); every other loop goes to (0, 0).
    Object space is world space here (identity transform, see above).
    """
    mesh = obj.data
    uv = _ensure_uv_layer(obj)
    dx, dy = x1 - x0, y1 - y0
    for poly in mesh.polygons:
        top = poly.normal.z > 0.9
        for loop_index in poly.loop_indices:
            if top:
                co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                uv.data[loop_index].uv = ((co.x - x0) / dx, (co.y - y0) / dy)
            else:
                uv.data[loop_index].uv = (0.0, 0.0)


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


def _emit_finish_geometry(seed: int = 7, palette: dict | None = None, bounds: dict | None = None,
                         crash_rail: bool = False, ceiling_z: float | None = None) -> dict:
    """Build finish meshes: the vinyl floor field and the S6 acoustic-tile
    ceiling field plus one flush troffer always; the crash rail only when
    explicitly enabled (off by default; some other room type may want it).

    S5 deletions (DUAL90 corridor 90-breakers, owned by S6 where noted):
    exam table, exit sign, the whole hand-built door kit (replaced by
    Infinigen's own kept leaf, textured in apply_finish), the flat ceiling
    field and the T-bar grid (rebuilt below from the measured ceiling plane:
    the tile field spans the shell at the T-bar plane, the troffer lens sits
    flush in it -- emissive material only, no Blender light object or node
    cut).

    ceiling_z is the shell ceiling mesh's own room-facing (inner) face height
    measured by apply_finish; None keeps the legacy pooled cross-shell maxz
    (single-box fixtures with no ceiling mesh).
    """
    import bpy  # type: ignore[import-not-found]
    import math

    # Anchor all placements to the measured base-shell bounds so finish
    # geometry lands inside the actual room instead of fixed coordinates
    # sized for a different shell.
    b = bounds or {"x": [-3.0, 3.0], "y": [-2.4, 2.4], "z": [0.0, 2.8]}
    minx, maxx = b["x"]
    miny, maxy = b["y"]
    minz, maxz = b["z"]
    cx, cy = (minx + maxx) / 2.0, (miny + maxy) / 2.0
    w, d, h = maxx - minx, maxy - miny, maxz - minz
    created: list[str] = []
    counts = {"floor": 0, "ceiling": 0, "troffer": 0, "rail": 0}

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
    # Photo-texture finish materials. Floor and ceiling are UV-fed (see
    # _photo_uv_material): the tiling lives in baked per-vertex UV0 so the
    # glTF export carries a genuine repeat. Built by the _photo_* builders,
    # never by mat_for, so the flat-paint loop in apply_finish() cannot
    # stomp them (it only assigns wall/trim materials to base-shell meshes;
    # openclinxr_ finish meshes are skipped). The door leaf keeps
    # Object-space mapping (its shell-bake atlas has no usable UVs).
    floor_photo_m = _photo_uv_material("openclinxr_finish_floor_photo", FLOOR_TEXTURE_FILE, 0.45)
    ceiling_photo_m = _photo_uv_material("openclinxr_finish_ceiling_photo", CEILING_TEXTURE_FILE, 0.9)
    troffer_m = _photo_uv_material("openclinxr_finish_troffer_emissive", TROFFER_TEXTURE_FILE, 0.4,
                                   emissive=True, emission_strength=TROFFER_EMISSION_STRENGTH)
    rail_m = mat_for("openclinxr_finish_rail", [0.35, 0.55, 0.70], 0.5)

    def new_box(name: str, x: float, y: float, z: float, dx: float, dy: float, dz: float, mat: object = None):
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
        return obj

    # Vinyl floor field closes the shell, with real-world tiling baked into
    # UV0 (U = x_m / 1.2, V = y_m / 1.2) so the repeat survives glTF export.
    floor_obj = new_box("openclinxr_floor_field", cx, cy, minz + 0.03, w, d, 0.05, floor_photo_m)
    _assign_world_xy_uv(floor_obj, 1.0 / FLOOR_REPEAT_M)
    counts["floor"] += 1
    # S6 ceiling: the acoustic-tile field spans the shell with its underside
    # exactly on the T-bar plane (the shell ceiling's own room-facing face
    # minus the suspension drop, never the pooled cross-shell maxz: the
    # exterior mesh's top cap sits ~11 cm above the ceiling plane on the real
    # ward shell, and hanging the field off maxz parked the tiles above the
    # visible plane so the room saw flat-painted shell), tiled at the 0.6 m
    # module via baked UV0. One 2x4 troffer lens sits near the room centre
    # with its top face 1 mm below the tile underside (flush read, no
    # z-fighting): edges snap to the grid origin below, so every long edge
    # lands on a 0.6 m line.
    ceiling_plane_z = ceiling_z if ceiling_z is not None else maxz
    tbar_z = ceiling_plane_z - CEILING_TBAR_DROP_M
    ceil_obj = new_box("openclinxr_ceiling_tiles", cx, cy, tbar_z + 0.01, w, d, 0.02, ceiling_photo_m)
    _assign_world_xy_uv(ceil_obj, 1.0 / CEILING_REPEAT_M)
    counts["ceiling"] += 1
    grid_ox = math.floor(minx / CEILING_MODULE_M) * CEILING_MODULE_M
    grid_oy = math.floor(miny / CEILING_MODULE_M) * CEILING_MODULE_M
    troffer_x0 = round((cx - TROFFER_LONG_M / 2 - grid_ox) / CEILING_MODULE_M) * CEILING_MODULE_M + grid_ox
    troffer_y0 = round((cy - TROFFER_SHORT_M / 2 - grid_oy) / CEILING_MODULE_M) * CEILING_MODULE_M + grid_oy
    troffer_x1, troffer_y1 = troffer_x0 + TROFFER_LONG_M, troffer_y0 + TROFFER_SHORT_M
    troffer_obj = new_box("openclinxr_troffer_lens",
                          troffer_x0 + TROFFER_LONG_M / 2, troffer_y0 + TROFFER_SHORT_M / 2,
                          tbar_z - 0.001 - 0.005, TROFFER_LONG_M, TROFFER_SHORT_M, 0.01, troffer_m)
    _assign_top_unit_uv(troffer_obj, troffer_x0, troffer_x1, troffer_y0, troffer_y1)
    counts["troffer"] += 1
    ceiling_grid = {
        "origin": [grid_ox, grid_oy],
        "module": CEILING_MODULE_M,
        "tbarZ": tbar_z,
        "shellCeilingZ": ceiling_plane_z,
        "troffer": {"minX": troffer_x0, "maxX": troffer_x1,
                    "minY": troffer_y0, "maxY": troffer_y1, "topZ": tbar_z - 0.001},
    }
    # Crash rail along corridor wall, off by default
    if crash_rail:
        new_box("openclinxr_crash_rail", cx, miny + 0.02, minz + h * 0.32, w * 0.67, 0.08, 0.15, rail_m)
        counts["rail"] += 1
    return {"meshes": created, "counts": counts, "crashRail": crash_rail, "seed": seed,
            "ceilingGrid": ceiling_grid}


def _texture_kept_door_leaf() -> list[str]:
    """Assign the maple photo material to Infinigen's own kept door leaf
    (Blender runtime only). Matches objects the strip renamed into the room
    prefix ("<room>_<seg>/<seg>.door_leaf", multi-leaf "<seg>.door_leaf_N").

    Object-space tiling, the convention the floor field used before S6: the
    leaf arrives carrying the shell-bake atlas, so full-face UV projection
    does not apply. Slots whose material name mentions glass keep their material
    (the lite's glass must not read as wood); every other slot goes maple.
    Post-S2-bake leaves carry consolidated shell_bake_* slots, so the whole
    leaf -- lite included -- reads maple there; recorded, not masked.
    """
    import bpy  # type: ignore[import-not-found]
    import re

    leaf_re = re.compile(r"\.door_leaf(_\d+)?$")
    leaf_m = _photo_object_material("openclinxr_finish_door_photo", DOOR_TEXTURE_FILE,
                                    FLOOR_OBJECT_SCALE, 0.48)
    textured: list[str] = []
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or not leaf_re.search(obj.name):
            continue
        mesh = obj.data
        for index, slot in enumerate(mesh.materials):
            if slot is not None and "glass" in slot.name.lower():
                continue
            mesh.materials[index] = leaf_m
        if len(mesh.materials) == 0:
            mesh.materials.append(leaf_m)
        textured.append(obj.name)
    return textured


def crash_rail_enabled(recipe: dict) -> bool:
    """Recipe options.crashRail gates the crash rail; absent means off."""
    options = recipe.get("options")
    if not isinstance(options, dict):
        return False
    value = options.get("crashRail", False)
    if not isinstance(value, bool):
        raise ValueError("recipe.options.crashRail must be a boolean when present")
    return value


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
    # The ceiling plane is measured off the shell ceiling mesh's OWN
    # room-facing (inner) face, not the pooled cross-shell maxz: on the real
    # ward shell the exterior mesh's top cap reaches ~11 cm above the
    # zero-thickness ceiling plane, so maxz is not the plane a viewer sees.
    # The ceiling mesh is the non-trim shell mesh carrying the Infinigen
    # ceiling segment name ("<room>_<seg>/<seg>.ceiling"); the trim
    # classification excludes skirting_ceiling, and the topmost inner face
    # wins when several match. No ceiling mesh (single-box fixtures) falls
    # back to the pooled maxz, the previous behaviour.
    xs, ys, zs = [], [], []
    ceiling_inner_z: float | None = None
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("openclinxr_"):
            continue
        mesh_min_z: float | None = None
        for v in obj.data.vertices:
            wv = obj.matrix_world @ v.co
            xs.append(wv.x); ys.append(wv.y); zs.append(wv.z)
            if mesh_min_z is None or wv.z < mesh_min_z:
                mesh_min_z = wv.z
        if (
            mesh_min_z is not None
            and "ceiling" in obj.name.lower()
            and classify_mesh(obj.name) != "trim"
        ):
            if ceiling_inner_z is None or mesh_min_z > ceiling_inner_z:
                ceiling_inner_z = mesh_min_z
    shell = {"x": [min(xs), max(xs)], "y": [min(ys), max(ys)], "z": [min(zs), max(zs)]} if xs else None
    emitted = _emit_finish_geometry(seed=int(recipe.get("seed", 7)), palette=palette, bounds=shell,
                                    crash_rail=crash_rail_enabled(recipe), ceiling_z=ceiling_inner_z)
    # S5: Infinigen's own kept leaf gets the maple photo skin; the casing and
    # skirting keep the trim flat paint from the loop above (no trim photo
    # exists in the licensed set). Fail closed when the strip did not keep
    # a leaf: a finish without a door would re-create the dark-hole capture.
    door_leaf = _texture_kept_door_leaf()
    if not door_leaf:
        raise SystemExit("room_clinic_finish: no kept door leaf (*.door_leaf) in input GLB")

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
        "emittedCeilingGrid": emitted["ceilingGrid"],
        "blenderLights": len([obj for obj in bpy.data.objects if obj.type == "LIGHT"]),
        "crashRail": emitted["crashRail"],
        "doorLeafPhoto": door_leaf,
    }
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print("room_clinic_finish: painted=%r anchors=%r" % (painted, stamped))
    return 0


if __name__ == "__main__":
    raise SystemExit(apply_finish())
