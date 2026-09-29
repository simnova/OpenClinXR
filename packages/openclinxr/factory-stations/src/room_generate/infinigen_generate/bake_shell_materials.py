#!/usr/bin/env python3
# Copyright (C) 2026 OpenClinXR. S2 pre-export shell material bake.
#
# Bakes shell materials from the LIVE work.blend (which still holds every
# procedural node tree) BEFORE the glTF extract. The post-extract albedo pass
# bakes from the GLB, but Blender's exporter writes NO image for a procedural
# node tree (10 materials -> 0 images, measured), so hue is gone before that
# bake starts. This pass runs between the strip step and the extract step in
# generate.ts and the unchanged extract then exports the now-baked blend.
#
# Technique: per surface role, box-project the role's objects into a
# full-coverage ALB_<role> layer and bake DIFFUSE with COLOR only (pure
# albedo, NO lighting baked in -- lighting folded into albedo darkens twice
# under runtime lights); the trim role (door leaf/casing, window) bakes an
# extra GLOSSY COLOR pass screened with its diffuse (metals have no diffuse
# response, so COLOR-only bakes them black); the skirting role (floor cove +
# ceiling cornice) bakes NOTHING -- it ships a pinned flat matte vinyl grey
# (Infinigen assigns it random white plastic and trim's glossy/low-roughness
# treatment renders it as a dark streaked metallic strip, measured seed 205);
# box-project ALL kept objects once into a shared BAKE_UV
# atlas and bake NORMAL (tangent) and ROUGHNESS there. Box (cube) projection
# instead of Smart UV Project: measured on the seed-205 ward, smart-project's
# packer collapses 94% of wall+trim loop-tris to zero UV area (wall role
# 0.48 / trim role 0.05 non-degenerate on BAKE_UV; 38 of 79 m^2 of
# center-visible wall rendering as flat snapped-texel faces), while cube
# projection leaves 8% degenerate (micro-faces the snap pass covers); planar
# projection along each face's dominant axis cannot collapse a flat wall
# quad. Fill unpainted (alpha-0) texels with neutral defaults so no cleared
# garbage is ever sampled; then replace each node tree with an Image Texture
# -> Principled BSDF hookup (albedo via ALB_<role>,
# normal/roughness via BAKE_UV). Contact AO stays in room-occlusion-bake.py on
# TEXCOORD_1 (each mesh keeps [ALB_<role>, BAKE_UV] with ALB active at index 0,
# so the AO pass appends AO_UV after them and its restore-active-to-layer-0
# keeps base colour on the albedo layout). Runtime lighting stays runtime: no
# light is added and no light contributes.
#
# Texture budget (decoded RGBA8 x1.33 mips, ward GLB <= 56 MB; 8 MB of the
# 64 MB quest3AssetBudget reserved for fixtures):
#   albedo floor 2048^2 (16 MB) + wall/ceiling/trim 1024^2 x3 (12 MB)
#     + other 512^2 (1 MB) = 29 (skirting carries NO albedo image -- a flat
#     pinned Base Color scalar -- so it adds nothing here)
#   normal shared 1024^2 (4) + roughness shared 1024^2 (4) = 8 (one atlas
#     each over ALL kept objects, so every surface keeps relief and finish
#     variation without per-surface normal images)
#   shell subtotal 37 MB; AO pass (untouched, 4x512^2) adds 4 MB (one image
#   per wired material: residue "other" ships unwired when uniform and shell
#   "skirting" skips by name, so 6 materials wire 4 AO images)
#   total 41 MB x 1.33 = 54.5 MB <= 56 MB
# Trim gets its own 1024 albedo (door/casing/window are primary visible
# surfaces); "other" is residue (exterior hull faces, boolean cutters) and
# drops to 512 to fund it. Every SURFACE image is >= 1024 px on its long
# edge; only the residue atlas is smaller (skirting ships no image at all).
#
# Determinism: fixed SHELL_BAKE_SEED drives random.seed, scene.cycles.seed and
# the bake sampling; cube projection is a pure function of face geometry
# (fixed cube_size/correct_aspect/scale_to_bounds, no RNG); the
# unpainted-texel fill is a pure function of the bake output. Two runs on the
# same seed produce identical image bytes.
#
# Seams/bleed: cube projection lays each face's dominant-axis planar island
# contiguously (no inter-island margin parameter exists). The fixed 4 px bake
# bleed (BAKE_MARGIN_PX) therefore samples neighbour-face texels across
# shared island edges -- neighbour-correct on a contiguous box unwrap, unlike
# a packed atlas where bleed crosses unrelated islands.
#
# Materials are consolidated per surface role (shell_bake_wall/floor/ceiling/
# trim/other/skirting): one atlas-cleared bake per role image (skirting: a
# pinned flat instead of a bake), then every polygon of the role's objects
# points at the role material. This keeps the material count at 6 (4 wired AO
# images: residue "other" ships unwired when uniform and shell "skirting"
# skips occlusion by name).
#
# Usage (inside Blender 5.1 headless):
#   blender --background --python bake_shell_materials.py -- \
#     --blend <work.blend> --output <baked.blend> [--seed N] [--device cpu|metal]
#
# Fail closed: any error prints a traceback and exits 1 via os._exit (Blender
# exits 0 on uncaught Python exceptions, so SystemExit alone is not enough).
# Prints [shell-bake] lines plus one JSON summary on stdout.
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import traceback
from typing import Dict, List, Tuple

