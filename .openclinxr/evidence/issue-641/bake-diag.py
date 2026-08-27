#!/usr/bin/env python3
"""#641 diagnostic: instrument the room bake for ONE room, printing the floor
material's node tree state and bake result. Replicates room-albedo-ao-bake.py
exactly, then prints diagnostics. NOT a product change."""
import sys
import os
import importlib.util

args = sys.argv[sys.argv.index("--") + 1:]
REPO = args[0]
INPUT = args[1]
_SPEC = importlib.util.spec_from_file_location(
    "room_albedo_ao_bake",
    os.path.join(REPO, "tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py"),
)
rb = importlib.util.module_from_spec(_SPEC)
_sys_mod = sys.modules
_sys_mod[_SPEC.name] = rb
_spec_loader = _SPEC.loader
assert _spec_loader is not None
_spec_loader.exec_module(rb)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

rb.clear_scene()
bpy.ops.import_scene.gltf(filepath=INPUT)
bbox = rb.scene_bbox()
print("[diag] scene bbox:", {k: round(v, 3) for k, v in bbox.items()})
rb.setup_scene(bbox, "distributed")

# Find the floor material (marble tile) and its objects.
floor_mat = None
for m in bpy.data.materials:
    if "marble" in m.name and "tile" in m.name:
        floor_mat = m
        break
assert floor_mat is not None, "no floor material found"
print("[diag] floor material:", floor_mat.name)

floor_objs = [
    o for o in bpy.context.scene.objects
    if o.type == "MESH" and o.data.materials and o.data.materials[0] == floor_mat
]
for o in floor_objs:
    mw = o.matrix_world
    world_norm = (mw.to_quaternion() @ o.data.polygons[0].normal).normalized()
    print(
        f"[diag] floor obj {o.name}: tris={len(o.data.polygons)} "
        f"world_norm=({world_norm.x:.3f},{world_norm.y:.3f},{world_norm.z:.3f}) "
        f"uv_layers={[(u.name, u.active_render) for u in o.data.uv_layers]}"
    )
    # UV bounds from active UV layer
    uv = o.data.uv_layers.active
    if uv:
        mins = [1e9, 1e9]
        maxs = [-1e9, -1e9]
        for loop in o.data.loops:
            for c in range(2):
                v = uv.data[loop.index].uv[c]
                mins[c] = min(mins[c], v)
                maxs[c] = max(maxs[c], v)
        print(f"[diag]   active UV '{uv.name}' bounds u:[{mins[0]:.3f},{maxs[0]:.3f}] v:[{mins[1]:.3f},{maxs[1]:.3f}]")

# Inspect material node tree BEFORE bake.
rb.restore_bright_albedo(floor_mat, "floor")
nt = floor_mat.node_tree
bsdf = rb.find_bsdf(floor_mat)
print("[diag] base color links:", len(list(bsdf.inputs["Base Color"].links)))
print("[diag] base color default_value:", list(bsdf.inputs["Base Color"].default_value))
for node in nt.nodes:
    print(
        f"[diag]   node type={node.type} name={node.name!r} "
        f"{'image=' + (node.image.name if node.image else 'NONE') if node.type == 'TEX_IMAGE' else ''} "
        f"{'extension=' + node.extension if node.type == 'TEX_IMAGE' else ''}"
    )

# Now bake ONLY the floor objects into the exact target image the script uses.
results = rb.bake_materials(1024, True)
floor_row = results.get(floor_mat.name)
print("[diag] floor bake result:", floor_row)
