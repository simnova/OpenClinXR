#!/usr/bin/env python3
"""#641 diag 4: bounds of every UV layer on the floor object + which layer the
'UV Map' node references + what the material's bake writes when only the floor
bakes, with per-layer diagnostics."""
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
sys.modules[_SPEC.name] = rb
assert _SPEC.loader is not None
_SPEC.loader.exec_module(rb)
import bpy  # noqa: E402

rb.clear_scene()
bpy.ops.import_scene.gltf(filepath=INPUT)
bbox = rb.scene_bbox()
rb.setup_scene(bbox, "distributed")

floor_mat = next(m for m in bpy.data.materials if "marble" in m.name and "tile" in m.name)
floor_objs = [
    o for o in bpy.context.scene.objects
    if o.type == "MESH" and o.data.materials and o.data.materials[0] == floor_mat
]
o = floor_objs[0]
print(f"[diag4] object {o.name} — {len(o.data.uv_layers)} UV layers:")
for layer in o.data.uv_layers:
    mins = [1e9, 1e9]
    maxs = [-1e9, -1e9]
    nonzero = 0
    total = 0
    for loop in o.data.loops:
        uv = layer.data[loop.index].uv
        total += 1
        if uv.x != 0 or uv.y != 0:
            nonzero += 1
        mins[0] = min(mins[0], uv.x)
        mins[1] = min(mins[1], uv.y)
        maxs[0] = max(maxs[0], uv.x)
        maxs[1] = max(maxs[1], uv.y)
    print(
        f"  {layer.name!r} active={layer.active_render} "
        f"u:[{mins[0]:.4f},{maxs[0]:.4f}] v:[{mins[1]:.4f},{maxs[1]:.4f}] "
        f"nonzero_loops={nonzero}/{total}"
    )

# What does the 'UV Map' node reference?
for node in floor_mat.node_tree.nodes:
    if node.type == "UVMAP":
        print(f"[diag4] UV Map node name={node.uv_map!r} (empty = active layer)")

# What are the OTHER materials/objects in the room? (only 4 primitives baked)
print("[diag4] all mesh objects and their first material:")
for obj in sorted(bpy.context.scene.objects, key=lambda x: x.name):
    if obj.type == "MESH":
        mats = [m.name if m else None for m in obj.data.materials]
        print(f"  {obj.name!r}: {len(obj.data.polygons)} tris, mats={mats}")
