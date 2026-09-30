#!/usr/bin/env python3
"""Ceiling acceptance measurements (chain seed 205, real ui-xr captures).

Usage (repo root):
  python3 tools/openclinxr/evidence/room-ward-finish-chain/ceiling-measurements.py
Writes docs/openclinxr/room-realism/light-balance/ceiling-measurements.json
Also writes ceiling-02/03-ref/cap-tile-crop.png (marked tile boxes).

Boxes are fixed 1280x720 pixel boxes. Ref/cap boxes may differ in coords
(door precedent: leaf-only in both); each is crop-verified to hold one
surface only (tile interior / diffuser interior / single T-bar crossing),
in the same frame region, and the JSON states every box. Selection rule:
clean single-surface interior, same region, largest such box; the mean is
reported whatever it reads.
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
CAP = os.path.join(LB, "captures-ceiling")
GLB = os.path.join(ROOT, ".openclinxr/evidence/ward-finish-chain",
                   "ward-chain.work.glb")

# Tile patches: clean tile interior in both (no grid/troffer/wall pixels;
# see the marked crops). Pose-02 pair sits in the upper tile field between
# the ref horizontal (above) and the cap horizontal (below); the diagonal
# in each image passes outside the box. Pose-03 pair sits on the tile left
# of the troffer, below the diagonal in both.
REF02_TILE_BOX = (805, 70, 875, 86)
CAP02_TILE_BOX = (805, 70, 875, 86)
REF03_TILE_BOX = (275, 330, 335, 365)
CAP03_TILE_BOX = (275, 330, 335, 365)
# Troffer diffuser interiors (inside the frame, diffuser only). The target
# boxes are centre patches used for the requested 225-245 read and clipping
# fraction. Separate edge patches are clean diffuser near a short edge.
REF05_DIFFUSER_BOX = (600, 330, 680, 380)
REF05_DIFFUSER_EDGE_BOX = (310, 285, 370, 330)
CAP05_DIFFUSER_BOX = (600, 445, 650, 485)
CAP05_DIFFUSER_EDGE_BOX = (570, 395, 610, 410)
# Crop-verified matched T-bar crossings. Each line profile is sampled normal
# to the member and averaged over 61 pixels along it to suppress tile grain.
# The edge offsets bound the visibly distinct painted member in each profile.
REF05_TBAR_CENTER = (200, 316)
REF05_TBAR_DIRECTION = (907, 498)
REF05_TBAR_EDGES = (-4, 3)
CAP05_TBAR_CENTER = (209, 344)
CAP05_TBAR_DIRECTION = (704, 442)
CAP05_TBAR_EDGES = (-4, 4)
# No-regression boxes verbatim from door-measurements.py; baselines are
# that file's cap values.
WALL_BOX = (500, 280, 780, 420)
FLOOR_BOX = (500, 640, 620, 700)
WALL_BASE = [209.95, 206.6, 203.03]
FLOOR_BASE = [215.92, 210.31, 202.36]


def box_mean(path, box):
    im = Image.open(path).convert("RGB").crop(box)
    s = ImageStat.Stat(im)
    return [round(v, 2) for v in s.mean], [round(v, 3) for v in s.stddev]


def diffuser_stats(path, box, edge_box):
    im = Image.open(path).convert("RGB").crop(box)
    a = np.asarray(im)
    frac255 = round(float(((a[:, :, 0] == 255) & (a[:, :, 1] == 255) & (a[:, :, 2] == 255)).mean()), 4)
    centre = np.asarray(im).mean(axis=(0, 1))
    edge = np.asarray(Image.open(path).convert("RGB").crop(edge_box)).mean(axis=(0, 1))
    return {
        "box": list(box),
        "mean": [round(v, 2) for v in ImageStat.Stat(im).mean],
        "frac255": frac255,
        "centreBox": list(box),
        "edgeBox": list(edge_box),
        "centre": [round(float(v), 2) for v in centre],
        "edge": [round(float(v), 2) for v in edge],
        "centreEdgeDelta": [round(float(c - e), 2) for c, e in zip(centre, edge)],
    }


def bar_profile(path, centre, direction, edge_offsets):
    """Averaged luminance profile normal to one crop-verified T-bar."""
    a = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    along = np.asarray(direction, dtype=np.float64)
    along /= np.linalg.norm(along)
    normal = np.asarray([-along[1], along[0]])
    offsets = list(range(-30, 31))
    prof = []
    for offset in offsets:
        samples = []
        for along_offset in range(-30, 31):
            x, y = np.asarray(centre) + normal * offset + along * along_offset
            samples.append(a[round(y), round(x)])
        prof.append(round(float(np.mean(samples)), 1))
    lo, hi = edge_offsets
    return {
        "centre": list(centre), "direction": list(direction),
        "averagingHalfLengthPx": 30,
        "normalOffsetsPx": offsets,
        "visibleEdgeOffsetsPx": list(edge_offsets),
        "visibleWidthPx": hi - lo,
        "profile": prof,
    }


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


def mesh_dims(json_doc, bin0, mesh_name):
    mesh = next(m for m in json_doc["meshes"] if m.get("name") == mesh_name)
    vals = []
    for prim in mesh["primitives"]:
        acc = json_doc["accessors"][prim["attributes"]["POSITION"]]
        view = json_doc["bufferViews"][acc["bufferView"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        arr = np.frombuffer(bin0[start:start + acc["count"] * 12], dtype=np.float32)
        vals.append(arr.reshape(-1, 3))
    v = np.vstack(vals)
    return sorted((v.max(axis=0) - v.min(axis=0)).tolist())


def marked_crop(src, box, dst):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle(box, outline=(255, 0, 0), width=3)
    im.save(dst)
    print(f"wrote {dst}")


def main():
    ref02 = os.path.join(REF, "02-toward-bed-wall.jpg")
    ref03 = os.path.join(REF, "03-ceiling-corner.jpg")
    ref05 = os.path.join(REF, "05-troffer-junction.jpg")
    cap02 = os.path.join(CAP, "runtime-02-toward-bed-wall.png")
    cap03 = os.path.join(CAP, "runtime-03-ceiling-corner.png")
    cap05 = os.path.join(CAP, "runtime-05-troffer-junction.png")
    old05 = os.path.join(LB, "captures-door/runtime-05-troffer-junction.png")
    marked_crop(ref02, REF02_TILE_BOX, os.path.join(LB, "ceiling-02-ref-tile-crop.png"))
    marked_crop(cap02, CAP02_TILE_BOX, os.path.join(LB, "ceiling-02-cap-tile-crop.png"))
    marked_crop(ref03, REF03_TILE_BOX, os.path.join(LB, "ceiling-03-ref-tile-crop.png"))
    marked_crop(cap03, CAP03_TILE_BOX, os.path.join(LB, "ceiling-03-cap-tile-crop.png"))

    ref02m, _ = box_mean(ref02, REF02_TILE_BOX)
    cap02m, cap02std = box_mean(cap02, CAP02_TILE_BOX)
    ref03m, _ = box_mean(ref03, REF03_TILE_BOX)
    cap03m, cap03std = box_mean(cap03, CAP03_TILE_BOX)

    json_doc, bin0 = load_glb(GLB)
    frame_nodes = [n.get("name") for n in json_doc["nodes"]
                   if (n.get("name") or "").startswith("openclinxr_troffer_frame_")]
    frame_dims = {}
    for mesh in json_doc["meshes"]:
        if (mesh.get("name") or "").startswith("openclinxr_troffer_frame_"):
            frame_dims[mesh["name"]] = [round(v, 4) for v in mesh_dims(json_doc, bin0, mesh["name"])]

    result = {
        "schemaVersion": "openclinxr.ceiling-measurements.v1",
        "trofferFrameGlb": {
            "nodes": sorted(frame_nodes),
            "dimsM": frame_dims,
            "gate": "4 named frame nodes, visible width 0.02-0.04 m",
        },
        "trofferPose05": {
            "ref": diffuser_stats(ref05, REF05_DIFFUSER_BOX, REF05_DIFFUSER_EDGE_BOX),
            "cap": diffuser_stats(cap05, CAP05_DIFFUSER_BOX, CAP05_DIFFUSER_EDGE_BOX),
            "gate": "cap centre-box channels 225-245, frac255 < 0.50, "
                    "and positive centre-to-edge gradient",
        },
        "tbarPose05": {
            "ref": bar_profile(ref05, REF05_TBAR_CENTER, REF05_TBAR_DIRECTION, REF05_TBAR_EDGES),
            "cap": bar_profile(cap05, CAP05_TBAR_CENTER, CAP05_TBAR_DIRECTION, CAP05_TBAR_EDGES),
            "old": bar_profile(old05, CAP05_TBAR_CENTER, CAP05_TBAR_DIRECTION, (-9, 8)),
            "widthDeltaPct": round(
                100 * ((CAP05_TBAR_EDGES[1] - CAP05_TBAR_EDGES[0]) /
                       (REF05_TBAR_EDGES[1] - REF05_TBAR_EDGES[0]) - 1), 1),
            "gate": "cap visible width within +-30% of ref at the matched crossing; "
                    "old edge offsets document the pre-fix bloomed stripe",
        },
        "tilePose02": {
            "refBox": list(REF02_TILE_BOX), "ref": ref02m,
            "capBox": list(CAP02_TILE_BOX), "cap": cap02m, "capStd": cap02std,
            "delta": [round(c - r, 2) for c, r in zip(cap02m, ref02m)],
            "gate": "+-8 per channel",
        },
        "tilePose03": {
            "refBox": list(REF03_TILE_BOX), "ref": ref03m,
            "capBox": list(CAP03_TILE_BOX), "cap": cap03m, "capStd": cap03std,
            "delta": [round(c - r, 2) for c, r in zip(cap03m, ref03m)],
            "gate": "+-8 per channel",
        },
    }
    wall_cap, _ = box_mean(cap02, WALL_BOX)
    floor_cap, _ = box_mean(cap02, FLOOR_BOX)
    result["noRegression"] = {
        "wallBox": {"box": list(WALL_BOX), "doorCap": WALL_BASE, "cap": wall_cap,
                    "delta": [round(c - r, 2) for c, r in zip(wall_cap, WALL_BASE)]},
        "floorBox": {"box": list(FLOOR_BOX), "doorCap": FLOOR_BASE, "cap": floor_cap,
                     "delta": [round(c - r, 2) for c, r in zip(floor_cap, FLOOR_BASE)]},
        "gate": "+-3 per channel",
    }
    out = os.path.join(LB, "ceiling-measurements.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
