"""Make the Blender-baked pore tile exactly periodic (8px edge crossfade).

The bake itself is tileable by construction (modulo-wrapped Voronoi coords in
bake_skin_maps.py); bump-derived normals use screen-space derivatives, so the
single edge rows carry interior-neighbour noise. This blends the 8px edge
strips of opposite sides so the seam step matches the interior texel step.
Run once; the manifest records the resulting sha256.
"""
import sys

from PIL import Image
import numpy as np

path = sys.argv[1]
img = np.asarray(Image.open(path).convert("RGB")).astype(float)
H, W, _ = img.shape
band = 8
out = img.copy()
for i in range(band):
    t = i / (band - 1)
    out[i, :, :] = (1 - t) * img[i, :, :] + t * img[H - band + i, :, :]
    out[H - band + i, :, :] = (1 - t) * img[H - band + i, :, :] + t * img[i, :, :]
    out[:, i, :] = (1 - t) * img[:, i, :] + t * img[:, W - band + i, :]
    out[:, W - band + i, :] = (1 - t) * img[:, W - band + i, :] + t * img[:, i, :]
Image.fromarray(out.astype(np.uint8)).save(path)
a = np.asarray(Image.open(path).convert("RGB")).astype(float)
print(f"row interior={np.abs(np.diff(a, axis=0)).mean():.3f} seam={np.abs(a[-1] - a[0]).mean():.3f}")
print(f"col interior={np.abs(np.diff(a, axis=1)).mean():.3f} seam={np.abs(a[:, -1] - a[:, 0]).mean():.3f}")