SHARED_UV_LAYER = "BAKE_UV"
ALB_UV_PREFIX = "ALB_"
SHELL_BAKE_SEED = 205
BAKE_SAMPLES = 4
BAKE_MARGIN_PX = 4

# Decoded RGBA8 bytes per image size (w*h*4); the budget table lives above.
ALBEDO_SIZE_BY_ROLE = {"floor": 2048, "wall": 1024, "ceiling": 1024, "trim": 1024, "other": 512}
SHARED_NORMAL_SIZE = 1024
SHARED_ROUGHNESS_SIZE = 1024
SHELL_MATERIAL_PREFIX = "shell_bake_"

# Fill for texels no face painted (alpha ~ 0 after the bake): neutral,
# opaque, and deterministic. Keeps material-less hull faces (the exterior
# ships no Infinigen material) a flat light gray instead of cleared garbage.
FILL_ALBEDO = (0.8, 0.8, 0.78, 1.0)
FILL_NORMAL = (0.5, 0.5, 1.0, 1.0)
FILL_ROUGHNESS = (0.9, 0.9, 0.9, 1.0)

# Pinned shell skirting: the spec is a 100mm grey vinyl cove, matte, not
# metal. Infinigen assigns skirting random white plastic per seed, so no bake
# can produce the specced grey; the value below is pinned and calibrated in
# RUNTIME space against imagine-multiview-v2 06-floor-base (strip boxes mean
# ~127-155 sRGB, target ~140, near-neutral). Second-iteration derivation: an
# isolation render of the first-iteration flat (0.42,0.42,0.415, no normal or
# occlusion maps) read (160.5,157.3,150.1) sRGB, giving per-channel scene
# gains (0.838,0.810,0.733) linear -- the capture scene light runs warm, so
# the flat runs slightly cool (sRGB ~152,155,161) to render neutral 140.
# Linear (Blender/three.js Base Color). GREEN re-capture reads 129 center /
# 128 left / 135 right (reference strip spans 127-155; pose-01 brackets from
# above), matte and neutral, streak-free.
SKIRTING_BASE_COLOR_LINEAR = (0.313, 0.323, 0.352, 1.0)
SKIRTING_ROUGHNESS = 0.9


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def role_for_object(obj_name: str) -> str:
    n = obj_name.lower()
    if ".floor" in n or "/floor" in n:
        return "floor"
    if ".wall" in n or "/wall" in n:
        return "wall"
    if ".ceiling" in n or "/ceiling" in n:
        return "ceiling"
    # Skirting (floor cove + ceiling cornice) is NOT trim: Infinigen builds it
    # as dielectric white plastic (wall_decorations/skirting_board.py: a
    # geometry-nodes SetMaterial with plastic_rough, roughness input 0.5-1.0
    # mapped to a 0.05-0.25 glossy output) while the trim bucket exists for
    # the metal door frame (hammered/grained metal + glass lite). Sharing
    # trim's metal-aware GLOSSY screen and low-roughness atlas renders the
    # cove as a dark streaked metallic strip (measured seed 205: runtime mean
    # ~26 vs the ~140 vinyl-grey reference), so skirting gets its own role
    # with a pinned flat matte vinyl grey. Post-strip names
    # ("<room>_<seg>/<seg>.skirting_floor|skirting_ceiling") and raw factory
    # names ("skirtingboard_*") both land here; checked BEFORE trim.
    for part in (".skirting", "/skirting", "skirtingboard",
                 ".baseboard", "/baseboard", ".skirt", "/skirt"):
        if part in n:
            return "skirting"
    # Trim (door leaf/casing, window): Infinigen's own trim parts, either
    # renamed into the room prefix by strip_room_shell_placeholders.py
    # ("<room>_<seg>/<seg>.door_leaf") or in raw factory shape
    # ("DoorCasingFactory(...).spawn_asset").
    # They must NOT fall into "other": the "other" atlas is residue space and
    # the downstream albedo pass treats "other" materials under ceiling
    # lighting assumptions. Substring list mirrors compose.py's
    # TRIM_NAME_RE_PARTS plus the strip step's keep_re suffixes.
    for part in (".door", "/door", "doorfactory", "doorcasingfactory",
                 ".casing", "/casing",
                 ".window", "/window", ".trim", "/trim"):
        if part in n:
            return "trim"
    return "other"


