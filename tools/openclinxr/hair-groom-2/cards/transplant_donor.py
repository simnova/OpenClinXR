"""Donor GLB for transplant_library_hair.py: the card material without KHR_materials_specular.

    python3 transplant_donor.py <donor.glb> <out.glb> <record.json>

render_cards.py exports the calibrated Principled material; with Specular IOR Level 0 (calib_search.py)
Blender writes KHR_materials_specular (specularFactor 0). transplant_library_hair.py refuses any
material extension, so this copy drops that one extension (and its extensionsUsed entry) and records
what was dropped. The runtime GLB then carries glTF's default dielectric specular (F0 0.04), not the
calibrated 0: the runtime hair is more specular than the graded Cycles round.

cards-r5 runtime sheen (transplant_library_hair.py --carry-extensions now carries extensions, so the
drop above is only needed for the old path):
    <blender python> transplant_donor.py <donor.glb> <out.glb> <record.json> --runtime-sheen S R A <atlas.png>
sets the hair_cards material to KHR_materials_specular specularFactor S with specularColorFactor = the
atlas's alpha-weighted mean linear colour scaled to max 1 (hair-tinted highlight), roughness R and
KHR_materials_anisotropy strength A along the strand (rotation pi/2: card UV v runs root -> tip; three.js
0.184 builds the tangent frame from UV derivatives when the mesh has no TANGENT). The atlas carries the
Cycles rig's baked highlight, which does not move with the runtime lights, and the offline calibration
keeps specular 0 (cards-r5 s1: E 0.12 at 0 vs 0.59 / 1.19 at 0.1 / 0.2 anisotropic). S R A are picked by
eye on runtime head crops (cards-r5 x-rt* probes): a runtime-only material layer, not graded offline.
"""
from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from pathlib import Path

EXT = "KHR_materials_specular"


def atlas_tint(path):
    import numpy as np
    from PIL import Image
    im = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float64) / 255.0
    a = im[..., 3:]
    c = im[..., :3]
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = (lin * a).reshape(-1, 3).sum(0) / max(float(a.sum()), 1e-9)
    return [round(float(x), 4) for x in m / m.max()]


def sheen(doc, spec, rough, aniso, atlas):
    tint = atlas_tint(atlas)
    for m in doc.get("materials", []):
        if m.get("name") != "hair_cards":
            continue
        ext = m.setdefault("extensions", {})
        ext["KHR_materials_specular"] = {"specularFactor": spec, "specularColorFactor": tint}
        ext["KHR_materials_anisotropy"] = {"anisotropyStrength": aniso, "anisotropyRotation": math.pi / 2}
        m["pbrMetallicRoughness"]["roughnessFactor"] = rough
    doc["extensionsUsed"] = sorted(set(doc.get("extensionsUsed", [])) | {"KHR_materials_specular",
                                                                        "KHR_materials_anisotropy"})
    return {"specularFactor": spec, "specularColorFactor": tint, "roughness": rough, "anisotropyStrength": aniso,
            "atlas": str(atlas)}


def main():
    src, dst, rec_p = map(Path, sys.argv[1:4])
    data = src.read_bytes()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    if len(sys.argv) > 4 and sys.argv[4] == "--runtime-sheen":
        spec, rough, aniso = (float(x) for x in sys.argv[5:8])
        applied = sheen(doc, spec, rough, aniso, Path(sys.argv[8]))
        js = json.dumps(doc, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        out = struct.pack("<III", magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), jtype) + js + rest
        dst.write_bytes(out)
        rec = {"tool": "tools/openclinxr/hair-groom-2/cards/transplant_donor.py", "mode": "runtime-sheen",
               "donor": str(src), "donorSha256": hashlib.sha256(data).hexdigest(), "out": str(dst),
               "outSha256": hashlib.sha256(out).hexdigest(), "applied": applied}
        rec_p.write_text(json.dumps(rec, indent=1))
        print("DONOR_DONE", json.dumps(rec))
        return
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
