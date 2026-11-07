#!/usr/bin/env python3
"""Self-tests for the orientation + band metrics (runs under system python).

(a) Target vs itself (own frame, identity transform): 0 angular error, 0 EMD.
(b) A strand field rotated by 10 deg reads ~10 deg error through the full
    score_view path (load PNG -> register -> orient -> compare), while its
    silhouette IoU stays 1.0 -- i.e. the direction gate sees what the shape
    gate cannot. Synthetic strands are used because a rigid photo rotation
    displaces curled hair by tens of px, conflating displacement with
    direction; the Gabor bank itself is validated exact on stripes
    (median 10.0 deg). The photo-rotation number is reported as context.
(c) Scoring the same input twice is bit-identical.
Writes self-test2.json beside this script. Exit nonzero on failure.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
sys.path[:0] = [str(E)]
import bands as B
import orientation as O

TB = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JM = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
TNAMES = {"front": ("target-front.png", "mask-front-v2.png"),
          "three_quarter": ("target-three_quarter.png", "mask-three_quarter.png"),
          "profile_90": ("target-profile.png", "mask-profile-v2.png"),
          "back": ("target-back.png", "mask-back-v3.png")}

TMP = E / "self-test"
TMP.mkdir(exist_ok=True)


def strand_field(path: Path):
    """Coherent strand-like field: one dominant direction + noise.

    Single orientation (no discontinuity boundary: a rigid rotation moves a
    boundary across pixels and conflates displacement with direction, the
    same reason photo rotation is context-only). Full-mask so the shape
    gate (IoU) stays exactly 1.0 while the direction gate must read ~10.
    """
    rng = np.random.default_rng(7)
    N = 1024
    Y, X = np.mgrid[0:N, 0:N].astype(float)
    field = 0.5 + 0.5 * np.sin(2 * np.pi * (X * np.cos(0.5) + Y * np.sin(0.5)) / 5.0)
    field = np.clip(field + rng.normal(0, 0.03, field.shape), 0, 1)
    rgb = (field * 255).astype(np.uint8)
    Image.fromarray(np.stack([rgb] * 3, axis=-1)).save(path)


def main() -> dict:
    tt = O.target_triples()
    out: dict = {}

    # (a) target vs itself in its own frame
    a_ok = True
    a_detail = {}
    for view, (bi, mi) in TNAMES.items():
        b, m = O.load_beauty_mask(TB / bi, JM / mi)
        s = O.score_view(b, m, b, m, view,
                         render_triple=tt[view], target_triple=tt[view])
        a_detail[view] = {"err": s["meanAbsErrDeg"], "emd": s["histEMD"],
                          "pixels": s["pixels"]}
        a_ok &= (s["meanAbsErrDeg"] == 0.0 and s["histEMD"] == 0.0
                 and s["pixels"] > 0)
    out["a_target_self"] = {"pass": bool(a_ok), "views": a_detail}

    # (b) synthetic strand field rotated 10 deg, full score_view path
    strand_field(TMP / "strands.png")
    b, m = O.load_beauty_mask(TMP / "strands.png", TMP / "strands.png")
    m = np.ones((1024, 1024), bool)  # mask PNG is white -> full mask anyway
    b8 = (np.clip(b, 0, 1) * 255 + 0.5).astype(np.uint8)
    br = np.asarray(Image.fromarray(b8).rotate(
        10, resample=Image.BICUBIC)).astype(np.float64) / 255.0
    s = O.score_view(br, m, b, m, "three_quarter")
    inter = int((m & m).sum())
    union = int((m | m).sum())
    b_err = s["meanAbsErrDeg"]
    b_ok = 8.0 <= b_err <= 13.0
    out["b_rotated10"] = {"pass": bool(b_ok), "err": b_err,
                          "emd": s["histEMD"], "iouShapeGate": union and inter / union,
                          "expectDeg": 10.0}
    # photo-rotation context (displacement-confounded, informational only)
    bb, mm = O.load_beauty_mask(TB / "target-back.png", JM / "mask-back-v3.png")
    b8p = (np.clip(bb, 0, 1) * 255 + 0.5).astype(np.uint8)
    brp = np.asarray(Image.fromarray(b8p).rotate(
        10, resample=Image.BICUBIC)).astype(np.float64) / 255.0
    mrp = np.array(Image.fromarray(
        (mm.astype(np.uint8) * 255)).rotate(10, resample=Image.NEAREST)) > 127
    sp = O.score_view(brp, mrp, bb, mm, "back",
                      render_triple=tt["back"], target_triple=tt["back"])
    out["b_photo_context"] = {"err": sp["meanAbsErrDeg"], "emd": sp["histEMD"],
                              "note": "displacement-confounded; informational only"}

    # (c) determinism: same input twice, full dict equality
    s1 = O.score_view(br, m, b, m, "three_quarter")
    s2 = O.score_view(br, m, b, m, "three_quarter")
    bands1 = B.score_beauty(b, m)
    bands2 = B.score_beauty(b, m)
    c_ok = (s1 == s2) and (bands1 == bands2)
    out["c_determinism"] = {"pass": bool(c_ok)}
    out["pass"] = bool(a_ok and b_ok and c_ok)
    (E / "self-test2.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":
    sys.exit(0 if main()["pass"] else 1)
