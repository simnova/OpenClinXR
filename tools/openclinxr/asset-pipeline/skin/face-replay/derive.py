"""Mesh-only derivation of occlusion, occupancy, part masks, socket-wall masks, and landmark UVs.

Ported from S/derive/derive.py for the face-replay hand-steps chain.
Texture convention: row=v*S, col=u*S (flipY=false as three.js samples it).
trimesh returns V upside-down; we flip once on load.
Blender bakes need NO flip (verified by neon render grid S/derive/neon-A.png).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree

# --- Anatomical constants (metres; same for every adult subject) ---
LIP_RING = 0.008
BROW_BAND = 0.006
EYE_RING = 0.002
EAR_DROP = 0.012
NECK_DEPTH = 0.11
CHIN_SEARCH = 0.09
NOSTRIL_WIN = 0.020
FEATHER = {"lips": 6.0, "eyes": 6.0, "socket": 8.0, "brows": 16.0,
           "ears": 16.0, "default": 32.0}

# Blender AO definition (same as shade/bake_ao.py)
AO_SAMPLES = 96
AO_DISTANCE = 0.03
AO_MARGIN = 8
AO_HIDE = ("jeans", "pant", "shoe", "boot", "shirt", "t_shirt", "hair",
           "mhair", "blunt", "bob", "cap", "hat", "glass", "icosphere")

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"

BAKE_TMPL = """import os, time
import bpy
GLB = r\"\"\"{glb}\"\"\"
OUT = r\"\"\"{out}\"\"\"
SIZE = {size}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = {samples}
scene.cycles.use_denoising = False
HIDE = {hide}
skin_obj = None
best = -1
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    name = o.name.lower()
    if any(s in name for s in HIDE):
        o.hide_render = True
        print("hidden:", o.name, flush=True)
    else:
        print("occluder on:", o.name, flush=True)
for o in bpy.data.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    n = len(getattr(o.data, "polygons", []))
    if n > best:
        best = n
        skin_obj = o
assert skin_obj is not None, "no skin object"
print("skin:", skin_obj.name, "polys:", best, flush=True)
skin = skin_obj.data.materials[0]
img = bpy.data.images.new("derive_ao", SIZE, SIZE, alpha=False)
img.file_format = "PNG"
node = skin.node_tree.nodes.new("ShaderNodeTexImage")
node.image = img
node.select = True
skin.node_tree.nodes.active = node
bpy.ops.object.select_all(action="DESELECT")
skin_obj.select_set(True)
bpy.context.view_layer.objects.active = skin_obj
scene.cycles.seed = 0
t0 = time.time()
bpy.ops.object.bake(type="AO", use_clear=True, margin={margin},
                    max_ray_distance={dist}, use_selected_to_active=False)
