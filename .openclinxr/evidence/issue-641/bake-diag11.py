#!/usr/bin/env python3
"""#641 diag: does mesh.uv_layers.remove work on the LAST layer in Blender 5.1?"""
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
obj = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.data.name == "Circle.032")
mesh = obj.data
print(f"[diag] before: {len(mesh.uv_layers)} layers, first={mesh.uv_layers[0].name if len(mesh.uv_layers) else None}")
layer = mesh.uv_layers[0]
try:
    mesh.uv_layers.remove(layer)
    print(f"[diag] remove succeeded -> {len(mesh.uv_layers)} layers")
except Exception as e:
    print(f"[diag] remove raised: {type(e).__name__}: {e}")
print(f"[diag] after remove: {len(mesh.uv_layers)} layers")
# Can we smart-project now?
if len(mesh.uv_layers) == 0:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[diag] smart-project -> {len(mesh.uv_layers)} layers frac={rb.non_degenerate_uv_fraction(mesh):.3f}")
