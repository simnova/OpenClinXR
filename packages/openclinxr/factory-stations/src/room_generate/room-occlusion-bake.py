#!/usr/bin/env python3
"""
Room occlusion bake for shipped environment GLBs (issue-349, MADR 0056 item 1, light half;
issue-526 mechanism replacement).

#345 shipped the albedo half (Cycles DIFFUSE baseColorTexture per material). This script
ships the OTHER half: a SEPARATE glTF `occlusionTexture` per material. Nothing is
multiplied into base colour (that is refused — unrecoverable; MADR 0056 item 6 atlas
depends on clean albedo). The bake is deterministic: same input GLB + fixed parameters ->
same output. No LLM in the path (D1). No light nodes ship (the bake needs none).
Triangle count untouched.

MECHANISM HISTORY — why the bake below uses EMIT + Ambient Occlusion node,
measured 2026-09-29 on Blender 5.1.1 (this worktree), reproducing 2026-08-27 first:
  - `bpy.ops.object.bake(type='AO')` IGNORES `scene.render.bake.max_ray_distance`
    (re-probed: byte-identical maps at ray 0.0 vs 1.0 on a 4.3 x 3.9 x 2.4 m box
    fixture) and `world.light_settings.distance`. Its reach is ~2.4-2.6 m and not
    under the baker's control, so it self-occludes closed rooms into a cave.
  - The Cycles "Ambient Occlusion" shader node's Distance input IS honoured by an
    EMIT bake (ladder on the same fixture, floor planar UV, 32 samples: Distance
    0.0 = unbounded cave with centre 0.62; 0.3/0.5/1.0 = graded contact falloff
    with the room centre fully open at 1.0; 3.0 = the 2.4 m ceiling re-enters and
    the centre drops to 0.62). The 2026-08-27 note claiming EMIT+AO returns ~1.0
    regardless of distance does not reproduce on this build with the node wired
    AO.Color -> Emission -> Surface and Distance set on the node input socket.
  - So the bounded bake is a real Cycles pass after all: per material group, a
    throwaway override material (Emission lit ONLY by the AO node at the measured
    reach) shades the group's objects while `bpy.ops.object.bake(type='EMIT')`
    writes the group's AO image through the same box-projected AO_UV layer the
    hand-rolled painter used. No BVH, no per-texel Python raycast, no jitter.

ISSUE-526 MECHANISM — bounded Cycles EMIT+AO ("cycles_emit_ao"):
  The AO node's Distance is the hard reach: occluders beyond it contribute
  nothing, so contact darkening survives while whole-room self-occlusion is
  bounded away — an open-room-quality map on a closed room. AO_REACH_METERS
  keeps its name and meaning from the retired raycaster (the radius inside which
  geometry counts as an occluder); only the evaluation moved into Cycles.

UV handling (the question the brief flagged): the shipped rooms already carry TEXCOORD_0.
The shell's TEXCOORD_0 is a per-face cube unwrap, non-overlapping, reused for base colour.
The Infinigen room's wall/ceiling UVs are TILED (span -2.6..4.2) and its exterior hull is a
single collapsed (0,0) point — an AO bake into TEXCOORD_0 there would smear. So every mesh
gets a SECOND UV layer "AO_UV" via box/cube projection (per material group, so islands
cannot overlap between meshes sharing a material; within the group each co-planar
face set -- dominant normal axis + sign + 5 cm plane quantum -- then repacks into
its own disjoint atlas cell, so opposite interior walls never share texels), the AO
bakes into it, and the occlusion
texture references TEXCOORD_1. Base colour keeps TEXCOORD_0 untouched. Cube, not Smart UV
Project: smart-project's packer collapses most wall faces to zero UV area on ward-shell
geometry (measured on the shipped inpatient ward wall: 44 of 56 tris single-texel, 78.6%
degenerate, 37 islands for one wall object), and a collapsed face bakes as one flat snapped
texel — the per-island tonal steps behind the wall facets. Planar projection along each
face's dominant axis cannot collapse a flat wall quad, so each wall plane becomes one or a
small few large islands. Same pattern as D3b's BAKE_UV box_project_into (0711c8a71).

Usage (inside Blender 5.1 headless):
  blender --background --python room-occlusion-bake.py -- \
    --input <room.glb> --output <baked.glb> [--resolution 512 (AO_DEFAULT_RESOLUTION, budget max)] \
    [--device cpu|metal]

Exit 0 on success; non-zero with a printed error on any bake failure (the input GLB is
never modified in place).
"""
from __future__ import annotations

