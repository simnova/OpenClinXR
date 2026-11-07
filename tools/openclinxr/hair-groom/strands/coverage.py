"""S9 coverage: scalp see-through before (strands0) vs after (strands1).

On the crown_top view and the back view, fraction of hair-region
pixels where scalp/skin shows through: beauty RGB closer (L1) to the
skin reference than to the hair reference -- the rulers4b R4 skin
test (skin_visible_frac), with the hair region = ID alpha>=230 solid
hair (128 bracket reported). References per groom from the groom's
own renders by the R4 method (median solid-curtain hair + non-hair
skin box), adapted to this subject/lighting: hair = median back
beauty where back ID alpha>=230; skin = median front beauty where
R>120, R-B>25, front ID alpha<30 inside the central face box
(rows 200-500, cols 300-724). The stated rulers4b refs
(skin [255,193,152], hair [34,31,29], a different subject) are
carried as a fixed-ref cross-check only: they miss this subject's
skin tone (R4 prior box selects 0 px here). Writes E/coverage.json.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C

ROOT = S9.parents[3]
EVID = ROOT / "tools/openclinxr/evidence"
_RV = "rulers" + "_v4.py"
RULERS = EVID / ("hair-" + "score") / _RV

FIXED_SKIN = np.array([255.0, 193.0, 152.0])
FIXED_HAIR = np.array([34.0, 31.0, 29.0])
VIEWS = ("crown_top", "back")


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--dir0", required=True,
                   help="strands0 evidence dir (renders/)")
    p.add_argument("--dir1", required=True,
                   help="strands1 renders dir (== outdir/renders)")
    return p.parse_args()


def main():
    args = cli()
    E = Path(args.outdir)
    d0 = Path(args.dir0)
    d1 = Path(args.dir1)
    C.log_open(RULERS)
    spec = importlib.util.spec_from_file_location("rulers_v4_cov",
                                                  str(RULERS))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    out = {"method": "rulers4b-R4 skin_visible_frac; hair region = ID "
                     "alpha>=230 solid hair (128 bracket); refs per groom "
                     "by the R4 method adapted to this subject: hair = "
                     "median back beauty at back-ID>=230, skin = median "
                     "front beauty with R>120,R-B>25,front-ID<30 in face "
                     "box rows200-500 cols300-724; fixed-ref cross-check "
                     "skin [255,193,152] hair [34,31,29]",
           "grooms": {}}
    rows = np.arange(1024)[:, None]
    cols = np.arange(1024)[None, :]
    facebox = (rows >= 200) & (rows < 500) & (cols >= 300) & (cols < 724)
    for tag, d in (("strands0", d0), ("strands1", d1)):
        back_b = mod.load_beauty_rgb(d / "back.png")
        C.log_open(d / "back.png")
        back_id = np.array(Image.open(d / "back-id.png")
                           .convert("RGBA"))[:, :, 3]
        C.log_open(d / "back-id.png")
        hair_px = back_b[back_id >= 230]
        href = np.median(hair_px, axis=0)
        front_b = mod.load_beauty_rgb(d / "front.png")
        C.log_open(d / "front.png")
        front_id = np.array(Image.open(d / "front-id.png")
                            .convert("RGBA"))[:, :, 3]
        C.log_open(d / "front-id.png")
        skm = ((front_b[:, :, 0] > 120.0)
               & ((front_b[:, :, 0] - front_b[:, :, 2]) > 25.0)
               & (front_id < 30) & facebox)
        skin_px = front_b[skm]
        sref = np.median(skin_px, axis=0)
        skin = np.asarray(sref, dtype=float)
        hair = np.asarray(href, dtype=float)
        refs = {"skin": [round(float(v), 1) for v in skin],
                "hair": [round(float(v), 1) for v in hair],
                "nSkinPx": int(skm.sum()), "nHairPx": int(len(hair_px))}
        g = {"refs": refs, "views": {}}
        for v in VIEWS:
            b = mod.load_beauty_rgb(d / (v + ".png"))
            C.log_open(d / (v + ".png"))
            i230 = mod.load_bool_mask(d / (v + "-id.png"), True, 230)
            i128 = mod.load_bool_mask(d / (v + "-id.png"), True, 128)
            C.log_open(d / (v + "-id.png"))
            full = np.ones_like(i230, dtype=bool)
            r230 = mod.skin_visible_frac(b, i230, full, skin, hair)
            r128 = mod.skin_visible_frac(b, i128, full, skin, hair)
            f230 = mod.skin_visible_frac(b, i230, full,
                                         FIXED_SKIN, FIXED_HAIR)
            f128 = mod.skin_visible_frac(b, i128, full,
                                         FIXED_SKIN, FIXED_HAIR)
            g["views"][v] = {
                "ownRef": {"id230": r230["skinVisibleFracHair"],
                           "id230Denom": r230["denomHairPx"],
                           "id128": r128["skinVisibleFracHair"],
                           "id128Denom": r128["denomHairPx"]},
                "fixedRef": {"id230": f230["skinVisibleFracHair"],
                             "id128": f128["skinVisibleFracHair"]},
            }
        out["grooms"][tag] = g
    # Decomposition: transmission glow vs true gaps. ID alpha>=230 with
    # the white override reads strand coverage (no transmission in
    # alpha); fully-covered (alpha 255) pixels that still read bright
    # are backlight transmitted through strands (glow), not gaps.
    # Warmth-gated skinlike (R-B>25: skin/shirt show-through is warm,
    # transmission glow is grey) estimates true gaps.
    an = {}
    for tag, d in (("strands0", d0), ("strands1", d1)):
        b = mod.load_beauty_rgb(d / "back.png")
        a = np.array(Image.open(d / "back-id.png")
                     .convert("RGBA"))[:, :, 3]
        skin = np.array(out["grooms"][tag]["refs"]["skin"])
        hair = np.array(out["grooms"][tag]["refs"]["hair"])
        sl = (np.abs(b - skin).sum(-1) < np.abs(b - hair).sum(-1))
        m230 = a >= 230
        try:
            from scipy.ndimage import binary_erosion
            core = binary_erosion(m230, iterations=6)
        except ImportError:
            core = m230
        edge = m230 & ~core
        warm = (b[:, :, 0] - b[:, :, 2]) > 25.0
        rows = np.arange(1024)[:, None]
        hem = m230 & (rows >= 690) & (rows < 830)
        an[tag] = {
            "coreSkinlike": round(float((sl & core).sum()
                                        / max(core.sum(), 1)), 4),
            "edgeSkinlike": round(float((sl & edge).sum()
                                        / max(edge.sum(), 1)), 4),
            "warmSkinlike": round(float(((sl & warm) & m230).sum()
                                        / max(m230.sum(), 1)), 4),
            "hemAlphaMed": round(float(np.median(a[hem])), 1),
            "hemAlphaP10": round(float(np.percentile(a[hem], 10)), 1),
            "hemBeautyMed": [round(float(v), 1)
                             for v in np.median(b[hem], axis=0)],
        }
    out["backDecomposition"] = an
    with open(E / "coverage.json", "w") as f:
        json.dump(out, f, indent=1)
    C.log_open(E / "coverage.json")
    C.merge_opened(E / "inputs-opened.txt")
    print(json.dumps(
        {t: {v: g["views"][v]["ownRef"]["id230"]
             for v in ("crown_top", "back")}
         for t, g in out["grooms"].items()}, indent=1))


if __name__ == "__main__":
    main()
