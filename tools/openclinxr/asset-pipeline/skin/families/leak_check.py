"""P2 leak gate: how much studio light is baked into an atlas on the MakeHuman UV.

For an atlas PNG and a subject GLB:
  (1) S = studio irradiance baked into the UV (Blender Cycles DIFFUSE bake,
      direct+indirect only, AO off) under the realism-chain studio rig, or
      loaded from --s-cache. Studio structure (light colours, head-relative
      placement, ACES+RoomEnvironment ownership) is read from
      packages/openclinxr/xr-scene/src/isolated-subject-rig-variants.ts
      (applyRigOverride studio branch); concrete numbers are the final-b
      studio that grades sym/out-albedo.png (sym/final-b.variant.json).
      Nothing is guessed: every constant cites its source below.
  (2) atlas -> Lab L, low band (downsample to 64, upsample), Pearson r of
      that band with S and with analytic normal.y on skin texels.
  (3) signed and absolute mesh-mirror low-band L bias through the mirror
      correspondence built exactly like face-replay/fix_sym.py (reflect x
      about the mesh centre, nearest-vertex lookup).

Skin texels = derive facecore mask minus lips/eyes/brows feature masks
(eyes stand in for the caruncle; no caruncle mask exists), intersected with
the derive occupancy map. Outputs one JSON row to --row-out.

Texture convention everywhere: row=v*S, col=u*S (three.js flipY=false;
trimesh V flipped once on load, same as face-replay/derive.py).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"

# --- Studio rig: structure from isolated-subject-rig-variants.ts ---
# HemisphereLight(sky #ffffff, ground #8a8a8a, hemisphereIntensity), key
# DirectionalLight #fff1e0 at (az, el) 2 m head-relative, fill #dfe8ff at
# (-az, 10 deg), rim #ffffff at (az 180, el 40), ACESFilmic + exposure,
# RoomEnvironment IBL at environmentIntensity. Concrete numbers: the final-b
# studio (sym/final-b.variant.json) that grades the Aisha realism atlas.
STUDIO = {
    "keyAzimuthDeg": 15,
    "keyElevationDeg": 20,
    "keyIntensity": 2.7,
    "fillIntensity": 1.3,
    "hemisphereIntensity": 0.3,
    "rimIntensity": 0.5,
    "exposure": 0.3762,
    "environmentIntensity": 0.9,
    "keyColor": "#fff1e0",
    "fillColor": "#dfe8ff",
    "hemiSky": "#ffffff",
    "hemiGround": "#8a8a8a",
    "rimColor": "#ffffff",
    "provenance": ("structure: packages/openclinxr/xr-scene/src/"
                   "isolated-subject-rig-variants.ts applyRigOverride studio "
                   "branch; numbers: realism-spike/sym/final-b.variant.json "
                   "rigOverride.studio (the rig grading sym/out-albedo.png)"),
}
# Blender-side transfer (recorded, scale-free: Pearson r is scale-invariant,
# so only direction/colour/ratio choices matter):
#  - SUN energies copy three.js intensities verbatim (key 2.7 / fill 1.3 /
#    rim 0.5); directions copy az/el at 2 m.
#  - hemisphere + RoomEnvironment IBL collapse to a uniform world background:
#    strength = hemi*mean(sky,ground luminance) + env*0.5
#    = 0.3*0.63 + 0.9*0.5. ACES + exposure are display scale: skipped.
WORLD_STRENGTH = round(
    STUDIO["hemisphereIntensity"] * 0.63
    + STUDIO["environmentIntensity"] * 0.5, 4)
BAKE_SAMPLES = 128
BAKE_SIZE = 2048
BAKE_MARGIN = 8
AO_HIDE = ("jeans", "pant", "shoe", "boot", "shirt", "t_shirt", "hair",
           "mhair", "blunt", "bob", "cap", "hat", "glass", "icosphere")

BAKE_TMPL = """import bpy
from mathutils import Vector
GLB = r\"\"\"{glb}\"\"\"
OUT = r\"\"\"{out}\"\"\"
SIZE = {size}
# channel literals: key #fff1e0 has red 0xFF, fill #dfe8ff has blue 0xFF
KEY = ({az}, {el}, {key_e}, (1.0, {key_g}, {key_b}))
FILL = ({faz}, {fel}, {fill_e}, ({fill_r}, {fill_g}, 1.0))
RIM = (180.0, 40.0, {rim_e}, (1.0, 1.0, 1.0))
WORLD = {world}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = {samples}
scene.cycles.seed = 0
scene.cycles.use_denoising = False
# world: uniform ambient proxy for hemisphere + RoomEnvironment IBL
world = bpy.data.worlds.new("leak_world")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
bg.inputs["Strength"].default_value = WORLD
scene.world = world
# no default lights: the studio rig owns all illumination
for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)
HIDE = {hide}
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    if any(s in o.name.lower() for s in HIDE):
        o.hide_render = True
