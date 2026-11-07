#!/usr/bin/env python3
"""hair-crown2 STEP 1 ruler: lock regions, stats, overlay (numpy/PIL/scipy).

OUR region (per view) = capmask-white (visible under-hair scalp; only exists
above/behind the anatomical hairline) INTERSECT hair silhouette (ID>=30
closed+dilated) INTERSECT H-normalized crown band. Face/forehead skin below
the hairline can never be cap-white -> excluded by construction.
TARGET region = target hair mask INTERSECT same H-fraction band.
Metrics: meanLum, orangeFrac (crown1 predicate lum>0.45 & R-B>0.12 & R>0.4),
circular-mean hue over region. Secondary (reported): drape hair fraction.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

E = Path(__file__).resolve().parent
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TJ = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
SIZE = 1024


def rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=float) / 255.0


def lum(im: np.ndarray) -> np.ndarray:
    return 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]


def hue_circmean(im: np.ndarray, mask: np.ndarray) -> float:
    px = im[mask]
    mx, mn = px.max(axis=1), px.min(axis=1)
    rng = mx - mn
    h = np.zeros(len(px))
    nz = rng > 1e-9
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    isr = nz & (mx == r)
    isg = nz & ~isr & (mx == g)
    isb = nz & ~isr & ~isg
    h[isr] = ((g[isr] - b[isr]) / rng[isr]) % 6.0
    h[isg] = (b[isg] - r[isg]) / rng[isg] + 2.0
    h[isb] = (r[isb] - g[isb]) / rng[isb] + 4.0
    ang = h * np.pi / 3.0
    return float((np.degrees(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360.0))


def stats(im: np.ndarray, mask: np.ndarray) -> dict:
    L = lum(im)
    sel = L[mask]
    orange = ((L > 0.45) & ((im[..., 0] - im[..., 2]) > 0.12) & (im[..., 0] > 0.4))[mask]
    return {"pixels": int(mask.sum()), "meanLum": float(sel.mean()),
            "meanHueDeg": hue_circmean(im, mask), "orangeFrac": float(orange.mean())}


def main():
    R = E / "ruler"
    base_score = json.loads((E / "base" / "score.json").read_text())
    olm = base_score["judgeV6"]["landmarks"]
    tlm = json.loads((TJ / "landmarks.json").read_text())
    bands = {
        "front": {"ours": (103, 103 + round(0.35 * (583 - 103))),
                  "tgt": (127, 127 + round(0.35 * (608 - 127)))},
        "back": {"ours": (155 - round(0.02 * 480), 155 + round(0.30 * 480)),
                 "tgt": (130 - round(0.02 * 481), 130 + round(0.30 * 481))},
    }
    print("bands (r0,r1):", json.dumps(bands), flush=True)
    print("landmarks ours:", json.dumps(olm), flush=True)
    report = {"bands": bands, "definition": (
        "OUR = capmask-white(>127) & silhouette(ID>=30,close7,dilate5) & band; "
        "TARGET = targetmask(>127) & band(H-mapped)")}
    panels = []
    for view, tmask_name, tphoto in (("front", "mask-front-v2.png", "target-front.png"),
                                     ("back", "mask-back-v3.png", "target-back.png")):
        r0, r1 = bands[view]["ours"]
        band = np.zeros((SIZE, SIZE), bool)
        band[r0:r1, :] = True
        capm = np.asarray(Image.open(R / f"capmask_{view}.png").convert("L")) > 127
        alpha = np.asarray(Image.open(E / "base" / f"{view}-id.png").convert("RGBA"),
                           dtype=np.uint8)[..., 3]
        hair = alpha >= 30
        sil = ndimage.binary_dilation(ndimage.binary_closing(hair, iterations=7), iterations=5)
        ours = capm & sil & band
        drape = sil & band
        oim = rgb(E / "base" / f"{view}.png")
        report[view] = {"ours": stats(oim, ours),
                        "drapeHairFrac": float(hair[drape].mean()),
                        "drapePx": int(drape.sum()),
                        "capPx": int(capm.sum()),
                        "capInBandPx": int((capm & band).sum())}
        # target side
        tr0, tr1 = bands[view]["tgt"]
        tband = np.zeros((SIZE, SIZE), bool)
        tband[tr0:tr1, :] = True
        tm = np.asarray(Image.open(TJ / tmask_name).convert("L")) > 127
        treg = tm & tband
        tim = rgb(T / tphoto)
        report[view]["target"] = stats(tim, treg)
        # overlay panels: beauty + region contour in red, band edges yellow
        for tag, img, reg in (("ours", oim, ours), ("tgt", tim, treg)):
            cv = (img * 255).astype(np.uint8)
            panel = Image.fromarray(cv)
            edge = reg ^ ndimage.binary_erosion(reg, iterations=2)
            ys, xs = np.where(edge)
            dr = ImageDraw.Draw(panel)
            for x, y in zip(xs.tolist(), ys.tolist()):
                panel.putpixel((x, y), (255, 0, 0))
            rr = tr0 if tag == "tgt" else r0
            rr1 = tr1 if tag == "tgt" else r1
            dr.line([(0, rr), (SIZE - 1, rr)], fill=(255, 255, 0), width=2)
            dr.line([(0, rr1), (SIZE - 1, rr1)], fill=(255, 255, 0), width=2)
            dr.text((8, 8), f"{view} {tag}: RED=region YELLOW=band[{rr},{rr1}]",
                    fill=(255, 255, 0))
            panels.append(panel)
    (R / "ruler_stats.json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps(report, indent=1), flush=True)
    sheet = Image.new("RGB", (SIZE * 2, SIZE * 2))
    sheet.paste(panels[0], (0, 0))
    sheet.paste(panels[1], (SIZE, 0))
    sheet.paste(panels[2], (0, SIZE))
    sheet.paste(panels[3], (SIZE, SIZE))
    sheet.save(E / "ruler.png")
    print("saved ruler.png", sheet.size, flush=True)


if __name__ == "__main__":
    main()
