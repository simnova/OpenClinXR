#!/usr/bin/env python3
"""Grade the three oversize textures in the shipped peds-parent-aisha GLB.

CONTEXT (ci-w11 D2): afe8abced re-baked tara through the materializer at full
resolution, reintroducing 3600px hair PNGs (10.26 + 8.34 MB) and a full-res
2048 tightjeans PNG (5.44 MB). Max/median is 11.88x vs the 3.0x gate in
no-shipped-humanoid-texture-dwarfs-its-peers.test.ts.

GRADE (peer resolution + established recipe, not invented):
- tightjeans -> byte-EXACT reuse of the committed graded artifact
  tools/openclinxr/evidence/humanoid-vetting/tightjeans-2048-q85.jpg
  (1,196,954 B, JPEG q85 2048, chosen 2026-09-12 in
  humanoid-texture-budget-2026-09-12.md; 78% saving, weave intact).
  Same bytes the original fix baked; only the delivery differs (post-bake
  swap instead of a fresh materializer run, because a fresh bake would
  re-derive the deliberate fitted-teeth/albedo/walk-graft state).
- AuburnHair (diffuse, RGBA with LOAD-BEARING alpha: 571,860 fully-clear px,
  material alphaMode=MASK cutoff 0.2) -> LANCZOS 1024 PNG, alpha preserved.
  JPEG is forbidden here (no alpha channel); 1024 keeps it losslessly small.
- BakedHairNORMAL (normal map, alpha all-255 opaque -> safe to drop, asserted)
  -> LANCZOS 2048 RGB JPEG q85. Memo principle: full-resolution recompress
  beats halving on bytes AND detail (0.52 MB vs 1.39 MB PNG-1024).

FAIL-CLOSED: refuses unless the three originals match their HEAD-measured
byte sizes; refuses if the normal map carries non-opaque alpha; refuses if
the post-grade max/median still exceeds 3.0. Buffer surgery only: every
other bufferView is copied verbatim, so meshes/materials/nodes/animations
and all other texture bytes are untouched by construction.

Usage:
  python3 grade-tara-oversize-textures.py --input <tara.glb> --output <out.glb> \\
      --report <report.json>
"""
import argparse
import io
import json
import struct
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_INPUT = (
    REPO_ROOT / "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb"
)
DEFAULT_GRADED_TIGHTJEANS = (
    REPO_ROOT
    / "tools/openclinxr/evidence/humanoid-vetting/tightjeans-2048-q85.jpg"
)

# HEAD-measured originals (fail-closed pins; re-measure if the bake moves).
EXPECTED_ORIGINALS = {
    "tightjeans": 5441511,
    "AuburnHair": 8344296,
    "BakedHairNORMAL": 10260549,
}
GRADED_TIGHTJEANS_BYTES = 1196954
THRESHOLD = 3.0


def read_glb(path: Path):
    data = path.read_bytes()
    if struct.unpack_from("<I", data, 0)[0] != 0x46546C67:
        raise ValueError(f"Not a GLB: {path}")
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len].decode("utf-8"))
    bin_base = 20 + json_len + 8
    return data, gltf, bin_base