# same convention as face-replay/derive.py load_subject: the body.001 mesh
# when present (the mesh the derive masks were rasterized from), else the
# largest visible mesh.
skin_obj = None
best = -1
cands = [o for o in bpy.data.objects
         if o.type == "MESH" and not o.hide_render]
for o in cands:
    if "body.001" not in o.name.lower():
        continue
    n = len(getattr(o.data, "polygons", []))
    if n > best:
        best = n
        skin_obj = o
if skin_obj is None:
    for o in cands:
        n = len(getattr(o.data, "polygons", []))
        if n > best:
            best = n
            skin_obj = o
assert skin_obj is not None, "no skin object"
print("skin:", skin_obj.name, "polys:", best, flush=True)
import math
def place(az, el, R=2.0):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e) * R,
                   math.sin(e) * R,
                   math.cos(a) * math.cos(e) * R))
def add_sun(name, color, energy, az, el):
    bpy.ops.object.light_add(type="SUN")
    sun = bpy.context.active_object
    sun.name = name
    sun.data.color = color
    sun.data.energy = energy
    sun.location = place(az, el)
    d = (-sun.location).normalized()
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return sun
key = add_sun("studio_key", KEY[3], KEY[2], KEY[0], KEY[1])
fil = add_sun("studio_fill", FILL[3], FILL[2], FILL[0], FILL[1])
rim = add_sun("studio_rim", RIM[3], RIM[2], RIM[0], RIM[1])
# white diffuse override on the skin: bake reads irradiance, not albedo
mat = bpy.data.materials.new("leak_white")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
bsdf.inputs["Roughness"].default_value = 1.0
skin_obj.data.materials.clear()
skin_obj.data.materials.append(mat)
# 8-bit PNG: Pearson r on smooth irradiance is robust to quantization;
# (Image has no per-image bit-depth knob on this Blender build.)
img = bpy.data.images.new("leak_S", SIZE, SIZE, alpha=False)
img.file_format = "PNG"
node = mat.node_tree.nodes.new("ShaderNodeTexImage")
node.image = img
node.select = True
mat.node_tree.nodes.active = node
bpy.ops.object.select_all(action="DESELECT")
skin_obj.select_set(True)
bpy.context.view_layer.objects.active = skin_obj
bk = scene.render.bake
bk.use_pass_direct = True
bk.use_pass_indirect = True
bk.use_pass_color = False
bk.margin = {margin}
bpy.ops.object.bake(type="DIFFUSE")
img.filepath_raw = OUT
img.save()
print("S_BAKE_DONE", flush=True)
"""


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def bake_studio_irradiance(glb: Path, out_png: Path) -> None:
    kr, kg, kb = hex_rgb(STUDIO["keyColor"])
    fr, fg, fb = hex_rgb(STUDIO["fillColor"])
    script = BAKE_TMPL.format(
        glb=str(glb.absolute()), out=str(out_png.absolute()),
        size=BAKE_SIZE, samples=BAKE_SAMPLES, margin=BAKE_MARGIN,
        hide=repr(AO_HIDE),
        az=STUDIO["keyAzimuthDeg"], el=STUDIO["keyElevationDeg"],
        key_e=STUDIO["keyIntensity"], key_g=kg, key_b=kb,
        faz=-STUDIO["keyAzimuthDeg"], fel=10,
        fill_e=STUDIO["fillIntensity"], fill_r=fr, fill_g=fg,
        rim_e=STUDIO["rimIntensity"], world=WORLD_STRENGTH)
    tmp = out_png.parent / "bake_S_tmp.py"
    tmp.write_text(script)
    r = subprocess.run([BLENDER, "--background", "--python", str(tmp)],
                       capture_output=True, text=True)
    tail = (r.stdout + r.stderr)[-800:]
    if r.returncode != 0 or "S_BAKE_DONE" not in (r.stdout + r.stderr):
        raise RuntimeError("S bake failed exit=%d tail=%s"
                           % (r.returncode, tail))
    print("S baked -> %s" % out_png, flush=True)


def load_skin(glb_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """World-space verts/faces/UVs of the skin mesh (derive.py convention)."""
    sc = trimesh.load(str(glb_path), force="scene")
    geoms: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for node in sc.graph.nodes_geometry:
        T, name = sc.graph[node]
        g = sc.geometry[name]
        v = trimesh.transform_points(np.asarray(g.vertices, dtype=np.float64), T)
        uv = np.asarray(g.visual.uv, dtype=np.float64)
        if uv.ndim == 2 and uv.shape[1] == 2:
            uv = uv.copy()
            uv[:, 1] = 1.0 - uv[:, 1]
        geoms.setdefault(name, (v, np.asarray(g.faces, dtype=np.int64), uv))
    cand = [(v, f, uv) for nm, (v, f, uv) in geoms.items()
            if "body.001" in nm.lower()]
    if cand:
        v, f, uv = max(cand, key=lambda c: len(c[0]))
    else:
        name = max(geoms, key=lambda k: len(geoms[k][0]))
        v, f, uv = geoms[name]
    return v, f, uv


def bilin(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    from scipy.ndimage import map_coordinates
    c = np.clip(u, 0, img.shape[1] - 1.001)
    r = np.clip(v, 0, img.shape[0] - 1.001)
    return map_coordinates(img, [r, c], order=1, mode="nearest")


def mask01(p: Path, S: int) -> np.ndarray:
    m = np.asarray(Image.open(p).convert("L"), np.float32) / 255.0
    if m.shape != (S, S):
        m = np.asarray(
            Image.fromarray((m * 255).astype(np.uint8)).resize(
                (S, S), Image.BILINEAR), np.float32) / 255.0
    return m


def pearson(x: np.ndarray, y: np.ndarray) -> float:
    x = x.astype(np.float64).ravel()
    y = y.astype(np.float64).ravel()
    xm, ym = x - x.mean(), y - y.mean()
    den = float(np.sqrt((xm ** 2).sum() * (ym ** 2).sum()))
    if den == 0:
        return 0.0
    return float((xm * ym).sum() / den)


def lowband(img: np.ndarray) -> np.ndarray:
    """Downsample to 64, upsample back (P2 low band)."""
    small = cv2.resize(img, (64, 64), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (img.shape[1], img.shape[0]),
                      interpolation=cv2.INTER_LINEAR)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("atlas", type=Path)
    ap.add_argument("glb", type=Path)
    ap.add_argument("--derive-dir", type=Path, required=True)
    ap.add_argument("--s-cache", type=Path, required=True)
    ap.add_argument("--row-out", type=Path, required=True)
    ap.add_argument("--label", type=str, required=True)
    a = ap.parse_args(argv)
    t0 = time.time()

    S = BAKE_SIZE
    rgb = np.asarray(Image.open(a.atlas).convert("RGB"))
    if rgb.shape[0] != S or rgb.shape[1] != S:
        rgb = np.asarray(Image.fromarray(rgb).resize(
            (S, S), Image.LANCZOS))
        resized = True
    else:
        resized = False

    # (1) studio irradiance S into the UV: bake once, then load from cache.
    a.s_cache.parent.mkdir(parents=True, exist_ok=True)
    if not a.s_cache.exists():
        bake_studio_irradiance(a.glb, a.s_cache)
    s_rgb = np.asarray(Image.open(a.s_cache).convert("RGB"),
                       dtype=np.float64) / 255.0
    if s_rgb.shape[0] != S or s_rgb.shape[1] != S:
        raise RuntimeError("S cache is %s, want %dx%d"
                           % (s_rgb.shape, S, S))
    S_lum = (0.2126 * s_rgb[:, :, 0] + 0.7152 * s_rgb[:, :, 1]
             + 0.0722 * s_rgb[:, :, 2])

    # (2) atlas low-band luminance; analytic normal.y raster.
    lab = cv2.cvtColor((rgb.astype(np.float32) / 255.0),
                       cv2.COLOR_RGB2LAB)
    low_L = lowband(lab[:, :, 0].astype(np.float64))

    V, F, UV = load_skin(a.glb)
    nrm = trimesh.Trimesh(vertices=V, faces=F,
                          process=False).vertex_normals
    ny = np.asarray(nrm)[:, 1]
    u = np.clip(UV[:, 0] * S, 0, S - 1.001)
    v = np.clip(UV[:, 1] * S, 0, S - 1.001)
    ix = np.clip((UV[:, 0] * S).astype(int), 0, S - 1)
    iy = np.clip((UV[:, 1] * S).astype(int), 0, S - 1)
    acc = np.zeros((S, S), np.float64)
    cnt = np.zeros((S, S), np.float64)
    np.add.at(acc, (iy, ix), ny)
    np.add.at(cnt, (iy, ix), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        ny_map = np.where(cnt > 0, acc / np.maximum(cnt, 1e-9), 0)
    ny_map = cv2.GaussianBlur(ny_map, (0, 0), 8)

    # skin texel set: facecore minus features, inside occupancy.
    d = a.derive_dir
    core = mask01(d / "mask-facecore.png", S)
    feat = np.maximum.reduce([
        mask01(d / "mask-lips.png", S),
        mask01(d / "mask-eyes-L.png", S),
        mask01(d / "mask-eyes-R.png", S),
        mask01(d / "mask-brows-L.png", S),
        mask01(d / "mask-brows-R.png", S),
    ])
    occ = mask01(d / "occupancy.png", S)
    safe = (core > 0.5) & (feat <= 0.5) & (occ > 0.5)
    r_S = pearson(low_L[safe], S_lum[safe])
    r_ny = pearson(low_L[safe], ny_map[safe])

    # (3) mesh-mirror low-band bias (fix_sym.py construction: reflect x
    # about the mesh centre, nearest-vertex lookup), vertex-weighted.
    cx = float((V[:, 0].min() + V[:, 0].max()) / 2)
    mir = cKDTree(V).query(
        np.column_stack([2 * cx - V[:, 0], V[:, 1], V[:, 2]]))[1]
    w = bilin(core, u, v) * (1.0 - bilin(feat, u, v))
    Lv = bilin(low_L, u, v)
    um = np.clip(UV[mir, 0] * S, 0, S - 1.001)
    vm = np.clip(UV[mir, 1] * S, 0, S - 1.001)
    Lm = bilin(low_L, um, vm)
    dl = Lv - Lm
    wsum = float(w.sum())
    mirror_signed = float((w * dl).sum() / wsum)
    mirror_abs = float((w * np.abs(dl)).sum() / wsum)
    n_pairs = int((w > 0.01).sum())

    row = {
        "label": a.label,
        "atlas": str(a.atlas),
        "atlas_sha256": sha256_file(a.atlas),
        "atlas_resized_to_2048": resized,
        "glb": str(a.glb),
        "glb_sha256": sha256_file(a.glb),
        "derive_dir": str(a.derive_dir),
        "s_cache": str(a.s_cache),
        "s_sha256": sha256_file(a.s_cache),
        "rig": dict(STUDIO),
        "world_strength": WORLD_STRENGTH,
        "bake": ("Cycles CPU %d samples seed 0, DIFFUSE direct+indirect "
                 "no-colour margin %d, white-roughness-1 override, AO off "
                 "(no AO node present)" % (BAKE_SAMPLES, BAKE_MARGIN)),
        "lowband": "Lab L (cv2 RGB2LAB) downsampled to 64x64 (INTER_AREA) "
                   "then upsampled (INTER_LINEAR)",
        "normal_y": "analytic world-space vertex normals splatted to UV "
                    "+ gaussian sigma 8 (no Blender bake: exact, same-texel)",
        "mirror": ("fix_sym.py construction: reflect x about mesh centre-x, "
                   "cKDTree nearest vertex; vertex-weighted by "
                   "core*(1-feat)"),
        "skin_set": ("facecore>0.5 minus lips/eyes/brows>0.5 (eyes proxy "
                     "caruncle) inside occupancy>0.5"),
        "n_skin_texels": int(safe.sum()),
        "n_mirror_pairs": n_pairs,
        "r_S": round(r_S, 4),
        "r_normal_y": round(r_ny, 4),
        "mirror_signed_L": round(mirror_signed, 4),
        "mirror_abs_L": round(mirror_abs, 4),
        "wall_s": round(time.time() - t0, 1),
    }
    a.row_out.parent.mkdir(parents=True, exist_ok=True)
    with open(a.row_out, "w") as f:
        json.dump(row, f, indent=1)
    print("row %s: r_S=%.4f r_ny=%.4f mirror_signed=%.4f mirror_abs=%.4f "
          "n=%d pairs=%d" % (a.label, r_S, r_ny, mirror_signed, mirror_abs,
                             int(safe.sum()), n_pairs), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
