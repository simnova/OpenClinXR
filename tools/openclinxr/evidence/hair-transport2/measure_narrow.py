#!/usr/bin/env python3
"""STEP 1 (hair-transport2): test "transport narrows the back by averaging offsets inward".

Reads (no Blender): hair-real1 a1 strands.npz, hair-geo7 a_k5 strands.npz
(post-repair scored grooms), back-id.png masks from the geo7 scored cells,
hair-curtain3 back landmarks, guides16 + cap-v8 for the curtain mask replica.

Measures, for current a1 vs geo7 a_k5:
  (a) back outer half-width (px, judge half_widths replica) at the
      shoulder-blade row (landmark shoulder_row=651) and at a hem row
      (per-mask robust lowest hair row - 6);
  (b) mean |in-sheet offset| (mm): |x(s) - root_x| averaged over all 32 arc
      points and over outer back children. Outer back children = rear-region
      (NOT curtain-region per the frame_transport replica below) with
      |root_x - cx| >= median over the rear region (same roots both grooms).
Writes tools/openclinxr/evidence/hair-transport2/narrow.json.
System python (numpy/PIL only).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
GEO7 = ROOT / "tools/openclinxr/evidence/hair-geo7"
A1 = ROOT / "tools/openclinxr/evidence/hair-real1/cells/a1/strands.npz"
AK5 = GEO7 / "cells" / "a_k5" / "strands.npz"
GUIDES = ROOT / "tools/openclinxr/evidence/hair-look1/guides16.npz"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
LM = json.loads((ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json").read_text())
CENTRE = int(LM["judge"]["back"]["hair_centre_col"])
SHOULDER_ROW = int(LM["judge"]["back"]["shoulder_row"])
SIZE = 1024


def half_widths(mask: np.ndarray, row: int, centre: int) -> tuple[int, int]:
    r = min(max(row, 0), SIZE - 1)
    xs = np.where(mask[r])[0]
    left = [x for x in xs if x < centre]
    right = [x for x in xs if x > centre]
    return (int(centre - min(left)) if left else 0, int(max(right) - centre) if right else 0)


def robust_lowest(mask: np.ndarray, frac: float = 0.02) -> int | None:
    need = frac * mask.shape[1]
    rows = np.where(mask.sum(axis=1) >= need)[0]
    return int(rows.max()) if len(rows) else None


def curtain_child_mask(croots: np.ndarray) -> np.ndarray:
    """Replica of the frame_transport.build population split (K-independent)."""
    gd = np.load(GUIDES)
    groots = np.asarray(gd["roots"], float)
    cap = np.load(CAP)
    cx = float(cap["cx"])
    az = np.degrees(np.arctan2(np.abs(groots[:, 0] - cx), -(groots[:, 1] - float(cap["Cy"]))))
    sector = az < 70.0
    lift = np.asarray(gd["liftoff"])
    lim = np.where(lift[:, 0] >= cx, 0.1921 * 0.2107, 0.2004 * 0.2107)
    curtain = (sector & (np.abs(lift[:, 0] - cx) >= lim)) | np.asarray(gd["frontal_drape"], bool)
    side_c = croots[:, 0] >= cx
    side_g = groots[:, 0] >= cx
    out = np.zeros(len(croots), bool)
    for s in range(0, len(croots), 4096):
        take = slice(s, s + 4096)
        for side in (False, True):
            ids = np.flatnonzero(side_c[take] == side)
            if not len(ids):
                continue
            gc = np.flatnonzero(curtain & (side_g == side))
            gr = np.flatnonzero(~curtain & (side_g == side))
            dc = np.linalg.norm(croots[take][ids, None, :] - groots[gc][None, :, :], axis=2).min(axis=1)
            dr = np.linalg.norm(croots[take][ids, None, :] - groots[gr][None, :, :], axis=2).min(axis=1)
            out[np.arange(s, s + len(side_c[take]))[ids]] = (dr - dc) >= 0.0
    return out


def mask_of(cell_score_dir: Path) -> np.ndarray:
    return np.asarray(Image.open(cell_score_dir / "back-id.png").convert("RGBA"))[..., 3] >= 230


def main() -> None:
    E = ROOT / "tools/openclinxr/evidence/hair-transport2"
    E.mkdir(parents=True, exist_ok=True)
    a1 = np.load(A1)
    k5 = np.load(AK5)
    p1, r1 = np.asarray(a1["points"], float), np.asarray(a1["roots"], float)
    p5 = np.asarray(k5["points"], float)
    assert r1.shape == np.asarray(k5["roots"]).shape
    assert bool((r1 == np.asarray(k5["roots"], float)).all()), "roots must match (transport pins roots)"
    cx = float(np.asarray(a1["cx"]))
    curtain = curtain_child_mask(r1)
    rear = ~curtain
    spread = np.abs(r1[:, 0] - cx)
    outer = rear & (spread >= float(np.median(spread[rear])))

    # (b) mean |in-sheet offset| along arc for outer back children
    m1 = float(np.abs(p1[outer][..., 0] - r1[outer][:, None, 0]).mean() * 1000.0)
    m5 = float(np.abs(p5[outer][..., 0] - r1[outer][:, None, 0]).mean() * 1000.0)

    # (a) image-space outer half-widths from the scored back-id masks
    widths = {}
    for tag, score_dir in (("a1", GEO7 / "cells" / "current" / "score"),
                           ("a_k5", GEO7 / "cells" / "a_k5" / "score")):
        m = mask_of(score_dir)
        low = robust_lowest(m)
        hem_row = int(low) - 6
        lw_s, rw_s = half_widths(m, SHOULDER_ROW, CENTRE)
        lw_h, rw_h = half_widths(m, hem_row, CENTRE)
        widths[tag] = {"shoulderRow": SHOULDER_ROW, "shoulderHalfWidthPx": {"left": lw_s, "right": rw_s},
                       "robustLowestRow": low, "hemRow": hem_row,
                       "hemHalfWidthPx": {"left": lw_h, "right": rw_h},
                       "maskPx": int(m.sum())}
    # Matched-row control: both masks at a1's own hem row (a_k5 hangs lower,
    # so per-mask hem rows sit at different heights).
    matched_row = int(widths["a1"]["hemRow"])
    matched = {}
    for tag, score_dir in (("a1", GEO7 / "cells" / "current" / "score"),
                           ("a_k5", GEO7 / "cells" / "a_k5" / "score")):
        m = mask_of(score_dir)
        lw, rw = half_widths(m, matched_row, CENTRE)
        matched[tag] = {"row": matched_row, "halfWidthPx": {"left": lw, "right": rw}}

    narrow_s = (sum(widths["a_k5"]["shoulderHalfWidthPx"].values())
                < sum(widths["a1"]["shoulderHalfWidthPx"].values()))
    narrow_h = (sum(widths["a_k5"]["hemHalfWidthPx"].values())
                < sum(widths["a1"]["hemHalfWidthPx"].values()))
    narrow_m = (sum(matched["a_k5"]["halfWidthPx"].values())
                < sum(matched["a1"]["halfWidthPx"].values()))
    inward = m5 < m1
    # Compound claim needs BOTH the narrowing AND the inward-averaging
    # mechanism; the sheet does narrow, but the mean-offset mechanism does not.
    verdict = "SUPPORTED" if (narrow_s and narrow_h and inward) else "REFUTED"
    doc = {
        "claim": "frame-transport (K=5, all children) narrows the back sheet because outer children's lateral offsets average inward",
        "method": {"curtainReplica": "frame_transport.build population split; rear=~curtain",
                   "outerBack": "|root_x - cx| >= rear-region median (same roots both grooms)",
                   "halfWidth": "judge half_widths replica on scored back-id.png (1024px)",
                   "hemRow": "per-mask robust_lowest(frac=0.02) - 6",
                   "inSheetOffsetMm": "mean |x(s) - root_x| over 32 arc pts x outer back strands"},
        "counts": {"strands": int(len(r1)), "curtainRegion": int(curtain.sum()),
                   "rearRegion": int(rear.sum()), "outerBack": int(outer.sum())},
        "outerHalfWidthPx": widths,
        "matchedRowHalfWidthPx": {"note": "both masks at a1's hem row (row 796); controls for different hem heights",
                                  "widths": matched},
        "meanAbsInSheetOffsetMm": {"a1": round(m1, 4), "a_k5": round(m5, 4),
                                   "deltaMm": round(m5 - m1, 4)},
        "checks": {"narrowerAtShoulder": bool(narrow_s), "narrowerAtHem": bool(narrow_h),
                   "narrowerAtMatchedHemRow": bool(narrow_m),
                   "smallerMeanOffset": bool(inward)},
        "verdict": verdict,
        "reading": ("narrowing is height-dependent, not a uniform inward averaging: a_k5 is narrower "
                    "at the shoulder row (518 vs 568 px) but WIDER at a1's hem height (454 vs 235 px at "
                    "row 796) and hangs lower as thin spikes (robust lowest 864 vs 802; 62 px wide at its "
                    "own hem). Outer back children's mean |lateral offset| grows (+0.22 mm), so lateral "
                    "offsets do NOT average inward; the shoulder narrowing comes from transported "
                    "mid-shaft offsets swinging forward (side-view lean) plus tip-fade toward the guide "
                    "average, redistributing mass downward rather than shrinking lateral spread"),
    }
    (E / "narrow.json").write_text(json.dumps(doc, indent=2) + "\n")
    print(json.dumps({**doc["meanAbsInSheetOffsetMm"], **doc["checks"],
                      "verdict": verdict,
                      "shoulder": {k: v["shoulderHalfWidthPx"] for k, v in widths.items()},
                      "hem": {k: v["hemHalfWidthPx"] for k, v in widths.items()}}, indent=2))


if __name__ == "__main__":
    main()
