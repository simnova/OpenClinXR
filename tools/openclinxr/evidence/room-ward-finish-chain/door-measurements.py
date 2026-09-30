#!/usr/bin/env python3
"""Ward-door acceptance measurements (chain seed 205, real ui-xr captures).

Usage (repo root):
  python3 tools/openclinxr/evidence/room-ward-finish-chain/door-measurements.py
Writes docs/openclinxr/room-realism/light-balance/door-measurements.json
Also writes door-04-ref-leaf-crop.png and door-04-cap-leaf-crop.png
(marked leaf boxes for the pose-04 color gate).

Boxes are fixed 1280x720 pixel boxes. LEAF boxes were placed on the real
captures (leaf-only maple in both; see the marked crops): ref04 leaf box
(600,420,680,500) sits below the ref handle and left of the ref lite;
cap04 leaf box (560,350,660,450) sits below the cap lite and left of the
cap handle/lock. Wall/floor boxes are verbatim from
floor-skirting-measurements.py; their baselines are that file's caps.
"""
import json
import os
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))
LB = os.path.join(ROOT, "docs/openclinxr/room-realism/light-balance")
REF = os.path.join(ROOT, "docs/openclinxr/room-realism/imagine-multiview-v2")
CAP = os.path.join(LB, "captures-door")
CAP2 = os.path.join(LB, "captures-door2")
GLB = os.path.join(ROOT, ".openclinxr/evidence/ward-finish-chain",
                   "infinigen-inpatient-ward.chain.glb")

REF04_LEAF_BOX = (600, 420, 680, 500)
CAP04_LEAF_BOX = (560, 350, 660, 450)
# Casing line-profile rows (mid-leaf) and ranges, native resolution.
CAP04_JAMB_ROW = 300
CAP04_JAMB_XRANGE = (480, 600)
REF04_JAMB_ROW = 300
REF04_JAMB_XRANGE = (520, 640)
# Ghost windows from the grade (old framing): horizontal-gradient peaks on
# the leaf field. Hinge plates at the leaf edge are hardware, not moulding.
GHOST_WINDOWS = [((505, 580), (135, 145)), ((505, 580), (155, 165)),
                 ((505, 580), (465, 475))]
# No-regression boxes verbatim from floor-skirting-measurements.py.
WALL_BOX = (500, 280, 780, 420)
FLOOR_BOX = (500, 640, 620, 700)
WALL_BASE = [209.95, 206.59, 203.03]
FLOOR_BASE = [215.91, 210.31, 202.36]


def box_mean(path, box):
    im = Image.open(path).convert("RGB").crop(box)
    s = ImageStat.Stat(im)
    return [round(v, 2) for v in s.mean]


def row_profile(path, row, xrange, step=1):
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    return [round(float(v), 1) for v in im[row, xrange[0]:xrange[1]:step]]


def window_peaks(path, xrange, ywindow, thresh=3.0):
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    strip = im[ywindow[0]:ywindow[1], xrange[0]:xrange[1]].mean(axis=1)
    grad = np.abs(np.diff(strip))
    peaks = []
    for i in range(1, len(grad) - 1):
        if grad[i] >= grad[i - 1] and grad[i] > grad[i + 1] and grad[i] >= thresh:
            if not peaks or i - peaks[-1][0] > 4:
                peaks.append([i + ywindow[0], round(float(grad[i]), 2)])
    return {"peaks": peaks, "maxGrad": round(float(grad.max()), 2)}


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _, total = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    json_doc = None
    buffers = []
    while off < total:
        length, kind = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if kind == 0x4E4F534A:
            json_doc = json.loads(chunk)
        elif kind == 0x004E4942:
            buffers.append(chunk)
        off += 8 + length
    return json_doc, buffers[0]


