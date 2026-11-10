"""env_to_three.py <blender_pano.npy> <out.f16> <width>: resample a Blender equirect panorama (rows top-first,
Blender Z-up world, as written by target_scene_env.py + a bpy pixel dump) into three.js's equirect convention
as raw RGBA float16, row 0 = bottom.

Blender pano (camera at rotation (90, 0, 180) deg, measured from the three emitters): u_B = .5 + atan2(-x, -y)/2pi,
v_B (top-first) = .5 - asin(z)/pi. glTF import maps three (X, Y, Z) -> Blender (X, -Z, Y). three equirect:
u = atan2(dz, dx)/2pi + .5, v (row 0 = bottom) = asin(dy)/pi + .5.
"""
import sys
import numpy as np

src, out, W = sys.argv[1], sys.argv[2], int(sys.argv[3])
p = np.load(src)[..., :3].astype(np.float64)
hB, wB, _ = p.shape
H = W // 2
u = (np.arange(W) + .5) / W
v = (np.arange(H) + .5) / H
uu, vv = np.meshgrid(u, v)
phi = (uu - .5) * 2 * np.pi          # atan2(dz, dx)
el = (vv - .5) * np.pi               # asin(dy), row 0 = bottom
dx = np.cos(el) * np.cos(phi); dz = np.cos(el) * np.sin(phi); dy = np.sin(el)
xB, yB, zB = dx, -dz, dy
uB = (.5 + np.arctan2(-xB, -yB) / (2 * np.pi)) % 1.0
vB = .5 - np.arcsin(np.clip(zB, -1, 1)) / np.pi
# bilinear sample, u wraps
fx = uB * wB - .5; fy = np.clip(vB * hB - .5, 0, hB - 1)
x0 = np.floor(fx).astype(int); y0 = np.floor(fy).astype(int); tx = fx - x0; ty = fy - y0
x0m = x0 % wB; x1 = (x0 + 1) % wB; y1 = np.minimum(y0 + 1, hB - 1)
s = (p[y0, x0m] * ((1 - tx) * (1 - ty))[..., None] + p[y0, x1] * (tx * (1 - ty))[..., None]
     + p[y1, x0m] * ((1 - tx) * ty)[..., None] + p[y1, x1] * (tx * ty)[..., None])
rgba = np.concatenate([s, np.ones((H, W, 1))], -1).astype(np.float16)
rgba.tofile(out)
# self-check: brightest direction per emitter, in three coords
L = s.mean(-1)
for name, (bx, by, bz) in {"KEY": (-1.5, -2.0, 2.2), "FILL": (1.5, -2.0, 1.8), "RIM": (0.0, 2.0, 2.6)}.items():
    d = np.array([bx, bz - 1.52, -by]); d /= np.linalg.norm(d)
    uu_ = np.arctan2(d[2], d[0]) / (2 * np.pi) + .5; vv_ = np.arcsin(d[1]) / np.pi + .5
    print("%s centre-dir three u %.3f v %.3f L there %.2f" % (name, uu_, vv_, L[int(vv_ * H), int(uu_ * W) % W]))
print("WROTE", out, W, H, "mean %.3f max %.2f" % (L.mean(), L.max()))
