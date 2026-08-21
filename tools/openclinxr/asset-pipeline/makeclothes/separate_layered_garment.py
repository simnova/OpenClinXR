#!/usr/bin/env python3
"""#504 — apply the outer-layer standoff to a SHIPPED GLB's over-garment mesh.

The bake treats a garment worn under another identically to one worn alone: the scrub
shirt and the lab coat both land at the raw MakeClothes fit because their .mhclo files
declare the SAME `z_depth 50`, so the shirt pokes through the coat in the render.
Consuming z_depth faithfully yields no offset between them (equal values), and
`delete_verts` removes BASEMESH vertices (body under garment, #485/#295), not the shirt
under the coat. This introduces the separation the shipped data does not express:
push the OUTER garment out to CLOTH_STANDOFF_M along the body's outward normal, using
the SAME `cloth_offset` the materializer now bakes (materialize_mpfb_humanoid_candidate.py,
the #504 coat pass) and the trousers use (#322).

Surgical: only the over-garment POSITION accessor bytes change. Topology, materials,
skin, morph targets and every other buffer are copied verbatim. This is the migration
step for bytes that were baked before the coat pass existed; a fresh bake produces the
same result inside Blender.

claimScope: deterministic outer-layer standoff on the shipped bytes.
notEvidenceFor: render appearance, poke-through-free pixels, clinical realism.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
from garment_coverage import CLOTH_STANDOFF_M, cloth_outward_offset  # noqa: E402


def _read_glb(path: Path):
    data = bytearray(path.read_bytes())
    if data[:4] != b"glTF":
        raise RuntimeError(f"#504: not a GLB: {path}")
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])
    # BIN chunk header sits at json_end..json_end+8; bufferView offsets are relative
    # to the buffer data that follows it.
    bin_start = json_end + 8
    bin_data = data[bin_start:]
    return data, json_len, json_end, bin_start, gltf, bin_data


def _rewrite_glb(data: bytearray, json_len: int, json_end: int, bin_start: int, bin_data: bytearray) -> bytearray:
    data[json_end + 8 :] = bin_data
    return data


def _accessor_positions(gltf, acc_idx, bin_data):
    acc = gltf["accessors"][acc_idx]
    if acc.get("componentType") != 5126 or acc.get("type") != "VEC3":
        raise RuntimeError(f"#504: accessor {acc_idx} is not float32 VEC3 POSITION")
    bv = gltf["bufferViews"][acc["bufferView"]]
    stride = bv.get("byteStride", 12)
    off = (bv.get("byteOffset", 0) or 0) + (acc.get("byteOffset", 0) or 0)
    verts = np.zeros((acc["count"], 3), dtype=np.float64)
    for i in range(acc["count"]):
        for k in range(3):
            verts[i, k] = struct.unpack_from("<f", bin_data, off + i * stride + k * 4)[0]
    return verts, off, stride, acc["count"]


def _accessor_indices(gltf, acc_idx, bin_data):
    acc = gltf["accessors"][acc_idx]
    ct = acc.get("componentType")
    bv = gltf["bufferViews"][acc["bufferView"]]
    stride = bv.get("byteStride", 2 if ct == 5123 else 4)
    off = (bv.get("byteOffset", 0) or 0) + (acc.get("byteOffset", 0) or 0)
    fmt = "<H" if ct == 5123 else "<I" if ct == 5125 else None
    if fmt is None:
        raise RuntimeError(f"#504: unsupported index componentType {ct}")
    idx = np.zeros(acc["count"], dtype=np.int64)
    for i in range(acc["count"]):
        idx[i] = struct.unpack_from(fmt, bin_data, off + i * stride)[0]
    return idx


def _find_garment_mesh(gltf, name_re):
    import re as _re
    out = []
    for m in gltf.get("meshes", []):
        if not _re.search(name_re, m.get("name", "")):
            continue
        for p in m.get("primitives", []):
            if "POSITION" in p.get("attributes", {}):
                out.append((m.get("name", ""), p["attributes"]["POSITION"]))
    return out


def _find_body_surface(gltf, bin_data, name_re):
    import re as _re
    verts_parts = []
    faces_parts = []
    v_base = 0
    for m in gltf.get("meshes", []):
        if not _re.search(name_re, m.get("name", "")):
            continue
        for p in m.get("primitives", []):
            if "POSITION" not in p.get("attributes", {}) or "indices" not in p:
                continue
            pos, _off, _stride, _n = _accessor_positions(gltf, p["attributes"]["POSITION"], bin_data)
            idx = _accessor_indices(gltf, p["indices"], bin_data)
            verts_parts.append(pos)
            faces_parts.append(idx.reshape(-1, 3) + v_base)
            v_base += pos.shape[0]
    if not verts_parts:
        raise RuntimeError(f"#504: no body surface matched {name_re!r}")
    return np.concatenate(verts_parts), np.concatenate(faces_parts)


def separate_layered_garment(
    glb_path: Path,
    *,
    garment_name_re: str = "lab_coat",
    body_name_re: str = "_body",
    standoff: float = CLOTH_STANDOFF_M,
    dry_run: bool = False,
) -> dict:
    data, json_len, json_end, bin_start, gltf, bin_data = _read_glb(glb_path)

    body_verts, body_faces = _find_body_surface(gltf, bin_data, body_name_re)
    garments = _find_garment_mesh(gltf, garment_name_re)
    if not garments:
        raise RuntimeError(f"#504: no garment mesh matched {garment_name_re!r} in {glb_path}")

    report = {"path": str(glb_path), "standoff": standoff, "garments": []}
    for mesh_name, pos_acc_idx in garments:
        garment_verts, off, stride, count = _accessor_positions(gltf, pos_acc_idx, bin_data)
        before = garment_verts.mean(axis=0)
        new_verts = cloth_outward_offset(garment_verts, body_verts, body_faces, standoff)
        shift = np.linalg.norm(new_verts - garment_verts, axis=1)
        if not dry_run:
            for i in range(count):
                for k in range(3):
                    struct.pack_into("<f", bin_data, off + i * stride + k * 4, float(new_verts[i, k]))
        after = new_verts.mean(axis=0)
        report["garments"].append(
            {
                "mesh": mesh_name,
                "verts": count,
                "centroidBefore": [round(float(c), 6) for c in before],
                "centroidAfter": [round(float(c), 6) for c in after],
                "netCentroidShiftM": round(float(np.linalg.norm(after - before)), 6),
                "minShiftM": round(float(shift.min()), 6),
                "maxShiftM": round(float(shift.max()), 6),
                "medianShiftM": round(float(np.median(shift)), 6),
            }
        )

    if not dry_run:
        _rewrite_glb(data, json_len, json_end, bin_start, bin_data)
        glb_path.write_bytes(bytes(data))
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="#504 outer-layer standoff on a shipped GLB garment")
    ap.add_argument("--glb", required=True, help="GLB to migrate (e.g. mpfb-clinical-physician-adult.glb)")
    ap.add_argument("--garment-re", default="lab_coat", help="regex matched against garment mesh names")
    ap.add_argument("--body-re", default="_body", help="regex matched against body mesh names")
    ap.add_argument("--standoff", type=float, default=CLOTH_STANDOFF_M)
    ap.add_argument("--dry-run", action="store_true", help="report the shift without writing")
    args = ap.parse_args(argv)
    report = separate_layered_garment(
        Path(args.glb),
        garment_name_re=args.garment_re,
        body_name_re=args.body_re,
        standoff=args.standoff,
        dry_run=args.dry_run,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
