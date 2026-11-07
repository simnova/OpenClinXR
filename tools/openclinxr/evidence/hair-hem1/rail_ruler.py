#!/usr/bin/env python3
"""hair-hem1 STEP 1: rail ruler (system python, numpy+cv2+PIL).

Rail = connected hair-mask region strictly below the sheet's hem line that
is narrower than 15 px (bounding-box width), plus total rail area.

Hem line definition (per view, stated in rails_base.json + RESULT.txt):
  y_bottom(x) = lowest hair-mask row in column x (-1 if column empty).
  y_hem(x)    = median filter of y_bottom over a 61-px column window, then
                11-px uniform smoothing, with empty columns filled by nearest
                valid neighbour BEFORE filtering.
  Rationale: rails are <15 px wide, so a 61-wide median cannot follow them;
  y_hem tracks the lowest CONTINUOUS sheet edge. Rail candidates = hair
  pixels with row > y_hem(x) + 2 (2 px tolerance). 8-way connected
  components of the candidates; width<15 px -> rail (counted), else
  sheet-edge chunk (reported for context only).

Applied identically to our renders (alpha>=230 on *-id.png) and to the TS
target masks (mask-*-v*.png, white=hair).
Overlay E/rail-ruler.png: beauty frame + hem line (green) + rail boxes (red)
+ wide below-hem chunks (yellow). Rows: base back/front/profile, target
back/front/profile.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-hem1")
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
S = 1024
MED_W = 61
SMOOTH_W = 11
TOL = 2
MAX_W = 15

VIEWS = ["back", "front", "profile_90"]
TMASK = {"back": "mask-back-v3.png", "front": "mask-front-v2.png",
         "profile_90": "mask-profile-v2.png"}
TPHOTO = {"back": "target-back.png", "front": "target-front.png",
          "profile_90": "target-profile.png"}


def load_mask(path: Path, target: bool) -> np.ndarray:
    if target:
        m = np.asarray(Image.open(path).convert("L")) > 127
    else:
        m = np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 230
    assert m.shape == (S, S), (path, m.shape)
    return m


def hem_line(mask: np.ndarray) -> np.ndarray:
    yb = np.full(S, -1, dtype=float)
    cols = np.where(mask.any(axis=0))[0]
    for x in cols:
        yb[x] = float(np.where(mask[:, x])[0].max())
    # fill empties by nearest valid neighbour
    valid = yb >= 0
    yf = yb.copy()
    if valid.any():
        idx = np.arange(S)
        nearest = np.where(valid, idx, -1)
        nearest = np.maximum.accumulate(nearest)
        nearest2 = np.where(valid, idx, S)
        nearest2 = np.minimum.accumulate(nearest2[::-1])[::-1]
        use_left = (idx - np.where(nearest < 0, 0, nearest)) <= (
            np.where(nearest2 > S - 1, S - 1, nearest2) - idx)
        pick = np.where(use_left, np.clip(nearest, 0, S - 1),
                        np.clip(nearest2, 0, S - 1))
        yf[~valid] = yb[pick[~valid]]
    else:
        yf[:] = 0.0
    k = MED_W // 2
    pad = np.pad(yf, (k, k), mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(pad, MED_W)
    ymed = np.median(win, axis=1)
    kk = np.ones(SMOOTH_W) / SMOOTH_W
    return np.convolve(np.pad(ymed, (SMOOTH_W // 2,) * 2, mode="edge"),
                       kk, mode="valid")


def ruler(mask: np.ndarray) -> dict:
    hem = hem_line(mask)
    below = np.zeros_like(mask, dtype=bool)
    xs = np.arange(S)
    hh = np.clip((hem + TOL).astype(int), 0, S)
    for x in range(S):
        if hh[x] < S - 1:
            below[hh[x] + 1:, x] = mask[hh[x] + 1:, x]
    n, lab, stats, _ = cv2.connectedComponentsWithStats(
        below.astype(np.uint8), connectivity=8)
    rails, chunks = [], []
    for i in range(1, n):
        w = int(stats[i, cv2.CC_STAT_WIDTH])
        rec = {"area": int(stats[i, cv2.CC_STAT_AREA]), "width": w,
               "height": int(stats[i, cv2.CC_STAT_HEIGHT]),
               "left": int(stats[i, cv2.CC_STAT_LEFT]),
               "top": int(stats[i, cv2.CC_STAT_TOP])}
        (rails if w < MAX_W else chunks).append(rec)
    rail_area = int(sum(r["area"] for r in rails))
    return {"railComponents": len(rails), "railAreaPx": rail_area,
            "railBoxes": rails,
            "wideChunks": len(chunks),
            "wideChunkAreaPx": int(sum(c["area"] for c in chunks)),
            "hairPixels": int(mask.sum()),
            "hemLine": [round(float(v), 1) for v in hem]}


def overlay(beauty: np.ndarray, res: dict) -> np.ndarray:
    img = beauty.copy()
    hem = np.array(res["hemLine"])
    for x in range(0, S, 2):
        cv2.circle(img, (x, int(round(hem[x]))), 1, (0, 255, 0), -1)
    for b in res["railBoxes"]:
        cv2.rectangle(img, (b["left"], b["top"]),
                      (b["left"] + b["width"] - 1, b["top"] + b["height"] - 1),
                      (255, 0, 0), 2)
    return img


def main() -> None:
    out = {"method": ("y_bottom(x)=lowest hair row; y_hem=61-wide median + "
                      "11-wide smooth of nearest-filled y_bottom; rail = "
                      "8-way CC of hair pixels > y_hem+2 with bbox width<15px"),
           "medWindow": MED_W, "smoothWindow": SMOOTH_W, "tolPx": TOL,
           "maxRailWidthPx": MAX_W}
    panels = []
    for v in VIEWS:
        m = load_mask(E / "base" / f"{v}-id.png", False)
        r = ruler(m)
        r.pop("hemLine")
        out[f"base_{v}"] = r
        full = ruler(m)
        beau = np.asarray(Image.open(E / "base" / f"{v}.png").convert("RGB"))
        panels.append(overlay(beau, full))
        print(f"BASE {v}: rails={r['railComponents']} area={r['railAreaPx']} "
              f"wideChunks={r['wideChunks']} wideArea={r['wideChunkAreaPx']}",
              flush=True)
    for v in VIEWS:
        m = load_mask(J / TMASK[v], True)
        r = ruler(m)
        r.pop("hemLine")
        out[f"target_{v}"] = r
        full = ruler(m)
        photo = np.asarray(Image.open(T / TPHOTO[v]).convert("RGB"))
        panels.append(overlay(photo, full))
        print(f"TS {v}: rails={r['railComponents']} area={r['railAreaPx']} "
              f"wideChunks={r['wideChunks']} wideArea={r['wideChunkAreaPx']}",
              flush=True)
    (E / "rails_base.json").write_text(json.dumps(out, indent=2) + "\n")
    sheet = np.vstack([np.hstack(panels[:3]), np.hstack(panels[3:])])
    Image.fromarray(sheet[::2, ::2]).save(E / "rail-ruler.png")
    print("WROTE", E / "rails_base.json", E / "rail-ruler.png", flush=True)


if __name__ == "__main__":
    main()
