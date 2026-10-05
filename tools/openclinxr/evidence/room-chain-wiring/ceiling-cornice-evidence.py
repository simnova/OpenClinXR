#!/usr/bin/env python3
"""Measure and sheet the shipped ceiling-cornice before/after runtime captures."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/openclinxr/room-realism/ceiling-cornice"
REFERENCE = ROOT / "docs/openclinxr/room-realism/imagine-multiview-v2"
POSES = [
    "01-toward-door",
    "02-toward-bed-wall",
    "03-ceiling-corner",
    "04-door-inside",
    "05-troffer-junction",
    "06-floor-base",
]
JUNCTIONS = {
    "ward": {
        "01-toward-door": {"band": [360, 183, 560, 190], "wall": [360, 198, 560, 218]},
        "02-toward-bed-wall": {"band": [300, 143, 500, 152], "wall": [300, 165, 500, 185]},
    },
    "stepdown": {
        "01-toward-door": {"band": [200, 149, 450, 160], "wall": [200, 172, 450, 192]},
        "02-toward-bed-wall": {"band": [350, 198, 650, 208], "wall": [350, 218, 650, 238]},
    },
}
REFERENCE_BOXES = {
    "01-toward-door": {"band": [400, 154, 600, 162], "wall": [400, 175, 600, 195]},
    "02-toward-bed-wall": {"band": [300, 163, 500, 171], "wall": [300, 180, 500, 200]},
}


def mean_luminance(image: Image.Image, box: list[int]) -> tuple[float, list[float]]:
    rgb = ImageStat.Stat(image.crop(tuple(box))).mean
    luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return round(luminance, 2), [round(value, 2) for value in rgb]


def measure(image_path: Path, boxes: dict[str, list[int]]) -> dict:
    image = Image.open(image_path).convert("RGB")
    band_l, band_rgb = mean_luminance(image, boxes["band"])
    wall_l, wall_rgb = mean_luminance(image, boxes["wall"])
    delta = round(band_l - wall_l, 2)
    return {
        "image": str(image_path.relative_to(ROOT)),
        "bandBox": boxes["band"],
        "bandMeanRgb": band_rgb,
        "bandMeanLuminance": band_l,
        "adjacentWallBox": boxes["wall"],
        "adjacentWallMeanRgb": wall_rgb,
        "adjacentWallMeanLuminance": wall_l,
        "bandMinusWallLuminance": delta,
        "threshold": -30,
        "passes": delta >= -30,
    }


def overlay(image_path: Path, boxes: dict[str, list[int]], output: Path) -> None:
    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)
    for label, color in (("band", (255, 50, 50)), ("wall", (50, 220, 80))):
        box = boxes[label]
        draw.rectangle(tuple(box), outline=color, width=3)
        draw.text((box[0] + 4, box[1] + 3), label, fill=color)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)


def sheets() -> None:
    for room in ("ward", "stepdown"):
        output = EVIDENCE / room / "sheets"
        output.mkdir(parents=True, exist_ok=True)
        for pose in POSES:
            paths = [
                EVIDENCE / room / "before" / f"runtime-{pose}.png",
                EVIDENCE / room / "after" / f"runtime-{pose}.png",
            ]
            labels = ["before", "after"]
            if room == "ward":
                paths.append(REFERENCE / f"{pose}.jpg")
                labels.append("v2 reference")
            sheet = Image.new("RGB", (1280 * len(paths), 750), "white")
            draw = ImageDraw.Draw(sheet)
            for index, (path, label) in enumerate(zip(paths, labels)):
                sheet.paste(Image.open(path).convert("RGB"), (1280 * index, 30))
                draw.text((1280 * index + 12, 8), label, fill="black")
            sheet.save(output / f"{pose}-{'-'.join(labels).replace(' ', '-')}.jpg", quality=90)


def main() -> None:
    results = {
        "schemaVersion": "openclinxr.ceiling-cornice-evidence.v1",
        "method": "Rec.709 luminance from native 1280x720 learner-runtime PNG crop means",
        "target": "replacement band is no darker than adjacent wall minus 30 luminance points",
        "rooms": {},
        "wardV2Reference": {},
        "notEvidenceFor": ["Quest headset readiness", "clinical validity"],
    }
    for room, poses in JUNCTIONS.items():
        room_results = {}
        for pose, boxes in poses.items():
            pose_results = {}
            for arm in ("before", "after"):
                image_path = EVIDENCE / room / arm / f"runtime-{pose}.png"
                pose_results[arm] = measure(image_path, boxes)
                overlay(image_path, boxes, EVIDENCE / room / "junction-boxes" / f"{pose}-{arm}.png")
            room_results[pose] = pose_results
        results["rooms"][room] = room_results
    for pose, boxes in REFERENCE_BOXES.items():
        image_path = REFERENCE / f"{pose}.jpg"
        results["wardV2Reference"][pose] = measure(image_path, boxes)
        overlay(image_path, boxes, EVIDENCE / "ward" / "junction-boxes" / f"{pose}-v2-reference.png")
    sheets()
    (EVIDENCE / "junction-measurements.json").write_text(
        json.dumps(results, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