def kept_mesh_objects() -> List[object]:
    import bpy

    return [o for o in bpy.data.objects if o.type == "MESH"]


def make_single_user(obj) -> None:
    if obj.data is not None and obj.data.users > 1:
        obj.data = obj.data.copy()


def ensure_uv_layer(obj, layer_name: str) -> None:
    me = obj.data
    if layer_name not in [u.name for u in me.uv_layers]:
        me.uv_layers.new(name=layer_name)


def box_project_into(objects: List[object], layer_name: str) -> None:
    """Unwrap `objects` into `layer_name`, filling the unit square.

    Run once per role (full-coverage albedo atlases) and once over all kept
    objects (the shared normal/roughness atlas). Cube (box) projection, NOT
    Smart UV Project: smart-project's packer collapses nearly all wall+trim
    faces to zero UV area on this geometry (measured seed 205: 94% of
    wall+trim loop-tris degenerate, vs 8% under cube), and a collapsed face
    bakes nothing -- it renders as one flat snapped texel. Planar projection
    along each face's dominant axis cannot collapse a flat quad.
    Deterministic: pure function of face geometry (fixed cube_size,
    correct_aspect, scale_to_bounds), no RNG."""
    import bpy

    for obj in objects:
        ensure_uv_layer(obj, layer_name)
        obj.data.uv_layers.active = obj.data.uv_layers[layer_name]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.cube_project(cube_size=1.0, correct_aspect=True,
                                clip_to_bounds=False, scale_to_bounds=True)
    except TypeError:
        bpy.ops.uv.cube_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")


def setup_bake_scene(seed: int, device: str = "cpu") -> None:
    import bpy

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    if device == "metal":
        # Metal GPU backend (measured 2026-09-28, seed-205 ward: ~2.3x mean
        # wall-time win over CPU with byte-identical baked pixels per device
        # and <=0.08/255 mean CPU-vs-Metal difference). Fail closed when no
        # Metal device exists: silently falling back to CPU would misreport
        # the device this bake ran on.
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        metal = [d for d in prefs.devices if d.type == "METAL"]
        if not metal:
            raise RuntimeError("shell bake --device metal: no METAL Cycles device found")
        for d in prefs.devices:
            d.use = d.type == "METAL"
        scene.cycles.device = "GPU"
        print(f"[shell-bake] device=metal ({len(metal)} Metal device(s) enabled)")
    elif device == "cpu":
        scene.cycles.device = "CPU"
    else:
        raise RuntimeError(f"shell bake --device must be cpu|metal (got {device!r})")
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.seed = seed
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    scene.render.bake.margin = BAKE_MARGIN_PX
    scene.render.bake.use_clear = True


