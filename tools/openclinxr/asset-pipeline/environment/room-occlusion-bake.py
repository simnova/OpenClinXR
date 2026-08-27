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

MECHANISM HISTORY — why native AO cannot ship, measured 2026-08-27 (issue-526):
  - #349/#345 shipped the native Cycles AO bake type. Blender 5.1 IGNORES
    `scene.render.bake.max_ray_distance` for the AO bake type (probed 3x in #345, re-probed
    here: byte-identical bakes at ray=0.0 vs 2.0). It ALSO ignores
    `world.light_settings.distance` (probed: identical AO at 10/5/2/1/0.5/0 m).
  - The AO bake's true reach is not under the baker's control and is ~2.4-2.6 m in this
    build (measured: a ceiling at 2.65 m never occludes the floor; at 2.41 m it fully
    does; a wall contributes identically at every distance from 0.05 to 2.45 m). The
    shipped Infinigen rooms are closed boxes with floor-to-ceiling height 2.41-2.65 m and
    double-walled meshes (faces 0.1-0.35 m apart), so the native bake self-occluded every
    surface into a dark cave — measured on all fourteen shipped rooms as means of
    3-55/255 with 95%+ of texels below 64 (issue-526 plant, 8519ebce).
  - The Cycles "Ambient Occlusion" shader node (Distance input) cannot rescue this: an
    EMIT bake with the AO node wired returns ~1.0 regardless of distance (probed 2026-08-27)
    — the node is not evaluated by the bake path.

ISSUE-526 MECHANISM — bounded deterministic raycast AO ("bounded_raycast_v2"):
  A per-texel occlusion estimate computed from a BVH over the whole imported scene.
  Cosine-weighted rays are cast over the hemisphere around each sampled point; ONLY hits
  within AO_REACH_METERS count as occluders, and hits closer than AO_MIN_HIT_DISTANCE are
  ignored (a real occluder is a DIFFERENT surface — the sample point sits on its own
  surface, so any hit at ~0 is the surface's own coplanar plane and must not count; the
  v1 bake (f81d1c0f) counted those and measured a floor "contact shadow" that was mostly
  the artifact). Geometry beyond the reach contributes nothing, so contact darkening
  survives while whole-room self-occlusion is bounded away — an open-room-quality map on
  a closed room.

  v1's second defect, fixed here: v1 built its BVH from the CURRENT material's meshes only
  (`bvh = build_bvh(objects)`), so a plaster wall could not occlude a tile floor. This
  version builds ONE BVH over every mesh in the scene (all materials); cross-material
  occlusion is the point of a room AO map.

UV handling (the question the brief flagged): the shipped rooms already carry TEXCOORD_0.
The shell's TEXCOORD_0 is a per-face cube unwrap, non-overlapping, reused for base colour.
The Infinigen room's wall/ceiling UVs are TILED (span -2.6..4.2) and its exterior hull is a
single collapsed (0,0) point — an AO bake into TEXCOORD_0 there would smear. So every mesh
gets a SECOND UV layer "AO_UV" via smart_project (per material group, so islands cannot
overlap between meshes sharing a material), the AO bakes into it, and the occlusion texture
references TEXCOORD_1. Base colour keeps TEXCOORD_0 untouched.

Usage (inside Blender 5.1 headless):
  blender --background --python room-occlusion-bake.py -- \
    --input <room.glb> --output <baked.glb> [--resolution 512]

