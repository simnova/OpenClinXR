#!/usr/bin/env python3
"""Isolated dermal-F1 skin-normal bake (dermal-f1 slice).

Fresh Blender process: create_human + enhanced_skin + configure_skin_normal_detail
+ bake_skin_normal_to_texture. No garments/hair/eyes, no full materialize.
Saves $OPENCLINXR_JOB_TMP/skin-normal.png + face-island crop (u>=0.65) and
prints the bake census. Run under blender --background --python; OUT_DIR env
provides the unique job tmp dir.
"""
import importlib.util
import json
import os
import pathlib
import sys

import bpy
import numpy as np

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT_DIR = pathlib.Path(os.environ["OPENCLINXR_JOB_TMP"])
OUT_DIR.mkdir(parents=True, exist_ok=True)
RES = int(os.environ.get("DERMAL_F1_RES", "1024"))

# Voronoi feature enum available on this Blender (F1 must be present).
from bpy.types import ShaderNodeTexVoronoi as _V  # noqa: E402

print("VORONOI_FEATURE_ENUM " + json.dumps(
    [e.identifier for e in _V.bl_rna.properties["feature"].enum_items]))

# MPFB must be enabled before any bl_ext import (logservice reads the
# addon context). Do this before loading the materialize module too.
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
assert "bl_ext.user_default.mpfb" in bpy.context.preferences.addons, "mpfb addon did not enable"
print("MPFB_ADDON enabled")

# Load the WIP module for its (already edited) configure/bake functions.
_spec = importlib.util.spec_from_file_location(
    "dermal_f1_materialize",
    str(REPO_ROOT / "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"),
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _mod
_spec.loader.exec_module(_mod)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.materialservice import MaterialService  # noqa: E402

human = HumanService.create_human(feet_on_ground=True)
bpy.context.view_layer.update()

SKIN_NAME = "mpfb_skin_dermal_f1_isolated"
_skin_mat = MaterialService.create_v2_skin_material(SKIN_NAME, human)

out_png = OUT_DIR / "skin-normal.png"
img = _mod.bake_skin_normal_to_texture(human, SKIN_NAME, str(out_png), resolution=RES)

# Census on the baked pixels (float 0..1 buffer -> 0..255), every 4th texel,
# skipping black atlas gutter — same sampling as the shipped-map contract.
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float64).reshape(h, w, 4) * 255.0
sub = px[0:h:4, 0:w:4, :]
r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
non_gutter = ~((r < 0.5) & (g < 0.5) & (b < 0.5))
rs_all = r[non_gutter]
flat = (np.abs(r - 128) <= 2) & (np.abs(g - 128) <= 2) & (b >= 251)
flat_frac = float(flat[non_gutter].mean()) if rs_all.size else 1.0
sd_r = float(rs_all.std()) if rs_all.size else 0.0
# Adjacent-MAD along rows, gutter breaking runs (contract-equivalent).
adj = []
for row in range(sub.shape[0]):
    prev = None
    for col in range(sub.shape[1]):
        if not non_gutter[row, col]:
            prev = None
            continue
        v = r[row, col]
        if prev is not None:
            adj.append(abs(v - prev))
        prev = v
mad = float(np.mean(adj)) if adj else 0.0
incoherence = mad / sd_r if sd_r > 0 else 1.0
print("DERMAL_F1_CENSUS " + json.dumps({
    "resolution": w,
    "nonGutterTexels": int(rs_all.size),
    "sdR": round(sd_r, 3),
    "flatFraction": round(flat_frac, 4),
    "adjacentMAD": round(mad, 3),
    "incoherence": round(incoherence, 4),
    "gateSdGe8": sd_r >= 8,
    "gateIncoherenceLe06": incoherence <= 0.6,
}))

# Face-island crop: right side of the atlas (u >= 0.65), saved beside the bake.
x0 = int(0.65 * w)
crop_w = w - x0
crop = bpy.data.images.new("dermal_f1_face_crop", crop_w, h)
full = px  # (h, w, 4) float 0..255
crop_px = np.zeros((h, crop_w, 4), dtype=np.float64)
crop_px[..., :3] = full[:, x0:w, :3] / 255.0
crop_px[..., 3] = 1.0
crop.pixels = crop_px.ravel().tolist()
crop.filepath_raw = str(OUT_DIR / "skin-normal-face-crop-u065.png")
crop.file_format = "PNG"
crop.save()
print("DERMAL_F1_CROP " + str(OUT_DIR / "skin-normal-face-crop-u065.png")
      + f" bytes={(OUT_DIR / 'skin-normal-face-crop-u065.png').stat().st_size}")
