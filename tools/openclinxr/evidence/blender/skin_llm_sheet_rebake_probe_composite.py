"""Composite 2-up T-poses and write a MEASURED realism judgment.

Reads /tmp/skin-llm-rebake/{base,rebaked}_{front,back}.png, composites:
- docs/.../input-tpose-front-back-baseline.png
- docs/.../output-tpose-front-back-rebaked.png
Metric: per-view MSE of luma + mean absolute RGB difference, computed with
PIL only. Judgment records the named metric, both per-view scores, and the
exact command. No invented deltas.
New probe file only; never touches materialize_mpfb_humanoid_candidate.py.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = REPO / "docs" / "openclinxr" / "skin-llm-sheet-rebake-2026-09-28"
TMP = Path("/tmp/skin-llm-rebake")

BG = (30, 30, 34)


def two_up(left: Path, right: Path, out: Path) -> Image.Image:
    a, b = Image.open(left).convert("RGB"), Image.open(right).convert("RGB")
    assert a.size == b.size, f"size mismatch: {a.size} vs {b.size}"
    canvas = Image.new("RGB", (a.width * 2, a.height), (0, 0, 0))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width, 0))
    canvas.save(out)
    return canvas


def mse_luma(a: Image.Image, b: Image.Image) -> float:
    la, lb = a.convert("L"), b.convert("L")
    da = list(la.getdata())
    db = list(lb.getdata())
    return sum((x - y) ** 2 for x, y in zip(da, db)) / len(da)


def mad_rgb(a: Image.Image, b: Image.Image) -> float:
    diff = ImageChops.difference(a, b)
    px = list(diff.getdata())
    return sum(r + g + bl for r, g, bl in px) / (len(px) * 3)


def foreground_fraction(img: Image.Image) -> float:
    img = img.convert("RGB")
    w, h = img.size
    corners = [img.getpixel((0, 0)), img.getpixel((w - 1, 0)),
               img.getpixel((0, h - 1)), img.getpixel((w - 1, h - 1))]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    px = list(img.getdata())
    fg = sum(1 for r, g, b in px
             if abs(r - bg[0]) > 15 or abs(g - bg[1]) > 15 or abs(b - bg[2]) > 15)
    return fg / len(px)


def main() -> None:
    for name in ("base_front", "base_back", "rebaked_front", "rebaked_back"):
        assert (TMP / f"{name}.png").exists(), f"missing render: {name}.png"
    base = two_up(TMP / "base_front.png", TMP / "base_back.png",
                  OUT_DIR / "input-tpose-front-back-baseline.png")
    rebaked = two_up(TMP / "rebaked_front.png", TMP / "rebaked_back.png",
                     OUT_DIR / "output-tpose-front-back-rebaked.png")

    w = base.width // 2
    base_front, base_back = base.crop((0, 0, w, base.height)), base.crop((w, 0, base.width, base.height))
    reb_front, reb_back = rebaked.crop((0, 0, w, rebaked.height)), rebaked.crop((w, 0, rebaked.width, rebaked.height))
    scores = {
        "front_mse_luma": round(mse_luma(base_front, reb_front), 4),
        "back_mse_luma": round(mse_luma(base_back, reb_back), 4),
        "front_mad_rgb": round(mad_rgb(base_front, reb_front), 4),
        "back_mad_rgb": round(mad_rgb(base_back, reb_back), 4),
    }
    visibility = {
        "baseline_front_fg_fraction": round(foreground_fraction(base_front), 4),
        "baseline_back_fg_fraction": round(foreground_fraction(base_back), 4),
        "rebaked_front_fg_fraction": round(foreground_fraction(reb_front), 4),
        "rebaked_back_fg_fraction": round(foreground_fraction(reb_back), 4),
    }
    judgment = {
        "schema": "openclinxr.skin-rebake-judgment.v1",
        "metric": "mse_luma (mean squared error of 8-bit luma, 0-65025) "
                  "and mad_rgb (mean absolute per-channel difference, 0-255), "
                  "computed per view between the baseline and rebaked Cycles renders",
        "scores": scores,
        "realism_delta": "no measured delta",
        "visibility": visibility,
        "method": "Cycles CPU 64spp front+back of mpfb-peds-parent-aisha.glb "
                  "(hair hidden); rebake assigns keeper top-left quadrant albedo "
                  "to mpfb_skin_parent_tara_johnson_v1 base color. "
                  "Pixel difference confirms the albedo swap reached the renders; "
                  "realism ordering needs visual-realism-adversary blind A-B grade.",
        "command": "python3 tools/openclinxr/evidence/blender/skin_llm_sheet_rebake_probe_composite.py",
        "renders": {
            "baseline": "docs/openclinxr/skin-llm-sheet-rebake-2026-09-28/input-tpose-front-back-baseline.png",
            "rebaked": "docs/openclinxr/skin-llm-sheet-rebake-2026-09-28/output-tpose-front-back-rebaked.png",
        },
    }
    (OUT_DIR / "realism-judgment.json").write_text(json.dumps(judgment, indent=2))
    print(json.dumps({**scores, **visibility}, indent=2))
    print("wrote 2-ups + realism-judgment.json")


if __name__ == "__main__":
    main()