Exit 0 on success; non-zero with a printed error on any bake failure (the input GLB is
never modified in place).
"""
from __future__ import annotations

import argparse
import math
import os
import random
import statistics
import sys
from typing import Dict, List, Tuple

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# Distance-bounded AO: only occluders within this radius of a sample point darken it.
# 2.0 m covers furniture-scale contact darkening in a ~6.5 m room; walls metres away
# contribute nothing, which is what keeps a CLOSED room from self-occluding to a cave.
AO_MECHANISM = "bounded_raycast_v2"
AO_REACH_METERS = 2.0
# Hits closer than this are the sample's own surface (the ray origin sits ON it): a real
# occluder is a DIFFERENT surface. v1 counted t~0 coplanar hits and its fixture's
# "contact shadow" was mostly that artifact (near/far 0.15 with the wall at 0.5 m, where
# real geometry alone measures ~0.25 on the same scene).
AO_MIN_HIT_DISTANCE = 0.05
# Ray origin is lifted this far off the surface along its normal. BVHTree.ray_cast reports
# a t~0 hit on the ray's own containing triangle for directions inside its normal cone
# (measured: an up-ray from a floor point returns the floor face at dist=-0.0), which can
# shadow a real occluder beyond it. Lifting the origin off the surface removes every
# self/coplanar hit geometrically; the min-distance filter catches any residual.
AO_RAY_ORIGIN_OFFSET = 0.02
# Hemisphere sampling per point. Fixed seed -> byte-deterministic output for the same GLB.
AO_SAMPLES_PER_RING = 16
AO_RINGS = (30.0, 60.0, 80.0)  # tilt angles from the surface normal, degrees
AO_SAMPLE_SEED = 20260825

GLTF_GROUP_NAMES = ("glTF Material Output", "glTF Settings")


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
    """Create/return the second UV layer name for AO. Uses smart_project on the material
    GROUP so islands from different meshes sharing a material cannot overlap in one image."""
    layer_name = "AO_UV"
    me = mesh_obj.data
    if layer_name not in [u.name for u in me.uv_layers]:
        me.uv_layers.new(name=layer_name)
    return layer_name


def smart_project_group(objects: List[bpy.types.Object], layer_name: str) -> None:
    """Unwrap all selected objects' faces into `layer_name` in ONE pass (non-overlapping
    islands across the group, island_margin so texels do not bleed between islands)."""
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
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    except TypeError:
        bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")


def setup_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True
    # Kept for provenance: Blender 5.1 ignores this knob on the AO bake type (probed), which
    # is WHY the bake below no longer uses the native AO bake type at all.
    scene.render.bake.max_ray_distance = 0.0


def build_scene_bvh() -> BVHTree:
    """ONE BVH over every mesh in the scene, so any surface occludes any other.

    v1 built the BVH from the CURRENT material's meshes only, so a plaster wall could not
    occlude a tile floor — cross-material occlusion is the point of a room AO map. The
    occluder set here is the whole room, whatever material each mesh wears."""
    verts_global: List[Tuple[float, float, float]] = []
    polys: List[List[int]] = []
    offset = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        me = obj.data
        mw = obj.matrix_world
        for v in me.vertices:
            p = mw @ v.co
            verts_global.append((p.x, p.y, p.z))
        for poly in me.polygons:
            polys.append([offset + i for i in poly.vertices])
        offset += len(me.vertices)
    if offset == 0:
        raise RuntimeError("scene contains no mesh geometry to build an occlusion BVH from")
    return BVHTree.FromPolygons(verts_global, polys)


def bounded_ao_at(bvh: BVHTree, origin, normal, jitter: float) -> float:
    """Cosine-weighted-ish hemisphere occlusion with a hard distance cap.

    Returns 1.0 (fully open) .. 0.0 (fully occluded within reach). Rays are distributed
    over the hemisphere around `normal` at fixed tilts; each ray contributes cos(tilt)
    when it hits something within AO_REACH_METERS at distance >= AO_MIN_HIT_DISTANCE.
    Beyond-reach geometry never counts, so a closed room cannot darken itself into a cave;
    closer-than-min hits are the sample's own (co)plane and are ignored, so a floor is not
    "occluded" by its own tiles.

    The ray origin sits ON the surface: FromPolygons BVHs are single-sided, so a point on a
    face can only hit geometry whose FRONT faces the ray. The min-distance filter is what
    removes the coplanar t~0 hits (measured: 1136 of 1440 ceiling rays hit their own
    coplanar plane in the v1 bake, darkening open ceilings to ~0.15).
    """
    total_weight = 0.0
    hit_weight = 0.0
    n = normal.normalized()
    # Orthonormal tangent basis around the normal. t1 = ref.cross(n) (NOT n.cross(ref)):
    # the latter's handedness left half the azimuths uncovered (measured — a +X wall was
    # never hit because the sweep only covered -X and ±Y).
    ref = Vector((1.0, 0.0, 0.0))
    if abs(n.x) > 0.9:
        ref = Vector((0.0, 1.0, 0.0))
    t1 = ref.cross(n).normalized()
    t2 = n.cross(t1).normalized()
    origin = origin + n * AO_RAY_ORIGIN_OFFSET
    for i in range(AO_SAMPLES_PER_RING):
        phi = 2.0 * math.pi * i / AO_SAMPLES_PER_RING + jitter
        for tilt_deg in AO_RINGS:
            tilt = math.radians(tilt_deg)
            d = math.cos(tilt) * n + math.sin(tilt) * (math.cos(phi) * t1 + math.sin(phi) * t2)
            d.normalize()
            weight = math.cos(tilt)
            total_weight += weight
            loc, _nrm, _idx, dist = bvh.ray_cast(origin, d, AO_REACH_METERS)
            if loc is not None and dist >= AO_MIN_HIT_DISTANCE:
                hit_weight += weight
    if total_weight <= 0.0:
        return 1.0
    return max(0.0, 1.0 - hit_weight / total_weight)


def sample_points_for_object(obj: bpy.types.Object):
    """Per-face world-space (centre, normal, corner positions) for an evaluated mesh.

    The glTF import gives coarse room geometry (tens to hundreds of tris per material), so
    faces are the natural deterministic sample domain — per-texel evaluation interpolates
    within each face's UV footprint.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    obj_eval = obj.evaluated_get(depsgraph)
    me = obj_eval.to_mesh()
    mw = obj_eval.matrix_world
    nmw = mw.inverted().transposed()
    out = []
    for poly in me.polygons:
        center_local = poly.center
        normal_local = poly.normal
        c = mw @ center_local
        nrm = (nmw @ normal_local).normalized()
        corners = [mw @ me.vertices[vi].co for vi in poly.vertices]
        out.append((c, nrm, corners))
    obj_eval.to_mesh_clear()
    return out


