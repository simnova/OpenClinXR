#!/usr/bin/env python3
"""#641 diag: copy of ensure_uv with prints, to find the divergence."""
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

# replicate the "before" print from diag10
print(f"[diag13] before frac={rb.non_degenerate_uv_fraction(mesh):.3f} layers={len(mesh.uv_layers)}")

# EXACT copy of ensure_uv's first branch with prints
if mesh.uv_layers and len(mesh.uv_layers) > 0:
    print(f"[diag13] enter branch layers={len(mesh.uv_layers)}")
    for layer in list(mesh.uv_layers):
        mesh.uv_layers.active = layer
        frac = rb.non_degenerate_uv_fraction(mesh)
        print(f"[diag13]   layer={layer.name} active_after_set={mesh.uv_layers.active.name} frac={frac:.3f}")
        if frac < 0.5:
            mesh.uv_layers.remove(layer)
            print(f"[diag13]   removed -> {len(mesh.uv_layers)}")
    if mesh.uv_layers:
        mesh.uv_layers.active = mesh.uv_layers[0]
        print("[diag13] kept layer, return")
    else:
        print("[diag13] fall through to smart-project")
