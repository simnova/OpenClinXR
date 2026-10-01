#!/usr/bin/env python3
"""Measure matched, crop-verified door boxes and render their overlay proof."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/openclinxr/room-realism/stepdown-room-v1-finish"
REFERENCE = ROOT / "docs/openclinxr/room-realism/stepdown-door-ideas/reference-door.jpg"
POSE = "runtime-04-door-inside.png"

# Every box was verified on the native 1280x720 images. The infill/wall boxes
# straddle the left edge at equal height without touching casing or ceiling.
BOXES = {
    "runtime": {
        "wall": (485, 75, 505, 140),
        "infill": (529, 75, 549, 140),
        "leaf": (540, 240, 565, 580),
        "frame": (505, 230, 518, 580),
        "boundaryProfile": (480, 75, 575, 140),
    },
    "reference": {
        "wall": (485, 125, 505, 155),
        "infill": (520, 125, 540, 155),
        "leaf": (550, 210, 645, 570),
        "frame": (506, 210, 519, 590),
    },
}


def mean_rgb(array: np.ndarray, box: tuple[int, int, int, int]) -> list[float]:
    x0, y0, x1, y1 = box
    return np.mean(array[y0:y1, x0:x1], axis=(0, 1)).round(2).tolist()


def metrics(path: Path, kind: str) -> dict:
    array = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    boxes = BOXES[kind]
    result = {name: {"box": list(box), "meanRgb": mean_rgb(array, box)}
              for name, box in boxes.items() if name != "boundaryProfile"}
    result["infillVsWall"] = {
        "deltaRgb": np.subtract(result["infill"]["meanRgb"], result["wall"]["meanRgb"]).round(2).tolist()
    }
    if kind == "runtime":
        x0, y0, x1, y1 = boxes["boundaryProfile"]
        columns = np.mean(array[y0:y1, x0:x1], axis=0)
        steps = np.abs(np.diff(columns, axis=0))
        result["infillVsWall"]["boundaryProfileBox"] = list(boxes["boundaryProfile"])
        result["infillVsWall"]["maximumBoundaryColumnStep"] = round(float(np.max(steps)), 2)
    return result


def overlay(paths: list[tuple[str, Path, str]], output: Path) -> None:
    images = [Image.open(path).convert("RGB") for _, path, _ in paths]
    canvas = Image.new("RGB", (1280 * len(images), 760), (24, 24, 24))
    colours = {"wall": "#00d8ff", "infill": "#ffde59", "leaf": "#ff6b6b", "frame": "#8cff66"}
    draw = ImageDraw.Draw(canvas)
    for index, ((label, _, kind), image) in enumerate(zip(paths, images)):
        offset = index * 1280
        canvas.paste(image, (offset, 40))
        draw.text((offset + 16, 12), label, fill="white")
        for name, box in BOXES[kind].items():
            if name == "boundaryProfile":
                continue
            x0, y0, x1, y1 = box
            draw.rectangle((offset + x0, y0 + 40, offset + x1, y1 + 40), outline=colours[name], width=3)
            draw.text((offset + x0 + 3, y0 + 43), name, fill=colours[name])
    canvas.save(output)


def main() -> None:
    before_path = EVIDENCE / "before" / POSE
    after_path = EVIDENCE / "after" / POSE
    reference = metrics(REFERENCE, "reference")
    before = metrics(before_path, "runtime")
    after = metrics(after_path, "runtime")
    for arm in (before, after):
        arm["leafVsReference"] = {
            "deltaRgb": np.subtract(arm["leaf"]["meanRgb"], reference["leaf"]["meanRgb"]).round(2).tolist()
        }
        arm["frameVsReference"] = {
            "deltaRgb": np.subtract(arm["frame"]["meanRgb"], reference["frame"]["meanRgb"]).round(2).tolist()
        }
    report = {
        "schemaVersion": "openclinxr.stepdown-door-reference-measurements.v1",
        "pose": "derived learner-runtime pose 04",
        "reference": reference,
        "before": before,
        "after": after,
        "gates": {"infillWallMaxAbsChannelDelta": 3, "boundaryMaximumColumnStep": 4},
        "cropVerification": "Native 1280x720 boxes avoid ceiling, casing, lite, lever, and floor; overlay proof is door-reference-measurement-boxes.png.",
        "notEvidenceFor": ["clinical validity", "exam equivalence", "Quest readiness", "production readiness"],
    }
    (EVIDENCE / "door-reference-measurements.json").write_text(json.dumps(report, indent=2) + "\n")
    overlay([
        ("BEFORE — shipped ec42fa03c", before_path, "runtime"),
        ("AFTER — corrected finish", after_path, "runtime"),
        ("REFERENCE — operator-selected option A", REFERENCE, "reference"),
    ], EVIDENCE / "door-reference-measurement-boxes.png")


if __name__ == "__main__":
    main()