def _barycentric_uv(px, py, a, b, c):
    """Barycentric coords of a UV-space point in the UV triangle abc."""
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(det) < 1e-12:
        return 1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0
    l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
    l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
    return l1, l2, 1.0 - l1 - l2


def paint_bounded_ao(img, objects: List[bpy.types.Object], bvh: BVHTree) -> None:
    """Fill `img` by evaluating bounded AO PER TEXEL through each object's AO_UV layer.

    For every face, texels inside its UV footprint get the AO of their interpolated world
    position (barycentric over the face), so large coarse faces still carry real gradients.
    Texels no face covers stay white (open) — the safe default for an occlusion map.
    Determinism: a seeded per-texel jitter is consumed in face order, so output does not
    depend on object order and repeats byte-for-byte across runs.
    """
    W, H = img.size
    buf = [1.0] * (W * H)
    rng = random.Random(AO_SAMPLE_SEED)

    plans = []
    for obj in objects:
        me = obj.data
        layer = me.uv_layers.get("AO_UV")
        if layer is None:
            continue
        pts = sample_points_for_object(obj)
        uv_data = layer.data
        faces_uv = [[uv_data[li].uv.copy() for li in poly.loop_indices] for poly in me.polygons]
        plans.append((pts, faces_uv))

    for pts, faces_uv in plans:
        for (c, nrm, corners), uvs in zip(pts, faces_uv):
            us = [u.x for u in uvs]
            vs = [u.y for u in uvs]
            x0 = min(W - 1, max(0, int(min(us) * W)))
            x1 = min(W - 1, max(0, int(max(us) * W)))
            y0 = min(H - 1, max(0, int(min(vs) * H)))
            y1 = min(H - 1, max(0, int(max(vs) * H)))
            if len(uvs) < 3:
                continue
            uv_tris = []
            if len(uvs) == 3:
                uv_tris.append((0, 1, 2))
            else:
                # Fan-triangulate quads/n-gons so the whole UV footprint is covered.
                for k in range(1, len(uvs) - 1):
                    uv_tris.append((0, k, k + 1))
            for yy in range(y0, y1 + 1):
                row = yy * W
                py = (yy + 0.5) / H
                for xx in range(x0, x1 + 1):
                    px = (xx + 0.5) / W
                    covered = False
                    ao_acc = 0.0
                    w_acc = 0.0
                    for (i0, i1, i2) in uv_tris:
                        l1, l2, l3 = _barycentric_uv(
                            px, py,
                            (us[i0], vs[i0]), (us[i1], vs[i1]), (us[i2], vs[i2]),
                        )
                        if l1 < -0.02 or l2 < -0.02 or l3 < -0.02:
                            continue
                        covered = True
                        w = max(0.0, l1) + max(0.0, l2) + max(0.0, l3)
                        wp = corners[i0] * max(0.0, l1) + corners[i1] * max(0.0, l2) + corners[i2] * max(0.0, l3)
                        jitter = rng.random() * 2.0 * math.pi
                        ao_acc += bounded_ao_at(bvh, wp, nrm, jitter) * w
                        w_acc += w
                    if not covered or w_acc <= 0.0:
                        continue
                    idx = row + xx
                    ao = ao_acc / w_acc
                    if ao < buf[idx]:
                        buf[idx] = ao

    rgba = []
    for v in buf:
        rgba.extend((v, v, v, 1.0))
    img.pixels.foreach_set(rgba)


