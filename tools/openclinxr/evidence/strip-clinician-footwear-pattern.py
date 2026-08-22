#!/usr/bin/env python3
"""#502/#553 — strip the leopard "Shoe" print from toigo_flats in shipped MPFB GLBs.

Follows the in-tree precedent byte-for-byte: `mpfb-gown-adult-patient.glb` ships the SAME
`mat_makeclothes_library_footwear_toigo_flats` material with NO `baseColorTexture` and a flat
dark `baseColorFactor` (0.10, 0.09, 0.08 — the 26,23,20 the evidence RED reads). This is a
per-actor MATERIAL SWAP, not an edit to the shared "Shoe" texture bytes.

#502: clinicians. #553: cast patients too — Shoe.png is a leopard-print atlas and nothing in
any case definition authors it; generator now drops toigo_flats for every wearer.

JSON-chunk patch, BIN chunk copied verbatim. Geometry, rig, skin and morph targets untouched.
Orphaned "Shoe" image may remain unreferenced until a future rebake reclaim.

Usage:
  python3 tools/openclinxr/evidence/strip-clinician-footwear-pattern.py \
      apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb \
      apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb
"""

import json
import struct
import sys

FOOTWEAR_MATERIAL = "mat_makeclothes_library_footwear_toigo_flats"
PLAIN_FACTOR = [0.10, 0.09, 0.08, 1.0]


def strip(path: str) -> None:
    with open(path, "rb") as f:
        data = bytearray(f.read())
    if data[:4] != b"glTF":
        raise RuntimeError(f"#502: not a GLB: {path}")
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])

    patched = []
    for mat in gltf.get("materials", []):
        if mat.get("name") != FOOTWEAR_MATERIAL:
            continue
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            del pbr["baseColorTexture"]
        pbr["baseColorFactor"] = PLAIN_FACTOR
        patched.append(mat.get("name"))
    if not patched:
        raise RuntimeError(f"#502: no {FOOTWEAR_MATERIAL} material matched in {path}")

    new_json = json.dumps(gltf, separators=(",", ":"))
    new_json += " " * ((4 - len(new_json) % 4) % 4)
    bin_chunk = data[json_end:]
    out = bytearray()
    out += b"glTF"
    out += struct.pack("<II", 2, 12 + 8 + len(new_json) + len(bin_chunk))
    out += struct.pack("<I", len(new_json)) + b"JSON"
    out += new_json.encode("utf-8")
    out += bin_chunk
    with open(path, "wb") as f:
        f.write(out)
    print(f"#553 STRIPPED {path} -> {FOOTWEAR_MATERIAL} baseColorFactor={PLAIN_FACTOR}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for p in sys.argv[1:]:
        strip(p)
