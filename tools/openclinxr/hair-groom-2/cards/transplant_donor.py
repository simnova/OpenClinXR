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

cards-r6: --spec-alpha-power P (after the --runtime-sheen arguments) adds specularTexture: an RGBA PNG on the
atlas UVs whose alpha (the channel KHR_materials_specular reads) is the atlas alpha ^ P. The sheen then follows
strand density: card fringes, tips and sparse short cards (cards-r5/s6 runtime: tq tip glints L 1.0, side rear
sheet, behind-ear blades) get a fraction of it, the dense crown and temple cores keep it. View-independent data
only; three.js GLTFLoader maps it to specularIntensityMap. --aniso-alpha-power P does the same for
KHR_materials_anisotropy (anisotropyTexture blue = strength multiplier): the cards-r5/s6 tq glints and behind-ear
patch vanish with anisotropy 0 and not with the specular mask, so they are anisotropic highlights.

cards-r7: --aniso-rotation R (radians, default pi/2). With carried TANGENTs the cards-r6 material (spec 0.25, rough
0.5, rotation pi/2) adds at most dL 0.06-0.10 over a spec-0 render in any view: the runtime sheen was the baked atlas.
Rotation pi/2 stretches the lobe along the strand (spec 1.0: a vertical stripe down the back); rotation 0 stretches it
across the strands, so the highlight forms one band across the crown, as on real hair.
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


def card_agreement(cards_path, lo, hi):
    """Per-card per-station factor clip((|geometric card normal . stored vertex normal| - lo) / (hi - lo), 0, 1):
    three.js builds the anisotropy tangent frame from the geometric surface, so where the shading normal
    (card_vnormal, outward field) leaves the card plane the frame is skewed and the anisotropic lobe flares."""
    import numpy as np
    c = np.load(cards_path)
    n = int(c["n_cards"])
    V = c["card_verts"]
    S = len(V) // n // 2
    Vr = V.reshape(n, S, 2, 3)
    Wd = Vr[:, :, 1] - Vr[:, :, 0]
    T = np.gradient(Vr.mean(2), axis=1)
    G = np.cross(T, Wd)
    G /= np.linalg.norm(G, axis=2, keepdims=True) + 1e-12
    N = c["card_vnormal"].reshape(n, S, 2, 3).mean(2)
    N /= np.linalg.norm(N, axis=2, keepdims=True) + 1e-12
    ag = np.abs((G * N).sum(2))
    return np.clip((ag - lo) / (hi - lo), 0.0, 1.0), c["card_atlas_cell_px"], ag


def aniso_mask_png(atlas, power, agree=None):
    """KHR_materials_anisotropy anisotropyTexture: RG = tangent-space direction (1, 0) encoded (1, 0.5), so the
    material's anisotropyRotation still sets the strand direction; B = strength multiplier = atlas alpha ^ power."""
    import io
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(atlas).convert("RGBA"), dtype=np.float64)[..., 3] / 255.0
    out = np.empty(a.shape + (3,), np.uint8)
    out[..., 0], out[..., 1] = 255, 128
    b = a ** power
    if agree is not None:
        f, cells, _ = agree
        S = f.shape[1]
        for k, (x, y, w, h) in enumerate(cells):
            v = (np.arange(h - 2) + 0.5) / (h - 2)
            b[y + 1:y + h - 1, x:x + w] *= np.interp(v * (S - 1), np.arange(S), f[k])[:, None]
    out[..., 2] = np.round(b * 255.0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, format="PNG", compress_level=9)
    return buf.getvalue()


def spec_mask_png(atlas, power):
    import io
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(atlas).convert("RGBA"), dtype=np.float64)[..., 3] / 255.0
    out = np.full(a.shape + (4,), 255, np.uint8)
    out[..., 3] = np.round(a ** power * 255.0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, format="PNG", compress_level=9)
    return buf.getvalue()