dt = time.time() - t0
img.filepath_raw = OUT
img.save()
print("AO_BAKE_SECONDS=%.1f" % dt, flush=True)
"""


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


class NoBodySkinMeshError(RuntimeError):
    """Named refusal: no mesh in the GLB qualifies as derive skin."""


# A derive skin must be body-named and match none of these role/garment
# patterns (aisha-real-chain card tsk_adb53f2a4f22fd72: the decimated
# runtime LOD's fallback "largest mesh" picked an eyebrow card as SKIN).
ROLE_PATTERNS = ("eyebrow", "lash", "tearline", "teeth", "tongue", "eye",
                 "globe", "cornea", "cloth", "jean", "pant", "shoe", "boot",
                 "shirt", "hair", "glass", "hat", "cap")

# Split body primitives merge only when they partition one surface on one
# UV atlas: pairwise 3D-bbox-disjoint and pairwise UV-coverage IoU below
# this (measured at 256px). Base.glb splits 3D-nest (y-ranges subsets of
# body.001) so they never merge: largest primitive wins, byte-identical
# to S/derive/A.
MERGE_IOU_MAX = 0.05

# A derive skin must carry enough faces for 4096px masks. Measured:
# genuine subjects 70,504 (ref3) / 70,672 (lidconform) / 73,096 (base)
# faces; decimated runtime LOD assembly 10,705 faces merged (largest
# primitive 7,060); hand-steps synthetic fixture ~30k faces (must pass).
# Floor sits ~2x above the LOD assembly, ~3.5x below the smallest
# genuine subject.
SKIN_MIN_FACES = 20000


def _uv_coverage(uv: np.ndarray, faces: np.ndarray, size: int = 256) -> np.ndarray:
    img = np.zeros((size, size), np.uint8)
    px = np.clip((uv * size).astype(int), 0, size - 1)
    for tri in px[faces]:
        p = tri[:, ::-1][:, [1, 0]]
        cv2.fillPoly(img, [np.round(p).astype(np.int32)], 255)
    return img > 0


def _body_primitives_merge(geoms: dict, names: list[str]) -> tuple | None:
    """Merged (V, F, UV) when every pair is 3D-bbox-disjoint on one UV
    atlas, else None (caller picks the largest primitive)."""
    if len(names) < 2:
        return None
    for i in range(len(names)):
        vi = geoms[names[i]][0]
        uvi = geoms[names[i]][2]
        if not (isinstance(uvi, np.ndarray) and uvi.ndim == 2
                and uvi.shape[1] == 2 and len(uvi) == len(vi)):
            return None  # a part without per-vert UVs: not one atlas
        if not ((uvi >= 0.0).all() and (uvi <= 1.0).all()):
            return None
        for j in range(i + 1, len(names)):
            vj = geoms[names[j]][0]
            lo = np.maximum(vi.min(axis=0), vj.min(axis=0))
            hi = np.minimum(vi.max(axis=0), vj.max(axis=0))
            if bool((hi > lo).all()):
                return None  # 3D bboxes intersect: not a partition
            ci = _uv_coverage(geoms[names[i]][2], geoms[names[i]][1])
            cj = _uv_coverage(geoms[names[j]][2], geoms[names[j]][1])
            inter = int((ci & cj).sum())
            union = int((ci | cj).sum())
            if union and inter / union >= MERGE_IOU_MAX:
                return None  # UV stacks: separate atlases, not one
    parts = sorted(names, key=lambda k: len(geoms[k][0]), reverse=True)
    v_all, f_all, uv_all, off = [], [], [], 0
    for k in parts:
        v, f, uv = geoms[k]
        v_all.append(v)
        f_all.append(f + off)
        uv_all.append(uv)
        off += len(v)
    return (np.vstack(v_all), np.vstack(f_all), np.vstack(uv_all))


def find_mouth_loop(V: np.ndarray, F: np.ndarray, cx: float,
                    tcen: float | None) -> np.ndarray | None:
    """Largest centred boundary loop overlapping teeth height (n, xs, ys
    bounds are the chain's mouth-hole definition). Shared by
    load_subject (skin qualification) and main (the loop itself)."""
    for lp in sorted(boundary_loops(F), key=len, reverse=True):
        w = V[lp]
        xc = w[:, 0].mean()
        xs, ys = np.ptp(w[:, 0]), np.ptp(w[:, 1])
        if abs(xc - cx) < 0.010 and 0.030 < xs < 0.080 and ys < 0.060:
            if tcen is None or (w[:, 1].min() < tcen < w[:, 1].max() + 0.020):
                return lp
    return None


def load_subject(glb_path: Path) -> dict:
    """World-space verts/faces/UVs per mesh, roles by name substring."""
    s = trimesh.load(str(glb_path), force="scene")
    geoms = {}
    for node in s.graph.nodes_geometry:
        T, name = s.graph[node]
        g = s.geometry[name]
        v = trimesh.transform_points(np.asarray(g.vertices, dtype=np.float64), T)
        uv = np.asarray(g.visual.uv, dtype=np.float64)
        # trimesh returns V upside-down vs texture/renderer convention
        # (row=v*S, flipY=false): proven by neon capture (S/derive/neon-A.png
        # grid: unflipped masks render row-mirrored; stored maps applied raw
        # land on anatomy). Correct once here so every output is renderer-native.
        # Blender bakes need no flip (verified same orientation).
        if uv.ndim == 2 and uv.shape[1] == 2:
            uv = uv.copy()
            uv[:, 1] = 1.0 - uv[:, 1]
        geoms.setdefault(name, (v, np.asarray(g.faces, dtype=np.int64), uv))
    roles = {}
    body_names = [name for name, (v, f, uv) in geoms.items()
                  if "body" in name.lower()
                  and not any(s in name.lower() for s in ROLE_PATTERNS)
                  and isinstance(uv, np.ndarray) and uv.ndim == 2
                  and uv.shape[1] == 2 and len(uv) == len(v)]
    if not body_names:
        raise NoBodySkinMeshError(
            "NO_BODY_SKIN_MESH: no body-named mesh with per-vert UVs "
            "(excluding role meshes %s) in %s; meshes present: %s"
            % (",".join(ROLE_PATTERNS), glb_path, sorted(geoms)))
    merged = _body_primitives_merge(geoms, body_names)
    if merged is not None:
        v, f, uv = merged
        big = max(body_names, key=lambda k: len(geoms[k][0]))
        roles["skin"] = (v, f, uv, big + "+mergedx%d" % len(body_names))
    else:
        name = max(body_names, key=lambda k: len(geoms[k][0]))
        v, f, uv = geoms[name]
        roles["skin"] = (v, f, uv, name)
    skinV, skinF = roles["skin"][0], roles["skin"][1]
    if len(skinF) < SKIN_MIN_FACES:
        raise NoBodySkinMeshError(
            "NO_BODY_SKIN_MESH: chosen skin mesh %s in %s has %d faces "
            "(min %d for 4096px derivation); decimated runtime LOD is "
            "not a derive subject"
            % (roles["skin"][3], glb_path, len(skinF), SKIN_MIN_FACES))
    skin_cx = float((skinV[:, 0].min() + skinV[:, 0].max()) / 2)
    teeth_cands = [(vv, nm) for nm, (vv, ff, uu) in geoms.items()
                   if "teeth" in nm.lower()
                   and "tongue" not in nm.lower()]
    teeth_mean = (max(teeth_cands, key=lambda c: len(c[0]))[0][:, 1].mean()
                  if teeth_cands else None)
    if find_mouth_loop(skinV, skinF, skin_cx,
                       float(teeth_mean) if teeth_mean is not None else None) is None:
        raise NoBodySkinMeshError(
            "NO_BODY_SKIN_MESH: chosen skin mesh %s in %s has no mouth "
            "hole loop (largest centred boundary loop at teeth height); "
            "not a derive subject" % (roles["skin"][3], glb_path))
    for key, sub in (("brow", "eyebrow"), ("lash", "lash"),
                     ("tearline", "tearline"), ("teeth", "teeth")):
        cands = [(v, f, uv, nm) for nm, (v, f, uv) in geoms.items()
                 if sub in nm.lower() and ("tongue" not in nm.lower())]
        if cands:
            roles[key] = max(cands, key=lambda c: len(c[0]))
    eyes = [(v, f, uv, nm) for nm, (v, f, uv) in geoms.items()
            if ("globe" in nm.lower() or "eyes_low_poly" in nm.lower()
                or "eyes_high_poly" in nm.lower())
            and "occlusion" not in nm.lower() and "shell" not in nm.lower()
            and "cornea" not in nm.lower()]
    if eyes:
        globe = [c for c in eyes if "globe" in c[3].lower()]
        roles["eye"] = globe[0] if globe else eyes[0]
    return roles


def boundary_loops(F: np.ndarray) -> list[np.ndarray]:
    ec = defaultdict(int)
    for a, b, c in F.tolist():
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(u, v) if u < v else (v, u)] += 1
    bnd = [e for e, n in ec.items() if n == 1]
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for u, v in bnd:
        parent.setdefault(u, u)
        parent.setdefault(v, v)
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
    cl = defaultdict(list)
    for v in parent:
        cl[find(v)].append(v)
    return [np.array(vs, dtype=np.int64) for vs in cl.values()]


def faces_with_label(F: np.ndarray, lab: np.ndarray, k: int = 2) -> np.ndarray:
    return F[(lab[F].sum(axis=1) >= k)]


def raster_faces(faces_uv: np.ndarray, size: int) -> np.ndarray:
    """Binary atlas from UV triangles. Convention col=u*S, row=v*S."""
    img = np.zeros((size, size), np.uint8)
    if not len(faces_uv):
        return img
    px = faces_uv * size
    for tri in px:
        p = tri[:, ::-1][:, [1, 0]]  # (u,v) -> cv2 (col=u,row=v)
        cv2.fillPoly(img, [np.round(p).astype(np.int32)], 255)
    return img


def feather(bin_img: np.ndarray, sigma: float) -> np.ndarray:
    f = (bin_img > 0).astype(np.float32)
    if sigma and f.sum():
        f = cv2.GaussianBlur(f, (0, 0), float(sigma))
        m = f.max()
        if m > 0:
            f /= m
    return f


def uv_of(faces: np.ndarray, UV: np.ndarray) -> np.ndarray:
    return UV[faces]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("glb", type=Path)
    ap.add_argument("outdir", type=Path)
    ap.add_argument("--size", type=int, default=4096)
    ap.add_argument("--no-ao", action="store_true")
    a = ap.parse_args(argv)
    S = int(a.size)
    a.outdir.mkdir(parents=True, exist_ok=True)
    t_all = time.time()
    methods = {}

    roles = load_subject(a.glb)
    V, F, UV, skin_name = roles["skin"]
    cx = float((V[:, 0].min() + V[:, 0].max()) / 2)
    ytop = float(V[:, 1].max())
    tree = cKDTree(V)
    nrm = trimesh.Trimesh(vertices=V, faces=F, process=False).vertex_normals
    nz = np.asarray(nrm)[:, 2]

    browV = roles["brow"][0] if "brow" in roles else None
    lashV = roles["lash"][0] if "lash" in roles else None
    tearV = roles["tearline"][0] if "tearline" in roles else None
    teethV = roles["teeth"][0] if "teeth" in roles else None
    eyeV = roles["eye"][0] if "eye" in roles else None
    methods["roles"] = {k: roles[k][3] for k in roles if k != "skin"}
    methods["roles"]["skin"] = skin_name

    # ---- mouth hole loop: the LARGEST centred loop overlapping teeth height ----
    # (load_subject already refused a skin without one; shared predicate)
    tcen = teethV[:, 1].mean() if teethV is not None else None
    mouth = find_mouth_loop(
        V, F, cx, float(tcen) if tcen is not None else None)
    assert mouth is not None, "mouth hole loop not found"
    mV = V[mouth]
    mouth_bot, mouth_top = float(mV[:, 1].min()), float(mV[:, 1].max())
    methods["mouth_loop"] = ("largest centred boundary loop at teeth height, "
                             "n=%d" % len(mouth))

    # ---- nose tip: max-z vert in the dorsum zone ----
    emid = lashV[:, 1].mean() if lashV is not None else ytop - 0.12
    strip2 = (np.abs(V[:, 0] - cx) < 0.010) & (V[:, 1] > mouth_top + 0.008) \
        & (V[:, 1] < emid)
    tip_abs = np.where(strip2)[0][int(np.argmax(V[strip2][:, 2]))]
    tip = V[tip_abs]
    methods["nose_tip"] = "dorsum-zone (mouth_top+8mm..lash) strip z-max"

    # ---- face UV island: occupancy component holding the nose-tip UV ----
    occ_bin = raster_faces(UV[F], S)
    occ_d = cv2.dilate((occ_bin > 0).astype(np.uint8),
                       np.ones((3, 3), np.uint8), iterations=2)
    ncc, comp, _, _ = cv2.connectedComponentsWithStats(occ_d, 8)
    tuv = np.clip((UV[tip_abs] * S).astype(int), 0, S - 1)
    face_cc = int(comp[tuv[1], tuv[0]])
    if face_cc == 0:
        ys_t, xs_t = np.where(comp > 0)
        j = np.argmin((xs_t - tuv[0]) ** 2 + (ys_t - tuv[1]) ** 2)
        face_cc = int(comp[ys_t[j], xs_t[j]])
    methods["face_island"] = ("occupancy component holding nose-tip UV "
                              "(id %d of %d)" % (face_cc, ncc - 1))
    uv_px = np.clip((UV * S).astype(int), 0, S - 1)
    in_face = comp[uv_px[:, 1], uv_px[:, 0]] == face_cc
    face_idx = np.where(in_face)[0]
    face_tree = cKDTree(V[face_idx])

    def near_face(tgt):
        return int(face_idx[face_tree.query(np.asarray(tgt, float))[1]])

    # ---- chin: face-island centre-strip profile below the mouth ----
    strip = (np.abs(V[:, 0] - cx) < 0.008) & in_face
    bw = 0.001
    ys = np.arange(mouth_bot - CHIN_SEARCH, mouth_bot - 0.001, bw)
    pop = np.zeros(len(ys), bool)
    zmax = np.full(len(ys), np.nan)
    for i, y in enumerate(ys):
        m = strip & (np.abs(V[:, 1] - y) < bw / 2)
        if m.sum() >= 2:
            pop[i] = True
            zmax[i] = V[m][:, 2].max()
    lipz = np.nanmax(zmax) if pop.any() else 0.0
    front = pop & (lipz - zmax < 0.025)
    chin_y, chin_how = None, ""
    last = -1
    for i in range(len(ys) - 1, -1, -1):
        if front[i]:
            last = i
            break
    if last >= 0:
        gap = 0
        for j in range(last - 1, -1, -1):
            if front[j]:
                last = j
                gap = 0
            else:
                gap += 1
                if gap * bw >= 0.004:
                    break
        chin_y = float(ys[last])
        chin_z = float(zmax[last])
        chin_how = ("last front-surface strip bin descending from mouth "
                    "(face-island centre profile)")
    if chin_y is None:
        chin_y = mouth_bot - 0.032
        chin_z = lipz - 0.015
        chin_how = "FALLBACK mouth_bottom-32mm (no strip run)"
    methods["chin"] = chin_how
    chin_vi = near_face([cx, chin_y, chin_z])

    # ---- nostrils ----
    nostril_vi = {}
    for side, sgn in (("L", 1.0), ("R", -1.0)):
        m = (np.sign(V[:, 0] - cx) == sgn) \
            & (np.abs(V[:, 0] - cx) < 0.020) \
            & (np.abs(V[:, 0] - cx) > 0.004) \
            & (V[:, 1] > tip[1] - 0.025) & (V[:, 1] < tip[1] - 0.002) \
            & in_face & (nz > 0.3)
        nostril_vi[side] = near_face(V[np.where(m)[0]][np.argmin(V[m][:, 2])]) \
            if m.any() else int(tip_abs)
    methods["nostrils"] = "most-recessed vert per side in window beside/below tip"

    browtop = float(browV[:, 1].max()) if browV is not None else emid + 0.02
    face_hw = float(np.abs(browV[:, 0] - cx).max()) * 1.25 \
        if browV is not None else 0.075
    methods["face_frame"] = "brow mesh top/extent (x1.25) bound the face"

    # ---- per-vertex labels (geometry) ----
    N = len(V)
    eb = (V[:, 1] > emid - 0.030) & (V[:, 1] < emid + 0.015)
    lab_ear = np.zeros(N, bool)
    ear_vi = {}
    for side, sgn in (("L", 1.0), ("R", -1.0)):
        m = eb & (np.sign(V[:, 0] - cx) == sgn)
        if not m.any():
            continue
        mx = np.abs(V[m][:, 0] - cx).max()
        e = m & (np.abs(V[:, 0] - cx) > mx - EAR_DROP)
        ev = V[np.where(e)[0]]
        med = int(np.where(e)[0][np.argmin(((ev - ev.mean(0)) ** 2).sum(1))])
        my = V[med, 1]
        m2 = (np.abs(V[:, 1] - my) < 0.025) & (np.sign(V[:, 0] - cx) == sgn)
        if not m2.any():
            continue
        mx2 = np.abs(V[m2][:, 0] - cx).max()
        e2 = m2 & (np.abs(V[:, 0] - cx) > mx2 - EAR_DROP)
        lab_ear |= e2
        ev2 = V[np.where(e2)[0]]
        ear_vi[side] = int(np.where(e2)[0][np.argmin(
            ((ev2 - ev2.mean(0)) ** 2).sum(1))])
    methods["ears"] = ("lateral extremes in lash-anchored band, two-pass "
                        "(wide pass finds medoid, keep +-25mm height)")
    methods["neck"] = ("band below chin, halfwidth = face bottom-row width "
                        "(jaw/neck-top, covers sides, excludes chest)")
    lab_face = (V[:, 1] > chin_y - 0.005) \
        & (V[:, 1] < browtop + 0.015) & (np.abs(V[:, 0] - cx) < face_hw) \
        & ~lab_ear & in_face & (nz > -0.3) & (V[:, 2] > chin_z - 0.040)
    methods["facecore"] = ("brow frame minus ears, face-island, occiput and "
                           "throat guards")
    fbot = lab_face & (np.abs(V[:, 1] - chin_y) < 0.010)
    neck_hw = float(np.abs(V[fbot][:, 0] - cx).max()) if fbot.any() else 0.06
    lab_neck = (V[:, 1] < chin_y - 0.005) & (V[:, 1] > chin_y - NECK_DEPTH) \
        & (np.abs(V[:, 0] - cx) < neck_hw)
    head = V[:, 1] > chin_y - 0.005
    lab_scalp = head & ~lab_face & ~lab_ear & ~lab_neck
    methods["scalp"] = "head above chin minus face/ears/neck"

    # ---- feature-mesh rings ----
    lip_lab = np.zeros(N, bool)
    d_to_loop, _ = cKDTree(mV).query(V, k=1)
    lip_lab = (d_to_loop < LIP_RING) & in_face
    methods["lips"] = "skin within 8mm of mouth-hole loop (face island)"
    brow_lab = {"L": np.zeros(N, bool), "R": np.zeros(N, bool)}
    brow_end_vi = {}
    if browV is not None:
        d, _ = cKDTree(browV).query(V, k=1)
        for side, sgn in (("L", 1.0), ("R", -1.0)):
            m = (np.sign(browV[:, 0] - cx) == sgn)
            bside = browV[np.where(m)[0]] if m.any() else browV
            dd, _ = cKDTree(bside).query(V, k=1)
            brow_lab[side] = (dd < BROW_BAND) & in_face
            rel = np.abs(bside[:, 0] - cx)
            for end, j in (("inner", int(rel.argmin())),
                           ("outer", int(rel.argmax()))):
                tgt = bside[j]
                brow_end_vi["%s-%s" % (side, end)] = near_face(tgt)
        methods["brows"] = "skin within 6mm of brow mesh per side"
    else:
        methods["brows"] = "OPEN no brow mesh in GLB"
    eye_lab = {"L": np.zeros(N, bool), "R": np.zeros(N, bool)}
    corner_vi = {}
    lid_src = None
    if lashV is not None:
        lid_src = lashV if tearV is None else np.vstack([lashV, tearV])
        for side, sgn in (("L", 1.0), ("R", -1.0)):
            m = (np.sign(lid_src[:, 0] - cx) == sgn)
            lside = lid_src[np.where(m)[0]] if m.any() else lid_src
            dd, _ = cKDTree(lside).query(V, k=1)
            eye_lab[side] = (dd < EYE_RING) & in_face
            xs = lside[:, 0]
            rel = np.abs(xs - cx)
            for tag, j in (("outer", rel.argmax()), ("inner", rel.argmin())):
                corner_vi["%s-%s" % (side, tag)] = near_face(lside[j])
        methods["eyes"] = "skin within 2mm of lash+tearline per side"
        methods["eye_corners"] = "lash outer/inner |x| extremes, nearest skin"
    else:
        methods["eyes"] = "OPEN no lash mesh in GLB"
        methods["eye_corners"] = "OPEN no lash mesh in GLB"

    # ---- socket wall: fix_corner test with subject's own eye mesh ----
    sock_lab = {"L": np.zeros(N, bool), "R": np.zeros(N, bool)}
    sock_faces = {}
    eye_info = {}
    if eyeV is not None:
        for side, sgn in (("L", 1.0), ("R", -1.0)):
            m = (np.sign(eyeV[:, 0] - cx) == sgn)
            ev = eyeV[np.where(m)[0]] if m.sum() > 8 else eyeV
            cen = ev.mean(0)
            R = float((ev[:, 1].max() - ev[:, 1].min()) / 2)
            cen = np.array([cen[0], cen[1], ev[:, 2].max() - R])
            eye_info[side] = {"cen": [float(v) for v in cen], "R": R,
                              "n": int(m.sum())}
            dist = np.linalg.norm(V - cen, axis=1)
            ssx = (V[:, 0] - cen[0]) * sgn
            depth = V[:, 2] - (cen[2] + R)
            zone = (np.abs(ssx) > 0.009) & (np.abs(ssx) < 0.018) \
                & ((dist - R) > 0.0002) & ((dist - R) < 0.006) \
                & (depth > -0.003) & (np.abs(V[:, 1] - cen[1]) < 0.006) \
                & in_face
            sock_lab[side] = zone
            Fz = faces_with_label(F, zone)
            for tag in ("inner", "outer"):
                mid = (V[Fz][:, :, 0].mean(axis=1) - cen[0]) * sgn
                fx = Fz[mid < 0] if tag == "inner" else Fz[mid >= 0]
                sock_faces["%s-%s" % (side, tag)] = fx
        methods["socket"] = ("fix_corner inequalities vs subject eye-mesh "
                             "centroid/R per side")
    else:
        methods["socket"] = "OPEN no eye mesh in GLB"

    # ---- rasterize ----
    out = {}
    out["occupancy"] = (occ_bin > 0).astype(np.float32)
    tasks = [("mask-lips", lip_lab, "lips"),
             ("mask-brows-L", brow_lab["L"], "brows"),
             ("mask-brows-R", brow_lab["R"], "brows"),
             ("mask-eyes-L", eye_lab["L"], "eyes"),
             ("mask-eyes-R", eye_lab["R"], "eyes"),
             ("mask-ears-L", lab_ear & (V[:, 0] > cx), "ears"),
             ("mask-ears-R", lab_ear & (V[:, 0] < cx), "ears"),
             ("mask-neck", lab_neck, "default"),
             ("mask-scalp", lab_scalp, "default"),
             ("mask-facecore", lab_face, "default"),
             ("socket-wall-L", sock_lab["L"], "socket"),
             ("socket-wall-R", sock_lab["R"], "socket")]
    for name, lab, fk in tasks:
        fx = faces_with_label(F, lab)
        b = raster_faces(uv_of(fx, UV), S)
        out[name] = feather(b, FEATHER[fk])
        print("%s verts=%d faces=%d texels=%.4f" %
              (name, int(lab.sum()), len(fx), float((out[name] > 0.01).mean())),
              flush=True)

    for name, m in out.items():
        Image.fromarray((np.clip(m, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
            a.outdir / (name + ".png"))

    # ---- lipuv.npz: upper/lower lip-ring rasters, renderer convention ----
    # fix_lips/fix_sym consumers index these arrays as image rows directly
    # (row=v*S); the stored solve3 lipuv was landmark-box derived, so the
    # port derives the same keys from the mesh mouth-loop ring instead.
    # Only the union (up|hard_up|lo|hard_lo) is consumed; hard cores equal
    # the soft halves (feather sigma is applied by the consumer).
    lip_faces = faces_with_label(F, lip_lab)
    # Upper vs lower lip: by nearest mouth-loop arc, not by height. The loop
    # mid-height cuts through the mouth opening (loop spans 35mm; tissue
    # above/below is asymmetric), so height-splitting puts ~95% below.
    loop_mid = (mouth_bot + mouth_top) / 2
    upper_arc = mV[:, 1] >= loop_mid
    if upper_arc.any() and (~upper_arc).any():
        _ltree = cKDTree(mV)
        _fc = V[lip_faces].mean(axis=1)
        _near = _ltree.query(_fc, k=1)[1]
        _is_up = upper_arc[_near]
        up_fx = lip_faces[_is_up]
        lo_fx = lip_faces[~_is_up]
    else:
        up_fx = lo_fx = lip_faces
    up_b = raster_faces(uv_of(up_fx, UV), S) > 0
    lo_b = raster_faces(uv_of(lo_fx, UV), S) > 0
    np.savez(a.outdir / "lipuv.npz", up=up_b, hard_up=up_b,
             lo=lo_b, hard_lo=lo_b)
    print("lipuv up=%d lo=%d texels (union=%d)" %
          (int(up_b.sum()), int(lo_b.sum()), int((up_b | lo_b).sum())),
          flush=True)

    # ---- landmarks (texel = u*S, v*S) ----
    def lm_uv(vi):
        return [float(UV[vi, 0]) * S, float(UV[vi, 1]) * S]

    lms = {}
    for side in ("L", "R"):
        for tag in ("inner", "outer"):
            fx = sock_faces.get("%s-%s" % (side, tag))
            if fx is not None and len(fx):
                c = UV[fx].reshape(-1, 2).mean(axis=0) * S
                lms["eye-corner-%s-%s" % (side, tag)] = {
                    "uv_texel": [float(c[0]), float(c[1])],
                    "method": methods["socket"] + "; centroid of selected "
                              "socket faces (paint centroid)"}
            elif "%s-%s" % (side, tag) in corner_vi:
                vi = corner_vi["%s-%s" % (side, tag)]
                lms["eye-corner-%s-%s" % (side, tag)] = {
                    "uv_texel": lm_uv(vi), "method": methods["eye_corners"] +
                    " (socket selection empty, lash fallback)"}
    for key, vi in corner_vi.items():
        if "eye-corner-%s" % key not in lms:
            lms["eye-corner-%s" % key] = {"uv_texel": lm_uv(vi),
                                          "method": methods["eye_corners"]}
    for key, vi in brow_end_vi.items():
        lms["brow-end-%s" % key] = {"uv_texel": lm_uv(vi),
                                    "method": methods["brows"]}
    for side, vi in nostril_vi.items():
        lms["nostril-%s" % side] = {"uv_texel": lm_uv(vi),
                                    "method": methods["nostrils"]}
    xs = mV[:, 0]
    rim = mouth[np.where(in_face[mouth])[0]] \
        if in_face[mouth].any() else mouth
    rV = V[rim]
    my, mx = np.where(out["mask-lips"] > 0.5)
    mc = np.array([mx.mean(), my.mean()]) if len(mx) else None
    for tag, vi0 in (("lip-corner-L", rim[np.argmax(rV[:, 0])]),
                     ("lip-corner-R", rim[np.argmin(rV[:, 0])]),
                     ("lip-mid-upper", rim[np.argmax(rV[:, 1])]),
                     ("lip-mid-lower", rim[np.argmin(rV[:, 1])])):
        _, nb = tree.query(V[vi0], k=64)
        nb = np.atleast_1d(nb)
        if mc is not None:
            vi = int(nb[np.argmin(np.linalg.norm(UV[nb] * S - mc, axis=1))])
            how = methods["lips"] + "; seam-snapped to lip-mask island"
        else:
            vi, how = int(vi0), methods["lips"]
        lms[tag] = {"uv_texel": lm_uv(int(vi)), "method": how}
    for side, vi in ear_vi.items():
        lms["ear-attach-%s" % side] = {"uv_texel": lm_uv(vi),
                                       "method": methods["ears"]}
    lms["chin"] = {"uv_texel": lm_uv(chin_vi), "method": methods["chin"]}
    lms["nose-tip"] = {"uv_texel": lm_uv(int(tip_abs)),
                       "method": methods["nose_tip"]}
    with open(a.outdir / "landmarks-uv.json", "w") as f:
        json.dump({"size": S, "row": "v*S", "landmarks": lms}, f, indent=1)

    # ---- AO bake ----
    ao_sec = None
    if not a.no_ao:
        scr = a.outdir / "bake_ao_tmp.py"
        ao_out = a.outdir / "ao.png"
        with open(scr, "w") as f:
            f.write(BAKE_TMPL.format(glb=str(a.glb.absolute()), out=str(ao_out.absolute()),
                                     size=S, samples=AO_SAMPLES,
                                     dist=AO_DISTANCE, margin=AO_MARGIN,
                                     hide=repr(AO_HIDE)))
        log = a.outdir / "bake.log"
        t0 = time.time()
        r = subprocess.run([BLENDER, "--background", "--python", str(scr)],
                           capture_output=True, text=True)
        ao_sec = time.time() - t0
        tail = (r.stdout + r.stderr)[-1500:]
        with open(log, "w") as f:
            f.write("exit=%d\n" % r.returncode)
            f.write(tail)
        print("bake exit=%d ao_sec=%.0f has_ao=%s" %
              (r.returncode, ao_sec, ao_out.exists()), flush=True)
        if ao_out.exists():
            g = np.array(Image.open(ao_out).convert("L"))
            Image.fromarray(g).save(ao_out)  # greyscale collapse, no flip
        else:
            print("AO BAKE FAILED, tail:\n%s" % tail[-800:], flush=True)
    else:
        print("AO skipped (--no-ao)", flush=True)

    methods["ao"] = ("blender Cycles AO %d samples dist %s margin %d seed 0, "
                     "skin object by max faces, garments hidden; rows native "
                     "(renderer convention, neon-verified)" %
                     (AO_SAMPLES, AO_DISTANCE, AO_MARGIN))
    methods["occupancy"] = "rasterized skin UV triangles (covered = tri>=0)"
    literals = {"LIP_RING_m": LIP_RING, "BROW_BAND_m": BROW_BAND,
                "EYE_RING_m": EYE_RING, "EAR_DROP_m": EAR_DROP,
                "NECK_DEPTH_m": NECK_DEPTH, "CHIN_SEARCH_m": CHIN_SEARCH,
                "NOSTRIL_WIN_m": NOSTRIL_WIN, "AO_SAMPLES": AO_SAMPLES,
                "AO_DISTANCE_m": AO_DISTANCE, "AO_MARGIN_px": AO_MARGIN,
                "sock_window_m": [0.009, 0.018, 0.0002, 0.006, -0.003, 0.006]}
    derive = {"glb": str(a.glb.absolute()),
              "glb_sha256": sha256_file(a.glb), "size": S,
              "convention": ("texture row=v*S col=u*S as sampled by three.js "
                             "with flipY=false; trimesh import flips V and is "
                             "corrected on load; verified by neon render grid "
                             "S/derive/neon-A.png (all colours on anatomy)"),
              "wall_s": round(time.time() - t_all, 1), "ao_s": ao_sec,
              "methods": methods, "literals": literals,
              "eye_info": eye_info,
              "socket_faces": {k: int(len(v)) for k, v in sock_faces.items()},
              "mouth_loop_n": int(len(mouth)),
              "chin_y": chin_y, "nose_tip": [float(v) for v in tip]}
    with open(a.outdir / "derive.json", "w") as f:
        json.dump(derive, f, indent=1)
    print("wrote %s wall=%.0fs" % (a.outdir, time.time() - t_all), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())