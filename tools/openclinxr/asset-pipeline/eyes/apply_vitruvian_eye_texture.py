#!/usr/bin/env python3
"""Swap the shipped eye baseColorTexture for the Vitruvian resample (st-viteye r2).

A full Blender rebake is unavailable in a worktree without the staged
provider cache (garments/hair/iris .mhmat + MPFB addon); the eye bytes move
through the SAME slot the materializer uses (TEXTURE_OVERRIDES for
mat_makeclothes_library_eyes*, fed by iris_palette.iris_diffuse_override),
applied here as a deterministic post-export byte stage on the shipped GLB.

  python3 tools/openclinxr/asset-pipeline/eyes/apply_vitruvian_eye_texture.py
    --glb apps/ui-xr/public/generated-humanoids/<actor>.glb --colour brown

The palette (tools/openclinxr/asset-pipeline/anny/iris_palette.py) is the
single source of truth: the station resolves the texture through
iris_diffuse_override(colour) and refuses when it returns None. Only the eye
image's buffer segment is replaced; every other image's bytes are asserted
byte-identical after the rewrite (H3). The sidecar
<stem>.provenance.json gains a vitruvianEyeSwapR2 block and re-recorded
outputSha256/outputBytes; nothing else in the sidecar is touched.

Deterministic: JSON re-encoded with compact separators and stable key order,
BIN rebuilt with 4-byte padding, all downstream bufferView byteOffsets
shifted by the exact segment delta.
"""

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tools/openclinxr/asset-pipeline/anny"))
from iris_palette import iris_diffuse_override  # noqa: E402


def sha12(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:12]


def read_glb(path: Path):
    b = path.read_bytes()
    assert b[:4] == b"glTF", "not a GLB"
    (version, total) = struct.unpack("<II", b[4:12])
    assert version == 2, f"GLB version {version}"
    assert total == len(b), f"GLB length mismatch {total} != {len(b)}"
    off = 12
    json_bytes, bin_bytes = None, None
    while off < len(b):
        (clen, ctype) = struct.unpack("<II", b[off:off + 8])
        off += 8
        chunk = b[off:off + clen]
        if ctype == 0x4E4F534A:
            json_bytes = chunk
        elif ctype == 0x004E4942:
            bin_bytes = chunk
        off += clen
    assert json_bytes is not None and bin_bytes is not None
    return json.loads(json_bytes), bin_bytes


def write_glb(path: Path, doc: dict, bindata: bytes):
    jb = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    while len(jb) % 4:
        jb += b" "
    while len(bindata) % 4:
        bindata = bindata + b"\x00"
    total = 12 + 8 + len(jb) + 8 + len(bindata)
    out = b"glTF" + struct.pack("<II", 2, total)
    out += struct.pack("<I", len(jb)) + struct.pack("<I", 0x4E4F534A) + jb
    out += struct.pack("<I", len(bindata)) + struct.pack("<I", 0x004E4942) + bindata
    path.write_bytes(out)


