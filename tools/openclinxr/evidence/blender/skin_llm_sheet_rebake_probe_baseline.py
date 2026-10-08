"""Procedural skin-sheet proxy; never a generated-image or Blender result.

Builds: baseline 4-quadrant PBR sheet (albedo|normal / roughness|cavity),
baseline 2-up T-pose front/back, enhanced ("LLM") quad sheet with added
micro-detail, rebaked T-pose, and a realism judgment JSON.
Outputs are isolated below procedural-proxy, or an explicit --out-dir.
Never writes the retained generated-image experiment's evidence directory.
"""
from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

EVIDENCE = Path(__file__).resolve().parents[4] / "docs" / "openclinxr" / "skin-llm-sheet-rebake-2026-09-28"
OUT = EVIDENCE / "procedural-proxy"
W = H = 512
rng = random.Random(20260928)

SKIN = (198, 148, 118)


def _noise(draw: ImageDraw.ImageDraw, box, n: int, color, alpha: int = 40):
    for _ in range(n):
        x = rng.randint(box[0], box[2])
        y = rng.randint(box[1], box[3])
        r = rng.randint(1, 3)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color + (alpha,))


def albedo(detail: int) -> Image.Image:
    img = Image.new("RGBA", (W, H), SKIN + (255,))
    d = ImageDraw.Draw(img, "RGBA")
    # large-scale tonal variation
    for i in range(24):
        x, y = rng.randint(0, W), rng.randint(0, H)
        r = rng.randint(40, 120)
        tint = tuple(max(0, c + rng.randint(-14, 14)) for c in SKIN)
        d.ellipse([x - r, y - r, x + r, y + r], fill=tint + (28,))
    _noise(d, (0, 0, W, H), detail, (120, 80, 60))
    _noise(d, (0, 0, W, H), detail // 2, (235, 200, 170))
    # pore grid
    for y in range(0, H, 8):
        for x in range(0, W, 8):
            v = rng.randint(-12, 12)
            d.point((x, y), fill=(SKIN[0] + v, SKIN[1] + v, SKIN[2] + v, 255))
    return img


def normal_map() -> Image.Image:
    img = Image.new("RGBA", (W, H), (128, 128, 255, 255))
    d = ImageDraw.Draw(img)
    for y in range(0, H, 16):
        for x in range(0, W, 16):
            v = int(128 + 40 * math.sin(x / 24.0) * math.cos(y / 24.0))
            d.rectangle([x, y, x + 15, y + 15], fill=(v, v, 255, 255))
    return img


def roughness(detail: int) -> Image.Image:
    img = Image.new("RGBA", (W, H), (150, 150, 150, 255))
    d = ImageDraw.Draw(img, "RGBA")
    _noise(d, (0, 0, W, H), detail, (110, 110, 110))
    _noise(d, (0, 0, W, H), detail // 3, (190, 190, 190))
    return img


def cavity(detail: int) -> Image.Image:
    img = Image.new("RGBA", (W, H), (220, 220, 220, 255))
    d = ImageDraw.Draw(img, "RGBA")
    _noise(d, (0, 0, W, H), detail, (90, 90, 90))
    return img


def quad(detail: int, labels=("albedo", "normal", "roughness", "cavity")) -> Image.Image:
    sheet = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 255))
    sheet.paste(albedo(detail), (0, 0))
    sheet.paste(normal_map(), (W, 0))
    sheet.paste(roughness(detail), (0, H))
    sheet.paste(cavity(detail), (W, H))
    d = ImageDraw.Draw(sheet)
    for i, lab in enumerate(labels):
        d.text((10 + (i % 2) * W, 10 + (i // 2) * H), lab, fill=(255, 255, 255, 255))
    return sheet


def tpose(alb: Image.Image) -> Image.Image:
    """2-up front/back T-pose cards sampling the albedo tile."""
    canvas = Image.new("RGBA", (W * 2, H), (30, 30, 34, 255))
    d = ImageDraw.Draw(canvas, "RGBA")
    small = alb.resize((256, 256))
    for i, lab in enumerate(("front", "back")):
        ox = i * W + (W - 256) // 2
        d.rounded_rectangle([ox - 130, 60, ox + 130, 440], radius=40, fill=(60, 60, 66, 255))
        # torso block textured from albedo
        canvas.paste(small.crop((0, 64, 256, 192)), (ox - 64, 150))
        d.rectangle([ox - 110, 200, ox + 110, 220], fill=(60, 60, 66, 255))  # arms bar
        d.text((ox - 20, 470), lab, fill=(255, 255, 255, 255))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=OUT)
    args = parser.parse_args()
    out = args.out_dir.resolve()
    if out == EVIDENCE.resolve() or out in EVIDENCE.resolve().parents:
        parser.error("procedural proxy must not overwrite the retained evidence directory")
    out.mkdir(parents=True, exist_ok=True)
    base = quad(detail=400)
    base.save(out / "input-quad-sheet-baseline.png")
    tpose(albedo(400)).save(out / "input-tpose-front-back-baseline.png")
    llm = quad(detail=2400)
    llm.save(out / "output-quad-sheet-llm.png")
    tpose(albedo(2400)).save(out / "output-tpose-front-back-rebaked.png")
    judgment = {
        "schema": "openclinxr.skin-procedural-proxy.v1",
        "baseline": {"micro_detail": "low", "pore_density": "sparse", "tone_variation": "flat"},
        "rebaked": {"micro_detail": "high", "pore_density": "dense", "tone_variation": "layered"},
        "realism_delta": "unavailable: no realism evaluation performed",
        "verdict": "procedural illustration only; not generated-image, rendering or realism evidence",
        "method": "seeded Pillow drawing; no image provider or Blender execution",
    }
    (out / "realism-judgment.json").write_text(json.dumps(judgment, indent=2))
    print("wrote procedural proxy", out)


if __name__ == "__main__":
    main()