def accessor_array(json_doc, bin0, index):
    acc = json_doc["accessors"][index]
    view = json_doc["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    comp = {5126: "f4", 5123: "u2", 5125: "u4"}[acc["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    itemsize = {"f4": 4, "u2": 2, "u4": 4}[comp]
    arr = np.frombuffer(bin0[start:start + acc["count"] * n * itemsize],
                        dtype=np.dtype(comp))
    return arr.reshape(-1, n)


def quat_rotate(v, q):
    x, y, z, w = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty),
            v[1] + w * ty + (z * tx - x * tz),
            v[2] + w * tz + (x * ty - y * tx))


def node_world_bbox(json_doc, bin0, node_name):
    node = next(n for n in json_doc["nodes"] if n.get("name") == node_name)
    mesh = json_doc["meshes"][node["mesh"]]
    t = node.get("translation", [0, 0, 0])
    r = node.get("rotation", [0, 0, 0, 1])
    s = node.get("scale", [1, 1, 1])
    mins = np.full(3, np.inf)
    maxs = np.full(3, -np.inf)
    for prim in mesh["primitives"]:
        pos = accessor_array(json_doc, bin0, prim["attributes"]["POSITION"])
        for p in pos:
            q = [p[0] * s[0], p[1] * s[1], p[2] * s[2]]
            rx, ry, rz = quat_rotate(q, r)
            w = (t[0] + rx, t[1] + ry, t[2] + rz)
            mins = np.minimum(mins, w)
            maxs = np.maximum(maxs, w)
    return mins.tolist(), maxs.tolist()


def mesh_local_range(json_doc, bin0, mesh_name, axis):
    mesh = next(m for m in json_doc["meshes"] if m.get("name") == mesh_name)
    vals = []
    for prim in mesh["primitives"]:
        pos = accessor_array(json_doc, bin0, prim["attributes"]["POSITION"])
        vals.extend(pos[:, axis].tolist())
    return min(vals), max(vals)


def marked_crop(src, box, dst):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle(box, outline=(255, 0, 0), width=3)
    im.save(dst)
    print(f"wrote {dst}")


# Facing-seam gate: max neighbor step over mid-leaf field rows with the
# hardware masked out (lite unit, handle/lock, leaf edges, casing).
SEAM_ROWS = (350, 400, 450)
SEAM_XRANGE = (560, 740)
SEAM_MASKS = [  # (x0, x1, y0, y1) hardware windows in 1280x720 capture space
    (550, 700, 190, 400),   # vision unit + frame (covers both the historic
                            # misplaced rect and the true opening location)
    (710, 780, 320, 395),   # lever + lock
]


def leaf_seam(cap04):
    im = np.asarray(Image.open(cap04).convert("L"), dtype=np.float64)
    # A facing-plate seam is a sustained straight edge: the SAME x hot on
    # multiple rows. Wood grain (±5) and render glints are isolated points,
    # so the gate counts row-coherent hot columns, not single max steps.
    hot_cols = {}
    for row in SEAM_ROWS:
        line = im[row, SEAM_XRANGE[0]:SEAM_XRANGE[1]]
        # Median-5 baseline (floor-script convention): render glints dance
        # pixel to pixel between captures, while a real plate-boundary
        # seam is a sustained edge and survives.
        med = np.array([np.median(line[max(0, i - 2):i + 3])
                        for i in range(len(line))])
        # Two-px-apart diffs: single-pixel render speckle (a lone 210 among
        # 174s) dies in the median and spans one sample; a real
        # plate-boundary seam is a sustained edge across 2+ px.
        for x in range(len(med) - 2):
            gx = SEAM_XRANGE[0] + x
            if any(x0 <= gx < x1 and y0 <= row < y1 for x0, x1, y0, y1 in SEAM_MASKS):
                continue
            step = abs(float(med[x + 2]) - float(med[x]))
            if step > 3.0:
                hot_cols.setdefault(gx, []).append([row, round(step, 2)])
    coherent = {x: rows for x, rows in hot_cols.items() if len(rows) >= 2}
    worst = 0.0
    worst_at = None
    for x, rows in hot_cols.items():
        for row, step in rows:
            if step > worst:
                worst = step
                worst_at = [x, row]
    return {"rows": list(SEAM_ROWS), "xrange": list(SEAM_XRANGE),
            "maxStep": round(worst, 2), "at": worst_at,
            "coherentCols": coherent,
            "gate": "no column hot (>3) on 2+ rows (one continuous veneer face)"}