def new_image(name: str, size: int, colorspace: str):
    import bpy

    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, width=size, height=size, alpha=True, float_buffer=False)
    img.colorspace_settings.name = colorspace
    return img


def set_active_image_for_materials(mat_names: List[str], image) -> None:
    """Point every named material's active image node at `image` (created if
    missing) so one bake op writes all of them into the shared atlas."""
    import bpy

    for name in mat_names:
        mat = bpy.data.materials.get(name)
        if mat is None:
            raise RuntimeError(f"bake material {name!r} missing")
        if not mat.use_nodes or mat.node_tree is None:
            # A material-less flat default still needs a tree to bake into.
            mat.use_nodes = True
        nt = mat.node_tree
        node = None
        for nd in nt.nodes:
            if nd.type == "TEX_IMAGE" and nd.image is image:
                node = nd
                break
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = image
        else:
            node.image = image
        node.select = True
        nt.nodes.active = node


def materials_of(objects: List[object]) -> List[str]:
    seen: List[str] = []
    for obj in objects:
        for slot in obj.data.materials:
            if slot is not None and slot.name not in seen:
                seen.append(slot.name)
    return seen


def bakeable(objects: List[object]) -> List[object]:
    """Objects carrying at least one material: a material-less object has no
    active image for any face, and the bake op refuses the whole selection."""
    return [o for o in objects if any(m is not None for m in o.data.materials)]


def select_objects(objects: List[object]) -> None:
    import bpy

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def set_active_uv(objects: List[object], layer_name: str) -> None:
    for obj in objects:
        obj.data.uv_layers.active = obj.data.uv_layers[layer_name]


def bake_current_selection(bake_type: str, uv_layer: str, objects: List[object],
                           pass_filter=None, normal_space: str = "") -> None:
    """Bake `objects` into their active image nodes through `uv_layer`.

    Cycles bakes through each face's material-mapped UVs, so the layer each
    image was unwrapped into must be active on every object in the selection.
    """
    import bpy

    set_active_uv(objects, uv_layer)
    select_objects(objects)
    if normal_space:
        bpy.context.scene.render.bake.normal_space = normal_space
    if pass_filter is None:
        bpy.ops.object.bake(type=bake_type, use_clear=True)
    else:
        bpy.ops.object.bake(type=bake_type, pass_filter=pass_filter, use_clear=True)


def fill_unpainted_texels(image, fill: Tuple[float, float, float, float]) -> int:
    """Paint alpha-~0 texels (cleared background, uninitialized RGB) with a
    neutral opaque fill. Pure function of the bake output: deterministic."""
    px = list(image.pixels)
    n = image.size[0] * image.size[1]
    filled = 0
    for i in range(n):
        if px[i * 4 + 3] < 0.01:
            px[i * 4] = fill[0]
            px[i * 4 + 1] = fill[1]
            px[i * 4 + 2] = fill[2]
            px[i * 4 + 3] = fill[3]
            filled += 1
    if filled:
        image.pixels.foreach_set(px)
    return filled