def view_bytes(data: bytes, bin_base: int, bv: dict) -> bytes:
    off = bin_base + bv.get("byteOffset", 0)
    return data[off : off + bv["byteLength"]]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--graded-tightjeans", type=Path, default=DEFAULT_GRADED_TIGHTJEANS)
    args = ap.parse_args()

    from PIL import Image

    graded_tj = args.graded_tightjeans.read_bytes()
    if len(graded_tj) != GRADED_TIGHTJEANS_BYTES:
        raise SystemExit(
            f"graded tightjeans artifact is {len(graded_tj)} B, expected "
            f"{GRADED_TIGHTJEANS_BYTES} B — refusing (must be the committed grade)"
        )

    data, gltf, bin_base = read_glb(args.input)
    if len(gltf.get("buffers", [])) != 1:
        raise SystemExit("expected exactly one buffer; refusing")
    images = gltf.get("images", [])
    by_name = {img.get("name"): i for i, img in enumerate(images)}
    for name in EXPECTED_ORIGINALS:
        if name not in by_name:
            raise SystemExit(f"target image {name!r} absent; refusing")
        if "bufferView" not in images[by_name[name]]:
            raise SystemExit(f"target image {name!r} has no bufferView; refusing")

    replacements: dict[int, tuple[bytes, str]] = {}
    before = {}
    for name, expected in EXPECTED_ORIGINALS.items():
        bv = gltf["bufferViews"][images[by_name[name]]["bufferView"]]
        raw = view_bytes(data, bin_base, bv)
        if len(raw) != expected:
            raise SystemExit(
                f"{name}: {len(raw)} B, expected original {expected} B — "
                "bake moved; re-measure before grading"
            )
        im = Image.open(io.BytesIO(raw))
        before[name] = {
            "bytes": len(raw),
            "dims": list(im.size),
            "mime": images[by_name[name]].get("mimeType"),
        }
        if name == "tightjeans":
            replacements[images[by_name[name]]["bufferView"]] = (
                graded_tj,
                "image/jpeg",
            )
        elif name == "AuburnHair":
            if im.mode != "RGBA":
                raise SystemExit(f"AuburnHair mode is {im.mode}, expected RGBA")
            g = im.resize((1024, 1024), Image.LANCZOS)
            out = io.BytesIO()
            g.save(out, "PNG", optimize=True)
            replacements[images[by_name[name]]["bufferView"]] = (
                out.getvalue(),
                "image/png",
            )
        else:  # BakedHairNORMAL
            if im.mode == "RGBA":
                a = im.getchannel("A")
                lo, hi = a.getextrema()
                if (lo, hi) != (255, 255):
                    raise SystemExit(
                        f"BakedHairNORMAL alpha varies ({lo},{hi}); JPEG would "
                        "destroy it — refusing"
                    )
            g = im.resize((2048, 2048), Image.LANCZOS).convert("RGB")
            out = io.BytesIO()
            g.save(out, "JPEG", quality=85)
            replacements[images[by_name[name]]["bufferView"]] = (
                out.getvalue(),
                "image/jpeg",
            )

    # Rebuild the BIN in bufferView order; every untouched view is verbatim.
    bvs = gltf["bufferViews"]
    new_bin = bytearray()
    new_offsets = []
    for i, bv in enumerate(bvs):
        new_offsets.append(len(new_bin))
        chunk = replacements[i][0] if i in replacements else view_bytes(data, bin_base, bv)
        new_bin += chunk
        while len(new_bin) % 4:
            new_bin += b"\x00"
    for i, bv in enumerate(bvs):
        bv["byteOffset"] = new_offsets[i]
        if i in replacements:
            bv["byteLength"] = len(replacements[i][0])
    gltf["buffers"][0]["byteLength"] = len(new_bin)
    for name in EXPECTED_ORIGINALS:
        idx = by_name[name]
        bv_idx = images[idx]["bufferView"]
        images[idx]["mimeType"] = replacements[bv_idx][1]

    # Post-grade gate check on sizes (same measure as the test: all images).
    sizes = []
    after = {}
    for name in EXPECTED_ORIGINALS:
        idx = by_name[name]
        bv_idx = images[idx]["bufferView"]
        nb, mime = replacements[bv_idx]
        after[name] = {"bytes": len(nb), "mime": mime}
    for img in images:
        bv = gltf["bufferViews"][img["bufferView"]]
        sizes.append(
            len(replacements[img["bufferView"]][0])
            if img["bufferView"] in replacements
            else bv["byteLength"]
        )
    s = sorted(sizes)
    median = (s[len(s) // 2 - 1] + s[len(s) // 2]) / 2 if len(s) % 2 == 0 else s[len(s) // 2]
    ratio = max(sizes) / median
    if ratio > THRESHOLD:
        raise SystemExit(f"post-grade max/median {ratio:.2f}x still exceeds {THRESHOLD}; refusing")

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    total = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A)
    out += json_bytes
    out += struct.pack("<II", len(new_bin), 0x004E4942)
    out += new_bin
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(bytes(out))

    report = {
        "tool": "grade-tara-oversize-textures.py",
        "input": str(args.input),
        "output": str(args.output),
        "before": before,
        "after": after,
        "postGradeMaxMedian": round(ratio, 4),
        "threshold": THRESHOLD,
        "notes": [
            "tightjeans bytes are the committed 2026-09-12 grade, reused exactly",
            "AuburnHair keeps PNG: material alphaMode=MASK, alpha load-bearing",
            "BakedHairNORMAL alpha asserted all-opaque before JPEG conversion",
        ],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")

    print(f"max/median after grade: {ratio:.2f}x (gate {THRESHOLD})")
    for name in EXPECTED_ORIGINALS:
        b, a = before[name], after[name]
        print(f"  {name}: {b['bytes']} B {b['dims']} {b['mime']} -> {a['bytes']} B {a['mime']}")
    print(f"wrote {args.output} ({total} B)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
