#!/usr/bin/env python3
"""hair-hem1 STEP 2/3: summarize base+cells (IoU, ori, holes, rails, bands, eye)."""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, "tools/openclinxr/evidence/hair-hem1")
from rail_ruler import ruler, load_mask

E = Path("tools/openclinxr/evidence/hair-hem1")


def holes_of(idpath):
    a = np.asarray(Image.open(idpath).convert("RGBA"))[..., 3] >= 230
    bg = (~a).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bg, connectivity=8)
    border = set(np.unique(np.concatenate(
        [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])).tolist())
    hole_px, hole_n, sizes = 0, 0, []
    for i in range(1, n):
        if i in border:
            continue
        hole_n += 1
        px = int(stats[i, cv2.CC_STAT_AREA])
        hole_px += px
        sizes.append(px)
    return {"holeComponents": hole_n, "holePixels": hole_px,
            "hairPixels": int(a.sum()),
            "holePctOfHair": 100.0 * hole_px / max(int(a.sum()), 1),
            "largestHolePx": max(sizes) if sizes else 0}


def nums(tag, path):
    s = json.load(open(Path(path) / "score.json"))
    jf = list((Path(path) / "judge").glob("*.json"))
    j = json.load(open(jf[0])) if jf else {}
    op = j.get("openings") or {}
    eye = (op.get("eye") or {}).get("ours")
    jaw = (op.get("jaw") or {}).get("ours")
    rails = {}
    for v in ["back", "front", "profile_90"]:
        r = ruler(load_mask(Path(path) / f"{v}-id.png", False))
        r.pop("hemLine", None)
        r.pop("railBoxes", None)
        rails[v] = {"railComponents": r["railComponents"],
                    "railAreaPx": r["railAreaPx"]}
    au = E / "cells" / tag / "audit.json"
    inside = (json.load(open(au))["collider"]["post_inside_total"]
              if Path(au).exists() else None)
    return {
        "iouF": s["judgeV6"]["iou"]["front"],
        "iouP": s["judgeV6"]["iou"]["profile"],
        "iouB": s["judgeV6"]["iou"]["back"],
        "oriF": s["orientation"]["front"]["meanAbsErrDeg"],
        "ori3": s["orientation"]["three_quarter"]["meanAbsErrDeg"],
        "oriP": s["orientation"]["profile_90"]["meanAbsErrDeg"],
        "oriB": s["orientation"]["back"]["meanAbsErrDeg"],
        "backCount": s["bands"]["back"]["ours"]["count"],
        "eye": eye, "jaw": jaw,
        "holes": holes_of(Path(path) / "profile_90-id.png"),
        "rails": rails, "inside": inside,
        "n": s["geometry"]["strandCount"]}


tags = sys.argv[1:] or ["c_absorb", "c_blunt", "c_widen"]
base = nums("BASE", E / "base")
print("BASE", json.dumps(base, indent=1))
rows = {}
for tag in tags:
    d = E / "scores" / tag
    if not (d / "score.json").exists():
        print(tag, "MISSING")
        continue
    rows[tag] = nums(tag, d)
    r = rows[tag]
    print(tag, "IoU f/p/b=%.4f/%.4f/%.4f (d %+.4f/%+.4f/%+.4f)" % (
        r["iouF"], r["iouP"], r["iouB"], r["iouF"] - base["iouF"],
        r["iouP"] - base["iouP"], r["iouB"] - base["iouB"]))
    print("   ori f/3q/p/b=%.2f/%.2f/%.2f/%.2f (d %+.2f/%+.2f/%+.2f/%+.2f)" % (
        r["oriF"], r["ori3"], r["oriP"], r["oriB"],
        r["oriF"] - base["oriF"], r["ori3"] - base["ori3"],
        r["oriP"] - base["oriP"], r["oriB"] - base["oriB"]))
    print("   holes=%.3f%% (%d, largest %d) back=%d eye=%s inside=%s n=%d" % (
        r["holes"]["holePctOfHair"], r["holes"]["holeComponents"],
        r["holes"]["largestHolePx"], r["backCount"],
        round(r["eye"], 4) if r["eye"] else None, r["inside"], r["n"]))
    for v in ["back", "front", "profile_90"]:
        b, c = base["rails"][v], r["rails"][v]
        print("   rails %s: base %d/%dpx -> cell %d/%dpx (%.1f%%/%.1f%%)" % (
            v, b["railComponents"], b["railAreaPx"], c["railComponents"],
            c["railAreaPx"], 100 * c["railComponents"] / max(b["railComponents"], 1),
            100 * c["railAreaPx"] / max(b["railAreaPx"], 1)))
prev = {}
if (E / "scores_summary.json").exists():
    prev = json.load(open(E / "scores_summary.json")).get("cells", {})
prev.update(rows)
json.dump({"base": base, "cells": prev},
          open(E / "scores_summary.json", "w"), indent=2)
print("WROTE scores_summary.json")