def snap_degenerate_faces(objects: List[object], layer_name: str, image) -> int:
    """Point zero-UV-area faces at the nearest painted texel.

    Box projection still collapses micro-faces (measured seed 205: 8% of
    wall+trim loop-tris, all tiny boolean slivers) to a point that may land
    on unpainted fill, which would render as a flat gray quad. Snapping them
    to the nearest painted texel gives each such face a neighbour-plausible
    flat colour instead. Pure function of bake output: deterministic."""
    import bpy
    import numpy as np

    W, H = image.size
    px = np.array(image.pixels[:], dtype=np.float32).reshape(H, W, 4)
    painted = px[:, :, 3] > 0.5
    if not painted.any():
        return 0
    ys, xs = np.nonzero(painted)
    # Stride the candidate set: full-res nearest search is overkill.
    pts = np.stack([(xs[::7] + 0.5) / W, (ys[::7] + 0.5) / H], axis=1)
    moved = 0
    for obj in objects:
        me = obj.data
        layer = me.uv_layers.get(layer_name)
        if layer is None:
            continue
        me.calc_loop_triangles()
        for tri in me.loop_triangles:
            uvs = [layer.data[l].uv for l in tri.loops]
            a2 = abs((uvs[1][0] - uvs[0][0]) * (uvs[2][1] - uvs[0][1])
                     - (uvs[1][1] - uvs[0][1]) * (uvs[2][0] - uvs[0][0])) / 2
            if a2 >= 1e-9:
                continue
            cx = sum(u.x for u in uvs) / 3
            cy = sum(u.y for u in uvs) / 3
            d2 = (pts[:, 0] - cx) ** 2 + (pts[:, 1] - cy) ** 2
            best = pts[int(np.argmin(d2))]
            for l in tri.loops:
                layer.data[l].uv = (float(best[0]), float(best[1]))
            moved += 1
    return moved


def flood_image(image, fill: Tuple[float, float, float, float]) -> None:
    """Paint every texel with `fill` (opaque). For roles with no bakeable
    object (nothing carries a material, e.g. the material-less exterior
    hull): no bake op ever touches the image, so without this the atlas
    ships the blank-image default (opaque black) instead of the neutral
    background. Pure constant: deterministic."""
    W, H = image.size
    n = W * H
    image.pixels.foreach_set([fill[0], fill[1], fill[2], fill[3]] * n)


