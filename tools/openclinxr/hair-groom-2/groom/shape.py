"""Shape measures for a groom round vs the a1 targets (groom-r5 brief G4), Blender python + PIL.

    shape.py <round-dir>   -> <round-dir>/shape.json, one summary line on stdout

Targets are warped into the canonical (groom render) frame with grade/frames.json
(target px = s * canonical px + d; s > 1, so the warp only downscales).
  profile: rearmost hair column per canonical row (side view, face left), mean per 50-row
           band, round minus target in px (+ = round sits further back); rows 150-1000.
  back:    hair outline width (rightmost - leftmost hair px) per 50-row band, round and
           target, rows 150-1000; widthStep = max |d width| per 10 rows (D3 shelf proxy).
  sideburn: (a) 3D, strands.npz localPositions: lowest strand point in the band in front of
           the ear (|x| >= 40 mm, ear front - 14 mm <= y < ear front), mm below the ear top;
           p1 of z so a single stray point does not decide it. (b) image: side view cols
           485-505 (the same band projected), lowest hair row of the run that starts above
           the ear top row, in mm below the ear top row; target measured the same way.
Hair = luminance < 0.25, not green garment (G - max(R, B) > 0.03), in runs >= 3 px.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

W = Path(__file__).resolve().parents[4]
FR = json.loads((W / "tools/openclinxr/hair-groom-2/grade/frames.json").read_text())
TGT = W / "tools/openclinxr/hair-groom-2/targets"
K_M_PER_PX = FR["canonical"]["kMetresPerPx"]
Z_C = FR["canonical"]["targetZ"]
HAIR_L, MIN_RUN = 0.25, 3
BANDS = [(r, r + 50) for r in range(150, 1000, 50)]
SB_COLS = (485, 505)        # side view columns of the band ear front - 14 mm .. ear front
SB_DEPTH_MM, SB_MIN_ABS_X_MM = 14.0, 40.0


def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0


def canon_target(name, view):
    f = FR[view]
    im = Image.open(TGT / ("target-%s-a1.png" % name)).convert("RGB")
    out = im.transform((1024, 1024), Image.AFFINE, (f["s"], 0, f["dx"], 0, f["s"], f["dy"]),
                       resample=Image.BICUBIC, fillcolor=(200, 200, 200))
    return np.asarray(out, dtype=np.float64) / 255.0


def hair_mask(A):
    L = A @ np.array([0.2126, 0.7152, 0.0722])
    green = A[..., 1] - np.maximum(A[..., 0], A[..., 2]) > 0.03
    m = (L < HAIR_L) & ~green
    # drop runs shorter than MIN_RUN along rows (speckle)
    out = np.zeros_like(m)
    for r in range(m.shape[0]):
        row = m[r]
        c = 0
        while c < len(row):
            if row[c]:
                e = c
                while e < len(row) and row[e]:
                    e += 1
                if e - c >= MIN_RUN:
                    out[r, c:e] = True
                c = e
            else:
                c += 1
    return out


def rear_col(m):
    return np.array([np.where(m[r])[0].max() if m[r].any() else np.nan for r in range(m.shape[0])])


def width(m):
    w = np.full(m.shape[0], np.nan)
    for r in range(m.shape[0]):
        c = np.where(m[r])[0]
        if len(c):
            w[r] = c.max() - c.min()
    return w


def band_mean(v):
    return [None if np.all(np.isnan(v[a:b])) else round(float(np.nanmean(v[a:b])), 1) for a, b in BANDS]


def sideburn_image(m, ear_top_row):
    col = m[:, SB_COLS[0]:SB_COLS[1]].mean(1) > 0.5
    r = ear_top_row - 20
    if not col[r]:
        return None
    while r < len(col) - 1 and col[r + 1]:
        r += 1
    return (r - ear_top_row) * K_M_PER_PX * 1000.0


def main():
    rd = Path(sys.argv[1])
    st = json.loads((rd / "stats.json").read_text())
    ear = st["earLandmarksMm"]["L"]
    head_z = st["headFrame"]["origin"][2]
    ear_top_row = int(round(512 - (head_z + ear["zTopMm"] / 1000.0 - Z_C) / K_M_PER_PX))
    out = {"bands": BANDS, "earTopRowSide": ear_top_row}
    # profile
    ms, mt = hair_mask(load(rd / "side.png")), hair_mask(canon_target("profile", "side"))
    rs, rt = rear_col(ms), rear_col(mt)
    out["profileRearCol"] = {"round": band_mean(rs), "target": band_mean(rt)}
    d = rs - rt
    out["profileRearOffsetPx"] = band_mean(d)
    out["profileRearMeanAbsPx"] = round(float(np.nanmean(np.abs(d[150:1000]))), 1)
    # back
    if (rd / "back.png").exists():
        mb, mtb = hair_mask(load(rd / "back.png")), hair_mask(canon_target("back", "back"))
        wb, wt = width(mb), width(mtb)
        out["backWidth"] = {"round": band_mean(wb), "target": band_mean(wt)}
        out["backWidthDiffPx"] = band_mean(wb - wt)
        out["backWidthMeanAbsPx"] = round(float(np.nanmean(np.abs((wb - wt)[150:860]))), 1)

        def step(w):
            s = np.abs(w[160:1000] - w[150:990])
            return round(float(np.nanmax(s)), 1), int(np.nanargmax(s)) + 160
        out["backWidthStep10"] = {"round": step(wb), "target": step(wt)}
    # sideburn
    npz = np.load(rd / "strands.npz")
    P = npz["localPositions"] * 1000.0
    sb = {}
    for k, sgn in (("L", 1.0), ("R", -1.0)):
        e = st["earLandmarksMm"][k]
        x = P[:, 0] * sgn
        sel = (x >= SB_MIN_ABS_X_MM) & (P[:, 1] >= e["yFrontMm"] - SB_DEPTH_MM) & (P[:, 1] < e["yFrontMm"])
        z = P[sel, 2]
        sb[k] = round(float(e["zTopMm"] - np.percentile(z, 1)), 1) if len(z) else None
    out["sideburn3dMmBelowEarTop"] = sb
    out["sideburnImageMmBelowEarTop"] = {"round": sideburn_image(ms, ear_top_row),
                                         "target": sideburn_image(mt, ear_top_row)}
    (rd / "shape.json").write_text(json.dumps(out, indent=1))
    print("SHAPE profRearOff=%s meanAbs=%.1f | backWdiff=%s meanAbs=%s step=%s | sideburn3d=%s img=%s" % (
        out["profileRearOffsetPx"], out["profileRearMeanAbsPx"], out.get("backWidthDiffPx"),
        out.get("backWidthMeanAbsPx"), out.get("backWidthStep10"), sb, out["sideburnImageMmBelowEarTop"]))


if __name__ == "__main__":
    main()
