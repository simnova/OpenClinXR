#!/usr/bin/env python3
"""#641 diag: what does non_degenerate_uv_fraction compute in Blender for the
partial-U V floor meshes (Circle.032 primary-care, Circle.034 stepdown)?"""
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
for o in sorted(bpy.context.scene.objects, key=lambda x: x.name):
    if o.type != "MESH":
        continue
    layer = o.data.uv_layers.active
    frac = rb.non_degenerate_uv_fraction(o.data) if layer else None
    print(
        f"[diag] {o.name}: uv_layers={len(o.data.uv_layers)} "
        f"active={layer.name if layer else None} frac={frac:.3f} "
        f"tris={len(o.data.loop_triangles)}"
    )
    for layer_ in o.data.uv_layers:
        o.data.uv_layers.active = layer_
        print(
            f"    layer {layer_.name}: frac={rb.non_degenerate_uv_fraction(o.data):.3f}"
        )