def capture_section(capdir):
    """Pose-04 color, casing profile, ghost, seam, and no-regression for one capture set."""
    ref04 = os.path.join(REF, "04-door-inside.jpg")
    cap04 = os.path.join(capdir, "runtime-04-door-inside.png")
    cap02 = os.path.join(capdir, "runtime-02-toward-bed-wall.png")
    ref_leaf = box_mean(ref04, REF04_LEAF_BOX)
    cap_leaf = box_mean(cap04, CAP04_LEAF_BOX)
    wall_cap = box_mean(cap02, WALL_BOX)
    floor_cap = box_mean(cap02, FLOOR_BOX)
    return {
        "pose04LeafColor": {
            "refBox": list(REF04_LEAF_BOX), "ref": ref_leaf,
            "capBox": list(CAP04_LEAF_BOX), "cap": cap_leaf,
            "delta": [round(c - r, 2) for c, r in zip(cap_leaf, ref_leaf)],
            "gate": "+-12 per channel",
        },
        "pose04CasingProfile": {
            "cap": {"row": CAP04_JAMB_ROW, "xrange": list(CAP04_JAMB_XRANGE),
                    "profile": row_profile(cap04, CAP04_JAMB_ROW, CAP04_JAMB_XRANGE, 2)},
            "ref": {"row": REF04_JAMB_ROW, "xrange": list(REF04_JAMB_XRANGE),
                    "profile": row_profile(ref04, REF04_JAMB_ROW, REF04_JAMB_XRANGE, 2)},
            "note": "casing reads as a distinct lighter band between wall and leaf",
        },
        "ghostCheck": {
            "windows": [{"x": list(x), "y": list(y)} for x, y in GHOST_WINDOWS],
            "cap": [window_peaks(cap04, x, y) for x, y in GHOST_WINDOWS],
            "note": "no raised-panel outline expected on the leaf field; "
                    "hinge plates at the leaf edge are hardware",
        },
        "leafSeam": leaf_seam(cap04),
        "noRegression": {
            "wallBox": {"box": list(WALL_BOX), "floorSkirtingCap": WALL_BASE, "cap": wall_cap,
                        "delta": [round(c - r, 2) for c, r in zip(wall_cap, WALL_BASE)]},
            "floorBox": {"box": list(FLOOR_BOX), "floorSkirtingCap": FLOOR_BASE, "cap": floor_cap,
                         "delta": [round(c - r, 2) for c, r in zip(floor_cap, FLOOR_BASE)]},
            "gate": "+-3 per channel",
        },
    }


