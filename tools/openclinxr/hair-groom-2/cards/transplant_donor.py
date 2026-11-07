"""Donor GLB for transplant_library_hair.py: the card material without KHR_materials_specular.

    python3 transplant_donor.py <donor.glb> <out.glb> <record.json>

render_cards.py exports the calibrated Principled material; with Specular IOR Level 0 (calib_search.py)
Blender writes KHR_materials_specular (specularFactor 0). transplant_library_hair.py refuses any
material extension, so this copy drops that one extension (and its extensionsUsed entry) and records
what was dropped. The runtime GLB then carries glTF's default dielectric specular (F0 0.04), not the
calibrated 0: the runtime hair is more specular than the graded Cycles round.
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

EXT = "KHR_materials_specular"


def main():
    src, dst, rec_p = map(Path, sys.argv[1:4])
    data = src.read_bytes()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    dropped = {}
    for i, m in enumerate(doc.get("materials", [])):
        ext = m.get("extensions", {})
        if EXT in ext:
            dropped[m.get("name", str(i))] = ext.pop(EXT)
            if not ext:
                m.pop("extensions")
    used = [e for e in doc.get("extensionsUsed", []) if e != EXT]
    still = any(EXT in m.get("extensions", {}) for m in doc.get("materials", []))
    if not still:
        if used:
            doc["extensionsUsed"] = used
        else:
            doc.pop("extensionsUsed", None)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<III", magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), jtype) + js + rest
    dst.write_bytes(out)
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/transplant_donor.py", "donor": str(src),
           "donorSha256": hashlib.sha256(data).hexdigest(), "out": str(dst),
           "outSha256": hashlib.sha256(out).hexdigest(), "droppedExtension": EXT, "dropped": dropped}
    rec_p.write_text(json.dumps(rec, indent=1))
    print("DONOR_DONE", json.dumps(rec))


if __name__ == "__main__":
    main()
