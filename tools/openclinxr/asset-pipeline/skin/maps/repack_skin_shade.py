#!/usr/bin/env python3
"""Repack OPENCLINXR_skin_shade through the Blender producer's own AST block."""
from __future__ import annotations

import argparse
import ast
import json
import struct
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
SOURCE = REPO_ROOT / "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"
WANT_FUNCS = {
    "_skin_shade_actor_table",
    "_skin_shade_actor_row",
    "_skin_shade_body_mask",
    "patch_glb_skin_shade",
}


def producer_namespace():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    names = set(WANT_FUNCS)
    body = []
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id.startswith("SKIN_SHADE_")
        ):
            body.append(node)
            names.add(node.targets[0].id)
        elif isinstance(node, ast.FunctionDef) and node.name in WANT_FUNCS:
            body.append(node)
    present = {node.name for node in body if isinstance(node, ast.FunctionDef)}
    missing = WANT_FUNCS - present
    if missing:
        raise RuntimeError(f"producer functions missing: {sorted(missing)}")
    module = ast.Module(body=body, type_ignores=[])
    namespace = {
        "REPO_ROOT": REPO_ROOT,
        "__name__": "skin_shade_producer_stage",
        "json": json,
        "struct": struct,
    }
    exec(compile(module, str(SOURCE), "exec"), namespace)  # noqa: S102 - tracked producer source
    return namespace


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("--reference", required=True)
    args = parser.parse_args()
    if not args.glb.is_file():
        parser.error(f"GLB does not exist: {args.glb}")
    producer_namespace()["patch_glb_skin_shade"](str(args.glb), args.reference)


if __name__ == "__main__":
    main()