import argparse
import math
import os
import statistics
import sys
from typing import Dict, List, Tuple

import bpy

# Distance-bounded AO via a real Cycles pass (EMIT bake of an Ambient Occlusion
# node): occluders within this radius of a sample point darken it, geometry
# beyond the reach contributes nothing.
# 0.5 m is a measured contact scale, not a guess (box fixture 4.3 x 3.9 x 2.4 m,
# EMIT+AO ladder 2026-09-29): at 0.5 the wall-base gradient spans ~0.5 m with a
# strong but open corner (0.45) and edge (0.67), the room centre stays fully open
# (1.0), and the 2.4 m ceiling plus the 3.9/4.3 m opposite walls sit outside the
# reach by 4.8x or more. Door reveals (0.1-0.35 m gaps), skirting bases (~0.1 m)
# and wall-floor junction gradients (~0.2-0.5 m) all fall inside it, so every
# real contact feature in this room darkens while the room cannot cave.
AO_MECHANISM = "cycles_emit_ao"
AO_REACH_METERS = 0.5
# EMIT bake samples. Noise knee measured on the fixture (mean |S - 128| over the
# floor image): 16 -> 0.45, 32 -> 0.29, 64 -> 0.12/255 with max 2 and 2.7% of
# texels differing at all. 64 sits at the knee: doubling to 128 moves almost
# nothing, while the dot artifacts this bake replaces are ~28/255 deep.
AO_SAMPLES = 64
# Fixed Cycles seed -> byte-deterministic output for the same GLB on one device.
AO_SEED = 20260929

# AO texture resolution: budget-derived, not a bare literal. Texture budget (decoded RGBA8
# x1.33 mips, ward GLB <= 56 MB; see bake_shell_materials.py's budget table): shell 37 MB
# + AO 4x512^2 (4 MB) = 41 MB x1.33 = 54.5 MB <= 56 MB. 512 is the largest uniform
# power-of-two AO size that fits: 4x1024^2 would be 16 MB AO + 37 shell = 53 raw x1.33 =
# 70.5 MB > 56. Per-role AO sizes would break the exporter's single-UVMap-link assumption
# (one material = one image = one size), so the whole pass stays uniform at the budget max.
AO_DEFAULT_RESOLUTION = 512

# Co-planar group separation (lattice fix): faces sharing a (dominant axis, sign,
# 5 cm plane quantum) key keep one contiguous island; different keys pack into
# disjoint atlas cells. 0.05 m separates every distinct wall plane (thickness 0.22 m,
# opposite walls metres apart, reveal slivers decimetres apart) while exact-coplanar
# neighbours agree to float noise, far below the quantum.
COPLANAR_PLANE_QUANTUM_M = 0.05
# Last separation group count, published for the separation probe (tests only).
LAST_SEPARATION_BIN_COUNT = 0

GLTF_GROUP_NAMES = ("glTF Material Output", "glTF Settings")

