"""Brow ink per bake-off option. Instrument: regen2/measure.py brow_box
(sRGB -> CIELAB L, strand coverage = fraction of box pixels with L<28),
box x[300,724] y[400,470] at 1024 portrait scaled 1.25x to 1280:
x[375,905] y[500,588]. Shipped band 14-22% cited from
.openclinxr/realism-spike/polish/RESULT.md:3 and STATION-DESIGN.md:105
(not re-derived here; ref-shipped render measured alongside for anchoring).
"""
import json

import numpy as np
from PIL import Image

R = "tools/openclinxr/evidence/brow-form/renders"
BOX = (375, 905, 500, 588)  # x0,x1,y0,y1 at 1280


def srgb_to_L(rgb):
    c = rgb.astype(float) / 255.0
    m = c <= 0.04045
    c[m] = c[m] / 12.92
    c[~m] = ((c[~m] + 0.055) / 1.055) ** 2.4
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    d = xyz > 0.008856
    xyz[d] = xyz[d] ** (1 / 3)
    xyz[~d] = 7.787 * xyz[~d] + 16 / 116
    return 116 * xyz[..., 1] - 16


out = {}
for tag in ("browform-opt1-hybrid", "browform-opt2-texonly",
            "browform-opt3-meshonly", "browform-ref-shipped"):
    a = np.asarray(Image.open(f"{R}/{tag}-front.png").convert("RGB"))
    assert a.shape[:2] == (1280, 1280), a.shape
    x0, x1, y0, y1 = BOX
    L = srgb_to_L(a[y0:y1, x0:x1].reshape(-1, 3)).reshape(y1 - y0, x1 - x0)
    out[tag] = {"meanL": round(float(L.mean()), 2),
                "ink_L28": round(float((L < 28).mean()), 4)}
print(json.dumps(out, indent=1))
