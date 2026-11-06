#!/usr/bin/env python3
"""Repack OPENCLINXR_skin_shade through the Blender producer's own AST block."""
from __future__ import annotations

import argparse
import ast
import hashlib
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


def record_provenance(provenance: Path, glb: Path, reference: str,
                      input_sha256: str, input_bytes: int,
                      repair_predecessor: str | None) -> None:
    if len(input_sha256) != 64 or any(c not in "0123456789abcdef" for c in input_sha256):
        raise RuntimeError("--input-sha256 must be a lowercase SHA-256")
    doc = json.loads(provenance.read_text(encoding="utf-8"))
    output = glb.read_bytes()
    output_sha256 = hashlib.sha256(output).hexdigest()
    if repair_predecessor is not None:
        predecessor = doc.get(repair_predecessor)
        if not isinstance(predecessor, dict):
            raise RuntimeError(f"provenance has no {repair_predecessor} predecessor")
        existing_predecessor_sha = predecessor.get("outputSha256")
        if existing_predecessor_sha not in (input_sha256, output_sha256):
            raise RuntimeError(
                f"{repair_predecessor} output {existing_predecessor_sha} is neither "
                "predecessor nor current output"
            )
        if "wovenSha256" in predecessor:
            predecessor["wovenSha256"] = input_sha256
        predecessor["outputSha256"] = input_sha256
        predecessor["outputBytes"] = input_bytes
    tool = Path(__file__).resolve()
    tool_rel = str(tool.relative_to(REPO_ROOT))
    doc["skinShadeCarrier"] = {
        "tool": tool_rel,
        "toolSha256": hashlib.sha256(tool.read_bytes()).hexdigest(),
        "reference": reference,
        "inputSha256": input_sha256,
        "inputBytes": input_bytes,
        "outputSha256": output_sha256,
        "outputBytes": len(output),
        "recordedAt": "2026-11-06",
        "resolutionNote": (
            "st-vitbody3 r4b: records the post-weave skin-shade carrier as its own replayable "
            "stage; supersedes the r2 same-commit pin that incorrectly rewrote the predecessor."
        ),
        "claimScope": "post-export skin-shade images + material extension only",
    }
    doc["outputSha256"] = output_sha256
    doc["outputBytes"] = len(output)
    provenance.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"GLB_SKINSHADE_PROVENANCE {provenance} {input_sha256[:12]}->{output_sha256[:12]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--record-provenance", type=Path)
    parser.add_argument("--input-sha256")
    parser.add_argument("--input-bytes", type=int)
    parser.add_argument("--repair-predecessor")
    parser.add_argument("--provenance-only", action="store_true")
    args = parser.parse_args()
    if not args.glb.is_file():
        parser.error(f"GLB does not exist: {args.glb}")
    if not args.provenance_only:
        producer_namespace()["patch_glb_skin_shade"](str(args.glb), args.reference)
    if args.record_provenance:
        if args.input_sha256 is None or args.input_bytes is None:
            parser.error("--record-provenance requires --input-sha256 and --input-bytes")
        record_provenance(
            args.record_provenance,
            args.glb,
            args.reference,
            args.input_sha256,
            args.input_bytes,
            args.repair_predecessor,
        )


if __name__ == "__main__":
    main()
