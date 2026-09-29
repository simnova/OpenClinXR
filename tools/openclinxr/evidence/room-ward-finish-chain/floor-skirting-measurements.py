#!/usr/bin/env python3
"""Floor+skirting acceptance measurements (chain seed 205, real ui-xr captures).

Usage (repo root):
  python3 tools/openclinxr/evidence/room-ward-finish-chain/floor-skirting-measurements.py
Writes docs/openclinxr/room-realism/light-balance/floor-skirting-measurements.json

Boxes are fixed 1280x720 pixel boxes shared with the light-balance lineage.
PATCH constants below were verified on the real captures (floor-only crops,
seam-crossing rows, skirting-top windows); see the crop notes beside each.
"""
import json
import os
import struct

import numpy as np
from PIL import Image, ImageFilter, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))
LB = os.path.join(ROOT, "docs/openclinxr/room-realism/light-balance")
REF = os.path.join(ROOT, "docs/openclinxr/room-realism/imagine-multiview-v2")
CAP = os.path.join(LB, "captures-floor-skirting")
GLB = os.path.join(ROOT, ".openclinxr/evidence/ward-finish-chain/ward-chain.work.glb")

# Pose-02 floor strip (spec box, shared with the task brief).
P02_FLOOR_BOX = (500, 640, 620, 700)
# Pose-06 floor patch: tile interior, no seams (seam-checked on ref06:
# the diagonal seam crosses x~0-200 at these rows; this crop sits right
# of it, floor-only in both ref and capture).
P06_FLOOR_PATCH = (500, 470, 780, 610)
# Pose-02 seam profile rows (cross 2+ tile seams in ref02 and capture).
P02_SEAM_ROWS = (655, 665, 675)
P02_SEAM_XRANGE = (300, 1000)
# Pose-06 skirting-top window: vertical strip x in [560, 720] (cove spans
# the full width in both), top-edge transition rows (ref: wall->cove top
# edge; the cove->floor bottom edge sits lower and is out of window).
P06_SKIRT_XRANGE = (560, 720)
P06_TOP_WINDOW = (150, 260)
# No-regression anchors (stage1-final values in CURRENT dict below).
WALL_BOX = (500, 280, 780, 420)
TILE_BOX = (600, 95, 655, 145)


def box_mean(path, box):
    im = Image.open(path).convert("RGB").crop(box)
    s = ImageStat.Stat(im)
    return [round(v, 2) for v in s.mean], [round(v, 3) for v in s.stddev]


def lowfreq_std(path, box, sigma=8):
    im = Image.open(path).convert("RGB").crop(box)
    bl = im.filter(ImageFilter.GaussianBlur(sigma))
    s = ImageStat.Stat(bl)
    return [round(v, 3) for v in s.stddev]


def seam_profile(path, rows, xrange):
    """Mean luminance profile over rows, 5px-smoothed; returns dip positions + depths.

    Smoothing kills speckle/JPEG wiggles so only tile-seam grooves (surviving
    as >=3-deep dips spaced tens of pixels apart) count toward the pitch.
    """
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    prof = im[rows[0]:rows[1] + 1, xrange[0]:xrange[1]].mean(axis=0)
    kernel = np.ones(5) / 5.0
    smooth = np.convolve(prof, kernel, mode="same")
    base = float(np.median(smooth))
    dips = []
    for i in range(1, len(smooth) - 1):
        if smooth[i] < smooth[i - 1] and smooth[i] <= smooth[i + 1] and base - smooth[i] >= 3.0:
            if not dips or i - dips[-1][0] > 30:
                dips.append([i + xrange[0], round(base - float(smooth[i]), 2)])
    pitches = [dips[i + 1][0] - dips[i][0] for i in range(len(dips) - 1)]
    return {"dips": dips, "pitchPx": round(float(np.median(pitches)), 1) if pitches else None}


def edge_peaks(path, xrange, ywindow):
    """Vertical luminance gradient peak rows (strip-meaned) in the window,
    plus the window max gradient (a soft ramp with no sharp step reads a
    low max beside an empty peak list)."""
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    strip = im[ywindow[0]:ywindow[1], xrange[0]:xrange[1]].mean(axis=1)
    grad = np.abs(np.diff(strip))
    peaks = []
    for i in range(1, len(grad) - 1):
        if grad[i] >= grad[i - 1] and grad[i] > grad[i + 1] and grad[i] >= 3.0:
            if not peaks or i - peaks[-1][0] > 4:
                peaks.append([i + ywindow[0], round(float(grad[i]), 2)])
    return {"peaks": peaks, "maxGrad": round(float(grad.max()), 2)}


