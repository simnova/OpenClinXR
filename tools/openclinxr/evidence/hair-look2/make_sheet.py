#!/usr/bin/env python3
"""STEP 3: look-sheet.png (rows TS|b7|q1, cols front/tq/profile/back + ear/back crops)
and scoreboard.json (b7,p2,p7,q1 rows). Boxes per hair-look1/finalize.py line 16.
Plain-python (mise): no bpy/mathutils imports."""
from __future__ import annotations
import colorsys
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS = JUDGE / "target-set-back"
VIEWS = ["front", "three_quarter", "profile_90", "back"]
TS_NAME = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
           "profile_90": "target-profile.png", "back": "target-back.png"}
MASK_NAME = {"front": "mask-front-v2.png", "three_quarter": "mask-three_quarter.png",
             "profile_90": "mask-profile-v2.png", "back": "mask-back-v3.png"}
EAR_BOX = (100, 240, 484, 624)
BACK_BOX = (320, 280, 704, 664)


def _rgb(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0


def _mask_l(p):
    return np.asarray(Image.open(p).convert("L")) >= 128


def _lum(a):
    return .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]


def _hue_sat_bright(image, mask):
    y = _lum(image)
    vals = y[mask]
    if not len(vals):
        return {"hueDeg": None, "saturation": None, "pixels": 0}
    bright = mask & (y >= np.percentile(vals, 90))
    px = image[bright]
    hsv = np.asarray([colorsys.rgb_to_hsv(*q) for q in px])
    weights = np.maximum(hsv[:, 1], .02)
    ang = hsv[:, 0] * 2 * math.pi
    hue = math.degrees(math.atan2(np.sum(np.sin(ang) * weights), np.sum(np.cos(ang) * weights))) % 360
    return {"hueDeg": float(hue), "saturation": float(np.median(hsv[:, 1])), "pixels": int(len(px))}


def _back_profile(image, mask):
    y = _lum(image)
    yy, xx = np.nonzero(mask)
    if not len(yy):
        return {"bins": [None] * 10, "topMinusHemOverMean": None, "pixels": 0}
    y0, y1 = int(yy.min()), int(yy.max()) + 1
    xc = float(np.median(xx))
    half = .20 * (float(xx.max()) - float(xx.min()) + 1)
    X = np.indices(mask.shape)[1]
    band = mask & (X >= xc - half) & (X <= xc + half)
    edges = np.linspace(y0, y1, 11).astype(int)
    bins = []
    for i in range(10):
        m = band.copy()
        m[:edges[i]] = False
        m[edges[i + 1]:] = False
        bins.append(float(np.mean(y[m])) if m.any() else None)
    valid = np.asarray([v for v in bins if v is not None])
    contrast = ((bins[0] - bins[-1]) / max(float(valid.mean()), 1e-12)
                if bins[0] is not None and bins[-1] is not None else None)
    return {"bins": bins, "topMinusHemOverMean": float(contrast), "pixels": int(band.sum())}


def _target_photometrics(view):
    stem = "profile" if view == "profile_90" else view
    a = _rgb(TARGET / f"target-{stem}.png")
    m = _mask_l(TARGET_MASKS / MASK_NAME[view])
    vals = _lum(a)[m]
    out = {"p50": float(np.percentile(vals, 50)), "p90": float(np.percentile(vals, 90)),
           "highlight": _hue_sat_bright(a, m)}
    if view == "back":
        out["backProfile"] = _back_profile(a, m)
    return out


def ts_photo():
    return {v: _target_photometrics(v) for v in VIEWS}


def load(t):
    return json.load(open(HERE / "cells" / t / "metrics.json"))


def back_l1(bins, ts_bins):
    return float(sum(abs(b - t) for b, t in zip(bins, ts_bins)))


