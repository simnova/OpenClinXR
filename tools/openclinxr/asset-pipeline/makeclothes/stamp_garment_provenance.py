"""#596 — stamp mesh.extras {sourceMhclo, garmentClass, licence} into a shipped GLB.

Python twin of stamp-garment-provenance.ts so Blender bakes can persist the path they
already hold at fit time without a Node round-trip. JSON-chunk rewrite only; BIN verbatim.
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path
from typing import Iterable

# Longest-match order mirrors stamp-garment-provenance.ts
_RULES: list[tuple[re.Pattern[str], dict[str, str]]] = [
    (re.compile(r"lab_coat|labcoat|crudelabcoatopen", re.I), {
        "sourceMhclo": "crudelabcoatopen.mhclo",
        "garmentClass": "labcoat",
        "licence": "CC0",
    }),
    (re.compile(r"scrub_shirt", re.I), {
        "sourceMhclo": "Scrub_Shirt.mhclo",
        "garmentClass": "scrub",
        "licence": "CC-BY",
    }),
    (re.compile(r"scrub_pants", re.I), {
        "sourceMhclo": "Scrub_Pants.mhclo",
        "garmentClass": "scrub",
        "licence": "CC-BY",
    }),
    (re.compile(r"toigo_t_shirt|toigo_basic_tucked_t_shirt|toigo_basic_tucked_t-shirt", re.I), {
        "sourceMhclo": "toigo_basic_tucked_t-shirt.mhclo",
        "garmentClass": "street",
        "licence": "CC0",
    }),
    (re.compile(r"cargo_pants", re.I), {
        "sourceMhclo": "cargo_pants.mhclo",
        "garmentClass": "street",
        "licence": "CC0",
    }),
    (re.compile(r"footwear_toigo_flats|toigo_flats", re.I), {
        "sourceMhclo": "toigo_flats.mhclo",
        "garmentClass": "footwear",
        "licence": "CC0",
    }),
]

_SKIP = re.compile(r"eyes|hair|eyelash|eyebrow|teeth|tongue|declared_upper", re.I)
_GARMENT = re.compile(r"real_garment|makeclothes_library", re.I)


def provenance_for_mesh_name(name: str) -> dict[str, str] | None:
    if not _GARMENT.search(name) or _SKIP.search(name):
        return None
    for pat, stamp in _RULES:
        if pat.search(name):
            return dict(stamp)
    return None


def stamp_garment_provenance_glb(
    path: str | Path,
    overrides: dict[str, dict[str, str]] | None = None,
) -> list[str]:
    """Write provenance extras onto matching meshes. Returns stamped mesh names."""
    path = Path(path)
    overrides = overrides or {}
    data = bytearray(path.read_bytes())
    if data[:4] != b"glTF":
        raise RuntimeError(f"#596: not a GLB: {path}")
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])
    stamped: list[str] = []
    for mesh in gltf.get("meshes", []):
        name = mesh.get("name") or ""
        stamp = overrides.get(name) or provenance_for_mesh_name(name)
        if not stamp:
            continue
        extras = mesh.get("extras") or {}
        if not isinstance(extras, dict):
            extras = {}
        extras.update(stamp)
        mesh["extras"] = extras
        stamped.append(name)
    new_json = json.dumps(gltf, separators=(",", ":"))
    new_json += " " * ((4 - len(new_json) % 4) % 4)
    bin_chunk = data[json_end:]
    out = bytearray()
    out += b"glTF"
    out += struct.pack("<II", 2, 12 + 8 + len(new_json) + len(bin_chunk))
    out += struct.pack("<I", len(new_json)) + b"JSON"
    out += new_json.encode("utf-8")
    out += bin_chunk
    path.write_bytes(out)
    print(f"GLB_GARMENT_PROVENANCE_STAMP {path} meshes {','.join(stamped)}")
    return stamped


def stamp_many(paths: Iterable[str | Path]) -> None:
    for p in paths:
        stamp_garment_provenance_glb(p)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("usage: stamp_garment_provenance.py <glb> [<glb>…]")
    stamp_many(sys.argv[1:])