def combine_diffuse_glossy(diffuse_img, glossy_img, out_img) -> None:
    """Metal-aware albedo: diffuse COLOR screened with glossy COLOR.

    Measured on the seed-205 ward bake: Infinigen's trim mixes metallic
    (hammered/grained metal door frame) with dielectric (plastic skirting)
    and glass (door lite) sometimes on ONE object. A DIFFUSE COLOR-only bake
    writes ~black for the metal faces (metals have no diffuse response) and
    nothing for the glass, so trim ships black. GLOSSY with COLOR only is
    lighting-independent specular albedo: the metal tint for metals, ~F0
    gray for dielectrics. Screen blend (D + G - D*G) keeps the full metal
    tint where diffuse is black yet never clips bright dielectrics (a plain
    sum clipped the near-white skirting to pure white); alpha comes from
    the diffuse bake so the unpainted-texel fill keeps working. Pure
    function of the two bake outputs: deterministic."""
    import numpy as np

    W, H = diffuse_img.size
    d = np.array(diffuse_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    g = np.array(glossy_img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    out = np.empty_like(d)
    out[:, :, :3] = d[:, :, :3] + g[:, :, :3] * (1.0 - d[:, :, :3])
    out[:, :, 3] = d[:, :, 3]
    out_img.pixels.foreach_set(out.ravel().tolist())


def build_role_material(role: str, alb_layer: str, albedo_img, normal_img, roughness_img):
    """Fresh Image Texture -> Principled hookup; the procedural tree is gone.

    Albedo samples the role's full-coverage layout (index 0, so the later AO
    pass keeps base colour there); normal/roughness sample the shared atlas.
    Skirting is the exception: pinned flat Base Color plus scalar roughness
    (matte vinyl, albedo_img is None so no image nodes); normal relief still
    samples the shared atlas like every other role.
    """
    import bpy

    mat_name = f"{SHELL_MATERIAL_PREFIX}{role}"
    if mat_name in bpy.data.materials:
        bpy.data.materials.remove(bpy.data.materials[mat_name])
    mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    nt = mat.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0

    if role == "skirting":
        # Pinned matte vinyl: flat Base Color + scalar roughness, no image
        # nodes. The downstream albedo pass skips this material by name
        # (SHELL_FLAT_SKIP_MATERIALS in room-albedo-ao-bake.py), so the
        # calibrated grey ships untouched; AO still applies.
        bsdf.inputs["Base Color"].default_value = SKIRTING_BASE_COLOR_LINEAR
        bsdf.inputs["Roughness"].default_value = SKIRTING_ROUGHNESS
    else:
        alb_uv = nt.nodes.new("ShaderNodeUVMap")
        alb_uv.uv_map = alb_layer
        alb_uv.location = (-700, 250)
        albedo_tex = nt.nodes.new("ShaderNodeTexImage")
        albedo_tex.image = albedo_img
        albedo_tex.label = "shell albedo (COLOR only, no lighting)"
        albedo_tex.location = (-400, 250)
        nt.links.new(alb_uv.outputs["UV"], albedo_tex.inputs["Vector"])
        nt.links.new(albedo_tex.outputs["Color"], bsdf.inputs["Base Color"])

    shared_uv = nt.nodes.new("ShaderNodeUVMap")
    shared_uv.uv_map = SHARED_UV_LAYER
    shared_uv.location = (-700, -150)
    normal_tex = nt.nodes.new("ShaderNodeTexImage")
    normal_tex.image = normal_img
    normal_tex.label = "shell normal (tangent)"
    normal_tex.location = (-400, -50)
    nt.links.new(shared_uv.outputs["UV"], normal_tex.inputs["Vector"])
    normal_map = nt.nodes.new("ShaderNodeNormalMap")
    normal_map.space = "TANGENT"
    normal_map.uv_map = SHARED_UV_LAYER
    normal_map.location = (-100, -50)
    nt.links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
    nt.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])

    if role != "skirting":
        # Matte vinyl ships the scalar above; the baked atlas holds trim
        # metal roughness and must not touch the cove.
        rough_tex = nt.nodes.new("ShaderNodeTexImage")
        rough_tex.image = roughness_img
        rough_tex.label = "shell roughness"
        rough_tex.location = (-400, -350)
        nt.links.new(shared_uv.outputs["UV"], rough_tex.inputs["Vector"])
        nt.links.new(rough_tex.outputs["Color"], bsdf.inputs["Roughness"])
    return mat


def assign_role_material(objects: List[object], mat) -> None:
    for obj in objects:
        me = obj.data
        me.materials.clear()
        me.materials.append(mat)
        for poly in me.polygons:
            poly.material_index = 0


def drop_original_materials(names: List[str]) -> None:
    import bpy

    for name in names:
        mat = bpy.data.materials.get(name)
        if mat is not None and mat.users == 0 and not mat.name.startswith(SHELL_MATERIAL_PREFIX):
            bpy.data.materials.remove(mat)


def keep_bake_layers(by_role: Dict[str, List[object]]) -> None:
    """Each mesh keeps [ALB_<role>, BAKE_UV] with the albedo layout active at
    index 0; every original (tiled/collapsed) layer is removed."""
    for role, objects in by_role.items():
        alb_layer = f"{ALB_UV_PREFIX}{role}"
        for obj in objects:
            me = obj.data
            for layer in list(me.uv_layers):
                if layer.name not in (alb_layer, SHARED_UV_LAYER):
                    me.uv_layers.remove(layer)
            names = [u.name for u in me.uv_layers]
            if alb_layer not in names or SHARED_UV_LAYER not in names:
                raise RuntimeError(f"{obj.name}: bake UV layers missing after bake ({names})")
            # Albedo layout at index 0 (ALB layers are created before the
            # shared layer, originals are gone): the AO pass restores active
            # to layer 0, which keeps base colour on the albedo layout.
            if me.uv_layers.find(alb_layer) != 0:
                raise RuntimeError(f"{obj.name}: albedo layer not first ({names})")
            me.uv_layers.active = me.uv_layers[alb_layer]


