"""room_clinic_finish compose stage: paint wall/trim materials + stamp signage anchors.

Reads the recipe JSON written by run.ts (--recipe-json), applies the palette
to wall/trim mesh materials (matched by name), textures Infinigen's own kept
door leaf with the maple photo material, and creates one EMPTY per signage
anchor at the wall positions. Emits finish geometry (the vinyl floor field,
the S6 acoustic-tile ceiling field plus one flush troffer, plus the crash
rail only when recipe options.crashRail is true).

ward_photo preservation (dark-factory rule): under the ward_photo preset the
flat wall/trim repaint is skipped, so the shell_bake_wall/ceiling/trim
materials pass through untouched with their baked normal/roughness maps;
the floor field emits with the procedural vinyl-tile face (ward tile
exception, see README) instead of the shell rubber bake.

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

# Photo-texture sources for the ward realism pass (row-30 for the floor and
# door photos; the ceiling tile face is procedural speckle, the troffer lens
# a flat emissive panel -- neither carries a photo, so neither needs one).
# Resolved relative to this file so the Blender-spawned stage stays
# self-contained. Fail closed at compose time when a file is absent.
# S5 wires floor vinyl and the real-leaf maple. S6 wires the ceiling
# tile-face repeat, the real T-bar strip grid, and the flat troffer below.
TEXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
FLOOR_TEXTURE_FILE = "floor-vinyl.jpg"
DOOR_TEXTURE_FILE = "door-maple.jpg"
# Single acoustic-tile FACE (procedural speckle, no photo): holds no T-bar
# lines at all, so no baked grid can double against the real strips below.
# One repeat spans exactly one 0.6 m module.
CEILING_TEXTURE_FILE = "ceiling-tile-face.png"
# Derived PBR maps for the procedural tile face (finish-preserve-shell):
# height-from-luminance Sobel (strength 2.0) + inverted 5x5 local-contrast
# roughness, wraparound sampling (the face repeats at runtime) -- the same
# operators as the Imagine texture pipeline. Distinct -derived- names so
# they never collide with that pipeline's -normal/-roughness files.
CEILING_NORMAL_FILE = "ceiling-tile-face-derived-normal.png"
CEILING_ROUGHNESS_FILE = "ceiling-tile-face-derived-roughness.png"
# Door leaf crop (leaf aspect 0.95:2.10, single UV 0-1 map, never tiled)
# plus its edge-clamped script-derived maps (Imagine row-33 working set).
DOOR_LEAF_FILE = "door-maple-leaf.jpg"
DOOR_NORMAL_FILE = "door-maple-normal.png"
DOOR_ROUGHNESS_FILE = "door-maple-roughness.png"
# Object-space tiling scale. floor-vinyl.jpg is a representative sheet-vinyl
# patch, so one repeat spans 1.2 m (same convention as the ward-finish
# lineage's FLOOR_OBJECT_SCALE). Only the kept door leaf still uses
# Object-space mapping; floor and ceiling bake real per-vertex UV0 instead
# (glTF has no Object-space coordinate: the exporter dropped the Mapping
# scale into a KHR_texture_transform on a missing UV channel, which renders
# as one stretched texel -- measured 2026-09-28 on a real work GLB: floor
# primitive carried POSITION+NORMAL only, no TEXCOORD).
FLOOR_OBJECT_SCALE = 1.0 / 1.2
# Ward vinyl TILE face (documented dark-factory exception, see README):
# procedural single-tile face (generate-floor-tile-face.py, seeded), one
# repeat spans exactly one 0.6 m module, seam borders baked into the
# albedo plus a matching groove in the derived normal map. The shell
# BumpyRubberFloor bake cannot produce this: Infinigen ships no
# vinyl/linoleum material class (assets/materials has plastic, ceramic,
# wood, fabric -- no vinyl), and the closest tile family
# (ceramic.Tile.generate in assets/materials/ceramic/tile.py) draws a
# random shader/shape/scale per seed (log_uniform(1.0, 2.0) shader-space,
# not metre modules), so a 600 mm speckled vinyl module is not
# parameterizable in room_generate -- the finish adds it, the same class
# of addition as the ceiling T-bar/troffer assembly.
FLOOR_TILE_TEXTURE_FILE = "floor-vinyl-tile.png"
FLOOR_TILE_NORMAL_FILE = "floor-vinyl-tile-derived-normal.png"
FLOOR_TILE_ROUGHNESS_FILE = "floor-vinyl-tile-derived-roughness.png"
FLOOR_TILE_MODULE_M = 0.6
# Real-world repeats for the baked UV0 coordinates (U = x_m / REPEAT).
FLOOR_REPEAT_M = 1.2
CEILING_MODULE_M = 0.6
# The tile-face texture holds exactly one tile face, so one repeat spans one
# 0.6 m module: every tile renders at the v2 spec module, and the grid lines
# the room shows are the real T-bar strips below, never baked photo lines.
CEILING_REPEAT_M = CEILING_MODULE_M
# White T-bar strip width (24 mm) on the 0.6 m module.
TBAR_WIDTH_M = 0.024
# T-bar strips sit 2 mm proud of the tile underside so they read as real
# lines instead of hiding inside the tile-field slab.
TBAR_PROUD_M = 0.002
# 2x4 troffer lens: spans two 0.6 m cells by one.
TROFFER_LONG_M = 1.2
TROFFER_SHORT_M = 0.6
# T-bar suspension drop below the measured ceiling plane. Mirrors the
# ceiling recipe fragment's TBAR_DROP_M (ceiling.py); the troffer-face and
# grid assertions pin this value against the export, so a drift fails loud.
CEILING_TBAR_DROP_M = 0.06
# Flat lay-in LED panel face: near-white, no photo. Matches the v2 reference
# troffer lens (flat, diffuse, bright against the tiles).
TROFFER_FACE_RGB = (0.93, 0.93, 0.92)
# Troffer lens readout: emission strength of the flat panel face.
TROFFER_EMISSION_STRENGTH = 2.0
# Thin vinyl cove base (documented dark-factory exception, see README):
# 100 mm tall, ~flush to the wall, single clean top edge, matte vinyl
# grey. Infinigen-first was investigated and refused: skirting_board.py
# apply_skirtingboard() takes no height/profile parameters (height draws
# uniform(0.08, 0.15), thickness uniform(0.02, 0.05), and the profile
# control points draw random peaks inside FixedSeed -- nothing threads
# through make_skirting_board() or any gin-configurable), so the specced
# thin cove is not parameterizable in room_generate -- the finish
# replaces the shell floor skirting with these runs. The material name
# matches the existing room-albedo-ao-bake.py FINISH_FLAT_SKIP_MATERIALS
# entry, so a later rebake keeps the flat Base Color; the linear grey
# below is bake_shell_materials.py SKIRTING_BASE_COLOR_LINEAR (pinned and
# calibrated in runtime space against imagine-multiview-v2 06-floor-base).
SKIRTING_COVE_HEIGHT_M = 0.10
SKIRTING_COVE_THICKNESS_M = 0.018
SKIRTING_COVE_RGB_LINEAR = (0.313, 0.323, 0.352)
SKIRTING_COVE_ROUGHNESS = 0.9
# Draft-triangle profile: the run leans back 10 degrees so its top edge
# dies into the wall plane -- no flat shelf, hence no glare band. (A box
# top face rendered a 195 spike; a 12 mm chamfer cap rendered a 19-row
# 193 shelf: any up-facing flat at this glancing angle outshines both
# neighbors. The triangle's sloped room face reads near-vertical
# brightness with a single intersection line at the top, the reference
# anatomy.) Back edge sits 1 mm inside the wall so no coplanar faces
# remain (single-sided, backface-culled from the room).
# Tile field top lift above the measured shell floor plane: the shell
# floor is a zero-thickness plane (measured z=0 on the seed-205 ward)
# while the shell bounds min sits ~0.13 lower (exterior bottom cap), so
# a bounds-anchored field buries itself (measured: field top -0.055
# under the shell plane, rendering the shell cloud instead of the
# tile). 3 mm clears the plane with no coplanar fight.
FLOOR_FIELD_LIFT_M = 0.003
# Door-gap casing margin: the door-wall cove run splits around the kept
# leaf bbox expanded by this much per side along the run axis.
SKIRTING_DOOR_MARGIN_M = 0.06


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


def _load_data_image(path: str):
    """Load a normal/roughness map with Non-Color colour space (Blender runtime only)."""
    import bpy  # type: ignore[import-not-found]

    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "Non-Color"
    return img


def _photo_object_material(name: str, filename: str, scale_xy: float, roughness: float,
                           normal_filename: str | None = None,
                           roughness_filename: str | None = None):
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
    if normal_filename is not None or roughness_filename is not None:
        # PBR pattern from bake_shell_materials.build_role_material (Normal
        # Map node -> BSDF Normal; roughness texture -> BSDF Roughness);
        # vector source is the shared Object-space Mapping (the leaf carries
        # the shell-bake atlas, so no usable UV layer exists).
        if normal_filename is not None:
            ntex = nt.nodes.new("ShaderNodeTexImage")
            ntex.image = _load_data_image(_texture_path(normal_filename))
            ntex.extension = "REPEAT"
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.space = "TANGENT"
            nt.links.new(mapping.outputs["Vector"], ntex.inputs["Vector"])
            nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        if roughness_filename is not None:
            rtex = nt.nodes.new("ShaderNodeTexImage")
            rtex.image = _load_data_image(_texture_path(roughness_filename))
            rtex.extension = "REPEAT"
            nt.links.new(mapping.outputs["Vector"], rtex.inputs["Vector"])
            nt.links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _photo_uv_material(name: str, filename: str, roughness: float,
                       emissive: bool = False, emission_strength: float = 1.0,
                       normal_filename: str | None = None,
                       roughness_filename: str | None = None):
    """Photo material fed by the mesh's own UV layer (TexCoord "UV" output,
    no Mapping node), so the tiling the exporter writes is exactly the UV0
    coordinates baked onto the mesh -- no KHR_texture_transform, nothing the
    exporter can silently drop. Floor and ceiling use this; the caller must
    bake matching UVs (_assign_world_xy_uv / _assign_top_unit_uv) or the
    texture reads stretched. With emissive=True the photo also drives the
    Principled Emission Color; no Blender light object.
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
    if normal_filename is not None or roughness_filename is not None:
        # PBR pattern from bake_shell_materials.build_role_material: UV Map
        # node -> texture -> Normal Map node -> BSDF Normal input; roughness
        # texture -> BSDF Roughness input. Shared "UVMap" node (the baked
        # per-vertex UV0 layer the albedo already samples via TexCoord UV).
        shared_uv = nt.nodes.new("ShaderNodeUVMap")
        shared_uv.uv_map = "UVMap"
        if normal_filename is not None:
            ntex = nt.nodes.new("ShaderNodeTexImage")
            ntex.image = _load_data_image(_texture_path(normal_filename))
            ntex.extension = "REPEAT"
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.space = "TANGENT"
            nmap.uv_map = "UVMap"
            nt.links.new(shared_uv.outputs["UV"], ntex.inputs["Vector"])
            nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        if roughness_filename is not None:
            rtex = nt.nodes.new("ShaderNodeTexImage")
            rtex.image = _load_data_image(_texture_path(roughness_filename))
            rtex.extension = "REPEAT"
            nt.links.new(shared_uv.outputs["UV"], rtex.inputs["Vector"])
            nt.links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _flat_material(name: str, rgb: tuple, roughness: float,
                   emissive: bool = False, emission_strength: float = 1.0):
    """Flat Principled material with NO image node at all (Blender runtime
    only). The white T-bar strips and the flat lay-in troffer lens use this:
    the v2 spec wants plain white metal/paint and a plain diffuse panel face,
    not photos. With emissive=True the face colour also drives the Principled
    Emission Color (troffer lens); no Blender light object.
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
    rgba = (float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0)
    bsdf.inputs["Base Color"].default_value = rgba
    if emissive:
        bsdf.inputs["Emission Color"].default_value = rgba
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


def _is_shell_floor_skirting(obj_name: str) -> bool:
    """Post-strip floor-skirting names only (Blender runtime or pure).

    Matches "<room>_<seg>/<seg>.skirting_floor" (strip keep_re) and the raw
    factory name "skirtingboard_support" (floor). Ceiling names
    (".skirting_ceiling", "skirtingboard_ceiling") are NOT matched: the
    ceiling cornice stays untouched.
    """
    lowered = obj_name.lower()
    if "skirting_ceiling" in lowered or "skirtingboard_ceiling" in lowered:
        return False
    return "skirting_floor" in lowered or "skirtingboard_support" in lowered


def _is_wall_shell(obj_name: str) -> bool:
    """Wall meshes that carry an inner face the cove base sits against."""
    lowered = obj_name.lower()
    if lowered.startswith("openclinxr_"):
        return False
    if "wall" not in lowered:
        return False
    for part in ("door", "window", "skirt", "skirting", "ceiling", "floor", "trim", "casing"):
        if part in lowered:
            return False
    return True


def _wall_inner_planes() -> dict:
    """Measure each side's wall inner-face plane from the shell (Blender runtime only).

    Normal-clustered: wall polygons with axis-dominant normals vote their
    center plane per facing; each side takes the vote closest to the room
    center (the inner face, not the exterior back face). Handles the real
    merged shell (one "bedroom_0/0.wall" mesh for all sides) and separate
    slab fixtures uniformly. Returns {"x0", "x1", "y0", "y1", "cx", "cy"}
    in world meters. Fails closed when a side has no facing polygons.
    """
    import bpy  # type: ignore[import-not-found]

    meshes = [obj for obj in bpy.data.objects
              if obj.type == "MESH" and _is_wall_shell(obj.name)]
    if not meshes:
        raise SystemExit("room_clinic_finish: no wall shells for cove placement")
    rot = [obj.matrix_world.to_3x3() for obj in meshes]
    votes: dict[str, list[float]] = {"px": [], "nx": [], "py": [], "ny": []}
    for obj, rot_mat in zip(meshes, rot):
        mesh = obj.data
        for poly in mesh.polygons:
            world_normal = (rot_mat @ poly.normal).normalized()
            comps = (abs(world_normal.x), abs(world_normal.y), abs(world_normal.z))
            if max(comps) < 0.9 or comps[2] == max(comps):
                continue  # slanted or horizontal: not a wall face
            center = [0.0, 0.0, 0.0]
            for loop_index in poly.loop_indices:
                wv = obj.matrix_world @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
                center[0] += wv.x
                center[1] += wv.y
                center[2] += wv.z
            count = len(poly.loop_indices)
            if comps[0] == max(comps):
                votes["px" if world_normal.x > 0 else "nx"].append(center[0] / count)
            else:
                votes["py" if world_normal.y > 0 else "ny"].append(center[1] / count)
    for key, faces in votes.items():
        if not faces:
            raise SystemExit("room_clinic_finish: wall inner face missing (no %s-facing polygons)" % key)
    planes = {"x0": min(votes["px"]), "x1": max(votes["nx"]),
              "y0": min(votes["py"]), "y1": max(votes["ny"])}
    if not (planes["x1"] > planes["x0"] and planes["y1"] > planes["y0"]):
        raise SystemExit("room_clinic_finish: wall inner planes disagree: %r" % planes)
    planes["cx"] = (planes["x0"] + planes["x1"]) / 2
    planes["cy"] = (planes["y0"] + planes["y1"]) / 2
    return planes


def _door_leaf_xy_range() -> dict | None:
    """World x/y bbox of the kept door leaves (Blender runtime only)."""
    import bpy  # type: ignore[import-not-found]
    import re

    leaf_re = re.compile(r"\.door_leaf(_\d+)?$")
    xs: list[float] = []
    ys: list[float] = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not leaf_re.search(obj.name):
            continue
        for v in obj.data.vertices:
            wv = obj.matrix_world @ v.co
            xs.append(wv.x)
            ys.append(wv.y)
    if not xs:
        return None
    return {"minX": min(xs), "maxX": max(xs), "minY": min(ys), "maxY": max(ys)}


def _shell_floor_top() -> float | None:
    """Measured shell floor plane height (Blender runtime only).

    Max vertex z over floor-shell objects (bake role_for_object floor:
    ".floor"/"/floor" in the name, which excludes skirting_floor and the
    finish field). Fail-soft None when no floor shell exists.
    """
    import bpy  # type: ignore[import-not-found]

    top: float | None = None
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("openclinxr_"):
            continue
        lowered = obj.name.lower()
        if ".floor" not in lowered and "/floor" not in lowered:
            continue
        for v in obj.data.vertices:
            z = (obj.matrix_world @ v.co).z
            if top is None or z > top:
                top = z
    return top


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
                         crash_rail: bool = False, ceiling_z: float | None = None,
                         emit_floor: bool = True, floor_tile_layout: bool = False,
                         emit_cove: bool = False, floor_top: float | None = None) -> dict:
    """Build finish meshes: the vinyl floor field and the S6 acoustic-tile
    ceiling field plus one flush troffer always; the crash rail only when
    explicitly enabled (off by default; some other room type may want it).

    emit_floor=False skips the floor field entirely (legacy ward_photo
    dark-factory preservation: the shell_bake_floor was the source of truth
    for the floor). floor_tile_layout=True (ward tile exception, see
    README) emits the field with the procedural 600 mm vinyl-tile face
    instead of the legacy 1.2 m sheet-vinyl photo: the shell rubber bake
    reads as a low-frequency cloud with no seams, and Infinigen cannot
    produce the specced tile (see FLOOR_TILE_* comment above), so the
    finish adds it. The ceiling tile field always emits: the
    T-bar/tile/troffer assembly is what the shell bake structurally cannot
    model, the legitimate finish addition.

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
    # The ceiling tile face carries full PBR (derived normal + roughness);
    # the ward floor tile likewise (derived normal with seam grooves +
    # roughness); the legacy sheet-vinyl floor stays albedo-only.
    ceiling_photo_m = _photo_uv_material("openclinxr_finish_ceiling_photo", CEILING_TEXTURE_FILE, 0.9,
                                         normal_filename=CEILING_NORMAL_FILE,
                                         roughness_filename=CEILING_ROUGHNESS_FILE)
    # Flat lay-in LED panel: plain near-white emissive face, no photo (the
    # louvred-fixture photo is gone -- v2 wants a flat diffuse panel).
    troffer_m = _flat_material("openclinxr_finish_troffer_emissive", TROFFER_FACE_RGB, 0.4,
                               emissive=True, emission_strength=TROFFER_EMISSION_STRENGTH)
    # White T-bar strips: flat paint, no texture. Named for the bake skip
    # list in room-albedo-ao-bake.py (FINISH_FLAT_SKIP_MATERIALS) so a later
    # rebake keeps the flat Base Color instead of baking it near-black.
    tbar_m = _flat_material("openclinxr_finish_tbar", (0.93, 0.93, 0.92), 0.6)
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
    # UV0 (U = x_m / repeat, V = y_m / repeat) so the repeat survives glTF
    # export. Sheet vinyl (1.2 m repeat, albedo-only) for the legacy
    # presets; vinyl tile (0.6 m module, full PBR with seam grooves) for
    # the ward tile exception (floor_tile_layout).
    if emit_floor:
        if floor_tile_layout:
            if floor_top is None:
                raise SystemExit("room_clinic_finish: tile field needs a measured shell floor plane")
            floor_m = _photo_uv_material("openclinxr_finish_floor_tile_photo", FLOOR_TILE_TEXTURE_FILE, 0.52,
                                         normal_filename=FLOOR_TILE_NORMAL_FILE,
                                         roughness_filename=FLOOR_TILE_ROUGHNESS_FILE)
            # Top rides 3 mm above the shell plane (never the bounds min).
            floor_obj = new_box("openclinxr_floor_field", cx, cy, floor_top + FLOOR_FIELD_LIFT_M - 0.025,
                                w, d, 0.05, floor_m)
            _assign_world_xy_uv(floor_obj, 1.0 / FLOOR_TILE_MODULE_M)
        else:
            floor_photo_m = _photo_uv_material("openclinxr_finish_floor_photo", FLOOR_TEXTURE_FILE, 0.45)
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
    # Real T-bar grid: 24 mm white strips on the 0.6 m module lines anchored
    # to the grid origin above, 2 mm proud of the tile underside so they read
    # as geometry instead of hiding in the tile slab. Strips stop at the
    # troffer footprint (the fixture replaces the tiles there; the grid
    # frames it on all four edges exactly like the v2 reference).
    tbar_lines_x: list[float] = []
    tbar_lines_y: list[float] = []
    tbar_count = 0
    strip_margin = TBAR_WIDTH_M / 2 + 0.002
    kx = math.ceil((minx - grid_ox) / CEILING_MODULE_M)
    while True:
        line = grid_ox + kx * CEILING_MODULE_M
        if line > maxx + 1e-6:
            break
        if line >= minx - 1e-6:
            tbar_lines_x.append(line)
            spans = [(miny, maxy)]
            if troffer_x0 - strip_margin <= line <= troffer_x1 + strip_margin:
                spans = [(miny, troffer_y0), (troffer_y1, maxy)]
            for index, (ya, yb) in enumerate(spans):
                if yb - ya < 0.001:
                    continue
                new_box("openclinxr_tbar_x_%d_%d" % (kx, index), line, (ya + yb) / 2,
                        tbar_z - TBAR_PROUD_M + 0.01, TBAR_WIDTH_M, yb - ya, 0.02, tbar_m)
                tbar_count += 1
        kx += 1
    ky = math.ceil((miny - grid_oy) / CEILING_MODULE_M)
    while True:
        line = grid_oy + ky * CEILING_MODULE_M
        if line > maxy + 1e-6:
            break
        if line >= miny - 1e-6:
            tbar_lines_y.append(line)
            spans = [(minx, maxx)]
            if troffer_y0 - strip_margin <= line <= troffer_y1 + strip_margin:
                spans = [(minx, troffer_x0), (troffer_x1, maxx)]
            for index, (xa, xb) in enumerate(spans):
                if xb - xa < 0.001:
                    continue
                new_box("openclinxr_tbar_y_%d_%d" % (ky, index), (xa + xb) / 2, line,
                        tbar_z - TBAR_PROUD_M + 0.01, xb - xa, TBAR_WIDTH_M, 0.02, tbar_m)
                tbar_count += 1
        ky += 1
    counts["tbar"] = tbar_count
    ceiling_grid = {
        "origin": [grid_ox, grid_oy],
        "module": CEILING_MODULE_M,
        "tbarZ": tbar_z,
        "shellCeilingZ": ceiling_plane_z,
        "tbarLinesX": tbar_lines_x,
        "tbarLinesY": tbar_lines_y,
        "troffer": {"minX": troffer_x0, "maxX": troffer_x1,
                    "minY": troffer_y0, "maxY": troffer_y1, "topZ": tbar_z - 0.001},
    }
    # Crash rail along corridor wall, off by default
    if crash_rail:
        new_box("openclinxr_crash_rail", cx, miny + 0.02, minz + h * 0.32, w * 0.67, 0.08, 0.15, rail_m)
        counts["rail"] += 1
    cove_info: dict = {"runs": 0, "doorGap": None}
    if emit_cove:
        if floor_top is None:
            raise SystemExit("room_clinic_finish: cove base needs a measured shell floor plane")
        cove_m = _flat_material("openclinxr_finish_cove", SKIRTING_COVE_RGB_LINEAR, SKIRTING_COVE_ROUGHNESS)
        planes = _wall_inner_planes()
        x0, x1, y0, y1 = planes["x0"], planes["x1"], planes["y0"], planes["y1"]
        t = SKIRTING_COVE_THICKNESS_M
        # X-side runs (vary along y); y-side runs (vary along x). X-side
        # runs overshoot by one thickness per end to close the corners.
        runs: list[tuple] = [
            ("x0", x0 + t / 2 - 0.002, (y0 - t, y1 + t), "y"),
            ("x1", x1 - t / 2 + 0.002, (y0 - t, y1 + t), "y"),
            ("y0", y0 + t / 2 - 0.002, (x0, x1), "x"),
            ("y1", y1 - t / 2 + 0.002, (x0, x1), "x"),
        ]
        # Door-wall run splits around the kept leaf bbox (expanded by the
        # casing margin); the leaf sits in the opening, so the leaf's most
        # off-center axis names the door side.
        leaf = _door_leaf_xy_range()
        door_side: str | None = None
        gap: list[float] | None = None
        if leaf is not None:
            lx = (leaf["minX"] + leaf["maxX"]) / 2
            ly = (leaf["minY"] + leaf["maxY"]) / 2
            nx = abs(lx - planes["cx"]) / max((x1 - x0) / 2, 1e-6)
            ny = abs(ly - planes["cy"]) / max((y1 - y0) / 2, 1e-6)
            if nx >= ny:
                door_side = "x0" if lx < planes["cx"] else "x1"
                gap = [leaf["minY"] - SKIRTING_DOOR_MARGIN_M, leaf["maxY"] + SKIRTING_DOOR_MARGIN_M]
            else:
                door_side = "y0" if ly < planes["cy"] else "y1"
                gap = [leaf["minX"] - SKIRTING_DOOR_MARGIN_M, leaf["maxX"] + SKIRTING_DOOR_MARGIN_M]

        def cove_run(name: str, plane_pos: float, seg_lo: float, seg_hi: float,
                     axis: str, side: str) -> None:
            # Draft-triangle prism extruded along the run axis: sloped
            # room face from the field top to an apex 1 mm inside the
            # wall plane, back buried in the wall, bottom on the field.
            # Cross-section (u = offset from the wall face into the room,
            # v = height above the field top): A=(-0.001,0), B=(t,0),
            # C=(-0.001,H). Faces: bottom/slope/back quads plus two end
            # triangles (closed solid, so normals_make_consistent below
            # orients outward regardless of authored winding).
            t = SKIRTING_COVE_THICKNESS_M
            h = SKIRTING_COVE_HEIGHT_M
            zb = floor_top + FLOOR_FIELD_LIFT_M
            mesh = bpy.data.meshes.new(name + "_mesh")
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.scene.collection.objects.link(obj)
            obj["openClinXrFinishDecoration"] = True
            if axis == "y":
                # Run varies along y at fixed x; wall face at plane_pos,
                # room lies toward +x (x0 side) or -x (x1 side).
                direction = 1.0 if side == "x0" else -1.0
                xw = plane_pos - direction * 0.001
                xr = plane_pos + direction * t
                verts = [
                    (xw, seg_lo, zb), (xr, seg_lo, zb), (xw, seg_lo, zb + h),
                    (xw, seg_hi, zb), (xr, seg_hi, zb), (xw, seg_hi, zb + h),
                ]
            else:
                direction = 1.0 if side == "y0" else -1.0
                yw = plane_pos - direction * 0.001
                yr = plane_pos + direction * t
                verts = [
                    (seg_lo, yw, zb), (seg_lo, yr, zb), (seg_lo, yw, zb + h),
                    (seg_hi, yw, zb), (seg_hi, yr, zb), (seg_hi, yw, zb + h),
                ]
            faces = [(0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0), (0, 1, 2), (3, 4, 5)]
            mesh.from_pydata(verts, [], faces)
            mesh.update()
            # Safety net: closed solid, so consistent orientation is
            # outward regardless of the authored winding above.
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.object.mode_set(mode="OBJECT")
            bpy.context.view_layer.objects.active = None
            mesh.materials.append(cove_m)
            created.append(name)
            counts["cove"] = counts.get("cove", 0) + 1

        for side, plane_pos, (lo, hi), axis in runs:
            if side == door_side and gap is not None:
                glo, ghi = max(gap[0], lo), min(gap[1], hi)
                if ghi - glo >= (hi - lo) - 1e-6:
                    continue  # degenerate: leaf spans the run, keep the wall bare
                segments = [(lo, glo), (ghi, hi)]
            else:
                segments = [(lo, hi)]
            for index, (seg_lo, seg_hi) in enumerate(segments):
                if seg_hi - seg_lo < 0.01:
                    continue
                cove_run("openclinxr_cove_%s_%d" % (side, index), plane_pos, seg_lo, seg_hi,
                         axis, side)
        cove_info = {"runs": counts.get("cove", 0), "height": SKIRTING_COVE_HEIGHT_M,
                     "thickness": t, "doorSide": door_side, "doorGap": gap}
    return {"meshes": created, "counts": counts, "crashRail": crash_rail, "seed": seed,
            "ceilingGrid": ceiling_grid, "cove": cove_info}


