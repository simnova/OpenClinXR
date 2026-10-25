"""bind-skin.py — bounded image-byte replacement (stdlib only, portable).

Replaces ONLY the skin baseColor image bytes (bufferView splice, later views
shifted, buffer byteLength + container header recomputed, BIN 4-aligned).
Geometry/morph/rig/normals/other images untouched.
"""
import argparse
import hashlib
import json
import struct
import sys


def sha(b):
    return hashlib.sha256(b).hexdigest()


def refuse(msg):
    raise SystemExit("REFUSE: " + msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-glb", required=True)
    ap.add_argument("--png", required=True)
    ap.add_argument("--out-glb", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--expected-input-sha", required=True)
    ap.add_argument("--skin-image-sha-prefix", required=True)
    a = ap.parse_args()
    import os
    for p in [a.in_glb, a.png]:
        if not os.path.isfile(p):
            refuse("missing input: " + p)
    if os.path.exists(a.out_glb) or os.path.exists(a.report):
        refuse("no-clobber: output/report exists")
    if os.path.realpath(a.out_glb) == os.path.realpath(a.in_glb):
        refuse("output must differ from input")
    src = open(a.in_glb, "rb").read()
    if sha(src) != a.expected_input_sha:
        refuse("input sha mismatch")
    png = open(a.png, "rb").read()
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        refuse("not a PNG")
    magic, ver, total = struct.unpack("<III", src[:12])
    assert magic == 0x46546C67 and ver == 2 and total == len(src), "not a GLB2"
    jl, jt = struct.unpack("<II", src[12:20])
    assert jt == 0x4E4F534A, "first chunk must be JSON"
    j = json.loads(src[20:20 + jl])
    off = 20 + jl
    cl, ct = struct.unpack("<II", src[off:off + 8])
    assert ct == 0x004E4942, "second chunk must be BIN"
    binary = bytearray(src[off + 8:off + 8 + cl])
    assert off + 8 + cl == len(src), "GLB must be exactly JSON+BIN"
    bufs = j.get("buffers")
    assert isinstance(bufs, list) and len(bufs) == 1 and bufs[0].get("uri") is None
    views = j["bufferViews"]
    target = None
    for ii, img in enumerate(j.get("images", [])):
        bv = img.get("bufferView")
        if bv is None:
            continue
        v = views[bv]
        data = bytes(binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
        if sha(data)[:len(a.skin_image_sha_prefix)] == a.skin_image_sha_prefix:
            target = (ii, bv)
            break
    if target is None:
        refuse("skin image with expected sha prefix not found")
    ii, bv = target
    v = views[bv]
    start, old_len = v.get("byteOffset", 0), v["byteLength"]
    delta = len(png) - old_len
    new_bin = bytes(binary[:start]) + png + bytes(binary[start + old_len:])
    for i2, v2 in enumerate(views):
        if i2 == bv:
            v2["byteLength"] = len(png)
        elif v2.get("byteOffset", 0) > start:
            v2["byteOffset"] = v2.get("byteOffset", 0) + delta
    pad = (-len(new_bin)) % 4
    new_bin = new_bin + b"\x00" * pad
    j["buffers"][0]["byteLength"] = len(new_bin)
    j["images"][ii]["mimeType"] = "image/png"
    doc = json.dumps(j, separators=(",", ":")).encode()
    while len(doc) % 4:
        doc += b" "
    glb = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(doc) + 8 + len(new_bin))
           + struct.pack("<II", len(doc), 0x4E4F534A) + doc
           + struct.pack("<II", len(new_bin), 0x004E4942) + new_bin)
    with open(a.out_glb, "wb") as f:
        f.write(glb)
    rep = {"image": ii, "bufferView": bv, "oldBytes": old_len, "newBytes": len(png),
           "padBytes": pad, "outSha": sha(glb), "outBytes": len(glb)}
    with open(a.report, "w") as f:
        json.dump(rep, f, indent=1)
    print("BIND " + json.dumps(rep))


main()
