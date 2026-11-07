"""S8 STEP 1b (Blender): decimate the raw shell surface to budget.

Reads: WS/shell_raw.obj. Writes: WS/shell_dec.obj + WS/decimate.json
(tris before/after, ratio, blender version). Determinism gate support:
run twice with --out-suffix a/b; shell_flow.py compares the vertex
hashes. No shading, no render; decimate COLLAPSE only (planar merge
would join the cap across the face opening).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy

BUDGET_TRIS = 40000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = ap.parse_args(argv)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.wm.obj_import(filepath=args.raw)
    obj = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = obj
    n_before = len(obj.data.polygons)
    ratio = min(1.0, BUDGET_TRIS / max(n_before, 1))
    if ratio < 1.0:
        mod = obj.modifiers.new("OCLX_decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # collapse on a triangulated mesh keeps triangles; enforce anyway
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY",
                                       ngon_method="BEAUTY")
    bpy.ops.object.mode_set(mode="OBJECT")
    n_after = len(obj.data.polygons)
    bpy.ops.wm.obj_export(filepath=args.out,
                          export_selected_objects=True)
    Path(args.report).write_text(json.dumps(
        {"budgetTris": BUDGET_TRIS, "trisBefore": int(n_before),
         "trisAfter": int(n_after), "ratio": round(ratio, 5),
         "blenderVersion": bpy.app.version_string}, indent=1) + "\n")
    print("DECIMATE before=%d after=%d ratio=%.5f" % (
        n_before, n_after, ratio), flush=True)


if __name__ == "__main__":
    main()
