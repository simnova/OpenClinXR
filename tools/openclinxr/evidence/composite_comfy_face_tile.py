#!/usr/bin/env python3
"""Composite a Comfy-generated face tile onto a base albedo using source UV masks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


def main() -> None:
    args = parse_args()
    base = Image.open(args.base_texture).convert("RGBA").resize((args.size, args.size), Image.Resampling.LANCZOS)
    tile = Image.open(args.face_tile).convert("RGBA").resize((args.size, args.size), Image.Resampling.LANCZOS)
    mask_report = json.loads(Path(args.mask_report).read_text(encoding="utf-8"))
    face_mask_path = Path(mask_report["outputs"]["face_front"]["path"])
    if not face_mask_path.is_absolute():
        face_mask_path = Path.cwd() / face_mask_path
    mask = Image.open(face_mask_path).convert("L").resize((args.size, args.size), Image.Resampling.LANCZOS)

    masked_tile = Image.new("RGBA", base.size, (0, 0, 0, 0))
    masked_tile.paste(tile, (0, 0), mask)
    output = Image.alpha_composite(base, masked_tile)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)
    print(f"Wrote composite albedo: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-texture", required=True)
    parser.add_argument("--face-tile", required=True)
    parser.add_argument("--mask-report", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, default=1024)
    return parser.parse_args()


if __name__ == "__main__":
    main()