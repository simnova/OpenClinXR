from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
CASE = ROOT.parent
CROP_BOX = (300, 690, 1010, 1260)
LABEL_HEIGHT = 40
CELL = 640


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
    return ImageFont.truetype(path, size) if path.exists() else ImageFont.load_default()


columns = [
    (
        "control",
        CASE / "renders/control/three_quarter_right.png",
        CASE / "renders/control/three_quarter_right.png",
    ),
    (
        "round-3 TRELLIS.2",
        CASE / "round3/renders/trellis2-raw/three_quarter_right.png",
        CASE / "round3/renders/trellis2-budget/three_quarter_right.png",
    ),
    (
        "T1 UV=4",
        CASE / "round3/renders/trellis2-raw/three_quarter_right.png",
        ROOT / "renders/t1-uv4-budget/three_quarter_right.png",
    ),
    (
        "T2 UV=16",
        CASE / "round3/renders/trellis2-raw/three_quarter_right.png",
        ROOT / "renders/t2-uv16-budget/three_quarter_right.png",
    ),
    (
        "T3 UV=64",
        CASE / "round3/renders/trellis2-raw/three_quarter_right.png",
        ROOT / "renders/t3-uv64-budget/three_quarter_right.png",
    ),
    (
        "T4 UV=64, 512px",
        CASE / "round3/renders/trellis2-raw/three_quarter_right.png",
        ROOT / "renders/t4-uv64-512-budget/three_quarter_right.png",
    ),
]

sheet = Image.new("RGB", (CELL * len(columns), (CELL + LABEL_HEIGHT) * 2), (24, 24, 24))
draw = ImageDraw.Draw(sheet)
label_font = font(22)
for column_index, (label, raw_path, budget_path) in enumerate(columns):
    for row_index, (row, image_path) in enumerate((("raw", raw_path), ("budget", budget_path))):
        image = Image.open(image_path).convert("RGB").resize((CELL, CELL), Image.Resampling.LANCZOS)
        x = column_index * CELL
        y = row_index * (CELL + LABEL_HEIGHT) + LABEL_HEIGHT
        sheet.paste(image, (x, y))
        draw.text((x + 10, y - LABEL_HEIGHT + 8), f"{label} — {row}", fill="white", font=label_font)
sheet.save(ROOT / "contact-sheet-raw-budget.png", compress_level=9)

diagnosis_cells = [
    ("raw — source texture", CASE / "round3/renders/trellis2-raw/three_quarter_right.png"),
    ("raw — clay geometry", ROOT / "diagnosis/raw-clay/three_quarter_right.png"),
    ("round-3 budget — source texture", CASE / "round3/renders/trellis2-budget/three_quarter_right.png"),
    ("round-3 budget — clay geometry", ROOT / "diagnosis/budget-clay/three_quarter_right.png"),
]
diagnosis = Image.new("RGB", (CELL * len(diagnosis_cells), CELL + LABEL_HEIGHT), (24, 24, 24))
diagnosis_draw = ImageDraw.Draw(diagnosis)
for index, (label, image_path) in enumerate(diagnosis_cells):
    image = Image.open(image_path).convert("RGB").resize((CELL, CELL), Image.Resampling.LANCZOS)
    diagnosis.paste(image, (index * CELL, LABEL_HEIGHT))
    diagnosis_draw.text((index * CELL + 10, 8), label, fill="white", font=label_font)
diagnosis.save(ROOT / "diagnosis-stage-sheet.png", compress_level=9)

crop_dir = ROOT / "crops-column-base"
crop_dir.mkdir(parents=True, exist_ok=True)
crop_sheet = Image.new(
    "RGB",
    ((CROP_BOX[2] - CROP_BOX[0]) * len(columns), CROP_BOX[3] - CROP_BOX[1] + LABEL_HEIGHT),
    (24, 24, 24),
)
crop_draw = ImageDraw.Draw(crop_sheet)
individuals: list[dict[str, object]] = []
for column_index, (label, _, budget_path) in enumerate(columns):
    source = Image.open(budget_path).convert("RGB")
    crop = source.crop(CROP_BOX)
    magnified = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST)
    slug = label.lower().replace(" ", "-").replace("=", "").replace(",", "").replace(".", "")
    out = crop_dir / f"{slug}-budget-2x-nearest.png"
    magnified.save(out, compress_level=9)
    crop_sheet.paste(crop, (column_index * crop.width, LABEL_HEIGHT))
    crop_draw.text((column_index * crop.width + 8, 8), label, fill="white", font=label_font)
    individuals.append({"column": label, "source": str(budget_path), "path": str(out)})
crop_sheet.save(ROOT / "column-base-crops-budget.png", compress_level=9)

(ROOT / "evidence-layout.json").write_text(
    json.dumps(
        {
            "contactSheet": "contact-sheet-raw-budget.png",
            "diagnosisSheet": "diagnosis-stage-sheet.png",
            "rows": ["raw", "budget"],
            "columns": [column[0] for column in columns],
            "treatmentRawNote": "All four optimizer treatments share the exact Round-3 raw GLB/render.",
            "cropBox1280Pixels": list(CROP_BOX),
            "cropBoxConvention": "left, top, right, bottom",
            "magnification": "2x NEAREST; no invented interpolation",
            "cropSheet": "column-base-crops-budget.png",
            "individualCrops": individuals,
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
