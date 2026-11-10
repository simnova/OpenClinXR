"""Convert a groom round's strands.npz into the v1 cards.py inputs (numpy only).

    <blender python> guides_from_groom.py <round-dir> <out-dir>

Reads <round-dir>/strands.npz (groom.py: guides (G,P,3) world, guideRoots (G,3),
scalpFaceCentres, scalpFaceAreas). Writes <out-dir>/guides.npz in the v1 schema
(guides_xyz root-first, guides_root, guide_side 1 = posterior) and
<out-dir>/scalp-axis.npz (axis = area-weighted mean of the scalp face centres;
cards.py uses only its x, y as the vertical head axis for card frames).
No coordinate is chosen here: every value is read from or averaged over the groom.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np


def main() -> None:
    rd, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    src = rd / "strands.npz"
    d = np.load(src)
    guides = d["guides"].astype(np.float64)
    roots = d["guideRoots"].astype(np.float64)
    if not np.allclose(guides[:, 0], roots, atol=5e-3):
        raise RuntimeError("guide first point is not its root (max %.1f mm)"
                           % (1000 * np.abs(guides[:, 0] - roots).max()))
    a = d["scalpFaceAreas"].astype(np.float64)
    axis = (d["scalpFaceCentres"] * a[:, None]).sum(0) / a.sum()
    # posterior = behind the axis along world -y (the GLB faces -y in Blender)
    side = (roots[:, 1] > axis[1]).astype(np.int8)
    np.savez(out / "guides.npz", guides_xyz=guides, guides_root=roots, guide_side=side)
    np.savez(out / "scalp-axis.npz", axis=axis)
    rec = {
        "strands": str(src), "strandsSha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        "guides": int(len(guides)), "pointsPerGuide": int(guides.shape[1]),
        "posterior": int(side.sum()), "axis": axis.tolist(),
    }
    (out / "guides-record.json").write_text(json.dumps(rec, indent=1))
    print("GUIDES_DONE", json.dumps(rec))


if __name__ == "__main__":
    main()
