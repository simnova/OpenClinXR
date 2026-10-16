"""Face-station stage-4/7 driver: per-mesh POSITION sha256 for a GLB.

Read-and-run wrapper over the landed lid-conform core
(tools/openclinxr/asset-pipeline/realism-head/lid-conform/lid_conform_core.py):
the same accessor-bytes sha256 the any-subject G1 rebake comparison uses
(measure_conform.py C1: sha256 of the POSITION accessor bytes). Prints JSON
{body: <resolved body mesh name>, positionSha256: {mesh: sha}}.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lid-conform-dir", required=True)
    ap.add_argument("--glb", required=True)
    a = ap.parse_args()
    sys.path.insert(0, a.lid_conform_dir)
    import lid_conform_core as core  # noqa: E402  (landed stage code)

    js, blob = core.load_glb(a.glb)
    out = {}
    for m in js.get("meshes", []):
        prim = (m.get("primitives") or [{}])[0]
        idx = (prim.get("attributes") or {}).get("POSITION")
        if idx is None:
            continue
        pos = core.accessor(js, blob, idx)
        out[m.get("name")] = hashlib.sha256(
            np.ascontiguousarray(pos).tobytes()).hexdigest()
    print(json.dumps({"body": core.resolve_body_mesh_name(js),
                      "positionSha256": out}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
