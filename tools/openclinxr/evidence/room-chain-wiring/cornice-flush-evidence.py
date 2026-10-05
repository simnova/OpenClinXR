#!/usr/bin/env python3
"""Measure fixed native-pixel junction boxes and assemble cornice A/B sheets."""
from __future__ import annotations

import json
import hashlib
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/openclinxr/room-realism/cornice-flush"
HISTORICAL = ROOT / "docs/openclinxr/room-realism/cornice-ab"
REFERENCE = ROOT / "docs/openclinxr/room-realism/imagine-multiview-v2"
VARIANTS = ("v2", "v4-flush-wall", "v4-flush-tile", "v4-flush-tbar")
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
    x0, y0, x1, _ = boxes["band"]
    ceiling_box = [x0, y0 - 18, x1, y0 - 8]
    ceiling_l = luminance(ImageStat.Stat(image.crop(tuple(ceiling_box))).mean)
    result = {
        "image": str(path.relative_to(ROOT)),
        "captureSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bandBox": boxes["band"],
        "bandMeanLuminance": round(band_l, 2),
        "adjacentWallBox": boxes["wall"],
        "adjacentWallMeanLuminance": round(wall_l, 2),
        "bandMinusWallLuminance": round(band_l - wall_l, 2),
        "adjacentCeilingBox": ceiling_box,
        "adjacentCeilingMeanLuminance": round(ceiling_l, 2),
        "bandMinusCeilingLuminance": round(band_l - ceiling_l, 2),
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
            "v2": "Previously shipped angle; immutable cornice-ab capture",
            "v4-flush-wall": "7bc757730 wall-material control, including its emission",
            "v4-flush-tile": "Ceiling tile PBR material and continuous world XY UV",
            "v4-flush-tbar": "Existing off-white T-bar material",
        },
        "rooms": {},
        "notEvidenceFor": ["Quest headset readiness", "clinical validity"],
    }
    for room, poses in POSES.items():
        room_result = {}
        for pose in poses:
            boxes = BOXES[room][pose]
            paths = [(HISTORICAL if variant == "v2" else EVIDENCE) / room / variant / f"runtime-{pose}.png" for variant in VARIANTS]
            labels = [variant.upper() for variant in VARIANTS]
            if room == "ward":
                paths.append(REFERENCE / f"{pose}.jpg")
                labels.append("v2 visual reference")
            labelled_sheet(paths, labels, EVIDENCE / room / "sheets" / f"{pose}-materials.jpg")
            crop_sheet(paths, labels, boxes["crop"], EVIDENCE / room / "crops" / f"{pose}-junction-4x.png")
            measurements = {
                variant: measure(path, boxes, gap=variant != "v2")
                for variant, path in zip(VARIANTS, paths[:4])
            }
            # The rectangular junction ROI also contains wall/tile pixels.
            # A single material-change mask isolates the trim pixels for all
            # three arms; the original junction and gap ROIs stay unchanged.
            bands = [np.asarray(Image.open(p).convert("RGB").crop(tuple(boxes["band"])), dtype=float) for p in paths[1:4]]
            trim_mask = np.maximum(np.max(np.abs(bands[0] - bands[1]), axis=2),
                                   np.max(np.abs(bands[0] - bands[2]), axis=2)) > 2
            if not trim_mask.any():
                raise ValueError(f"No isolated trim pixels in {room}/{pose}")
            for variant, band in zip(VARIANTS[1:], bands):
                trim_l = luminance(band[trim_mask].mean(axis=0))
                measurements[variant]["trimSurface"] = {
                    "maskMethod": "Same pixels for every arm: max RGB change >2 between wall/tile/tbar within fixed bandBox",
                    "pixelCount": int(trim_mask.sum()),
                    "meanLuminance": round(trim_l, 2),
                    "minusAdjacentCeilingLuminance": round(trim_l - measurements[variant]["adjacentCeilingMeanLuminance"], 2),
                }
            reference_measurement = measure(paths[4], boxes, gap=False) if room == "ward" else None
            operator_reference = {"01-toward-door": -12, "02-toward-bed-wall": -5}.get(pose) if room == "ward" else None
            for variant, first_path in zip(VARIANTS[1:], paths[1:4]):
                measurement = measurements[variant]
                measurement["junctionDeltaVsV2"] = round(measurement["bandMinusWallLuminance"] - measurements["v2"]["bandMinusWallLuminance"], 2)
                measurement["adjacentWallDeltaVsV2"] = round(measurement["adjacentWallMeanLuminance"] - measurements["v2"]["adjacentWallMeanLuminance"], 2)
                first = Image.open(first_path).convert("RGB")
                repeat_path = EVIDENCE / room / f"{variant}-repeat" / f"runtime-{pose}.png"
                repeat = Image.open(repeat_path).convert("RGB")
                if first.size != repeat.size:
                    raise ValueError(f"repeat capture size mismatch: {repeat_path}")
                diff_sum = sum(abs(left - right)
                    for left_pixel, right_pixel in zip(first.get_flattened_data(), repeat.get_flattened_data())
                    for left, right in zip(left_pixel, right_pixel))
                mean_diff = diff_sum / (first.width * first.height * 3)
                measurement["repeatCapture"] = {
                    "image": str(repeat_path.relative_to(ROOT)),
                    "captureSha256": hashlib.sha256(repeat_path.read_bytes()).hexdigest(),
                    "meanAbsoluteChannelDifference": round(mean_diff, 4),
                    "flickerPassLt0_5": mean_diff < 0.5,
                }
                if reference_measurement:
                    measurement["v2VisualReferenceDelta"] = round(measurement["bandMinusWallLuminance"] - reference_measurement["bandMinusWallLuminance"], 2)
                if operator_reference is not None:
                    measurement["operatorReferenceDelta"] = round(measurement["bandMinusWallLuminance"] - operator_reference, 2)
            room_result[pose] = {
                "cropBox": boxes["crop"],
                "cropScale": "4x nearest-neighbour (one native pixel is a 4x4 block)",
                "measurements": measurements,
                "v2ReferenceDelta": measurements["v2"]["bandMinusWallLuminance"],
                "operatorReferenceWallDelta": operator_reference,
                **({"v2VisualReference": reference_measurement} if reference_measurement else {}),
            }
        result["rooms"][room] = room_result
    scores = {variant: round(sum(abs(result["rooms"]["ward"][pose]["measurements"][variant]["operatorReferenceDelta"])
              for pose in POSES["ward"][:2]) / 2, 2) for variant in VARIANTS[1:]}
    eligible = [variant for variant in VARIANTS[1:] if all(
        pose["measurements"][variant]["gapSeam"]["gapPixels"] == 0
        and pose["measurements"][variant]["repeatCapture"]["meanAbsoluteChannelDifference"] < 0.5
        for poses in result["rooms"].values() for pose in poses.values())]
    result["selection"] = {"reference": "Coordinator ward 01/02 targets -12/-5; frozen crop measurements also recorded separately",
                           "meanAbsoluteError": scores, "eligible": eligible,
                           "chosen": min(eligible, key=scores.get) if eligible else None}
    build_manifest = json.loads((ROOT / ".openclinxr/evidence/cornice-flush/build-manifest.json").read_text())
    (EVIDENCE / "build-manifest.json").write_text(json.dumps(build_manifest, indent=2) + "\n")
    chosen = result["selection"]["chosen"]
    if chosen:
        door = runpy.run_path(str(ROOT / "tools/openclinxr/evidence/room-chain-wiring/measure-stepdown-door.py"))
        selected = EVIDENCE / "stepdown" / chosen / "runtime-04-door-inside.png"
        historical = ROOT / "docs/openclinxr/room-realism/stepdown-room-v1-finish/after/runtime-04-door-inside.png"
        door_result = {
            "schemaVersion": "openclinxr.stepdown-door-reference-measurements.v1",
            "sourceGlbSha256": build_manifest["results"][f"stepdown_room_v1/{chosen}"]["glbSha256"],
            "before": door["metrics"](historical, "runtime"),
            "after": door["metrics"](selected, "runtime"),
            "reference": door["metrics"](door["REFERENCE"], "reference"),
            "notEvidenceFor": result["notEvidenceFor"],
        }
        (EVIDENCE / "stepdown/door-reference-measurements.json").write_text(json.dumps(door_result, indent=2) + "\n")
        door["overlay"]([("HISTORICAL", historical, "runtime"), (chosen, selected, "runtime"),
                         ("REFERENCE", door["REFERENCE"], "reference")], EVIDENCE / "stepdown/door-reference-measurement-boxes.png")
    (EVIDENCE / "measurements.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
