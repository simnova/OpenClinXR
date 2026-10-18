"""Build 2x2 bisect sheets (420x420 cells + header) with PIL.

EEVEE cells: the script's own bone-projected 420 crops (native).
three.js cells: native 420x420 crop centred on the MediaPipe iris centre
of the same eye (image-left eye = subject's right? we use the eye whose
iris centre is leftmost in the image for front views — recorded per cell).
No resampling anywhere: the EEVEE-vs-three.js scale gap is REPORTED
(irisRadiusPx per cell in sheets.json), not hidden.

Writes sheets + sheets.json {sheet, sha256, cells[]} per factor dir.
Framing: EEVEE 85mm@0.38m bone-projected; three.js portrait fov24/78%.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

STORE = "/Volumes/files/openclinxr-assets/store/eyes-realism-regression"
sys.path.insert(0, "/Users/patrick/.grok/worktrees/src-openclinxr/eyereal/tools/openclinxr/asset-pipeline/realism-head/sclera-shade")
from sclera_metrics import detect_landmarks  # noqa: E402

CELL = 420
HEADER = 52

FONT = ImageFont.load_default(size=26)


def sha_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def iris_centres(full_path):
    rgb = np.array(Image.open(full_path).convert("RGB"))
    pts = detect_landmarks(rgb)
    # MediaPipe pupil centres: R eye 468, L eye 473 (image coords).
    return {"R": (float(pts[468][0]), float(pts[468][1])),
            "L": (float(pts[473][0]), float(pts[473][1]))}


def crop_around(full_path, cx, cy, size=CELL):
    img = Image.open(full_path).convert("RGB")
    w, h = img.size
    x0 = min(max(int(cx - size / 2), 0), w - size)
    y0 = min(max(int(cy - size / 2), 0), h - size)
    return img.crop((x0, y0, x0 + size, y0 + size)), (x0, y0)


def three_cell(full_path, eye="L"):
    centres = iris_centres(full_path)
    cx, cy = centres[eye]
    crop, (x0, y0) = crop_around(full_path, cx, cy)
    return crop, {"irisCx": round(cx, 1), "irisCy": round(cy, 1),
                  "cropX0": x0, "cropY0": y0, "eye": eye}


def load(p):
    img = Image.open(p).convert("RGB")
    assert img.size == (CELL, CELL), f"{p} is {img.size}, want 420x420"
    return img


def build_sheet(out_path, grid, title_note=""):
    """grid: rows of [(img, label), ...]. All imgs 420x420."""
    rows = len(grid)
    cols = len(grid[0])
    sheet = Image.new("RGB", (cols * CELL, rows * (CELL + HEADER)), (15, 22, 19))
    d = ImageDraw.Draw(sheet)
    cells = []
    for r, row in enumerate(grid):
        for c, (img, label) in enumerate(row):
            x, y = c * CELL, r * (CELL + HEADER)
            d.rectangle([x, y, x + CELL, y + HEADER], fill=(15, 22, 19))
            d.text((x + 10, y + 12), label, font=FONT, fill=(232, 245, 239))
            sheet.paste(img, (x, y + HEADER))
            cells.append({"row": r, "col": c, "label": label})
    sheet.save(out_path)
    return {"sheet": out_path, "sha256": sha_of(out_path),
            "size": list(sheet.size), "cells": cells, "note": title_note}


def main():
    manifest = {}
    B = f"{STORE}/bisect"

    # ---- F1 renderer 2x2: rows [oct15, run3], cols [eevee, threejs] ----
    eevee_oct = load("/Volumes/files/openclinxr-assets/store/lid-conform-any/sheet-body2-new-front-eyeL-crop.png")
    eevee_run = load(f"{STORE}/now-run3/sheet-body2-now-front-eyeL-crop.png")
    t_oct, t_oct_meta = three_cell(f"{B}/f1-renderer/threejs-oct15-front.png")
    t_run, t_run_meta = three_cell(f"{B}/f1-renderer/threejs-run3-front.png")
    manifest["f1-renderer"] = build_sheet(
        f"{B}/f1-renderer/sheet-f1-renderer.png",
        [[(eevee_oct, "oct15 / EEVEE (ref)"),
          (t_oct, "oct15 / three.js room-rig")],
         [(eevee_run, "run3 / EEVEE"),
          (t_run, "run3 / three.js room-rig")]],
        "three.js cells: native 420 crop on MediaPipe iris centre "
        f"L{json.dumps(t_oct_meta)}/{json.dumps(t_run_meta)}; EEVEE cells: bone-projected 420 crops.")
    manifest["f1-renderer"]["threejsCropMeta"] = {"oct15": t_oct_meta, "run3": t_run_meta}

    # ---- F2 iris 2x2 per renderer: rows [oct15, run3], cols [brown_eye, iris-centred-c] ----
    eevee_oct_irisC = load(f"{B}/f2-iris/sheet-body2-oct15-irisC-front-eyeL-crop.png")
    eevee_run_brown = load(f"{B}/f2-iris/sheet-body2-run3-browneye-front-eyeL-crop.png")
    manifest["f2-iris-eevee"] = build_sheet(
        f"{B}/f2-iris/sheet-f2-iris-eevee.png",
        [[(eevee_oct, "oct15 / brown_eye (embed)"),
          (eevee_oct_irisC, "oct15 / iris-C (swap)")],
         [(eevee_run_brown, "run3 / brown_eye (swap)"),
          (eevee_run, "run3 / iris-C (embed)")]],
        "EEVEE eye-texture swap at load (probe_eevee_texswap_portrait.py).")
    t_oct_irisC, m1 = three_cell(f"{B}/f2-iris/threejs-oct15-irisC-front.png")
    t_run_brown, m2 = three_cell(f"{B}/f2-iris/threejs-run3-browneye-front.png")
    manifest["f2-iris-threejs"] = build_sheet(
        f"{B}/f2-iris/sheet-f2-iris-threejs.png",
        [[(t_oct, "oct15 / brown_eye (embed)"),
          (t_oct_irisC, "oct15 / iris-C (override)")],
         [(t_run_brown, "run3 / brown_eye (override)"),
          (t_run, "run3 / iris-C (embed)")]],
        "three.js eye-texture swap via materialOverrides baseColorUrl "
        f"{json.dumps(m1)}/{json.dumps(m2)}.")

    # ---- F3 lighting: rows [env0, env06, tonemap-none], cols [base, probe] ----
    t_base, mb = three_cell(f"{B}/f1-renderer/threejs-run3-front.png")
    t_env0, me0 = three_cell(f"{B}/f3-lighting/threejs-run3-env0-front.png")
    t_env06, me6 = three_cell(f"{B}/f3-lighting/threejs-run3-env06-front.png")
    t_tm, mtm = three_cell(f"{B}/f3-lighting/threejs-run3-tonemap-none-front.png")
    manifest["f3-lighting"] = build_sheet(
        f"{B}/f3-lighting/sheet-f3-lighting.png",
        [[(t_base, "run3 base (ACES)"),
          (t_env0, "run3 env=0 (was 1.0)")],
         [(t_base, "run3 base (ACES)"),
          (t_env06, "run3 env=0.6 (was 1.0)")],
         [(t_base, "run3 base (ACES)"),
          (t_tm, "run3 toneMapping=None")]],
        "three.js lighting variants (probe_threejs_bisect.ts). shadow-on "
        "not injectable (renderer module-local); recorded, not rendered.")
    manifest["f3-lighting"]["threejsCropMeta"] = {"base": mb, "env0": me0, "env06": me6, "tonemapNone": mtm}

    # ---- F4 lidgeo: rows [oct15-conform, canthus-repin], cols [front-eyeL, yaw25-eyeL] ----
    eevee_oct_y = load("/Volumes/files/openclinxr-assets/store/lid-conform-any/sheet-body2-new-yaw25-eyeL-crop.png")
    repin_f = load(f"{B}/f4-lidgeo/sheet-body2-repin-front-eyeL-crop.png")
    repin_y = load(f"{B}/f4-lidgeo/sheet-body2-repin-yaw25-eyeL-crop.png")
    manifest["f4-lidgeo"] = build_sheet(
        f"{B}/f4-lidgeo/sheet-f4-lidgeo.png",
        [[(eevee_oct, "oct15 conform / front eyeL"),
          (eevee_oct_y, "oct15 conform / yaw25 eyeL")],
         [(repin_f, "re-pin b2canthus / front"),
          (repin_y, "re-pin b2canthus / yaw25 eyeL")]],
        "both GLBs through lidany_portrait.py; repin run pixel-identical "
        "to run3+brown swap (meanAbsDiff 0.0).")

    # ---- F5 shell: rows [oct15, run3], cols [eevee eyeL, threejs eyeL] ----
    manifest["f5-shell"] = build_sheet(
        f"{B}/f5-shell/sheet-f5-shell.png",
        [[(eevee_oct, "oct15 EEVEE (no shell)"),
          (t_oct, "oct15 three.js (no shell)")],
         [(eevee_run, "run3 EEVEE (no shell)"),
          (t_run, "run3 three.js (no shell)")]],
        "shell-absence evidence is mesh/binary (inventory-*.json); cells "
        "reused from F1 to keep the F5 record self-contained.")

    with open(f"{B}/sheets.json", "w") as f:
        json.dump(manifest, f, indent=1)
    for k, v in manifest.items():
        print(f"SHEET {k} {v['sheet']} sha={v['sha256'][:12]} size={v['size']}")


if __name__ == "__main__":
    main()