def find_eye_image(doc: dict) -> tuple[int, str]:
    """Return (image index, material name) of the eye baseColorTexture image."""
    mats = doc.get("materials", [])
    texs = doc.get("textures", [])
    imgs = doc.get("images", [])
    for m in mats:
        name = m.get("name", "")
        if "eye" not in name.lower():
            continue
        pbr = m.get("pbrMetallicRoughness", {})
        bct = pbr.get("baseColorTexture", {})
        if "index" not in bct:
            continue
        ti = bct["index"]
        src = texs[ti].get("source")
        if src is None:
            continue
        iname = imgs[src].get("name", "")
        if "eye" in iname.lower() or "iris" in iname.lower():
            # "iris" covers a re-run on an already-swapped GLB (image name
            # becomes vitruvian-iris-<colour>); the material name above still
            # gates on /eye/, so no non-eye image can match.
            return src, name
    raise RuntimeError("no textured /eye/ material with an eye-named image found")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--colour", required=True,
                    help="pack id resolved through iris_diffuse_override")
    ap.add_argument("--sidecar-note", default="",
                    help="extra note recorded in the provenance block")
    args = ap.parse_args()

    tex_rel = iris_diffuse_override(args.colour)
    if tex_rel is None:
        raise RuntimeError(
            f"iris_diffuse_override({args.colour!r}) is None: no Vitruvian "
            "texture for this pack id; refusing (no silent pack fallback)")
    tex_path = REPO_ROOT / tex_rel
    new_bytes = tex_path.read_bytes()
    print(f"RESOLVED {args.colour} -> {tex_rel} ({len(new_bytes)} B)")

    glb_path = (REPO_ROOT / args.glb) if not Path(args.glb).is_absolute() \
        else Path(args.glb)
    doc, bindata = read_glb(glb_path)

    img_idx, mat_name = find_eye_image(doc)
    img = doc["images"][img_idx]
    assert img.get("mimeType") == "image/png", img.get("mimeType")
    bv_idx = img["bufferView"]
    view = doc["bufferViews"][bv_idx]
    start = view.get("byteOffset", 0)
    old_len = view["byteLength"]
    old_bytes = bytes(bindata[start:start + old_len])
    assert len(old_bytes) == old_len
    print(f"EYE {mat_name} image[{img_idx}] {img.get('name')} "
          f"{old_len} B sha {sha12(old_bytes)} bv {bv_idx}@{start}")

    # H3 pre-image census: every embedded image's bytes before the swap.
    before = {}
    for i, im in enumerate(doc.get("images", [])):
        v = doc["bufferViews"][im["bufferView"]] if im.get("bufferView") is not None else None
        if v is None:
            before[i] = None
        else:
            s, ln = v.get("byteOffset", 0), v["byteLength"]
            before[i] = bytes(bindata[s:s + ln])

    # splice + shift downstream views by the exact delta
    delta = len(new_bytes) - old_len
    new_bin = bindata[:start] + new_bytes + bindata[start + old_len:]
    for j, v in enumerate(doc["bufferViews"]):
        if j == bv_idx:
            v["byteLength"] = len(new_bytes)
            continue
        if v.get("byteOffset", 0) > start:
            v["byteOffset"] = v.get("byteOffset", 0) + delta
    doc["buffers"][0]["byteLength"] = len(new_bin)
    img["name"] = Path(tex_rel).stem
    img["mimeType"] = "image/png"

    write_glb(glb_path, doc, new_bin)

    # verify: re-read, new eye bytes in place, all other images identical
    doc2, bin2 = read_glb(glb_path)
    after = {}
    for i, im in enumerate(doc2.get("images", [])):
        v = doc2["bufferViews"][im["bufferView"]] if im.get("bufferView") is not None else None
        after[i] = None if v is None else bytes(bin2[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
    assert after[img_idx] == new_bytes, "eye bytes not in place after rewrite"
    changed = [i for i in before if before[i] != after.get(i)]
    print(f"CHANGED image indexes: {changed} (expected [{img_idx}] only)")
    assert changed == [img_idx], f"non-eye images moved: {changed}"
    print(f"WROTE {glb_path} eye {sha12(old_bytes)} -> {sha12(new_bytes)} "
          f"({old_len} -> {len(new_bytes)} B, delta {delta:+d})")

    # sidecar: re-record bytes + append the swap block, touch nothing else
    glb_rel = str(glb_path.relative_to(REPO_ROOT)) if glb_path.is_absolute() or \
        str(glb_path).startswith(str(REPO_ROOT)) else args.glb
    try:
        glb_rel = str(glb_path.resolve().relative_to(REPO_ROOT.resolve()))
    except ValueError:
        glb_rel = args.glb
    sidecar = REPO_ROOT / (glb_rel[:-4] + ".provenance.json")
    if sidecar.is_file():
        raw_text = sidecar.read_text()
        sc = json.loads(raw_text)
        raw = glb_path.read_bytes()
        sc["outputSha256"] = hashlib.sha256(raw).hexdigest()
        sc["outputBytes"] = len(raw)
        sc["vitruvianEyeSwapR2"] = {
            "tool": "tools/openclinxr/asset-pipeline/eyes/apply_vitruvian_eye_texture.py",
            "colour": args.colour,
            "texture": tex_rel,
            "textureSha256": hashlib.sha256(new_bytes).hexdigest(),
            "previousEyeSha12": sha12(old_bytes),
            "note": args.sidecar_note,
        }
        # preserve the file's own formatting: detect indent + keep non-ascii
        # literals, so the diff stays at the content change (aisha's sidecar
        # is indent-2/UTF-8; the others are indent-1/UTF-8).
        m = re.search(r'\n( +)"', raw_text)
        indent = len(m.group(1)) if m else 1
        sidecar.write_text(json.dumps(sc, indent=indent, ensure_ascii=False) + "\n")
        print(f"SIDECAR {sidecar.relative_to(REPO_ROOT)} outputSha256/outputBytes re-recorded")
    else:
        print(f"SIDECAR missing: {sidecar} (left untouched)")


if __name__ == "__main__":
    main()
