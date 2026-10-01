#!/usr/bin/env python3
"""Build six before | after | reference evidence sheets for stepdown."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/openclinxr/room-realism/stepdown-room-v1-finish"
NAMES = [
    "runtime-01-toward-door", "runtime-02-toward-bed-wall",
    "runtime-03-ceiling-corner", "runtime-04-door-inside",
    "runtime-05-troffer-junction", "runtime-06-floor-base",
]
WIDTH, HEIGHT, LABEL = 640, 360, 38


def fit(image: Image.Image) -> Image.Image:
    image.thumbnail((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, HEIGHT), (18, 18, 18))
    canvas.paste(image, ((WIDTH - image.width) // 2, (HEIGHT - image.height) // 2))
    return canvas


def main() -> None:
    sheets = EVIDENCE / "sheets"
    sheets.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        before = fit(Image.open(EVIDENCE / "before" / f"{name}.png").convert("RGB"))
        after = fit(Image.open(EVIDENCE / "after" / f"{name}.png").convert("RGB"))
        sheet = Image.new("RGB", (WIDTH * 3, HEIGHT + LABEL), (24, 24, 24))
        sheet.paste(before, (0, LABEL))
        sheet.paste(after, (WIDTH, LABEL))
        draw = ImageDraw.Draw(sheet)
        has_reference = name == "runtime-04-door-inside"
        if has_reference:
            reference = fit(Image.open(
                ROOT / "docs/openclinxr/room-realism/stepdown-door-ideas/reference-door.jpg"
            ).convert("RGB"))
            sheet.paste(reference, (WIDTH * 2, LABEL))
        else:
            draw.rectangle((WIDTH * 2, LABEL, WIDTH * 3 - 1, HEIGHT + LABEL - 1), fill=(36, 40, 48))
        draw.text((16, 12), "BEFORE — prior shipped stepdown", fill=(255, 255, 255))
        draw.text((WIDTH + 16, 12), "AFTER — room-chain finish", fill=(150, 230, 255))
        draw.text((WIDTH * 2 + 16, 12), "REFERENCE", fill=(220, 220, 220))
        if not has_reference:
            draw.text((WIDTH * 2 + 190, LABEL + HEIGHT // 2), "NO REFERENCE EXISTS", fill=(220, 220, 220))
        suffix = "reference" if has_reference else "no-reference"
        sheet.save(sheets / f"{name}-before-after-{suffix}.png")
        print(sheets / f"{name}-before-after-{suffix}.png")


if __name__ == "__main__":
    main()