# Shell flats that skip occlusion wiring (mirrors room-albedo-ao-bake.py's
# SHELL_FLAT_SKIP_MATERIALS: the same pinned materials skip both bakes).
SHELL_FLAT_SKIP_MATERIALS = ("shell_bake_skirting",)


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.lights, bpy.data.node_groups):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def find_bsdf(mat: bpy.types.Material):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def ensure_gltf_settings_group() -> bpy.types.NodeGroup:
    """The exporter's `get_socket_from_gltf_material_node` matches group names starting with
    "gltf settings" or "gltf material output" (case-insensitive, startswith). Reuse any such
    group; create one with an "Occlusion" input socket per the exporter's create_settings_group."""
    for name in GLTF_GROUP_NAMES:
        for group in bpy.data.node_groups:
            if group.name.lower().startswith(name.lower()) and "Occlusion" in [s.name for s in group.interface.items_tree if hasattr(s, "name")]:
                return group
    name = GLTF_GROUP_NAMES[0]
    group = bpy.data.node_groups.new(name, "ShaderNodeTree")
    group.interface.new_socket("Occlusion", socket_type="NodeSocketFloat")
    group.nodes.new("NodeGroupOutput")
    group_input = group.nodes.new("NodeGroupInput")
    group_input.location = -200, 0
    return group


def ensure_ao_uv(mesh_obj: bpy.types.Object) -> str:
    """Create/return the second UV layer name for AO. Unwrapped by box_project_group
    (per material group, so islands from different meshes sharing a material cannot
    overlap in one image)."""
    layer_name = "AO_UV"
    me = mesh_obj.data
    if layer_name not in [u.name for u in me.uv_layers]:
        me.uv_layers.new(name=layer_name)
    return layer_name


def coplanar_bin_key(nx: float, ny: float, nz: float, cx: float, cy: float, cz: float):
    """Deterministic co-planar group key for one face (world normal + center).

    Dominant normal axis + sign + plane quantum (signed distance of the face
    center along its normal, quantized to COPLANAR_PLANE_QUANTUM_M). Exactly
    co-planar same-facing faces share a key; opposite walls across the room
    differ in sign and/or quantum, so they never share. Pure function of
    geometry: no RNG, no Blender dependency."""
    ax = 0
    if abs(ny) >= abs(nx) and abs(ny) >= abs(nz):
        ax = 1
    elif abs(nz) >= abs(nx) and abs(nz) >= abs(ny):
        ax = 2
    n = (nx, ny, nz)[ax]
    sign = 1 if n >= 0 else -1
    d = cx * nx + cy * ny + cz * nz
    return (ax, sign, math.floor(d / COPLANAR_PLANE_QUANTUM_M + 0.5))