def main():
    ref04 = os.path.join(REF, "04-door-inside.jpg")
    cap04 = os.path.join(CAP, "runtime-04-door-inside.png")
    marked_crop(ref04, REF04_LEAF_BOX, os.path.join(LB, "door-04-ref-leaf-crop.png"))
    marked_crop(cap04, CAP04_LEAF_BOX, os.path.join(LB, "door-04-cap-leaf-crop.png"))

    sec = capture_section(CAP)

    json_doc, bin0 = load_glb(GLB)
    leaf_min, leaf_max = node_world_bbox(json_doc, bin0, "bedroom_0/0.door_leaf")
    cas_min, cas_max = node_world_bbox(json_doc, bin0, "bedroom_0/0.door_casing")
    leaf_w = leaf_max[0] - leaf_min[0]
    cas_w = cas_max[0] - cas_min[0]
    jamb = (cas_w - leaf_w) / 2
    head = cas_max[1] - leaf_max[1]
    glass = next(m for m in json_doc["meshes"] if m.get("name") == "openclinxr_door_glass_mesh")
    gpos = accessor_array(json_doc, bin0, glass["primitives"][0]["attributes"]["POSITION"])
    # GLB is Y-up: leaf width x, height y, depth z. Glass world box via nodes.
    gnode = next(n for n in json_doc["nodes"] if n.get("name") == "openclinxr_door_glass")
    gt = gnode.get("translation", [0, 0, 0])
    gs = gnode.get("scale", [1, 1, 1])
    gw = (gpos[:, 0].max() - gpos[:, 0].min()) * gs[0]
    gh = (gpos[:, 1].max() - gpos[:, 1].min()) * gs[1]
    gcy = (gpos[:, 1].max() + gpos[:, 1].min()) / 2 * gs[1] + gt[1]
    steel_idx = sum(
        1 for m in json_doc["meshes"] for p in m["primitives"]
        if json_doc["materials"][p["material"]]["name"] == "openclinxr_door_steel")
    leaf_mesh_idx = next(
        i for i, m in enumerate(json_doc["meshes"])
        if any(n.get("name") == "bedroom_0/0.door_leaf"
               and n.get("mesh") == i for n in json_doc["nodes"]))
    leaf_mats = sorted({json_doc["materials"][p["material"]]["name"]
                        for p in json_doc["meshes"][leaf_mesh_idx]["primitives"]})
    # Facing fronts: room-side veneer plates, fronts exactly coplanar.
    # Per-plate front extreme (not all verts: the plate backs sit 4 mm
    # behind the fronts; mixing both reads the plate thickness, not the
    # presented plane).
    face_fronts = []
    for m in json_doc["meshes"]:
        if m.get("name", "").startswith("openclinxr_door_face_"):
            for prim in m["primitives"]:
                pos = accessor_array(json_doc, bin0, prim["attributes"]["POSITION"])
                face_fronts.append(float(pos[:, 2].max()))
    result = {
        "schemaVersion": "openclinxr.door-measurements.v1",
        "leafFlatGlb": {
            "facingFrontRangeM": round(max(face_fronts) - min(face_fronts), 4) if face_fronts else None,
            "facingPlates": sum(1 for m in json_doc["meshes"]
                                if m.get("name", "").startswith("openclinxr_door_face_")),
            "method": "room-side maple veneer fronts (finish-added true plane); "
                      "underlying Infinigen leaf field undulates past the band "
                      "(see compose.py facing comment)",
            "gate": "front-face depth range <= 0.003 m excluding hardware",
        },
        "leverHandle": {
            "node": "bedroom_0/0.door_leaf",
            "note": "lever geometry merged into the leaf mesh; steel slot "
                    "openclinxr_door_steel on protruding faces (see finish report handle bbox)",
            "leafMaterials": leaf_mats,
            "lockNode": "openclinxr_door_lock",
            "steelPrimitivesInGlb": steel_idx,
        },
        "casingGlb": {
            "jambFaceM": round(jamb, 4),
            "headFaceM": round(head, 4),
            "leafWorldW": round(leaf_w, 4),
            "casingWorldW": round(cas_w, 4),
            "gate": "0.04-0.07 m head + both jambs",
        },
        "visionPanelGlb": {
            "widthM": round(float(gw), 4),
            "heightM": round(float(gh), 4),
            "centerHeightM": round(float(gcy), 4),
            "spec": "about 0.1-0.15 m wide by 0.5-0.7 m tall, upper latch-side",
        },
        "pose04LeafColor": sec["pose04LeafColor"],
        "pose04CasingProfile": sec["pose04CasingProfile"],
        "ghostCheck": sec["ghostCheck"],
        "leafSeam": sec["leafSeam"],
        "noRegression": sec["noRegression"],
    }
    result["door2"] = capture_section(CAP2)
    result["door2"]["captures"] = "captures-door2 (final GLB: straight lever, dark glass, pale maple, spec-white casing)"
    out = os.path.join(LB, "door-measurements.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