def main() -> Dict[str, object]:
    import bpy

    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--seed", type=int, default=SHELL_BAKE_SEED)
    ap.add_argument(
        "--device",
        choices=("cpu", "metal"),
        default="cpu",
        help="Cycles bake device: cpu (default, historical behaviour) or "
        "metal (Apple GPU backend; adopted 2026-09-28 after the "
        "room-chain-metal-measure bake-off showed a mean wall-time win "
        "with byte-identical baked pixels and <=0.08/255 CPU-vs-Metal "
        "mean difference on the seed-205 ward)",
    )
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.blend):
        raise RuntimeError(f"input blend not found: {args.blend}")
    random.seed(args.seed)

    bpy.ops.wm.open_mainfile(filepath=args.blend)
    objects = kept_mesh_objects()
    if not objects:
        raise RuntimeError(f"no mesh objects in {args.blend}")
    for obj in objects:
        make_single_user(obj)

    by_role: Dict[str, List[object]] = {}
    for obj in objects:
        by_role.setdefault(role_for_object(obj.name), []).append(obj)
    for role in sorted(by_role):
        names = sorted(f"{o.name}[{len([m for m in o.data.materials if m is not None])}m]" for o in by_role[role])
        print(f"[shell-bake] role {role}: {names}")

    setup_bake_scene(args.seed, args.device)

    # Per-role full-coverage albedo layouts (ALB_<role> created first).
    for role in sorted(by_role):
        box_project_into(by_role[role], f"{ALB_UV_PREFIX}{role}")
    # Shared atlas for normal + roughness (non-overlapping across roles).
    box_project_into(objects, SHARED_UV_LAYER)

    # Shared normal + roughness: one bake each over ALL bakeable objects.
    normal_img = new_image("shell_bake_normal", SHARED_NORMAL_SIZE, "Non-Color")
    roughness_img = new_image("shell_bake_roughness", SHARED_ROUGHNESS_SIZE, "Non-Color")
    all_mats = materials_of(objects)
    all_bakeable = bakeable(objects)
    if not all_bakeable:
        raise RuntimeError("no kept object carries a material to bake")
    set_active_image_for_materials(all_mats, normal_img)
    bake_current_selection("NORMAL", SHARED_UV_LAYER, all_bakeable, normal_space="TANGENT")
    normal_img.pack()
    print(f"[shell-bake] NORMAL {SHARED_NORMAL_SIZE}x{SHARED_NORMAL_SIZE} over {len(all_bakeable)} object(s)")
    set_active_image_for_materials(all_mats, roughness_img)
    bake_current_selection("ROUGHNESS", SHARED_UV_LAYER, all_bakeable)
    roughness_img.pack()
    print(f"[shell-bake] ROUGHNESS {SHARED_ROUGHNESS_SIZE}x{SHARED_ROUGHNESS_SIZE} over {len(all_bakeable)} object(s)")

    summary_roles: Dict[str, object] = {}
    for role in sorted(by_role):
        role_objects = by_role[role]
        alb_layer = f"{ALB_UV_PREFIX}{role}"
        if role == "skirting":
            # No bake: pinned flat matte vinyl (see SKIRTING_BASE_COLOR_LINEAR).
            # The ALB_skirting layout above still exists (uniform layer contract:
            # every mesh keeps [ALB_<role>, BAKE_UV]) but no image is created
            # for it; normal relief still samples the shared atlas.
            print(f"[shell-bake] role skirting: pinned flat, no bake ({len(role_objects)} object(s))")
            originals = materials_of(role_objects)
            role_mat = build_role_material(role, alb_layer, None, normal_img, roughness_img)
            assign_role_material(role_objects, role_mat)
            drop_original_materials(originals)
            summary_roles[role] = {
                "objects": sorted(o.name for o in role_objects),
                "albedo": None,
                "flatBaseColor": list(SKIRTING_BASE_COLOR_LINEAR),
                "roughness": SKIRTING_ROUGHNESS,
                "material": role_mat.name,
            }
            continue
        role_bakeable = bakeable(role_objects)
        size = ALBEDO_SIZE_BY_ROLE.get(role, 1024)
        albedo_img = new_image(f"shell_bake_albedo_{role}", size, "sRGB")
        # DIFFUSE with COLOR only: pure albedo, no light contribution.
        set_active_image_for_materials(materials_of(role_objects), albedo_img)
        if role_bakeable:
            bake_current_selection("DIFFUSE", alb_layer, role_bakeable, pass_filter={"COLOR"})
        else:
            # No object carries a material: no bake op will touch this
            # image, so flood it now (otherwise it ships opaque black).
            flood_image(albedo_img, FILL_ALBEDO)
        if role == "trim" and role_bakeable:
            # Metal-aware trim: a second GLOSSY COLOR pass into a scratch
            # image, screened with the diffuse (see combine_diffuse_glossy).
            # Without it the metal door frame bakes black (measured).
            glossy_img = new_image("shell_bake_glossy_trim_scratch", size, "sRGB")
            set_active_image_for_materials(materials_of(role_objects), glossy_img)
            bake_current_selection("GLOSSY", alb_layer, role_bakeable, pass_filter={"COLOR"})
            set_active_image_for_materials(materials_of(role_objects), albedo_img)
            combine_diffuse_glossy(albedo_img, glossy_img, albedo_img)
            bpy.data.images.remove(glossy_img)
        albedo_img.pack()
        print(f"[shell-bake] ALBEDO {role} {size}x{size} over {len(role_bakeable)} object(s)")

        originals = materials_of(role_objects)
        role_mat = build_role_material(role, alb_layer, albedo_img, normal_img, roughness_img)
        assign_role_material(role_objects, role_mat)
        drop_original_materials(originals)
        summary_roles[role] = {
            "objects": sorted(o.name for o in role_objects),
            "albedo": f"shell_bake_albedo_{role}",
            "albedoSize": size,
            "material": role_mat.name,
        }

    keep_bake_layers(by_role)

    # Snap collapsed faces BEFORE the neutral fill: the fill sets alpha to 1,
    # which would make fill texels valid snap targets (measured: wall faces
    # snapping to fill gray instead of mint). Then fill what remains.
    for role in sorted(by_role):
        if f"shell_bake_albedo_{role}" not in bpy.data.images:
            # Flat roles (skirting) ship no albedo image: nothing to snap.
            print(f"[shell-bake] role {role}: no albedo image, snap skipped")
            continue
        snapped = snap_degenerate_faces(by_role[role], f"{ALB_UV_PREFIX}{role}",
                                        bpy.data.images[f"shell_bake_albedo_{role}"])
        print(f"[shell-bake] role {role}: snapped {snapped} degenerate face(s)")
    snapped_shared = snap_degenerate_faces(objects, SHARED_UV_LAYER, normal_img)
    print(f"[shell-bake] shared atlas: snapped {snapped_shared} degenerate face(s)")
    for img, fill in ((normal_img, FILL_NORMAL), (roughness_img, FILL_ROUGHNESS)):
        filled = fill_unpainted_texels(img, fill)
        img.pack()
        print(f"[shell-bake] fill {img.name}: {filled} texel(s)")
    for role in sorted(by_role):
        if f"shell_bake_albedo_{role}" not in bpy.data.images:
            continue
        img = bpy.data.images[f"shell_bake_albedo_{role}"]
        filled = fill_unpainted_texels(img, FILL_ALBEDO)
        img.pack()
        print(f"[shell-bake] fill {img.name}: {filled} texel(s)")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.output)
    summary = {
        "blend": args.output,
        "seed": args.seed,
        "device": args.device,
        "sharedUv": SHARED_UV_LAYER,
        "roles": summary_roles,
        "sharedNormal": {"image": "shell_bake_normal", "size": SHARED_NORMAL_SIZE},
        "sharedRoughness": {"image": "shell_bake_roughness", "size": SHARED_ROUGHNESS_SIZE},
    }
    print(f"[shell-bake] saved {args.output}")
    print(json.dumps(summary))
    return summary


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        # Blender exits 0 on uncaught exceptions: force a failing exit.
        os._exit(1)