def separate_coplanar_uv_groups(objects: List[bpy.types.Object], layer_name: str, resolution: int) -> int:
    """Repack each co-planar group's UVs into its own disjoint atlas cell.

    Runs after the group's cube_project pass: every face keeps its planar
    projection shape (one affine map per group, so shared edges between
    same-plane neighbours still match exactly), but groups that used to land
    on top of each other now occupy disjoint grid cells separated by a 2-texel
    gutter. One uniform shrink across all groups (capped at 1.0, never outside
    0..1) preserves equal world-to-UV density. Deterministic: groups sorted by
    key, no RNG. Returns the group count (also published as
    LAST_SEPARATION_BIN_COUNT for the separation probe)."""
    global LAST_SEPARATION_BIN_COUNT
    entries = []
    for obj in objects:
        me = obj.data
        layer = me.uv_layers.get(layer_name)
        if layer is None:
            continue
        mw = obj.matrix_world
        nmw = mw.inverted().transposed()
        for poly in me.polygons:
            c = mw @ poly.center
            n = (nmw @ poly.normal).normalized()
            key = coplanar_bin_key(n.x, n.y, n.z, c.x, c.y, c.z)
            entries.append((key, obj, list(poly.loop_indices)))
    bins: Dict = {}
    for key, obj, loops in entries:
        bins.setdefault(key, []).append((obj, loops))
    LAST_SEPARATION_BIN_COUNT = len(bins)
    if not bins:
        return 0
    ordered = sorted(bins)
    n = len(ordered)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cell_w, cell_h = 1.0 / cols, 1.0 / rows
    gutter = 2.0 / resolution
    bboxes = {}
    for key in ordered:
        x0 = y0 = float("inf")
        x1 = y1 = float("-inf")
        for obj, loops in bins[key]:
            uv_data = obj.data.uv_layers[layer_name].data
            for li in loops:
                uv = uv_data[li].uv
                x0 = min(x0, uv.x)
                y0 = min(y0, uv.y)
                x1 = max(x1, uv.x)
                y1 = max(y1, uv.y)
        bboxes[key] = (x0, y0, x1, y1)
    scale = 1.0
    for key in ordered:
        x0, y0, x1, y1 = bboxes[key]
        bw, bh = x1 - x0, y1 - y0
        if bw > 1e-9:
            scale = min(scale, (cell_w - 2 * gutter) / bw)
        if bh > 1e-9:
            scale = min(scale, (cell_h - 2 * gutter) / bh)
    scale = max(min(scale, 1.0), 1e-6)
    for index, key in enumerate(ordered):
        ox, oy = (index % cols) * cell_w, (index // cols) * cell_h
        x0, y0, _, _ = bboxes[key]
        for obj, loops in bins[key]:
            uv_data = obj.data.uv_layers[layer_name].data
            for li in loops:
                uv = uv_data[li].uv
                uv_data[li].uv = (ox + gutter + (uv.x - x0) * scale,
                                  oy + gutter + (uv.y - y0) * scale)
    return n


def box_project_group(objects: List[bpy.types.Object], layer_name: str, resolution: int = AO_DEFAULT_RESOLUTION) -> None:
    """Unwrap all selected objects' faces into `layer_name` in ONE pass (non-overlapping
    islands across the group). Cube/box projection, NOT Smart UV Project: smart-project's
    packer collapses most wall faces to zero UV area on ward-shell geometry (measured on
    the shipped ward wall: 44/56 tris degenerate, 78.6%), and a collapsed face bakes as
    one flat snapped texel (the wall-facet tonal steps). Planar projection along each
    face's dominant axis cannot collapse a flat quad, so each wall plane becomes one or a
    small few large islands. Same settings as D3b's BAKE_UV box_project_into (0711c8a71):
    pure function of face geometry, no RNG.

    The single projection pass still lands co-planar parallel faces (double-wall skins,
    opposite walls across the room) on top of each other, so separate_coplanar_uv_groups
    repacks each co-planar set into its own disjoint cell afterwards: the fix is geometric
    (real UV separation), not a different per-texel reducer. `resolution` sizes the
    inter-cell gutter in texels (2); it defaults to the bake resolution the caller passes
    to its image, so the gutter is exact there and conservative elsewhere."""
    for obj in objects:
        me = obj.data
        if layer_name in [u.name for u in me.uv_layers]:
            me.uv_layers.active = me.uv_layers[layer_name]
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
    # Geometric deconfliction (lattice fix): co-planar groups that cube_project
    # stacked onto the same UV region get disjoint cells, so overlapping painters
    # never arbitrate between two different surfaces in one texel.
    separate_coplanar_uv_groups(objects, layer_name, resolution)


def setup_scene(device: str = "cpu") -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = AO_SAMPLES
    scene.cycles.seed = AO_SEED
    if device == "metal":
        # Same fail-closed pattern as bake_shell_materials.setup_bake_scene:
        # silently falling back to CPU would misreport the device this bake ran on.
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        metal = [d for d in prefs.devices if d.type == "METAL"]
        if not metal:
            raise RuntimeError("room occlusion bake --device metal: no METAL Cycles device found")
        for d in prefs.devices:
            d.use = d.type == "METAL"
        scene.cycles.device = "GPU"
        print(f"[room-ao] device=metal ({len(metal)} Metal device(s) enabled)")
    elif device == "cpu":
        scene.cycles.device = "CPU"
    else:
        raise RuntimeError(f"room occlusion bake --device must be cpu|metal (got {device!r})")
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    # Margin 0: island gutters are filled by dilate_unpainted_texels from the
    # geometric coverage mask below. Any margin > 0 would bleed across the
    # 2-texel coplanar-separation gutters into neighbouring cells.
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True


def _barycentric_uv(px, py, a, b, c):
    """Barycentric coords of a UV-space point in the UV triangle abc."""
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(det) < 1e-12:
        return 1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0
    l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
    l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
    return l1, l2, 1.0 - l1 - l2


def rasterize_coverage(objects: List[bpy.types.Object], layer_name: str, W: int, H: int) -> bytearray:
    """Geometric UV-footprint mask: 1 where a face covers the texel, else 0.

    The native EMIT bake writes only footprint texels and leaves the background
    at the clear colour; dilate_unpainted_texels needs to know which is which.
    A texel exactly at the bake's clear value could also be a legitimately fully
    occluded corner, so coverage is rasterized from the UV geometry (fan
    triangulation + _barycentric_uv, the same footprint convention the retired
    painter used) rather than thresholded from pixels. Pure function of the UV
    layer: no RNG, no scene queries, order-independent.
    """
    covered = bytearray(W * H)
    for obj in objects:
        me = obj.data
        layer = me.uv_layers.get(layer_name)
        if layer is None:
            continue
        uv_data = layer.data
        for poly in me.polygons:
            uvs = [uv_data[li].uv for li in poly.loop_indices]
            if len(uvs) < 3:
                continue
            us = [u.x for u in uvs]
            vs = [u.y for u in uvs]
            x0 = min(W - 1, max(0, int(min(us) * W)))
            x1 = min(W - 1, max(0, int(max(us) * W)))
            y0 = min(H - 1, max(0, int(min(vs) * H)))
            y1 = min(H - 1, max(0, int(max(vs) * H)))
            uv_tris = []
            if len(uvs) == 3:
                uv_tris.append((0, 1, 2))
            else:
                for k in range(1, len(uvs) - 1):
                    uv_tris.append((0, k, k + 1))
            for yy in range(y0, y1 + 1):
                row = yy * W
                py = (yy + 0.5) / H
                for xx in range(x0, x1 + 1):
                    px = (xx + 0.5) / W
                    for (i0, i1, i2) in uv_tris:
                        l1, l2, l3 = _barycentric_uv(
                            px, py,
                            (us[i0], vs[i0]), (us[i1], vs[i1]), (us[i2], vs[i2]),
                        )
                        if l1 >= -0.02 and l2 >= -0.02 and l3 >= -0.02:
                            covered[row + xx] = 1
                            break
    return covered


def bake_group_ao_image(img, mat_name: str, objs_: List[bpy.types.Object]) -> None:
    """Bake one material group's AO image with a real Cycles EMIT+AO pass.

    A throwaway override material shades every slot of the group's objects for
    the duration of the bake: Emission lit ONLY by an Ambient Occlusion node at
    AO_REACH_METERS, with the group's AO image as its active texture node fed by
    an explicit UV Map link to AO_UV (the same layer the shipped tree uses, so
    the bake target UVs are exactly the wired UVs). The shipped material trees
    are never touched by the bake itself — no BSDF link surgery, nothing to
    restore except the object material slots, which are saved and put back, and
    the override material, which is deleted afterwards. All slots of the group's
    objects wear the override during the bake (not just the group's own), so no
    face bakes a non-emissive BSDF into the image.
    """
    tmp_name = f"__openclinxr_ao_bake_{mat_name}"
    if tmp_name in bpy.data.materials:
        bpy.data.materials.remove(bpy.data.materials[tmp_name], do_unlink=True)
    tmp = bpy.data.materials.new(tmp_name)
    tmp.use_nodes = True
    nt = tmp.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    ao_node = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao_node.location = (-200, 0)
    dist_input = ao_node.inputs.get("Distance")
    if dist_input is None:
        raise RuntimeError("room occlusion bake: AO shader node has no Distance input on this build")
    dist_input.default_value = AO_REACH_METERS
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (0, 0)
    nt.links.new(ao_node.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    bake_tex = nt.nodes.new("ShaderNodeTexImage")
    bake_tex.image = img
    bake_tex.location = (-700, -300)
    uv_map = nt.nodes.new("ShaderNodeUVMap")
    uv_map.uv_map = "AO_UV"
    uv_map.location = (-900, -300)
    nt.links.new(uv_map.outputs["UV"], bake_tex.inputs["Vector"])
    bake_tex.select = True
    nt.nodes.active = bake_tex

    saved = []
    for obj in objs_:
        for i, slot_mat in enumerate(list(obj.data.materials)):
            saved.append((obj, i, slot_mat))
            obj.data.materials[i] = tmp
    try:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs_:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs_[0]
        bpy.ops.object.bake(type="EMIT", use_clear=True)
    finally:
        for obj, i, slot_mat in saved:
            try:
                obj.data.materials[i] = slot_mat
            except Exception:
                pass
        bpy.data.materials.remove(tmp, do_unlink=True)
        bpy.ops.object.select_all(action="DESELECT")


def dilate_unpainted_texels(img, covered: bytearray) -> int:
    """Fill uncovered (gutter/background) texels with their nearest painted value.

    Box-projected UV islands still leave background between differently-oriented planes;
    leaving those at the clear colour (open = 1.0) outlines every island with a bright
    seam under the runtime's bilinear/mip sampling (measured on a shipped 512px plaster
    the clear colour (open = 1.0) outlines every island with a bright seam under the
    runtime's bilinear/mip sampling (measured on a shipped 512px plaster AO map: 41.7%
    white background, edge-ring texels +10.4/255 brighter than interiors, 28.7% white-ish
    at mip level 3). Breadth-first dilation from all painted texels (row-major seed order,
    4-neighbourhood) gives each gutter texel the closest island-edge value, so border
    sampling blends with edge-like tones. Covered texels are never touched.
    Determinism: pure function of (covered, painted values) — no RNG, row-major order.
    Returns the filled texel count (0 when nothing was painted: the image stays white,
    preserving the old safe default for that degenerate case).
    """
    W, H = img.size
    n = W * H
    if n == 0 or not any(covered):
        return 0
    px = list(img.pixels)
    vals = [px[i * 4] for i in range(n)]
    nearest = [-1] * n
    from collections import deque
    queue: deque = deque()
    for idx in range(n):
        if covered[idx]:
            nearest[idx] = idx
            queue.append(idx)
    while queue:
        cur = queue.popleft()
        x = cur % W
        y = cur // W
        for nb in (cur - 1 if x > 0 else -1, cur + 1 if x < W - 1 else -1,
                   cur - W if y > 0 else -1, cur + W if y < H - 1 else -1):
            if nb >= 0 and nearest[nb] < 0:
                nearest[nb] = nearest[cur]
                queue.append(nb)
    filled = 0
    for idx in range(n):
        if not covered[idx]:
            v = vals[nearest[idx]]
            px[idx * 4] = v
            px[idx * 4 + 1] = v
            px[idx * 4 + 2] = v
            filled += 1
    if filled:
        img.pixels.foreach_set(px)
    return filled


def bake_ao_per_material(resolution: int, device: str = "cpu") -> Dict[str, Dict[str, object]]:
    """Bake distance-bounded AO per material into a packed image; wire it into the glTF
    Settings "Occlusion" input via a UV Map node pointing at the second UV set. Returns
    per-material stats including the baked image's luminance sd (0-255) so flat maps can
    be excluded.

    #issue-env-multimat: same defect class as the albedo bake's `bake_materials` (see
    its docstring) — grouping by `mats[0]` only silently drops every other material
    slot on a multi-material mesh (a wall with a window/door reveal is a SECOND slot on
    the same `.wall` object). That slot's node tree never gets an AO_UV image node, so
    it never receives an occlusionTexture at all, regardless of the flat-map skip below.
    Iterate every material slot an object actually carries.
    """
    # Cycles settings live here (not only in main) so direct callers such as the
    # locality fixture get the same engine/device/samples/seed as production.
    setup_scene(device)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    by_mat: Dict[str, List[bpy.types.Object]] = {}
    for obj in meshes:
        mats = [m for m in obj.data.materials if m is not None]
        for mat in mats:
            by_mat.setdefault(mat.name, []).append(obj)

    gltf_group = ensure_gltf_settings_group()
    results: Dict[str, Dict[str, object]] = {}
    for mat_name, objs_ in by_mat.items():
        if mat_name in SHELL_FLAT_SKIP_MATERIALS:
            # Pinned shell flats (shell_bake_skirting: flat matte vinyl grey,
            # no baked maps) must not get an occlusion texture: the
            # smart_project AO_UV islands on dense contour geometry are
            # slivers (measured seed 205: 99.4% of the 512^2 AO image is
            # dilated gutter) sampling near-black over the whole strip, which
            # crushes the calibrated grey to a black lower band at runtime
            # (measured pose 06: cove lower ~70 with the map vs ~160 without).
            # Contact shading still comes from runtime lights on the 0.9
            # roughness. Name list mirrors room-albedo-ao-bake.py's
            # SHELL_FLAT_SKIP_MATERIALS (same materials skip both bakes).
            results[mat_name] = {
                "image": "",
                "resolution": 0,
                "meshes": len(objs_),
                "luminanceSd255": 0.0,
                "wired": False,
                "skipped": True,
                "skipReason": "shell-flat",
            }
            print(f"[room-ao] SKIP {mat_name}: shell flat, occlusion not wired ({len(objs_)} mesh(es))")
            continue
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        if bsdf is None:
            raise RuntimeError(f"material {mat_name} has no Principled BSDF")

        for obj in objs_:
            ensure_ao_uv(obj)
        box_project_group(objs_, "AO_UV")

        img_name = f"openclinxr_room_ao_{mat_name}"
        if img_name in bpy.data.images:
            img = bpy.data.images[img_name]
        else:
            img = bpy.data.images.new(img_name, width=resolution, height=resolution, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "Non-Color"

        # AO image node, active for the bake, Vector fed by a UV Map node -> "AO_UV"
        # (exporter sees uvmap_info type "Fixed" -> TEXCOORD_1).
        ao_tex = None
        for node in nt.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.name == img_name:
                ao_tex = node
                break
        if ao_tex is None:
            ao_tex = nt.nodes.new("ShaderNodeTexImage")
            ao_tex.image = img
            ao_tex.location = (-700, -300)
        uv_map = None
        for node in nt.nodes:
            if node.type == "UVMAP" and node.uv_map == "AO_UV":
                uv_map = node
                break
        if uv_map is None:
            uv_map = nt.nodes.new("ShaderNodeUVMap")
            uv_map.uv_map = "AO_UV"
            uv_map.location = (-900, -300)
        for link in list(ao_tex.inputs["Vector"].links):
            nt.links.remove(link)
        nt.links.new(uv_map.outputs["UV"], ao_tex.inputs["Vector"])
        ao_tex.select = True
        nt.nodes.active = ao_tex

        # glTF Settings group "Occlusion" input <- AO image Color output.
        group_node = None
        for node in nt.nodes:
            if node.type == "GROUP" and node.node_tree is gltf_group:
                group_node = node
                break
        if group_node is None:
            group_node = nt.nodes.new("ShaderNodeGroup")
            group_node.node_tree = gltf_group
            group_node.location = (-400, -300)
        occ_input = group_node.inputs.get("Occlusion")
        if occ_input is None:
            raise RuntimeError(f"material {mat_name}: glTF Settings group has no Occlusion input")
        for link in list(occ_input.links):
            nt.links.remove(link)
        nt.links.new(ao_tex.outputs["Color"], occ_input)

        # Bounded Cycles bake (issue-526): EMIT of an Ambient Occlusion node at
        # AO_REACH_METERS through each object's AO_UV layer. Cross-material
        # occlusion comes free — Cycles traces the whole visible scene, so a
        # plaster wall occludes a tile floor with no explicit occluder set.
        bake_group_ao_image(img, mat_name, objs_)
        # Gutter dilation (wall-facets-ao-seams): nearest-edge fill of the UV-island
        # background so island borders do not sample the clear colour at runtime.
        # Coverage is rasterized from the UV geometry (a clear-valued texel can be
        # a legitimately fully occluded corner, so pixels are never thresholded).
        # Covered texels are untouched, so bake interiors are byte-identical with/without.
        W, H = img.size
        covered = rasterize_coverage(objs_, "AO_UV", W, H)
        filled = dilate_unpainted_texels(img, covered)
        img.pack()
        if filled:
            print(f"[room-ao] dilated {mat_name}: {filled} gutter texel(s)")

        # Measure luminance sd over the packed pixels (same 0-255 scale as the contract gate).
        px = list(img.pixels)
        vals = [px[i] for i in range(0, len(px), 4)]
        mean = sum(vals) / len(vals)
        sd = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
        sd255 = round(sd * 255.0, 1)
        results[mat_name] = {
            "image": img_name,
            "resolution": resolution,
            "meshes": len(objs_),
            "luminanceSd255": sd255,
            "wired": sd255 >= 6.0,
        }
        if sd255 < 6.0:
            # A flat AO map (measured: whiteboard_surface_white is a slab embedded 1 mm
            # behind the solid frame's front face — its true AO is uniform). Wiring a flat
            # map fails the contract's luminance-variation clause AND renders the surface
            # black in the runtime (aoMap multiplies). Leave it without an occlusion texture.
            for link in list(occ_input.links):
                nt.links.remove(link)
            print(f"[room-ao] SKIP {mat_name}: flat bake sd255={sd255} < 6 — occlusion not wired")
        else:
            print(f"[room-ao] baked {mat_name} -> {img_name} ({resolution}x{resolution}) on {len(objs_)} mesh(es), sd255={sd255}")
    return results


def restore_active_uv_layer() -> None:
    """The base-colour Image Texture nodes have no UV Map node, so the exporter maps them
    to the ACTIVE UV layer ("Active" uvmap_info). AO_UV was active during the bake; restore
    the FIRST layer (TEXCOORD_0) so base colour is not remapped."""
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.data.uv_layers:
            obj.data.uv_layers.active = obj.data.uv_layers[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--resolution", type=int, default=AO_DEFAULT_RESOLUTION)
    ap.add_argument("--device", choices=("cpu", "metal"), default="cpu",
                    help="Cycles device for the EMIT+AO bake (default cpu; metal is "
                    "fail-closed when no METAL device exists)")
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.input):
        raise SystemExit(f"input GLB not found: {args.input}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=args.input)

    # Scene/bake settings are applied inside bake_ao_per_material (same call the
    # locality fixture uses), so production and fixture share engine/device/
    # samples/seed. CLI contract (--input/--output/--resolution, exit codes)
    # is unchanged: runRoomGenerate needs no changes.
    results = bake_ao_per_material(args.resolution, args.device)
    restore_active_uv_layer()

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_animations=False,
        export_texcoords=True,
    )
    print(f"[room-ao] exported {args.output} (mechanism={AO_MECHANISM} reach={AO_REACH_METERS}m)")
    flat = [r["luminanceSd255"] for r in results.values()]
    wired = [r["luminanceSd255"] for r in results.values() if r["wired"]]
    if flat:
        print(
            f"[room-ao] materials={len(results)} wired={len(wired)} skipped={len(results) - len(wired)} "
            f"minSd255={min(flat)} maxSd255={max(flat)} medianSd255={round(statistics.median(flat), 1)}"
        )
    if len(wired) == 0:
        raise SystemExit("no material produced a non-flat occlusion bake — nothing wired")


if __name__ == "__main__":
    main()
