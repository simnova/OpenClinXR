#!/usr/bin/env python3
"""#641 diag: instrument ensure_uv's decision path on Circle.032."""
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
print(f"[diag] layers before: {len(mesh.uv_layers)}")
for layer in list(mesh.uv_layers):
    mesh.uv_layers.active = layer
    frac = rb.non_degenerate_uv_fraction(mesh)
    print(f"[diag]   layer={layer.name} active={mesh.uv_layers.active.name} frac={frac:.3f} remove?={frac < 0.5}")
    if frac < 0.5:
        mesh.uv_layers.remove(layer)
        print(f"[diag]   removed -> {len(mesh.uv_layers)} layers")
print(f"[diag] layers after loop: {len(mesh.uv_layers)} truthy={bool(mesh.uv_layers)}")
