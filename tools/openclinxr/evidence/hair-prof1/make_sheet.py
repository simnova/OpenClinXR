#!/usr/bin/env python3
"""hair-prof1 STEP 3 look sheet: rows TS | b9 | best(combo);
cols front, profile_90, back + profile/front overlays (ours red, TS green
on the TS photo). System python (PIL + numpy)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T5 = ROOT / "tools/openclinxr/evidence/hair-tilt5"
TS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TM = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
SIZE = 1024

RENDER = {"front": (103.0, 583.0, 512.0), "profile": (131.0, 561.0, 209.0)}
T_HAIR = {"front": (127.0, 608.0, 513.0), "profile": (125.0, 577.0, 344.0)}
H_MM = 210.65914630889893
TMASK = {"front": TM / "mask-front-v2.png", "profile": TM / "mask-profile-v2.png"}


def _window_sum(b, k):
    r = k // 2
    p = np.pad(b.astype(np.float64), r, mode="constant")
    cs = np.cumsum(np.cumsum(p, axis=0), axis=1)
    cs = np.pad(cs, ((1, 0), (1, 0)), mode="constant")
    h, w = b.shape
    return cs[k:k + h, k:k + w] - cs[0:h, k:k + w] - cs[k:k + h, 0:w] + cs[0:h, 0:w]


def closing(b, r=3):
    return (_window_sum(_window_sum(b, 2 * r + 1) > 0, 2 * r + 1) >= (2 * r + 1) ** 2)


def load_id(p):
    return np.array(Image.open(p))[:, :, 3].astype(float) >= 0.9 * 255


def register(m, a_r, b_r, c_r, a_t, b_t, c_t):
    s = (b_t - a_t) / (b_r - a_r)
    tx, ty = c_t - s * c_r, a_t - s * a_r
    inv = (1 / s, 0, -tx / s, 0, 1 / s, -ty / s)
    return np.array(Image.fromarray(m.astype(np.uint8) * 255).transform(
        (SIZE, SIZE), Image.AFFINE, inv, Image.NEAREST)) > 127


def overlay(view, ours_id):
    m = load_id(ours_id)
    t = np.array(Image.open(TMASK[view]).convert("L")) > 127
    if view == "front":
        m = closing(m)
        t = closing(t)
        a_h, b_h, c_h = T_HAIR["front"]
        off = 10.0 * (b_h - a_h) / H_MM
        mo = register(m, *RENDER["front"], a_h + off, b_h, c_h)
    else:
        mo = register(m, *RENDER["profile"], *T_HAIR["profile"])
    photo = np.array(Image.open(
        TS / ("target-front.png" if view == "front" else "target-profile.png")).convert("RGB")).copy()
    bt = t & ~(_window_sum(t, 3) >= 9)
    bo = mo & ~(_window_sum(mo, 3) >= 9)
    photo[bt] = (0, 255, 0)
    photo[bo] = (255, 0, 0)
    return Image.fromarray(photo)


def main():
    ROWS = (("TS", None),
            ("b9", T5 / "scores/s5"),
            ("best-combo", E / "scores/combo"))
    TSNAMES = {"front": "target-front.png", "profile_90": "target-profile.png", "back": "target-back.png"}
    COLS = ("front", "profile_90", "back", "profile-overlay", "front-overlay")
    TILE, LABEL = 256, 28
    canvas = Image.new("RGB", (TILE * len(COLS), (TILE + LABEL) * len(ROWS)), "white")
    draw = ImageDraw.Draw(canvas)
    ov = {"profile-overlay": overlay("profile", E / "scores/combo/profile_90-id.png"),
          "front-overlay": overlay("front", E / "scores/combo/front-id.png")}
    for ri, (name, src) in enumerate(ROWS):
        for ci, col in enumerate(COLS):
            x, y = ci * TILE, ri * (TILE + LABEL)
            draw.text((x + 7, y + 8), f"{name} | {col}", fill="black")
            if col in ov:
                v = "profile" if col == "profile-overlay" else "front"
                rid = "profile_90-id.png" if v == "profile" else "front-id.png"
                if name == "best-combo":
                    im = ov[col]
                elif name == "b9":
                    im = overlay(v, T5 / "scores/s5" / rid)
                else:  # TS row: TS photo + TS boundary green only
                    t = np.array(Image.open(TMASK[v]).convert("L")) > 127
                    if v == "front":
                        t = closing(t)
                    photo = np.array(Image.open(
                        TS / ("target-front.png" if v == "front" else "target-profile.png")
                    ).convert("RGB")).copy()
                    bt = t & ~(_window_sum(t, 3) >= 9)
                    photo[bt] = (0, 255, 0)
                    im = Image.fromarray(photo)
            elif name == "TS":
                im = Image.open(TS / TSNAMES[col]).convert("RGB")
            else:
                im = Image.open(src / f"{col}.png").convert("RGB")
            canvas.paste(im.resize((TILE, TILE), Image.Resampling.LANCZOS), (x, y + LABEL))
    canvas.save(E / "look-sheet.png")
    print("WROTE", E / "look-sheet.png", canvas.size, flush=True)


if __name__ == "__main__":
    main()