def add_image(doc, rest, png, name):
    """Append a PNG to the GLB BIN chunk (rest = chunk header + data) as image + texture; returns (texture index,
    new rest)."""
    blen, btype = struct.unpack_from("<II", rest, 0)
    data = rest[8:8 + blen]
    pad = -len(data) % 4
    off = len(data) + pad
    data = data + b"\0" * pad + png
    data += b"\0" * (-len(data) % 4)
    doc["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(png)})
    doc.setdefault("images", []).append({"bufferView": len(doc["bufferViews"]) - 1, "mimeType": "image/png", "name": name})
    tex = {"source": len(doc["images"]) - 1}
    hair = next(m for m in doc["materials"] if m.get("name") == "hair_cards")
    base = doc["textures"][hair["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    if "sampler" in base:
        tex["sampler"] = base["sampler"]
    doc["textures"].append(tex)
    doc["buffers"][0]["byteLength"] = len(data)
    return len(doc["textures"]) - 1, struct.pack("<II", len(data), btype) + data + rest[8 + blen:]


def sheen(doc, spec, rough, aniso, atlas, rot=math.pi / 2):
    tint = atlas_tint(atlas)
    for m in doc.get("materials", []):
        if m.get("name") != "hair_cards":
            continue
        ext = m.setdefault("extensions", {})
        ext["KHR_materials_specular"] = {"specularFactor": spec, "specularColorFactor": tint}
        ext["KHR_materials_anisotropy"] = {"anisotropyStrength": aniso, "anisotropyRotation": rot}
        m["pbrMetallicRoughness"]["roughnessFactor"] = rough
    doc["extensionsUsed"] = sorted(set(doc.get("extensionsUsed", [])) | {"KHR_materials_specular",
                                                                        "KHR_materials_anisotropy"})
    out = {"specularFactor": spec, "specularColorFactor": tint, "roughness": rough, "anisotropyStrength": aniso,
           "atlas": str(atlas)}
    if rot != math.pi / 2:
        out["anisotropyRotation"] = rot
    return out


def main():
    src, dst, rec_p = map(Path, sys.argv[1:4])
    data = src.read_bytes()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    if len(sys.argv) > 4 and sys.argv[4] == "--runtime-sheen":
        spec, rough, aniso = (float(x) for x in sys.argv[5:8])
        opts = sys.argv[9:]
        # cards-r7 M3: --aniso-rotation R (radians; default pi/2 = along the strand, cards-r5/r6)
        rot = float(opts[opts.index("--aniso-rotation") + 1]) if "--aniso-rotation" in opts else math.pi / 2
        applied = sheen(doc, spec, rough, aniso, Path(sys.argv[8]), rot)
        for flag, ext, key, fn, name in (
                ("--spec-alpha-power", "KHR_materials_specular", "specularTexture", spec_mask_png, "hair_spec_mask"),
                ("--aniso-alpha-power", "KHR_materials_anisotropy", "anisotropyTexture", aniso_mask_png,
                 "hair_aniso_mask")):
            if flag not in opts:
                continue
            pw = float(opts[opts.index(flag) + 1])
            agree = None
            if fn is aniso_mask_png and "--aniso-agree" in opts:
                i = opts.index("--aniso-agree")
                agree = card_agreement(opts[i + 1], float(opts[i + 2]), float(opts[i + 3]))
                applied["anisoAgree"] = {"cards": opts[i + 1], "lo": float(opts[i + 2]), "hi": float(opts[i + 3]),
                                         "stationsBelowHi": float((agree[2] < float(opts[i + 3])).mean())}
            png = fn(Path(sys.argv[8]), pw, agree) if fn is aniso_mask_png else fn(Path(sys.argv[8]), pw)
            ti, rest = add_image(doc, rest, png, name)
            for m in doc["materials"]:
                if m.get("name") == "hair_cards":
                    m["extensions"][ext][key] = {"index": ti}
            applied[key] = {"rule": "%s = atlas alpha ^ %g" % ("alpha" if ext.endswith("specular") else "blue (strength)", pw),
                            "png": len(png), "sha256": hashlib.sha256(png).hexdigest()}
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
