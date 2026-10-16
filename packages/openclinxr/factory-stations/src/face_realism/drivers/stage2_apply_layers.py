"""Face-station stage-2 driver: skin_layers.apply_layers at the case's weights.

Read-and-run wrapper over the landed instrument
(tools/openclinxr/asset-pipeline/skin/families/skin_layers.py): loads the
picked family PNG, applies apply_layers at the given weights, writes the
output PNG. All-zero weights return a byte copy by construction
(skin_layers.apply_layers early-returns src.copy()). Prints the out sha256.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--families-dir", required=True)
    ap.add_argument("--family", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    sys.path.insert(0, a.families_dir)
    sys.path.insert(0, str(Path(a.families_dir).parent / "face-replay"))
    import skin_layers  # noqa: E402  (landed stage script)

    fam_path = Path("/Volumes/files/openclinxr-assets/store") / a.family
    src = np.asarray(Image.open(fam_path).convert("RGB"))
    weights = json.loads(a.weights)
    if all(float(weights.get(k, 0.0)) == 0.0 for k in skin_layers.LAYER_ORDER):
        out = skin_layers.apply_layers(src, {}, None, weights)
    else:
        masks = skin_layers.build_masks()
        fa = None
        if float(weights.get("freckles", 0.0)) != 0.0:
            blobs = skin_layers.freckle_blobs(masks["freckle_zone"], masks)
            fa = skin_layers.freckle_alpha(
                src.shape[:2], blobs[: skin_layers.FRECKLE_DENSITIES["med"]])
        out = skin_layers.apply_layers(src, masks, fa, weights)
    out_path = Path(a.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(out_path)
    print("STAGE2_OK out=%s sha256=%s" % (out_path, sha256_file(out_path)))


if __name__ == "__main__":
    main()
