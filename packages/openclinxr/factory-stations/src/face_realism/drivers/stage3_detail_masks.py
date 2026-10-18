"""Face-station stage-3 driver: detail_bands exclusion masks.

Recomputes the three union masks the tracked replay builds inline for its
detail_bands stage (tools/openclinxr/asset-pipeline/skin/face-replay/replay.py
run_stage detail_bands branch): eye union (max of the derive eyes-L/R
masks), brow union (max of the derive brows-L/R masks), and the
lip-vermilion albedo union via replay._vermilion_union (segmented from the
LIPS-stage albedo with the derive lips mask as base region, handback 8).

Reuse, not a copy: the vermilion segmentation is imported from the landed
replay module; the eye/brow unions are the same two-line max operation the
replay performs inline. Prints a JSON object with the three absolute mask
paths (stdout only; the caller records shas).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def max_union(first: Path, second: Path, out: Path) -> Path:
    a = np.array(Image.open(first).convert("L"))
    b = np.array(Image.open(second).convert("L"))
    Image.fromarray(np.maximum(a, b)).save(out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--face-replay-dir", required=True)
    ap.add_argument("--albedo", required=True)
    ap.add_argument("--albedo-lips", default="")
    ap.add_argument("--derive-out", required=True)
    ap.add_argument("--store", required=True)
    a = ap.parse_args()
    sys.path.insert(0, a.face_replay_dir)
    from replay import _vermilion_union  # noqa: E402  (landed stage script)

    derive_out = Path(a.derive_out)
    store = Path(a.store)
    store.mkdir(parents=True, exist_ok=True)
    eyes = max_union(
        derive_out / "mask-eyes-L.png",
        derive_out / "mask-eyes-R.png",
        store / "eye-mask-union.png",
    )
    brows = max_union(
        derive_out / "mask-brows-L.png",
        derive_out / "mask-brows-R.png",
        store / "brow-mask-union.png",
    )
    lips_albedo = Path(a.albedo_lips) if a.albedo_lips else None
    if lips_albedo is None or not lips_albedo.exists():
        lips_albedo = Path(a.albedo)
    vermilion = _vermilion_union(store, lips_albedo, derive_out)
    print(json.dumps({
        "eyes_mask": str(eyes),
        "brows_mask": str(brows),
        "lips_mask": str(vermilion),
    }))


if __name__ == "__main__":
    main()
