#!/usr/bin/env python3
"""Compose Round-5 contact sheets, crops, and silhouette IoU metrics."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
CASE = ROOT.parent
CELL = 560
LABEL = 42
COLUMN_BASE = (300, 690, 1010, 1260)
FRONT_PANEL = (270, 130, 800, 770)


def font(size: int):
    path = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
    return ImageFont.truetype(path, size) if path.exists() else ImageFont.load_default()


def render(rel: str) -> Path:
    return ROOT / "renders" / rel / "three_quarter_right.png"


def mask(rel: str) -> Path:
    return ROOT / "silhouettes" / rel / "three_quarter_right.png"


seed7_raw = render("seed7-default-raw")
seed7_budget = render("seed7-default-budget")
main = [
    ("control", CASE / "renders/control/three_quarter_right.png", CASE / "renders/control/three_quarter_right.png"),
    ("T4 adopted", CASE / "round3/renders/trellis2-raw/three_quarter_right.png", CASE / "round4/renders/t4-uv64-512-budget/three_quarter_right.png"),
    ("R5-A pre-bake", seed7_raw, seed7_budget),
    ("R5-B filter", seed7_raw, render("r5-b-island-filter-budget")),
    ("R5-C CPU fill", seed7_raw, render("r5-c-cpu-fill-budget")),
    ("R5-D unavailable", None, None),
    ("R5-E seed winner", seed7_raw, seed7_budget),
    ("R5-BEST C→B→A", seed7_raw, render("r5-best-budget")),
]
seed_columns = [
    ("seed 42 default", render("seed42-default-raw"), render("seed42-default-budget")),
    ("seed 7 default", seed7_raw, seed7_budget),
    ("seed 123 default", render("seed123-default-raw"), render("seed123-default-budget")),
    ("seed 42 fast 6", render("seed42-fast6-raw"), render("seed42-fast6-budget")),
]


def compose(columns, out: Path) -> None:
    sheet = Image.new("RGB", (CELL * len(columns), (CELL + LABEL) * 2), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    fnt = font(21)
    for column_index, (name, raw, budget) in enumerate(columns):
        for row_index, (row, source) in enumerate((("raw", raw), ("budget", budget))):
            x = column_index * CELL
            y = row_index * (CELL + LABEL) + LABEL
            if source is None:
                image = Image.new("RGB", (CELL, CELL), (52, 52, 52))
                placeholder = ImageDraw.Draw(image)
                placeholder.multiline_text(
                    (36, 210),
                    "CPU REMESH UNAVAILABLE\nMetal-only cumesh backend\n(no fabricated mesh)",
                    fill=(235, 235, 235), font=font(24), spacing=12,
                )
            else:
                image = Image.open(source).convert("RGB").resize((CELL, CELL), Image.Resampling.LANCZOS)
            sheet.paste(image, (x, y))
            draw.text((x + 9, y - LABEL + 9), f"{name} — {row}", fill="white", font=fnt)
    sheet.save(out, compress_level=9)


compose(main, ROOT / "contact-sheet-raw-budget.png")
compose(seed_columns, ROOT / "seed-screen-raw-budget.png")


def crops(columns, box, slug: str) -> list[dict]:
    out_dir = ROOT / f"crops-{slug}"
    out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    valid = [(name, budget) for name, _, budget in columns if budget is not None]
    width, height = box[2] - box[0], box[3] - box[1]
    sheet = Image.new("RGB", (width * len(valid), height + LABEL), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    for index, (name, source) in enumerate(valid):
        crop = Image.open(source).convert("RGB").crop(box)
        safe = name.lower().replace(" ", "-").replace("→", "-").replace("/", "-")
        path = out_dir / f"{safe}-2x-nearest.png"
        crop.resize((width * 2, height * 2), Image.Resampling.NEAREST).save(path, compress_level=9)
        sheet.paste(crop, (index * width, LABEL))
        draw.text((index * width + 8, 9), name, fill="white", font=font(20))
        records.append({"column": name, "source": str(source), "path": str(path)})
    sheet.save(ROOT / f"{slug}-crops-budget.png", compress_level=9)
    return records


column_crops = crops(main, COLUMN_BASE, "column-base-caster")
panel_crops = crops(main, FRONT_PANEL, "front-panel")


oracle = Image.open(CASE / "inputs/ecg-cart-oracle-matted.png").convert("RGBA")
oracle = oracle.resize((1280, 1280), Image.Resampling.LANCZOS)
oracle_mask = np.asarray(oracle)[..., 3] >= 16


def iou(path: Path) -> float:
    candidate = np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 16
    union = np.count_nonzero(candidate | oracle_mask)
    return float(np.count_nonzero(candidate & oracle_mask) / union)


masks = {
    "control": CASE / "silhouettes/control/three_quarter_right.png",
    "t4": CASE / "round4/silhouettes/t4-uv64-512-budget/three_quarter_right.png",
    "seed42_default": mask("seed42-default-budget"),
    "seed7_default_r5a": mask("seed7-default-budget"),
    "seed123_default": mask("seed123-default-budget"),
    "seed42_fast6": mask("seed42-fast6-budget"),
    "r5b": mask("r5-b-island-filter-budget"),
    "r5c": mask("r5-c-cpu-fill-budget"),
    "r5best": mask("r5-best-budget"),
}
ious = {name: iou(path) for name, path in masks.items()}
(ROOT / "silhouette-iou.json").write_text(json.dumps({"alphaThreshold": 16, "values": ious}, indent=2) + "\n")
(ROOT / "evidence-layout.json").write_text(json.dumps({
    "mainContactSheet": "contact-sheet-raw-budget.png",
    "seedContactSheet": "seed-screen-raw-budget.png",
    "mainColumns": [name for name, _, _ in main],
    "rows": ["raw", "budget"],
    "columnBaseCasterCrop": {"box": list(COLUMN_BASE), "sheet": "column-base-caster-crops-budget.png", "individuals": column_crops},
    "frontPanelCrop": {"box": list(FRONT_PANEL), "sheet": "front-panel-crops-budget.png", "individuals": panel_crops},
    "magnification": "individual crops are 2x NEAREST; sheets retain native crop pixels",
    "dPlaceholder": "No mesh: installed remesh backend is Metal-only and Round 3 hit unsupported float atomics.",
}, indent=2) + "\n")
print(json.dumps({"ious": ious, "mainColumns": len(main), "seedColumns": len(seed_columns)}))
