#!/usr/bin/env python3
"""Portable posterior-only ED gown fit repair (asset-pipeline-lead).

Repairs ONLY the offending posterior drape of the case-derived ED gown.
Nothing else changes: no anterior/x clamps, no body/rig/morph/anim edits.

  posterior rule per 25mm y-band:
    gown z < body_zmin(y) - 0.012  ->  z = body_zmin(y) - 0.012
  (12mm cloth allowance measured from the old shared control:
   hem body zmin -0.035 vs old gown zmin -0.044 ~= 9mm; +12mm keeps
   control-like ease with margin. Anterior and |x| are NOT clamped.)

Normals: recomputed from indices + final positions as area-weighted smooth
vertex normals (the gown exports smooth-shaded, no split verts, no TANGENT
attribute in Main final; TANGENT stays absent, matching input behavior).
Updates POSITION + NORMAL buffers and accessor min/max.

CLI (portable, no hardcoded paths):
  --in-glb PATH --out-glb PATH --expected-input-sha HEX [--receipt PATH]
Refuses on SHA mismatch; refuses to overwrite existing output (no-clobber);
refuses if input == output. Writes optional JSON receipt with repo-relative
source path, SHAs, dates, and per-band stats (all computed, none typed).
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import struct
import sys

import numpy as np

POST_EASE = 0.012
BAND = 0.025


def sha_file(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def load_glb(p: pathlib.Path):
    raw = open(p, "rb").read()
    jl, = struct.unpack("<I", raw[12:16])
    j = json.loads(raw[20:20 + jl])
    bl, = struct.unpack("<I", raw[20 + jl:24 + jl])
    off = 28 + jl
    return j, bytearray(raw[off:off + bl])


def read_float3(j, bin0, acc_idx):
    a = j["accessors"][acc_idx]
    bv = j["bufferViews"][a["bufferView"]]
    stride = bv.get("byteStride", 0) or 12
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    out = np.zeros((n, 3))
    for i in range(n):
        o = base + i * stride
        out[i] = struct.unpack("<3f", bytes(bin0[o:o + 12]))
    return out


def write_float3(j, bin0, acc_idx, arr):
    a = j["accessors"][acc_idx]
    bv = j["bufferViews"][a["bufferView"]]
    stride = bv.get("byteStride", 0) or 12
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    assert arr.shape == (a["count"], 3)
    for i in range(a["count"]):
        o = base + i * stride
        bin0[o:o + 12] = struct.pack("<3f", float(arr[i, 0]), float(arr[i, 1]), float(arr[i, 2]))
    a["min"] = [float(arr[:, 0].min()), float(arr[:, 1].min()), float(arr[:, 2].min())]
    a["max"] = [float(arr[:, 0].max()), float(arr[:, 1].max()), float(arr[:, 2].max())]


def read_indices(j, bin0, idx):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    ct = a["componentType"]
    fmt = {5121: "B", 5123: "H", 5125: "I"}[ct]
    sz = {"B": 1, "H": 2, "I": 4}[fmt]
    return np.array(struct.unpack("<" + fmt * n, bytes(bin0[base:base + n * sz])), dtype=np.int64)


def smooth_normals(pos, tris):
    n = np.zeros_like(pos)
    p0, p1, p2 = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)
    for k in range(3):
        np.add.at(n, tris[:, k], fn)
    L = np.linalg.norm(n, axis=1, keepdims=True)
    L[L == 0] = 1.0
    return n / L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-glb", required=True)
    ap.add_argument("--out-glb", required=True)
    ap.add_argument("--expected-input-sha", required=True)
    ap.add_argument("--receipt", default=None)
    a = ap.parse_args()
    inp = pathlib.Path(a.in_glb)
    outp = pathlib.Path(a.out_glb)
    if inp.resolve() == outp.resolve():
        sys.exit("REFUSE: input == output")
    if outp.exists():
        sys.exit(f"REFUSE: output exists (no-clobber): {outp}")
    actual = sha_file(inp)
    if actual != a.expected_input_sha:
        sys.exit(f"REFUSE: input SHA mismatch expected={a.expected_input_sha} actual={actual}")
    j, bin0 = load_glb(inp)
    body = np.vstack([
        read_float3(j, bin0, pr["attributes"]["POSITION"])
        for m in j["meshes"] if m["name"] == "mpfb_robert_reference_body"
        for pr in m["primitives"]
    ])
    gm = [m for m in j["meshes"] if "real_garment" in m["name"]]
    assert len(gm) == 1, "one real_garment mesh expected"
    prim = gm[0]["primitives"][0]
    gpos = read_float3(j, bin0, prim["attributes"]["POSITION"])
    tris = read_indices(j, bin0, prim["indices"]).reshape(-1, 3)
    had_tangent = "TANGENT" in prim["attributes"]

    y = body[:, 1]
    zmin_of = {}
    y0 = float(y.min())
    top = float(y.max())
    lo = y0
    while lo <= top + 1e-9:
        sel = body[(y >= lo - 0.02) & (y <= lo + 0.02)]
        if len(sel) >= 8:
            zmin_of[round(lo, 4)] = float(sel[:, 2].min())
        lo += BAND

    def band_min(yy):
        return zmin_of[min(zmin_of, key=lambda k: abs(k - yy))]

    new = gpos.copy()
    moved = 0
    pull = 0.0
    per_band = {}
    for i in range(len(new)):
        yy = float(new[i, 1])
        tgt = band_min(yy) - POST_EASE
        if float(new[i, 2]) < tgt:
            pull = max(pull, tgt - float(new[i, 2]))
            new[i, 2] = tgt
            moved += 1
            k = str(round(min(zmin_of, key=lambda b: abs(b - yy)), 3))
            per_band[k] = per_band.get(k, 0) + 1
    write_float3(j, bin0, prim["attributes"]["POSITION"], new)
    write_float3(j, bin0, prim["attributes"]["NORMAL"], smooth_normals(new, tris))

    jbytes = json.dumps(j, separators=(",", ":")).encode()
    while len(jbytes) % 4:
        jbytes += b" "
    blob = bytearray(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(jbytes) + 8 + len(bin0)))
    blob += struct.pack("<II", len(jbytes), 0x4E4F534A) + jbytes
    blob += struct.pack("<II", len(bin0), 0x004E4942) + bytes(bin0)
    outp.parent.mkdir(parents=True, exist_ok=True)
    open(outp, "wb").write(bytes(blob))
    out_sha = sha_file(outp)
    rec = {
        "tool": "candidates/tools/openclinxr/evidence/blender/fit-ed-gown-posterior.py",
        "postEase": POST_EASE,
        "band": BAND,
        "inputSha": actual,
        "outputSha": out_sha,
        "outputBytes": len(blob),
        "movedVerts": moved,
        "maxPosteriorPullM": round(float(pull), 6),
        "perBandMoved": per_band,
        "normalsRecomputed": True,
        "tangentPresentIn": had_tangent,
        "tangentPresentOut": had_tangent,
        "anteriorClamped": False,
        "xClamped": False,
        "computedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if a.receipt:
        rp = pathlib.Path(a.receipt)
        rp.parent.mkdir(parents=True, exist_ok=True)
        try:
            rec["sourcePathRepoRelative"] = str(rp.resolve().relative_to(pathlib.Path("/Volumes/files/src/openclinxr").resolve()))
        except Exception:
            rec["sourcePathRepoRelative"] = rp.name
        rp.write_text(json.dumps(rec, indent=1) + "\n")
    print(json.dumps({k: rec[k] for k in ("movedVerts", "maxPosteriorPullM", "outputSha", "tangentPresentIn")}))


if __name__ == "__main__":
    main()
