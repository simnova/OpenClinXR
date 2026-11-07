#!/usr/bin/env python3
"""hair-cover1 STEP 4: look-sheet (system python).

Rows TS | base | best ; cols front, profile_90, back, profile hole overlay,
back crop (320,280,704,664). Hole overlay = beauty with hair mask tinted and
hole components red (same holes.py definition, alpha>=230, 8-way, enclosed).
"""
import numpy as np
import cv2
from pathlib import Path
from PIL import Image, ImageDraw

E = Path("tools/openclinxr/evidence/hair-cover1")
TS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TSM = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
W = 320  # cell width; beauty frames resized 1024->W for sheet


def beauty(path):
    return Image.open(path).convert("RGB").resize((W, W), Image.LANCZOS)


def hole_overlay(beauty_path, id_path):
    b = np.asarray(Image.open(beauty_path).convert("RGB"))
    a = np.asarray(Image.open(id_path).convert("RGBA"))[..., 3]
    hair = a >= 230
    bg = (~hair).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bg, connectivity=8)
    h, w = hair.shape
    border = set(np.unique(np.concatenate(
        [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])).tolist())
    hole = np.zeros_like(hair, bool)
    for i in range(1, n):
        if i not in border:
            hole |= (labels == i)
    ov = b.astype(float) * 0.45
    ov[hair] = ov[hair] * 0.35 + np.array([40, 180, 255]) * 0.65
    ov[hole] = np.array([255, 30, 30])
    return Image.fromarray(ov.astype(np.uint8)).resize((W, W), Image.LANCZOS)


def crop(path, box=(320, 280, 704, 664)):
    im = Image.open(path).convert("RGB").crop(box)
    return im.resize((W, int(W * (box[3] - box[1]) / (box[2] - box[0]))),
                     Image.LANCZOS)


rows = []
# TS row
ts_row = [beauty(TS / "target-front.png"), beauty(TS / "target-profile.png"),
          beauty(TS / "target-back.png")]
tm = np.asarray(Image.open(TSM / "mask-profile-v2.png").convert("L")) > 127
tm_im = Image.fromarray(((~tm) * 40 + tm * 200).astype(np.uint8), "L")
tm_im = tm_im.resize((W, W), Image.NEAREST).convert("RGB")
ts_row.append(tm_im)
ts_row.append(crop(TS / "target-back.png"))
rows.append(("TS", ts_row))

for tag, sdir in (("base", E / "base"), ("best", E / "scores/best4")):
    row = [beauty(sdir / "front.png"), beauty(sdir / "profile_90.png"),
           beauty(sdir / "back.png"),
           hole_overlay(sdir / "profile_90.png", sdir / "profile_90-id.png"),
           crop(sdir / "back.png")]
    rows.append((tag, row))

labels = ["front", "profile_90", "back", "profile holes", "back crop"]
ch = rows[0][1][3].size[1]
sheet = Image.new("RGB", (W * 5 + 90, 30 + (W + 8) * 3 + ch + 8), (18, 18, 18))
dr = ImageDraw.Draw(sheet)
for j, lab in enumerate(labels):
    dr.text((90 + j * W + 8, 8), lab, fill=(0, 255, 255))
y = 30
for tag, cells in rows:
    dr.text((8, y + 8), tag, fill=(255, 255, 0))
    hmax = 0
    for j, im in enumerate(cells):
        sheet.paste(im, (90 + j * W, y))
        hmax = max(hmax, im.size[1])
    y += hmax + 8
sheet.save(E / "look-sheet.png")
print("WROTE", E / "look-sheet.png", sheet.size)