def bake_ao_per_material(resolution: int) -> Dict[str, Dict[str, object]]:
    """Bake distance-bounded AO per material into a packed image; wire it into the glTF
    Settings "Occlusion" input via a UV Map node pointing at the second UV set. Returns
    per-material stats including the baked image's luminance sd (0-255) so flat maps can
    be excluded."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    by_mat: Dict[str, List[bpy.types.Object]] = {}
    for obj in meshes:
        mats = [m for m in obj.data.materials if m is not None]
        if not mats:
            continue
        by_mat.setdefault(mats[0].name, []).append(obj)

    # One BVH over the WHOLE scene (every material), built once: cross-material
    # occlusion is the point of a room AO map (v1's per-material BVH defect).
    scene_bvh = build_scene_bvh()

    gltf_group = ensure_gltf_settings_group()
    results: Dict[str, Dict[str, object]] = {}
    for mat_name, objs_ in by_mat.items():
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        if bsdf is None:
            raise RuntimeError(f"material {mat_name} has no Principled BSDF")

        for obj in objs_:
            ensure_ao_uv(obj)
        smart_project_group(objs_, "AO_UV")

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

        # Distance-bounded raycast AO (issue-526): fill the image through each object's
        # AO_UV layer against the WHOLE-scene BVH. Replaces the native Cycles AO bake,
        # whose reach Blender 5.1 cannot bound (max_ray_distance and world distance both
        # ignored) and which self-occludes closed rooms to a cave.
        bpy.ops.object.select_all(action="DESELECT")
        paint_bounded_ao(img, objs_, scene_bvh)
        img.pack()

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
    ap.add_argument("--resolution", type=int, default=512)
    args = ap.parse_args(_argv_after_double_dash())

    if not os.path.exists(args.input):
        raise SystemExit(f"input GLB not found: {args.input}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=args.input)

    setup_scene()
    results = bake_ao_per_material(args.resolution)
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
