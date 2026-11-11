#!/usr/bin/env python3
"""Teeth/tongue accessor hashes of a FINAL (post-step) GLB, for derive_sidecar.ts finalAccessorHashes.

A separate file so swap_teeth.py (and its toolSha256 pin) stays unchanged. It reuses
swap_teeth.py's _feature_match, _primitive_accessor_rows and _accessor_hash: the rows are
hashed exactly as the swap report hashes outputAccessorHashes, so the two records compare.
"""
import importlib.util
import json
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("openclinxr_swap_teeth", Path(__file__).with_name("swap_teeth.py"))
if _spec is None or _spec.loader is None:
    raise RuntimeError("cannot load swap_teeth.py")
swap_teeth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(swap_teeth)


def feature_hashes_of(path: Path) -> dict[str, list[dict[str, str]]]:
    document, binary, _ = swap_teeth.GLB.parse_glb(path)
    result: dict[str, list[dict[str, str]]] = {}
    for feature, token in swap_teeth.DONOR_TOKEN.items():
        _, mesh, _, _ = swap_teeth._feature_match(document, token, feature)
        result[feature] = [
            {"slot": slot, "sha256": swap_teeth._accessor_hash(document, binary, index)}
            for slot, index in swap_teeth._primitive_accessor_rows(mesh)
        ]
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: feature_hashes.py <glb>")
    print(json.dumps(feature_hashes_of(Path(sys.argv[1]))))
