"""exr_to_npy.py (Blender --background --python ... -- <in.exr> <out.npy>): float EXR -> numpy RGBA, top row first."""
import sys
import bpy
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
im = bpy.data.images.load(a[0])
w, h = im.size
px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
np.save(a[1], px)
print("DUMP", w, h, float(px[..., :3].max()), float(px[..., :3].mean()))
