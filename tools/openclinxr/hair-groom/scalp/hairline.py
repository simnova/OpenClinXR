"""STEP 1a (pure python): target frontal hairline arc from the front mask.

CORRECTION 1: only hair LYING ON THE SCALP is back-projected. The target's
hanging curtains (hair in the air against the face) are excluded by the
departure rule: inside the brow-to-crown ROI the on-scalp hairline is the
roughly horizontal lower edge of the upper hair mass; where the curtains
leave the head the boundary turns roughly vertical (run-end rows dive).
Temple/sideburn/ear-front lines are PRIOR (built in the cast step), not
target observations. The profile view is not used (its front edge is the
curtain silhouette, not a hairline).

Departure rule (stated): over the contiguous first-run column interval
through the face centre, let m = median run-end row over the central third.
Walking outward from the centre, the departure column is the last column
with run-end row <= m + 35px; beyond it the edge falls steeply (curtain).
Part band (stated): N = 8px each side of the face centre (part gap 11px at
row 135 -> half-width 6px rounded + 2px margin); the arc is interpolated
across the band in 3D (source TARGET-interp).

Reads: manifest, front target mask (pinned path). Writes: E/hairline_2d.json.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-scalp1")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def runs(vec):
    d = np.diff(np.concatenate([[0], vec.view(np.int8), [0]]))
    return list(zip((np.where(d == 1)[0]).tolist(), (np.where(d == -1)[0] - 1).tolist()))


def main():
    doc, _ = C.load_manifest()
    land_p = Path(doc["targets"]["landmarks"]["path"])
    C.log_open(land_p)
    land = json.loads(land_p.read_text())
    p = Path(doc["targets"]["masks"]["front"]["path"])
    C.log_open(p)
    digest = sha(p)
    if digest != doc["targets"]["masks"]["front"]["sha256"]:
        raise ValueError("mask sha mismatch for front")
    front = np.asarray(Image.open(p).convert("L")) > 127

    crown_row = int(land["front"]["crown_top_row"])      # 127
    eye_row = int(land["front"]["eye_row"])              # 343
    centre = int(land["front"]["face_centre_col"])       # 513
    ok = {}
    for c in range(300, 731):
        r = runs(front[:, c])
        if not r:
            continue
        s, e = r[0]
        if s <= crown_row + 43 and e <= eye_row - 13:
            ok[c] = (int(s), int(e))
    if centre not in ok:
        raise RuntimeError("face centre column fails the hairline rule")
    lo = centre
    while lo - 1 in ok:
        lo -= 1
    hi = centre
    while hi + 1 in ok:
        hi += 1
    third = (hi - lo + 1) // 3
    central = list(range(lo + third, hi - third + 1))
    m = float(np.median([ok[c][1] for c in central]))
    # walk outward from the centre; departure = last col within m + 35
    depL = centre
    for c in range(centre, lo - 1, -1):
        if ok[c][1] <= m + 35:
            depL = c
        else:
            break
    depR = centre
    for c in range(centre, hi + 1):
        if ok[c][1] <= m + 35:
            depR = c
        else:
            break
    if not (depL > lo and depR < hi):
        raise RuntimeError("departure not found inside interval %d..%d" % (lo, hi))

    # part band from the part width measured at row crown+8 (stable, in-hair)
    prow = crown_row + 8
    z = np.where(~front[prow, centre - 60:centre + 60])[0]
    bounds = []
    prev = None
    cur = []
    for v in z:
        if prev is None or v == prev + 1:
            cur.append(v)
        else:
            bounds.append(cur)
            cur = [v]
        prev = v
    if cur:
        bounds.append(cur)
    part_w = 0
    for b in bounds:
        if b[0] <= 60 <= b[-1]:
            part_w = int(b[-1] - b[0] + 1)
    N = int(np.ceil(part_w / 2.0)) + 2 if part_w else 8

    arc = []
    for c in range(depL, depR + 1):
        arc.append({"col": c, "row": ok[c][1],
                    "inPartBand": bool(abs(c - centre) <= N)})
    kept = [a for a in arc if not a["inPartBand"]]

    out = {
        "method": "CORRECTION 1: frontal arc only, departure-bounded (last col each side within central-third median + 35px), part band excluded and interpolated in 3D; no profile observation (curtain silhouette); temples PRIOR",
        "roi": {"crownRow": crown_row, "eyeRow": eye_row, "centreCol": centre},
        "interval": [lo, hi],
        "centralMedian": m,
        "departure": {"rule": "last col outward with run-end <= centralMedian+35px",
                      "left": {"col": depL, "row": ok[depL][1]},
                      "right": {"col": depR, "row": ok[depR][1]}},
        "part": {"widthPx": part_w, "row": prow, "bandHalfWidthPx": N,
                 "bandCols": [centre - N, centre + N]},
        "arc": arc,
        "nKept": len(kept),
        "maskSha": digest,
    }
    E.mkdir(parents=True, exist_ok=True)
    (E / "hairline_2d.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    C.write_opened(E / "inputs-opened.txt")
    print("ARC cols %d..%d n=%d kept=%d median=%.1f partW=%d N=%d" % (
        depL, depR, len(arc), len(kept), m, part_w, N))


if __name__ == "__main__":
    main()