def make_scoreboard(ts):
    ts_bins = ts["back"]["backProfile"]["bins"]
    rows = {}
    for t in ("b7", "p2", "p7", "q1"):
        m = load(t)
        v = m["views"]
        b = v["back"]
        rows[t] = {
            "tag": t,
            "front": {"p50": v["front"]["p50"], "p90": v["front"]["p90"],
                      "ts_p50": ts["front"]["p50"], "ts_p90": ts["front"]["p90"]},
            "three_quarter": {"p50": v["three_quarter"]["p50"], "p90": v["three_quarter"]["p90"],
                              "ts_p50": ts["three_quarter"]["p50"], "ts_p90": ts["three_quarter"]["p90"]},
            "profile_90": {"p50": v["profile_90"]["p50"], "p90": v["profile_90"]["p90"],
                           "ts_p50": ts["profile_90"]["p50"], "ts_p90": ts["profile_90"]["p90"]},
            "back": {"p50": b["p50"], "p90": b["p90"],
                     "ts_p50": ts["back"]["p50"], "ts_p90": ts["back"]["p90"],
                     "hue": b["highlight"]["hueDeg"], "hue_ts": ts["back"]["highlight"]["hueDeg"],
                     "sat": b["highlight"]["saturation"], "sat_ts": ts["back"]["highlight"]["saturation"],
                     "contrast": b["backProfile"]["topMinusHemOverMean"],
                     "contrast_ts": ts["back"]["backProfile"]["topMinusHemOverMean"],
                     "bins": b["backProfile"]["bins"],
                     "backProfileL1": back_l1(b["backProfile"]["bins"], ts_bins)},
            "partSide": v["front"]["partSide"],
            "faceP50": v["front"]["faceP50"],
        }
    doc = {"rows": rows, "ts_back_bins": ts_bins,
           "q1_spread": load("q1").get("threeSeedSpread"),
           "q1_params": load("q1")["params"]}
    (HERE / "scoreboard.json").write_text(json.dumps(doc, indent=1) + "\n")
    return rows


def src_img(tag, source):
    if tag == "TS":
        return Image.open(TARGET / TS_NAME[source]).convert("RGB")
    return Image.open(HERE / "cells" / tag / (source + ".png")).convert("RGB")


def make_sheet():
    cols = [("front", "front", None), ("three_quarter", "three_quarter", None),
            ("profile_90", "profile_90", None), ("back", "back", None),
            ("ear crop", "three_quarter", EAR_BOX), ("back crop", "back", BACK_BOX)]
    rows = ["TS", "b7", "q1"]
    tile, labelh = 384, 32
    canvas = Image.new("RGB", (tile * len(cols), len(rows) * (tile + labelh)), "white")
    d = ImageDraw.Draw(canvas)
    for ri, tag in enumerate(rows):
        for ci, (label, source, box) in enumerate(cols):
            im = src_img(tag, source)
            if box is not None:
                im = im.crop(box)
            im = im.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + labelh) + labelh
            canvas.paste(im, (x, y))
            d.text((x + 6, ri * (tile + labelh) + 8), f"{tag} | {label}", fill="black")
    canvas.save(HERE / "look-sheet.png")


def main():
    ts = ts_photo()
    rows = make_scoreboard(ts)
    for t, r in rows.items():
        print(t, "front", round(r["front"]["p50"], 4), round(r["front"]["p90"], 4),
              "tq", round(r["three_quarter"]["p50"], 4), round(r["three_quarter"]["p90"], 4),
              "prof", round(r["profile_90"]["p50"], 4), round(r["profile_90"]["p90"], 4),
              "back", round(r["back"]["p50"], 4), round(r["back"]["p90"], 4),
              "L1", round(r["back"]["backProfileL1"], 4),
              "hue/sat", round(r["back"]["hue"], 2), round(r["back"]["sat"], 3),
              "part/side", round(r["partSide"], 3), "face", round(r["faceP50"], 5))
    make_sheet()
    print("SHEET_DONE")


if __name__ == "__main__":
    main()
