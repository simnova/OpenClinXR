"""Face-station stage-3 family-base driver: the case's own stage-2 skin at the derive size.

A case with no goal-derived donor island or colour solve enters the skin chain
from its stage-2 output (the tone-picked skin family with the case layer
weights). The family atlases are 2048 px; the chain's derive size and every
physical-scale stage (detail_bands texels_per_mm) are defined at the derive
size, so this driver resamples the atlas to that size once, with PIL LANCZOS
(deterministic for fixed input bytes and PIL version), and prints one JSON
line: {"in_size": [w, h], "out_size": [w, h], "out_sha256": "..."}.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--size", type=int, required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    img = Image.open(a.src).convert("RGB")
    w, h = img.size
    if w != h:
        raise SystemExit(f"family atlas {w}x{h} is not square: refused")
    out = img if w == a.size else img.resize((a.size, a.size), Image.LANCZOS)
    out.save(a.out, format="PNG")
    print(json.dumps({
        "in_size": [w, h],
        "out_size": list(out.size),
        "out_sha256": sha256_file(Path(a.out)),
    }))


if __name__ == "__main__":
    main()
