"""Native eye-band crops for a lid-conform sheet (no upscale, >=420 px).

tsk_083b92e9c7ca5d7b. Reads the `portrait-<label>.json` written by
render_eye_sheet.py (camera + projected eye centres + exact mmPerPx) and cuts
one square crop per eye and view from the full-resolution render. The crop
edge is passed in (`--edge`, default 420 = the sheet's stated minimum); the
box is centred on the projected eye centre and clamped inside the frame, so
the crop is always native pixels at the render's own resolution -- never a
resampled or upscaled image.

Writes `<prefix>-<label>-<view>-eye{L,R}-crop.png` plus `crops.json`
(box, native size, source full-render sha256, per-crop sha256) so a report
can cite bytes rather than a visual claim.

Usage:
  mise exec -- python3 crop_eye_sheet.py --portrait <portrait-base.json> \
    --out-dir <dir> [--prefix sheet-child] [--edge 420]
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

PARSER = argparse.ArgumentParser()
PARSER.add_argument("--portrait", required=True)
PARSER.add_argument("--out-dir", required=True)
PARSER.add_argument("--prefix", default="sheet-child")
PARSER.add_argument("--edge", type=int, default=420)
ARGS = PARSER.parse_args()

OUT = Path(ARGS.out_dir)
OUT.mkdir(parents=True, exist_ok=True)
PORTRAIT_PATH = Path(ARGS.portrait)
PORTRAIT = json.loads(PORTRAIT_PATH.read_text())


def sha256_file(path):
    h = hashlib.sha256()
    with open(str(path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


LABEL = PORTRAIT["label"]
RECORD = {
    "tool": "crop_eye_sheet.py",
    "label": LABEL,
    "edge": ARGS.edge,
    "portrait": {
        "path": str(PORTRAIT_PATH),
        "sha256": sha256_file(PORTRAIT_PATH),
        "mmPerPx": PORTRAIT["mmPerPx"],
        "resolution": PORTRAIT["resolution"],
    },
    "crops": {},
}

for view, entry in PORTRAIT["views"].items():
    full = Path(entry["path"])
    img = Image.open(full)
    width, height = img.size
    assert width == PORTRAIT["resolution"] and height == PORTRAIT["resolution"], (
        f"{full} is {width}x{height}, expected the render's "
        f"{PORTRAIT['resolution']} square (no upscale: crop the native render)"
    )
    half = ARGS.edge // 2
    for eye, key in (("eyeL", "leftEyePx"), ("eyeR", "rightEyePx")):
        cx, cy = entry[key]
        x0 = int(round(cx)) - half
        y0 = int(round(cy)) - half
        x0 = max(0, min(x0, width - ARGS.edge))
        y0 = max(0, min(y0, height - ARGS.edge))
        box = (x0, y0, x0 + ARGS.edge, y0 + ARGS.edge)
        crop = img.crop(box)
        name = f"{ARGS.prefix}-{LABEL}-{view}-{eye}-crop.png"
        dest = OUT / name
        crop.save(dest)
        RECORD["crops"][name] = {
            "view": view,
            "eye": eye,
            "box": list(box),
            "size": list(crop.size),
            "source": {"path": str(full), "sha256": sha256_file(full)},
            "sha256": sha256_file(dest),
        }

(OUT / "crops.json").write_text(json.dumps(RECORD, indent=1, sort_keys=True) + "\n")
print("CROPS_OK " + json.dumps({k: v["sha256"][:16] for k, v in RECORD["crops"].items()}))
