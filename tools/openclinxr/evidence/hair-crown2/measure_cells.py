#!/usr/bin/env python3
"""hair-crown2: ruler stats for every scored cell (same ruler as STEP 1)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E))
from ruler import rgb, stats  # noqa: E402

SIZE = 1024


def main():
    R = E / "ruler"
    rep = json.loads((R / "ruler_stats.json").read_text())
    bands = rep["bands"]
    for tag in ("base", "liner_s50", "liner_s75", "liner_s100", "spread"):
        d = E / "scores" / tag if tag != "base" else E / "base"
        line = {"cell": tag}
        for view in ("front", "back"):
            r0, r1 = bands[view]["ours"]
            band = np.zeros((SIZE, SIZE), bool)
            band[r0:r1, :] = True
            capm = np.asarray(Image.open(R / f"capmask_{view}.png").convert("L")) > 127
            alpha = np.asarray(Image.open(d / f"{view}-id.png").convert("RGBA"),
                               dtype=np.uint8)[..., 3]
            hair = alpha >= 30
            sil = ndimage.binary_dilation(ndimage.binary_closing(hair, iterations=7),
                                          iterations=5)
            ours = capm & sil & band
            st = stats(rgb(d / f"{view}.png"), ours)
            line[view] = {k: (round(v, 4) if isinstance(v, float) else v)
                          for k, v in st.items()}
        print(json.dumps(line), flush=True)


if __name__ == "__main__":
    main()
