#!/usr/bin/env python3
"""hair-hem2 STEP 1: shape ruler (system python, numpy+PIL; no cv2 needed).

Per view (back, front, profile_90): register our hair mask into the TARGET
frame with the score.py-judge similarity (uniform scale + translation from
projected-landmark triples, NEAREST resample), then over the lower 40% of
TARGET hair height compare:
  y_bottom(x) = lowest hair row per column  -> MAE px (columns where both valid)
  w(y)        = hair pixel count per row    -> MAE px (all lower-40% rows)
Lower 40%: rows y >= y_top + 0.6*(y_bot - y_top) from the TARGET mask rows
that contain hair. Coverage (fraction of target columns with ours present)
reported alongside so a missing column cannot hide.

Overlays E/shape-ruler.png: rows back/front/profile, cols
target-photo+both-outlines | ours-beauty-registered+both-outlines
(green=target, red=ours). READ THE PNG BEFORE USING THE NUMBERS.

Usage: python3 shape_ruler.py <tag> [<tag> ...]
  tag = subdir of E holding <view>-id.png (+ beauty <view>.png for overlay);
  view file names: back/front/profile_90 map to target back/front/profile.
  Writes E/shape_<tag>.json; overlay only for the first tag.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-hem2")
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
S = 1024

VIEWS = ["back", "front", "profile_90"]
TMASK = {"back": "mask-back-v3.png", "front": "mask-front-v2.png",
         "profile_90": "mask-profile-v2.png"}
TPHOTO = {"back": "target-back.png", "front": "target-front.png",
          "profile_90": "mask-profile-v2.png"}  # placeholder, fixed below
TPHOTO = {"back": "target-back.png", "front": "target-front.png",
          "profile_90": "target-profile.png"}
# score.py render_triples (hair-curtain3/landmarks.json judge) + judge target
# triples (target-set-back/landmarks.json): the same triples score.py v3
# registers with (register_view: scale+translation, no rotation).
RENDER_TRIPLE = {
    "back": (155.0, 651.0, 512.0),
    "front": (103.0, 583.0, 512.0),
    "profile_90": (131.0, 561.0, 209.0),
}
TARGET_TRIPLE = {
    "back": (130.0, 646.0, 513.0),
    "front": (127.0, 608.0, 513.0),
    "profile_90": (125.0, 577.0, 344.0),
}


def register_mask(mask: np.ndarray, a_r, b_r, c_r, a_t, b_t, c_t):
    H_t = float(b_t - a_t)
    H_r = float(b_r - a_r)
    s = H_t / H_r
    tx = float(c_t) - s * float(c_r)
    ty = float(a_t) - s * float(a_r)
    inv = (1.0 / s, 0.0, -tx / s, 0.0, 1.0 / s, -ty / s)
    m = np.array(Image.fromarray((mask.astype(np.uint8) * 255)).transform(
        (S, S), Image.AFFINE, inv, Image.NEAREST)) > 127
    return m, {"scale": s, "tx": tx, "ty": ty}


def register_beauty(beau: np.ndarray, tr):
    s, tx, ty = tr["scale"], tr["tx"], tr["ty"]
    inv = (1.0 / s, 0.0, -tx / s, 0.0, 1.0 / s, -ty / s)
    return np.array(Image.fromarray(beau).transform(
        (S, S), Image.AFFINE, inv, Image.BILINEAR))


def y_bottom(mask: np.ndarray) -> np.ndarray:
    yb = np.full(S, -1, dtype=int)
    cols = np.where(mask.any(axis=0))[0]
    for x in cols:
        yb[x] = int(np.where(mask[:, x])[0].max())
    return yb


def ruler(ours_reg: np.ndarray, tgt: np.ndarray) -> dict:
    rows_t = np.where(tgt.any(axis=1))[0]
    y_top, y_bot = int(rows_t.min()), int(rows_t.max())
    lo = int(round(y_top + 0.6 * (y_bot - y_top)))
    yb_o, yb_t = y_bottom(ours_reg), y_bottom(tgt)
    vt = yb_t >= 0
    vo = yb_o >= 0
    both = vt & vo
    # restrict to lower-40% hem columns: target bottom edge at/below lo
    hem_t = vt & (yb_t >= lo)
    hem_both = hem_t & vo
    mae_y = float(np.abs(yb_o[hem_both].astype(float) - yb_t[hem_both].astype(float)).mean()) if hem_both.sum() else float("nan")
    w_o = ours_reg[lo:, :].sum(axis=1).astype(float)
    w_t = tgt[lo:, :].sum(axis=1).astype(float)
    mae_w = float(np.abs(w_o - w_t).mean())
    return {
        "yTopTgt": y_top, "yBotTgt": y_bot, "lower40Lo": lo,
        "nTgtHemCols": int(hem_t.sum()), "nBothHemCols": int(hem_both.sum()),
        "coverage": float(hem_both.sum() / max(int(hem_t.sum()), 1)),
        "yBottomMAEpx": round(mae_y, 2),
        "widthMAEpx": round(mae_w, 2),
        "widthMeanTgtPx": round(float(w_t.mean()), 1),
        "widthMeanOursPx": round(float(w_o.mean()), 1),
    }


def outline_points(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    yb = y_bottom(mask)
    xs = np.where(yb >= 0)[0]
    return xs, yb[xs]


def draw_outlines(img: np.ndarray, tgt: np.ndarray, ours: np.ndarray) -> np.ndarray:
    out = img.copy()
    h, w, _ = out.shape
    for mask, col in ((tgt, (0, 255, 0)), (ours, (255, 0, 0))):
        xs, ys = outline_points(mask)
        for x, y in zip(xs[::2], ys[::2]):
            xx, yy = int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1))
            out[yy - 1:yy + 2, xx - 1:xx + 2] = col
        # width ticks at lower-40% mid: left/right extents every 40 rows
        rows = np.where(mask.any(axis=1))[0]
        if len(rows):
            lo = int(round(rows.min() + 0.6 * (rows.max() - rows.min())))
            for y in range(lo, h, 40):
                xsrow = np.where(mask[y])[0]
                if len(xsrow):
                    for xx in (int(xsrow.min()), int(xsrow.max())):
                        out[y - 2:y + 3, xx - 2:xx + 3] = col
    return out


def main() -> None:
    tags = sys.argv[1:] or ["base"]
    tgt_masks = {v: np.asarray(Image.open(J / TMASK[v]).convert("L")) > 127
                 for v in VIEWS}
    for v in VIEWS:
        assert tgt_masks[v].shape == (S, S), (v, tgt_masks[v].shape)
    first_panels = []
    for tag in tags:
        d = E / tag if (E / tag / "back-id.png").exists() else E / "scores" / tag
        res: dict = {
            "method": ("register ours->target by judge similarity "
                       "(scale+translation from projected-landmark triples, "
                       "NEAREST); lower40 = rows >= y_top+0.6*(y_bot-y_top) of "
                       "TARGET hair rows; yBottomMAE over hem columns "
                       "(target edge at/below lower40 top) where both valid; "
                       "widthMAE = mean|w_ours-w_tgt| over lower40 rows"),
            "renderTriple": {v: list(RENDER_TRIPLE[v]) for v in VIEWS},
            "targetTriple": {v: list(TARGET_TRIPLE[v]) for v in VIEWS},
        }
        for v in VIEWS:
            ours = np.asarray(Image.open(d / f"{v}-id.png").convert("RGBA"))[..., 3] >= 230
            a_r, b_r, c_r = RENDER_TRIPLE[v]
            a_t, b_t, c_t = TARGET_TRIPLE[v]
            ours_reg, tr = register_mask(ours, a_r, b_r, c_r, a_t, b_t, c_t)
            r = ruler(ours_reg, tgt_masks[v])
            r["transform"] = {k: round(float(x), 4) for k, x in tr.items()}
            res[v] = r
            print(f"{tag} {v}: yBottomMAE={r['yBottomMAEpx']}px "
                  f"(n={r['nBothHemCols']}/{r['nTgtHemCols']}) "
                  f"widthMAE={r['widthMAEpx']}px "
                  f"(w {r['widthMeanOursPx']} vs {r['widthMeanTgtPx']})", flush=True)
            if tag == tags[0]:
                photo = np.asarray(Image.open(T / TPHOTO[v]).convert("RGB"))
                beau = np.asarray(Image.open(d / f"{v}.png").convert("RGB"))
                beau_reg = register_beauty(beau, tr)
                first_panels.append(draw_outlines(photo, tgt_masks[v], ours_reg))
                first_panels.append(draw_outlines(beau_reg, tgt_masks[v], ours_reg))
        (E / f"shape_{tag.replace('/', '_')}.json").write_text(
            json.dumps(res, indent=2) + "\n")
        print("WROTE", E / f"shape_{tag.replace('/', '_')}.json", flush=True)
    if first_panels:
        rows = [np.hstack(first_panels[i:i + 2]) for i in range(0, 6, 2)]
        sheet = np.vstack(rows)
        Image.fromarray(sheet[::2, ::2]).save(E / "shape-ruler.png")
        print("WROTE", E / "shape-ruler.png", sheet.shape, flush=True)


if __name__ == "__main__":
    main()
