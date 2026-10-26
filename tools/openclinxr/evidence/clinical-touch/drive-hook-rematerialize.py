#!/usr/bin/env python3
"""Hook-only oracle driver: stub bpy/mathutils, AST-load rematerialize_rlq_clip, print JSON.

Loads ONLY the hook oracle (module constants + _glb_animation_names +
rematerialize_rlq_clip) from the bake script via AST selection — never the full
module, so Blender-only imports (bpy at top level, automate_blender) are not
executed. A "-" report argument maps to None (job-local temp report dir).
"""
import ast
import json
import pathlib
import subprocess
import sys
import tempfile
import types

bake_py, glb_path, report_arg = sys.argv[1], sys.argv[2], sys.argv[3]

stub_bpy = types.ModuleType("bpy")
stub_bpy.ops = types.SimpleNamespace()
stub_bpy.context = types.SimpleNamespace(scene=types.SimpleNamespace(objects=[]))
stub_bpy.data = types.SimpleNamespace(
    objects=types.SimpleNamespace(remove=lambda *a, **k: None)
)
sys.modules["bpy"] = stub_bpy

stub_mathutils = types.ModuleType("mathutils")


class Matrix:
    def __init__(self, *a, **k):
        pass

    def __matmul__(self, other):
        return self

    def __rmatmul__(self, other):
        return self

    @staticmethod
    def Rotation(*a, **k):
        return Matrix()

    @staticmethod
    def Identity(*a, **k):
        return Matrix()


stub_mathutils.Matrix = Matrix
sys.modules["mathutils"] = stub_mathutils

WANT = {"RLQ_CLIP_NAME", "MATERIALIZER", "_glb_animation_names", "rematerialize_rlq_clip"}
tree = ast.parse(pathlib.Path(bake_py).read_text(), bake_py)
wanted = [
    node
    for node in tree.body
    if (isinstance(node, (ast.Assign, ast.AnnAssign)) and any(isinstance(t, ast.Name) and t.id in WANT for t in ast.walk(node)))
    or (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in WANT)
]
ns = {
    "__name__": "bake_rematerialize_hook_oracle",
    "pathlib": pathlib,
    "json": json,
    "subprocess": subprocess,
    "sys": sys,
    "tempfile": tempfile,
    "REPO_ROOT": pathlib.Path(bake_py).resolve().parents[4],
}
exec(compile(ast.Module(body=wanted, type_ignores=[]), bake_py, "exec"), ns)
report_path = None if report_arg == "-" else pathlib.Path(report_arg)
out = ns["rematerialize_rlq_clip"](pathlib.Path(glb_path), report_path)
print(json.dumps({"skipped": out is None, "report": out}))
