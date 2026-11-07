#!/usr/bin/env python3
"""hair-groom5 STEP 2: shading A/B on FIXED groom5 geometry (Review 20 C).

Arms (back view, 512): A1 HUANG/0.15, A2 HUANG/0.35, B1 CHIANG/0.15,
B2 CHIANG/0.35. Per arm: bandpass streak width (do bands survive?),
gloss (bright-px frac in hair mask vs target), colour hold
(lum/sat in render mask vs target mask). Writes E/shadeAB/score.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E5 = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
ARMS = {"A1-huang-r15": ("HUANG", 0.15), "A2-huang-r35": ("HUANG", 0.35),
        "B1-chiang-r15": ("CHIANG", 0.15), "B2-chiang-r35": ("CHIANG", 0.35)}


def lum(rgb):
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])


def sat(rgb):
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-12), 0.0)


def streak_bp(beauty, r0=70, r1=250, c0=190, c1=330):
    L = lum(beauty[r0:r1, c0:c1].astype(np.float64))
    widths = []
    for i in range(0, L.shape[0], 4):
        row = L[i]
        bp = ndimage.gaussian_filter1d(row, 1.5, mode="nearest") \
            - ndimage.gaussian_filter1d(row, 6, mode="nearest")
        m = bp > 0
        d = np.diff(np.concatenate([[0], m.view(np.int8), [0]]))
        s = np.nonzero(d == 1)[0]
        e = np.nonzero(d == -1)[0]
        widths.extend((e - s).tolist())
    w = np.array(widths)
    w = w[w >= 2]
    return {"median": round(float(np.median(w)), 1),
            "p75": round(float(np.percentile(w, 75)), 1), "n": int(len(w))}


def main():
    tgt = np.array(Image.open(SCR / "target-back.png").convert("RGB").resize((512, 512)))
    tmask = np.array(Image.open(SCR / "mask-back.png").convert("L")) > 127
    # downscale target to 512 for like-for-like gloss/colour
    tgt512 = np.array(Image.open(SCR / "target-back.png").convert("RGB").resize((512, 512)))
    tmask512 = np.array(Image.open(SCR / "mask-back.png").convert("L").resize((512, 512))) > 127
    tL = lum(tgt512.astype(np.float64))
    tgloss = float((tL[tmask512] > 150).mean())
    out = {"target": {"glossFrac": round(tgloss, 4),
                       "lumP50": round(float(np.median(tL[tmask512])), 1),
                       "satMean": round(float(sat(tgt512.astype(np.float64))[tmask512].mean()), 3),
                       "streak": streak_bp(tgt, 70, 250, 190, 330)}}
    for arm in ARMS:
        d = E5 / "shadeAB" / arm
        b = np.array(Image.open(d / "back.png").convert("RGB").resize((512, 512)))
        a = np.array(Image.open(d / "back-id.png").convert("RGBA").resize((512, 512)))[:, :, 3]
        hair = a >= 230
        L = lum(b.astype(np.float64))
        S = sat(b.astype(np.float64))
        out[arm] = {
            "streak": streak_bp(np.array(Image.open(d / "back.png").convert("RGB")),
                                70, 250, 190, 330),
            "glossFrac": round(float((L[hair] > 150).mean()), 4),
            "lumP50": round(float(np.median(L[hair])), 1),
            "satMean": round(float(S[hair].mean()), 3),
            "nHairPx": int(hair.sum()),
        }
    (E5 / "shadeAB" / "score.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
