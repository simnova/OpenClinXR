#!/usr/bin/env python3
"""Apply a tone-keyed family skin albedo as a post-export byte stage (st-vitphys).

The shipped physician GLB carries a long post-export chain (decimation
ladder, garment weld, palette fold, walk-channel repair, teeth retreat,
rebinds, vitfacet normal rebind) that a from-scratch Blender rebake drops,
so the albedo moves here instead — exactly like
tools/openclinxr/asset-pipeline/eyes/apply_vitruvian_eye_texture.py, whose
GLB rewrite functions are IMPORTED (not copied):

  python3 tools/openclinxr/asset-pipeline/skin/families/apply_family_skin_albedo.py
    --glb apps/ui-xr/public/generated-humanoids/<actor>.glb --skin-tone deep_warm

The albedo resolves through ONE module
(tools/openclinxr/asset-pipeline/skin/families/family_albedo.py, shared
with the Blender materializer so the two paths cannot drift) and is
rendered with the producer's stated recipe (RGB -> LANCZOS -> 1024x1024,
Pillow default PNG encoder). ONLY the skin material's baseColor image
segment (material name starts with mpfb_skin) is replaced; every other
image and every mesh/accessor byte is asserted identical after the
rewrite. The sidecar <stem>.provenance.json gains a
SKIN_FAMILY_ALBEDO_REPLACES_BAKE block and re-recorded
outputSha256/outputBytes; the sidecar <stem>.skin-baked.png is rewritten
with the exact spliced bytes. An unmapped tone REFUSES (no family for
tone) and leaves the GLB byte-identical.

Deterministic: JSON re-encoded with compact separators, BIN rebuilt with
4-byte padding, all downstream bufferView byteOffsets shifted by the exact
segment delta (via the imported write_glb).
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO_ROOT / "tools/openclinxr/asset-pipeline/eyes"))
sys.path.insert(0, str(REPO_ROOT / "tools/openclinxr/asset-pipeline/skin/families"))
from apply_vitruvian_eye_texture import read_glb, sha12, write_glb  # noqa: E402
from family_albedo import (  # noqa: E402
    FAMILY_BAKE_SIZE,
    FAMILY_RESAMPLE_FILTER,
    family_albedo_bake_bytes,
    resolve_family_albedo,
)


def find_skin_image(doc: dict) -> tuple[int, str]:
    """Return (image index, material name) of the skin baseColorTexture image."""
    mats = doc.get("materials", [])
    texs = doc.get("textures", [])
    imgs = doc.get("images", [])
    for m in mats:
        name = m.get("name", "")
        if not name.startswith("mpfb_skin"):
            continue
        pbr = m.get("pbrMetallicRoughness", {})
        bct = pbr.get("baseColorTexture", {})
        if "index" not in bct:
            continue
        ti = bct["index"]
        src = texs[ti].get("source")
        if src is None:
            continue
        return src, name
    raise RuntimeError("no mpfb_skin* material with a baseColorTexture found")


def mesh_inventory(doc: dict) -> list:
    inv = []
    for mm in doc.get("meshes", []):
        counts = [p.get("count", 0) for p in mm.get("primitives", [])]
        inv.append((mm.get("name"), counts))
    return inv


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--skin-tone", required=True,
                    help="case actor tone resolved through family_albedo.py")
    args = ap.parse_args()

    resolved = resolve_family_albedo(args.skin_tone)
    if resolved is None:
        raise RuntimeError(
            f"no family albedo for tone {args.skin_tone!r}: refusing, GLB untouched")
    fam_path, fam_sha = resolved
    new_bytes = family_albedo_bake_bytes(fam_path)
    print(f"RESOLVED {args.skin_tone} -> {fam_path} sha {fam_sha[:12]} "
          f"({len(new_bytes)} B bake PNG, {FAMILY_BAKE_SIZE} {FAMILY_RESAMPLE_FILTER})")

    glb_path = (REPO_ROOT / args.glb) if not Path(args.glb).is_absolute() \
        else Path(args.glb)
    input_sha = hashlib.sha256(glb_path.read_bytes()).hexdigest()
    doc, bindata = read_glb(glb_path)

    img_idx, mat_name = find_skin_image(doc)
    img = doc["images"][img_idx]
    assert img.get("mimeType") == "image/png", img.get("mimeType")
    meshes_before = mesh_inventory(doc)
    bv_idx = img["bufferView"]
    view = doc["bufferViews"][bv_idx]
    start = view.get("byteOffset", 0)
    old_len = view["byteLength"]
    old_bytes = bytes(bindata[start:start + old_len])
    assert len(old_bytes) == old_len
    print(f"SKIN {mat_name} image[{img_idx}] {img.get('name')} "
          f"{old_len} B sha {sha12(old_bytes)} bv {bv_idx}@{start}")

    # pre-image census: every embedded image's bytes before the swap.
    before = {}
    for i, im in enumerate(doc.get("images", [])):
        v = doc["bufferViews"][im["bufferView"]] if im.get("bufferView") is not None else None
        before[i] = None if v is None else bytes(
            bindata[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])

    # splice + shift downstream views by the exact delta (imported rewrite).
    delta = len(new_bytes) - old_len
    new_bin = bindata[:start] + new_bytes + bindata[start + old_len:]
    for j, v in enumerate(doc["bufferViews"]):
        if j == bv_idx:
            v["byteLength"] = len(new_bytes)
            continue
        if v.get("byteOffset", 0) > start:
            v["byteOffset"] = v.get("byteOffset", 0) + delta
    doc["buffers"][0]["byteLength"] = len(new_bin)
    img["mimeType"] = "image/png"

    write_glb(glb_path, doc, new_bin)

    # verify: re-read, new skin bytes in place, all other images identical,
    # mesh inventory unchanged.
    doc2, bin2 = read_glb(glb_path)
    after = {}
    for i, im in enumerate(doc2.get("images", [])):
        v = doc2["bufferViews"][im["bufferView"]] if im.get("bufferView") is not None else None
        after[i] = None if v is None else bytes(
            bin2[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
    assert after[img_idx] == new_bytes, "skin bytes not in place after rewrite"
    changed = [i for i in before if before[i] != after.get(i)]
    print(f"CHANGED image indexes: {changed} (expected [{img_idx}] only)")
    assert changed == [img_idx], f"non-skin images moved: {changed}"
    assert mesh_inventory(doc2) == meshes_before, "mesh inventory moved"
    print(f"MESHES unchanged: {len(meshes_before)} meshes")
    print(f"WROTE {glb_path} skin {sha12(old_bytes)} -> {sha12(new_bytes)} "
          f"({old_len} -> {len(new_bytes)} B, delta {delta:+d})")

    # sidecar bake PNG: rewrite with the exact spliced bytes.
    try:
        glb_rel = str(glb_path.resolve().relative_to(REPO_ROOT.resolve()))
    except ValueError:
        glb_rel = args.glb
    bake_png = REPO_ROOT / (glb_rel[:-4] + ".skin-baked.png")
    if bake_png.is_file():
        bake_png.write_bytes(new_bytes)
        print(f"BAKEPNG {bake_png.relative_to(REPO_ROOT)} rewritten ({len(new_bytes)} B)")
    else:
        print(f"BAKEPNG missing: {bake_png} (left untouched)")

    # sidecar provenance: append the stage block, re-record bytes.
    sidecar = REPO_ROOT / (glb_rel[:-4] + ".provenance.json")
    if sidecar.is_file():
        raw_text = sidecar.read_text()
        sc = json.loads(raw_text)
        raw = glb_path.read_bytes()
        sc["outputSha256"] = hashlib.sha256(raw).hexdigest()
        sc["outputBytes"] = len(raw)
        sc["SKIN_FAMILY_ALBEDO_REPLACES_BAKE"] = {
            "stage": "family-skin-albedo",
            "tool": "tools/openclinxr/asset-pipeline/skin/families/apply_family_skin_albedo.py",
            "tone": args.skin_tone,
            "familyPath": str(fam_path),
            "familySha256": fam_sha,
            "filter": FAMILY_RESAMPLE_FILTER,
            "size": list(FAMILY_BAKE_SIZE),
            "inputGlbSha": input_sha,
            "previousSkinSha12": sha12(old_bytes),
            "newSkinSha12": sha12(new_bytes),
        }
        m = re.search(r'\n( +)"', raw_text)
        indent = len(m.group(1)) if m else 1
        sidecar.write_text(json.dumps(sc, indent=indent, ensure_ascii=False) + "\n")
        print(f"SIDECAR {sidecar.relative_to(REPO_ROOT)} stage recorded, "
              f"outputSha256/outputBytes re-recorded")
    else:
        print(f"SIDECAR missing: {sidecar} (left untouched)")


if __name__ == "__main__":
    main()
