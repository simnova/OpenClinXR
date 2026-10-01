#!/usr/bin/env python3
"""Measure fixed native-pixel junction boxes and assemble cornice A/B sheets."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/openclinxr/room-realism/cornice-ab"
REFERENCE = ROOT / "docs/openclinxr/room-realism/imagine-multiview-v2"
VARIANTS = ("v2", "v4", "v4-flush")
POSES = {
    "ward": ("01-toward-door", "02-toward-bed-wall", "03-ceiling-corner", "05-troffer-junction"),
    "stepdown": ("01-toward-door", "02-toward-bed-wall", "04-door-inside", "05-troffer-junction"),
}
BOXES = {
    "ward": {
        "01-toward-door": {"band": [360, 183, 560, 190], "wall": [360, 198, 560, 218], "crop": [320, 145, 600, 235]},
        "02-toward-bed-wall": {"band": [300, 143, 500, 152], "wall": [300, 165, 500, 185], "crop": [260, 115, 540, 205]},
        "03-ceiling-corner": {"band": [50, 492, 100, 498], "wall": [50, 510, 100, 530], "crop": [20, 455, 160, 550]},
        "05-troffer-junction": {"band": [900, 633, 960, 640], "wall": [900, 650, 960, 670], "crop": [850, 580, 1030, 680]},
    },
    "stepdown": {
        "01-toward-door": {"band": [200, 149, 450, 160], "wall": [200, 172, 450, 192], "crop": [160, 115, 490, 215]},
        "02-toward-bed-wall": {"band": [350, 198, 650, 208], "wall": [350, 218, 650, 238], "crop": [310, 165, 690, 260]},
        "04-door-inside": {"band": [820, 96, 831, 100], "wall": [820, 110, 831, 120], "crop": [730, 40, 1000, 140]},
        "05-troffer-junction": {"band": [900, 557, 1040, 565], "wall": [900, 580, 1040, 600], "crop": [850, 520, 1100, 620]},
    },
}


def luminance(rgb: tuple[float, ...] | list[float]) -> float:
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def measure(path: Path, boxes: dict[str, list[int]], gap: bool) -> dict:
    image = Image.open(path).convert("RGB")
    band_rgb = ImageStat.Stat(image.crop(tuple(boxes["band"]))).mean
    wall_rgb = ImageStat.Stat(image.crop(tuple(boxes["wall"]))).mean
    band_l = luminance(band_rgb)
    wall_l = luminance(wall_rgb)
    result = {
        "image": str(path.relative_to(ROOT)),
        "bandBox": boxes["band"],
        "bandMeanLuminance": round(band_l, 2),
        "adjacentWallBox": boxes["wall"],
        "adjacentWallMeanLuminance": round(wall_l, 2),
        "bandMinusWallLuminance": round(band_l - wall_l, 2),
    }
    if gap:
        threshold = wall_l - 40
        band_image = image.crop(tuple(boxes["band"]))
        pixels = list(band_image.get_flattened_data())
        # A seam is a horizontal run, not isolated texture/shadow specks.
        # Five native pixels is deliberately below V1's visible continuous
        # runs while rejecting the final flush arm's <=4 px isolated marks.
        seam_pixels = 0
        for y in range(band_image.height):
            run = 0
            for x in range(band_image.width):
                if luminance(band_image.getpixel((x, y))) < threshold:
                    run += 1
                else:
                    if run >= 5:
                        seam_pixels += run
                    run = 0
            if run >= 5:
                seam_pixels += run
        result["gapSeam"] = {
            "junctionBox": boxes["band"],
            "thresholdLuminance": round(threshold, 2),
            "pixelsDarkerThanWallMinus40": sum(1 for pixel in pixels if luminance(pixel) < threshold),
            "minimumHorizontalRunPx": 5,
            "gapPixels": seam_pixels,
            "pixelCount": len(pixels),
        }
    return result


def labelled_sheet(paths: list[Path], labels: list[str], output: Path) -> None:
    panels = [Image.open(path).convert("RGB") for path in paths]
    sheet = Image.new("RGB", (sum(panel.width for panel in panels), max(panel.height for panel in panels) + 30), "white")
    draw = ImageDraw.Draw(sheet)
    x = 0
    for panel, label in zip(panels, labels):
        draw.text((x + 12, 8), label, fill="black")
        sheet.paste(panel, (x, 30))
        x += panel.width
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=92)


def crop_sheet(paths: list[Path], labels: list[str], box: list[int], output: Path) -> None:
    scale = 4
    panels = [Image.open(path).convert("RGB").crop(tuple(box)).resize(
        ((box[2] - box[0]) * scale, (box[3] - box[1]) * scale), Image.Resampling.NEAREST
    ) for path in paths]
    sheet = Image.new("RGB", (sum(panel.width for panel in panels), max(panel.height for panel in panels) + 30), "white")
    draw = ImageDraw.Draw(sheet)
    x = 0
    for panel, label in zip(panels, labels):
        draw.text((x + 12, 8), f"{label} | source box {box} | 4x nearest", fill="black")
        sheet.paste(panel, (x, 30))
        x += panel.width
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def main() -> None:
    result = {
        "schemaVersion": "openclinxr.cornice-flush-measurements.v1",
        "method": "Rec.709 luminance over fixed native 1280x720 learner-runtime boxes; gap threshold is adjacent-wall mean minus 40; flicker is absolute per-channel mean across two captures",
        "variants": {
            "v2": "24 mm T-bar off-white (checked-in shipped GLB)",
            "v4": "24 mm wall material/colour, 24 mm vertical step",
            "v4-flush": "24 mm wall material/colour, coplanar underside, tile field inset 24 mm, 3 mm vertical edge below tile",
        },
        "rooms": {},
        "notEvidenceFor": ["Quest headset readiness", "clinical validity"],
    }
    for room, poses in POSES.items():
        room_result = {}
        for pose in poses:
            boxes = BOXES[room][pose]
            paths = [EVIDENCE / room / variant / f"runtime-{pose}.png" for variant in VARIANTS]
            labels = [variant.upper() for variant in VARIANTS]
            if room == "ward":
                paths.append(REFERENCE / f"{pose}.jpg")
                labels.append("v2 visual reference")
            labelled_sheet(paths, labels, EVIDENCE / room / "sheets" / f"{pose}-v2-v4-v4-flush{'-v2-reference' if room == 'ward' else ''}.jpg")
            crop_sheet(paths, labels, boxes["crop"], EVIDENCE / room / "crops" / f"{pose}-junction-4x.png")
            measurements = {
                variant: measure(path, boxes, gap=variant == "v4-flush")
                for variant, path in zip(VARIANTS, paths[:3])
            }
            measurements["v4-flush"]["junctionDeltaVsV2"] = round(
                measurements["v4-flush"]["bandMinusWallLuminance"]
                - measurements["v2"]["bandMinusWallLuminance"], 2)
            measurements["v4-flush"]["adjacentWallDeltaVsV2"] = round(
                measurements["v4-flush"]["adjacentWallMeanLuminance"]
                - measurements["v2"]["adjacentWallMeanLuminance"], 2)
            first = Image.open(paths[2]).convert("RGB")
            repeat_path = EVIDENCE / room / "v4-flush-repeat" / f"runtime-{pose}.png"
            repeat = Image.open(repeat_path).convert("RGB")
            if first.size != repeat.size:
                raise ValueError(f"repeat capture size mismatch: {repeat_path}")
            diff_sum = sum(
                abs(left - right)
                for left_pixel, right_pixel in zip(first.get_flattened_data(), repeat.get_flattened_data())
                for left, right in zip(left_pixel, right_pixel)
            )
            mean_diff = diff_sum / (first.width * first.height * 3)
            measurements["v4-flush"]["repeatCapture"] = {
                "image": str(repeat_path.relative_to(ROOT)),
                "meanAbsoluteChannelDifference": round(mean_diff, 4),
                "flickerPassLt0_5": mean_diff < 0.5,
            }
            if room == "ward":
                reference_measurement = measure(paths[3], boxes, gap=False)
                measurements["v4-flush"]["v2VisualReferenceDelta"] = round(
                    measurements["v4-flush"]["bandMinusWallLuminance"]
                    - reference_measurement["bandMinusWallLuminance"], 2)
            else:
                reference_measurement = None
            room_result[pose] = {
                "cropBox": boxes["crop"],
                "cropScale": "4x nearest-neighbour (one native pixel is a 4x4 block)",
                "measurements": measurements,
                "v2ReferenceDelta": measurements["v2"]["bandMinusWallLuminance"],
                **({"v2VisualReference": reference_measurement} if reference_measurement else {}),
            }
        result["rooms"][room] = room_result
    (EVIDENCE / "measurements.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