def _texture_kept_door_leaf(albedo_file: str = DOOR_TEXTURE_FILE,
                            normal_file: str | None = None,
                            roughness_file: str | None = None) -> list[str]:
    """Assign the maple photo material to Infinigen's own kept door leaf
    (Blender runtime only). Matches objects the strip renamed into the room
    prefix ("<room>_<seg>/<seg>.door_leaf", multi-leaf "<seg>.door_leaf_N").

    Object-space tiling, the convention the floor field used before S6: the
    leaf arrives carrying the shell-bake atlas, so full-face UV projection
    does not apply. Slots whose material name mentions glass keep their material
    (the lite's glass must not read as wood); every other slot goes maple.
    Post-S2-bake leaves carry consolidated shell_bake_* slots, so the whole
    leaf -- lite included -- reads maple there; recorded, not masked.

    ward_photo passes the leaf-crop albedo plus its derived normal/roughness
    (full PBR); other presets keep the legacy square maple, albedo-only.
    """
    import bpy  # type: ignore[import-not-found]
    import re

    leaf_re = re.compile(r"\.door_leaf(_\d+)?$")
    leaf_m = _photo_object_material("openclinxr_finish_door_photo", albedo_file,
                                    FLOOR_OBJECT_SCALE, 0.48,
                                    normal_filename=normal_file,
                                    roughness_filename=roughness_file)
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

    # ward_photo dark-factory preservation (finish-preserve-shell): the S2
    # shell bake is the source of truth for wall, ceiling shell, and
    # trim (shell_bake_trim landed with the metal-aware glossy pass), so the
    # flat wall/trim repaint is skipped entirely and those materials pass
    # through untouched with their baked normal/roughness maps. The floor
    # is the documented tile exception (see README): the shell rubber bake
    # cannot produce the specced 600 mm vinyl tile, so the finish emits the
    # procedural tile field instead. Scoped to
    # ward_photo only: peds_calm/clinic_day/evening_calm keep the legacy
    # repaint (their tests + fixtures pin that behaviour; no real-chain
    # calibration depends on changing them).
    preserve_shell = recipe.get("preset") == "ward_photo"

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

    if not preserve_shell:
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
    # Ward cove exception (see README): the shell floor skirting (random
    # height/profile white plastic from skirting_board.py) is removed and
    # the finish emits the thin cove base instead. Ceiling skirting stays.
    # Other presets keep the legacy trim-paint path above (untouched).
    removed_skirting: list[str] = []
    measured_floor_top: float | None = None
    if preserve_shell:
        for obj in list(bpy.data.objects):
            if obj.type == "MESH" and _is_shell_floor_skirting(obj.name):
                removed_skirting.append(obj.name)
                bpy.data.objects.remove(obj, do_unlink=True)
        measured_floor_top = _shell_floor_top()
        if measured_floor_top is None:
            raise SystemExit("room_clinic_finish: no shell floor plane for tile/cove placement")
    emitted = _emit_finish_geometry(seed=int(recipe.get("seed", 7)), palette=palette, bounds=shell,
                                    crash_rail=crash_rail_enabled(recipe), ceiling_z=ceiling_inner_z,
                                    emit_floor=True, floor_tile_layout=preserve_shell,
                                    emit_cove=preserve_shell, floor_top=measured_floor_top)
    # S5: Infinigen's own kept leaf gets the maple photo skin; the casing and
    # skirting keep the trim flat paint from the loop above (no trim photo
    # exists in the licensed set). Under ward_photo preservation there is no
    # trim repaint, so casing/skirting keep their shell_bake_trim instead;
    # the leaf still gets maple (deliberate dark-factory exception: Infinigen
    # has no maple-veneer class), now as the leaf-aspect crop with full PBR.
    # Fail closed when the strip did not keep
    # a leaf: a finish without a door would re-create the dark-hole capture.
    if preserve_shell:
        door_leaf = _texture_kept_door_leaf(DOOR_LEAF_FILE, DOOR_NORMAL_FILE, DOOR_ROUGHNESS_FILE)
    else:
        door_leaf = _texture_kept_door_leaf()
    if not door_leaf:
        raise SystemExit("room_clinic_finish: no kept door leaf (*.door_leaf) in input GLB")

    bpy.ops.wm.save_as_mainfile(filepath=args.output.replace(".glb", ".blend"))
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_extras=True)

    report = {
        "schemaVersion": RECIPE_SCHEMA_VERSION,
        "environmentId": recipe.get("environmentId"),
        "preset": recipe.get("preset"),
        "preserveShell": preserve_shell,
        "painted": painted,
        "signageAnchors": stamped,
        "movedGeometry": True,
        "emittedMeshes": emitted["counts"],
        "emittedCount": len(emitted["meshes"]),
        "emittedCeilingGrid": emitted["ceilingGrid"],
        "emittedCove": emitted["cove"],
        "removedShellSkirting": removed_skirting,
        "measuredFloorTop": measured_floor_top,
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