def cove_heights(glb_path):
    with open(glb_path, "rb") as f:
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
    assert json_doc is not None, "GLB has no JSON chunk"
    assert buffers, "GLB has no BIN chunk"
    bin0 = buffers[0]
    out = {}
    for mesh in json_doc["meshes"]:
        if "openclinxr_cove_" not in mesh["name"]:
            continue
        ymin, ymax = float("inf"), float("-inf")
        for prim in mesh["primitives"]:
            acc = json_doc["accessors"][prim["attributes"]["POSITION"]]
            view = json_doc["bufferViews"][acc["bufferView"]]
            start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
            arr = np.frombuffer(bin0[start:start + acc["count"] * 12], dtype=np.float32)
            ys = arr.reshape(-1, 3)[:, 1]
            ymin, ymax = min(ymin, ys.min()), max(ymax, ys.max())
        out[mesh["name"]] = round(float(ymax - ymin), 4)
    return out


def main():
    ref02 = os.path.join(REF, "02-toward-bed-wall.jpg")
    ref06 = os.path.join(REF, "06-floor-base.jpg")
    cap02 = os.path.join(CAP, "runtime-02-toward-bed-wall.png")
    cap06 = os.path.join(CAP, "runtime-06-floor-base.png")
    cap03 = os.path.join(CAP, "runtime-03-ceiling-corner.png")
    old02 = os.path.join(LB, "captures-stage1-final/runtime-02-toward-bed-wall.png")
    old03 = os.path.join(LB, "captures-stage1-final/runtime-03-ceiling-corner.png")

    ref_floor, _ = box_mean(ref02, P02_FLOOR_BOX)
    cap_floor, cap_floor_std = box_mean(cap02, P02_FLOOR_BOX)
    ref_patch, _ = box_mean(ref06, P06_FLOOR_PATCH)
    cap_patch, _ = box_mean(cap06, P06_FLOOR_PATCH)

    result = {
        "schemaVersion": "openclinxr.floor-skirting-measurements.v1",
        "floorPose02Box": {"box": list(P02_FLOOR_BOX), "ref": ref_floor, "cap": cap_floor,
                           "delta": [round(c - r, 2) for c, r in zip(cap_floor, ref_floor)],
                           "gate": "+-8 per channel"},
        "floorPose06Patch": {"box": list(P06_FLOOR_PATCH), "ref": ref_patch, "cap": cap_patch,
                             "delta": [round(c - r, 2) for c, r in zip(cap_patch, ref_patch)],
                             "capStd": cap_floor_std, "gate": "+-8 per channel"},
        "blotch": {"refLowFreqStd": lowfreq_std(ref06, P06_FLOOR_PATCH),
                   "capLowFreqStd": lowfreq_std(cap06, P06_FLOOR_PATCH),
                   "gate": "cap <= ref + 3 per channel"},
        "seamsPose02": {"ref": seam_profile(ref02, (P02_SEAM_ROWS[0], P02_SEAM_ROWS[-1]), P02_SEAM_XRANGE),
                        "cap": seam_profile(cap02, (P02_SEAM_ROWS[0], P02_SEAM_ROWS[-1]), P02_SEAM_XRANGE)},
        "skirtingTopEdge": {"window": {"x": list(P06_SKIRT_XRANGE), "y": list(P06_TOP_WINDOW)},
                            "ref": edge_peaks(ref06, P06_SKIRT_XRANGE, P06_TOP_WINDOW),
                            "cap": edge_peaks(cap06, P06_SKIRT_XRANGE, P06_TOP_WINDOW),
                            "gate": "single transition, not two"},
        "coveHeightsGlb": cove_heights(GLB),
    }
    wall_ref, _ = box_mean(old02, WALL_BOX)
    wall_cap, _ = box_mean(cap02, WALL_BOX)
    tile_ref, _ = box_mean(old03, TILE_BOX)
    tile_cap, _ = box_mean(cap03, TILE_BOX)
    result["noRegression"] = {
        "wallBox": {"box": list(WALL_BOX), "stage1Final": wall_ref, "cap": wall_cap,
                    "delta": [round(c - r, 2) for c, r in zip(wall_cap, wall_ref)]},
        "tileBox": {"box": list(TILE_BOX), "stage1Final": tile_ref, "cap": tile_cap,
                    "delta": [round(c - r, 2) for c, r in zip(tile_cap, tile_ref)]},
        "gate": "+-3 per channel",
    }
    out = os.path.join(LB, "floor-skirting-measurements.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
