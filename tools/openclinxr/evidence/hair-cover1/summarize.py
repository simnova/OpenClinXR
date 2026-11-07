#!/usr/bin/env python3
"""hair-cover1 STEP 2/3: summarize cell scores + holes vs base (system python).

KEEP rule (all at once):
  profile hole area <= 1.0%; IoU f/p/b each not down > 0.01 vs base;
  orientation not worse > 1 deg any view; back components >= 85% of base;
  eye-opening within 1 pp; inside-body count 0.
"""
import json
import sys
import numpy as np
import cv2
from pathlib import Path
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-cover1")


def holes_of(idpath):
    a = np.asarray(Image.open(idpath).convert("RGBA"))[..., 3] >= 230
    bg = (~a).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bg, connectivity=8)
    h, w = a.shape
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


def cell_numbers(tag, path):
    s = json.load(open(Path(path) / "score.json"))
    jfiles = list((Path(path) / "judge").glob("*.json"))
    j = json.load(open(jfiles[0])) if jfiles else {}
    op = (j.get("openings") or {})
    eye = ((op.get("eye") or {}).get("ours"))
    jaw = ((op.get("jaw") or {}).get("ours"))
    holes = holes_of(Path(path) / "profile_90-id.png")
    au = {}
    ap = Path("tools/openclinxr/evidence/hair-cover1/cells") / tag / "audit.json"
    if Path(ap).exists():
        au = json.load(open(ap))
    return {
        "iouF": s["judgeV6"]["iou"]["front"],
        "iouP": s["judgeV6"]["iou"]["profile"],
        "iouB": s["judgeV6"]["iou"]["back"],
        "oriF": s["orientation"]["front"]["meanAbsErrDeg"],
        "ori3": s["orientation"]["three_quarter"]["meanAbsErrDeg"],
        "oriP": s["orientation"]["profile_90"]["meanAbsErrDeg"],
        "oriB": s["orientation"]["back"]["meanAbsErrDeg"],
        "backCount": s["bands"]["back"]["ours"]["count"],
        "backMean": s["bands"]["back"]["ours"]["meanAreaPx"],
        "eye": eye, "jaw": jaw,
        "holes": holes,
        "inside": ((au.get("collider") or {}).get("post_inside_total")),
        "n": s["geometry"]["strandCount"],
    }


tags = sys.argv[1:] or ["c_den", "c_rad", "c_spr", "c_hem"]
base = cell_numbers("BASE", E / "base")
print("BASE", json.dumps(base, indent=1))
rows = {}
for tag in tags:
    try:
        rows[tag] = cell_numbers(tag, E / "scores" / tag)
    except FileNotFoundError as e:
        print(tag, "MISSING", e)
        continue
    r = rows[tag]
    print(tag, "IoU f/p/b=%.4f/%.4f/%.4f (d %+.4f/%+.4f/%+.4f)" % (
        r["iouF"], r["iouP"], r["iouB"],
        r["iouF"] - base["iouF"], r["iouP"] - base["iouP"], r["iouB"] - base["iouB"]))
    print("   ori f/3q/p/b=%.2f/%.2f/%.2f/%.2f (d %+.2f/%+.2f/%+.2f/%+.2f)" % (
        r["oriF"], r["ori3"], r["oriP"], r["oriB"],
        r["oriF"] - base["oriF"], r["ori3"] - base["ori3"],
        r["oriP"] - base["oriP"], r["oriB"] - base["oriB"]))
    print("   holes=%.3f%% (%d comp, largest %d) back=%dx%.1f eye/jaw=%s/%s inside=%s n=%d" % (
        r["holes"]["holePctOfHair"], r["holes"]["holeComponents"],
        r["holes"]["largestHolePx"], r["backCount"], r["backMean"],
        round(r["eye"], 4) if r["eye"] else None,
        round(r["jaw"], 4) if r["jaw"] else None, r["inside"], r["n"]))
(E / "scores_summary.json").write_text(
    json.dumps({"base": base, "cells": rows}, indent=2) + "\n")
