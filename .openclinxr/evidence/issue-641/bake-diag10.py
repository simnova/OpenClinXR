#!/usr/bin/env python3
"""#641 diag: run ensure_uv directly on primary-care's Circle.032 (frac 0.333)
and report whether it smart-projects."""
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
print(f"[diag] object={obj.name} mesh={obj.data.name}")
print(f"[diag] before: layers={len(obj.data.uv_layers)} active={obj.data.uv_layers.active.name if obj.data.uv_layers.active else None} frac={rb.non_degenerate_uv_fraction(obj.data):.3f}")
rb.ensure_uv(obj)
print(f"[diag] after: layers={len(obj.data.uv_layers)} active={obj.data.uv_layers.active.name if obj.data.uv_layers.active else None} frac={rb.non_degenerate_uv_fraction(obj.data):.3f}")
