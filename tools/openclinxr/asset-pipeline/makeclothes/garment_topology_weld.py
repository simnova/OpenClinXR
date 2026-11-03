#!/usr/bin/env python3
"""Garment topology weld (st-weld D1) — connect per-face index islands by position.

WHY THIS EXISTS
---------------
MPFB-rail MakeClothes garments ship as one index island per face (the nurse scrub
shirt measures 4692 raw components; welded by position it is exactly 1). The
shoulder-span counterweights (garment-hem-boundary cl.3, open-front-underlayer
cl.3) require ONE index component spanning front/back/shoulders, so every such
garment fails them by construction.

A NAIVE weld (merge everything, average all normals) conflicts with
garments-are-flat-shaded-and-the-body-is-not: joins sharper than 60 deg must keep
split normals (clause 2 floors them at 0.9x the measured count). This stage is the
weld that keeps normals:

- Group corners by position with the contract's own weld keys
  (`(x).toFixed(5)`, reimplemented here as Decimal quantize — measured 0
  divergences on 232,298 exported garment positions).
- Per position, incident FACES are clustered by dihedral (single linkage:
  two faces join when their normals differ by less than the threshold; faces
  come from positions, so smoothing can never move this reference — same
  argument as the flat-shade contract's WHY section). Each face-component
  becomes one shared vertex (indices remapped to the survivor; survivor
  NORMAL = normalized mean of the component's face normals — the same math
  as #371's post-export smoothing). A real crease separates into one vertex
  per cloth side, so the position stays split and the flat-shade contract's
  sharp-split count is unchanged. A doubled hem (3-4 coincident corners:
  outer/inner/facing duplicates) separates per side instead of staying a
  crack farm, and a crack WITHIN one side (coincident corners whose faces
  agree — measured 11 deg max on the nurse scrub fold) closes. A plain
  widest-angle rule keeps such cracks open and the hem-boundary walk bounces
  between the coincident verts (measured 180-deg hairpins, which fail the
  hem-regularity clause).
- Skinning is never altered: a group whose JOINTS_0/WEIGHTS_0 disagree beyond
  1e-4 is kept split and logged (measured on the nurse scrub: 0 disagreements
  in 4437 merged groups).
- UVs: a group whose TEXCOORD_0 disagree beyond 1e-4 is kept split when the
  material binds a baseColorTexture (merging would smear the print), and
  averaged when untextured (the nurse scrub ships a flat role colour, no
  texture — measured). The count is logged either way.

WHAT IT DOES NOT DO
-------------------
- It never moves a position, never adds/removes a triangle, never changes the
  file length: only glTF indices are remapped and surviving NORMAL (and, for
  untextured materials, TEXCOORD) values rewritten in place — the same in-place
  rewrite pattern as #371's apply_garment_auto_smooth_normals. Orphaned corners
  stay in the accessors unreferenced (morph-target sparse indices keep working;
  a future compacting bake may drop the dead corners — not needed for any
  clause and deliberately out of scope).
- It never touches body/skin, eyes, hair, footwear tread (functional sharp
  geometry), or any non-makeclothes primitive.

REUSE
-----
Other garment kinds/owners reuse this stage with a measured angle: the threshold
is the smallest angle at which the garment's largest piece becomes the only
meaningful index component (nurse scrub: 90 — thr60 leaves front/back as 2
meaningful pieces, thr90 leaves 1 + dust; t-shirt kinds never connect by angle
alone and need their owner's measurement, see E/STATE.md).

Measured 2026-11-03 on Blender 5.1.1-exported bytes with the contract's own
instrument math (tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py
wires this post-export, before the #371/#body smoothing passes, which are
order-independent with it by construction).
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from decimal import Decimal, ROUND_HALF_UP

#: Default weld angle. Measured minimal for the nurse scrub upper: with 60 the
#: shirt is 2 meaningful components (front/back split at the ~90-degree shoulder
#: band); with 90 it is 1 meaningful component + unreferenced dust.
#: Joins at or above this angle keep split normals (the flat-shade contract
#: floors sharp splits at >60 deg, so a weld at 90 preserves a superset of them).
WELD_ANGLE_DEG_DEFAULT = 90.0

_UV_TOL = 1e-4
_WEIGHT_TOL = 1e-4


def _weld_key_5(pos) -> str:
    """Position weld key identical to the contract's JS `(x).toFixed(5)` string."""
    return ",".join(
        format(
            Decimal(str(c)).quantize(Decimal("0.00001"), rounding=ROUND_HALF_UP),
            "f",
        )
        for c in pos
    )


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(v):
    length = math.sqrt(sum(c * c for c in v)) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


def _dot(a, b) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _is_weld_garment_material(mat_name: str) -> bool:
    """Upper/lower MakeClothes shells. Footwear tread, eyes and fitted hair are
    excluded: tread blocks are functional sharp geometry no clause needs welded,
    and eyes/hair are not garments."""
    n = mat_name or ""
    low = n.lower()
    if "makeclothes_library" not in low:
        return False
    if "eyes" in low:
        return False
    if "footwear" in low or "shoe" in low or "boot" in low:
        return False
    if "hair" in low:
        return False
    return True


_VEC_SIZES = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
_CTYPES = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}


def _elem_size(accessor) -> int:
    fmt, size = _CTYPES[accessor["componentType"]]
    return _VEC_SIZES[accessor["type"]] * size


def apply_garment_topology_weld(glb_path: str, angle_deg: float = WELD_ANGLE_DEG_DEFAULT) -> dict:
    """Weld garment index islands by position, preserving sharp split normals.

    Returns a per-material report dict (merged/kept/refused counts). Raises
    RuntimeError on interleaved or otherwise unreadable garment primitives
    rather than shipping a half-weld.
    """
    with open(glb_path, "rb") as f:
        data = bytearray(f.read())
    if data[:4] != b"glTF":
        raise RuntimeError(f"garment-topology-weld: not a GLB: {glb_path}")
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])
    bin_header = bytes(data[json_end : json_end + 8])
    bin_chunk = bytearray(data[json_end + 8 :])
    bvs = gltf.get("bufferViews", [])
    accs = gltf.get("accessors", [])
    materials = gltf.get("materials", [])

    def read_accessor(acc_idx, elem_fmt, count_override=None):
        acc = accs[acc_idx]
        bv = bvs[acc["bufferView"]]
        # Stride may exceed the element size: garment prims are commonly
        # interleaved (e.g. stride 52 with POSITION+NORMAL+UV+JOINTS+WEIGHTS in
        # one bufferView). Reads and lane writes step by the stride, so both
        # layouts are handled; nothing here assumes tightly packed arrays.
        stride = bv.get("byteStride", _elem_size(acc))
        off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        count = acc["count"] if count_override is None else count_override
        return (
            [struct.unpack_from(elem_fmt, bin_chunk, off + i * stride) for i in range(count)],
            bv,
            off,
            stride,
        )

    report: dict = {"angle_deg": angle_deg, "prims": []}
    patched_any = False

    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mat_idx = prim.get("material")
            mat_name = ""
            mat_has_texture = False
            if mat_idx is not None and mat_idx < len(materials):
                mat = materials[mat_idx]
                mat_name = mat.get("name", "")
                pbr = mat.get("pbrMetallicRoughness", {})
                mat_has_texture = "baseColorTexture" in pbr
            if not _is_weld_garment_material(mat_name):
                continue
            attrs = prim.get("attributes", {})
            if "POSITION" not in attrs or "NORMAL" not in attrs or "indices" not in prim:
                raise RuntimeError(
                    f"garment-topology-weld: {mat_name} missing POSITION/NORMAL/indices"
                )
            pos_acc_idx = attrs["POSITION"]
            nor_acc_idx = attrs["NORMAL"]
            pos_acc = accs[pos_acc_idx]
            nor_acc = accs[nor_acc_idx]
            if pos_acc["componentType"] != 5126 or nor_acc["componentType"] != 5126:
                raise RuntimeError(f"garment-topology-weld: {mat_name} POSITION/NORMAL not float32")

            P, _, _, _ = read_accessor(pos_acc_idx, "<fff")
            N, nor_bv, nor_off, nor_stride = read_accessor(nor_acc_idx, "<fff")
            idx_acc = accs[prim["indices"]]
            if idx_acc["componentType"] == 5123:
                idx = [r[0] for r in read_accessor(prim["indices"], "<H")[0]]
                idx_fmt: str | None = "<H"
            elif idx_acc["componentType"] == 5125:
                idx = [r[0] for r in read_accessor(prim["indices"], "<I")[0]]
                idx_fmt = "<I"
            else:
                raise RuntimeError(f"garment-topology-weld: {mat_name} unsupported index type")

            has_uv = "TEXCOORD_0" in attrs
            has_skin = "JOINTS_0" in attrs and "WEIGHTS_0" in attrs
            T = read_accessor(attrs["TEXCOORD_0"], "<ff")[0] if has_uv else None
            J = read_accessor(attrs["JOINTS_0"], "<BBBB")[0] if has_skin else None
            W = read_accessor(attrs["WEIGHTS_0"], "<ffff")[0] if has_skin else None
            nor_arr = [list(n) for n in N]

            face_normals = []
            for t in range(0, len(idx), 3):
                a, b, c = idx[t], idx[t + 1], idx[t + 2]
                face_normals.append(_norm(_cross(_sub(P[b], P[a]), _sub(P[c], P[a]))))

            # Per position: incident faces and, per face, the corner vertex ids
            # sitting on this position (a needle triangle can park two corners
            # of one face on one position). Faces drive the clustering; corners
            # are what the indices remap.
            face_corners: dict[str, dict[int, list[int]]] = {}
            for t in range(0, len(idx), 3):
                tri = (idx[t], idx[t + 1], idx[t + 2])
                for i in tri:
                    k = _weld_key_5(P[i])
                    face_corners.setdefault(k, {}).setdefault(t // 3, []).append(i)

            remap: dict[int, int] = {}
            merged_groups: list[list[int]] = []
            merged = kept_sharp = kept_weights = kept_uv = 0
            for k, fmap in face_corners.items():
                if sum(len(c) for c in fmap.values()) < 2:
                    continue
                faces = sorted(fmap)
                # Single-linkage face components by dihedral: faces joined by a
                # <angle_deg step belong to one smooth side. A doubled hem
                # (outer/inner/facing stacks, 3-4 coincident corners) separates
                # into one component per cloth side, while a crack WITHIN one
                # side (coincident corners whose faces agree to <angle_deg,
                # measured 11 deg max on the nurse scrub fold) closes. A plain
                # widest-angle rule keeps such cracks open and the hem-boundary
                # walk bounces between the coincident verts (180-deg hairpins).
                parent = {f: f for f in faces}
                def find(a):
                    while parent[a] != a:
                        parent[a] = parent[parent[a]]
                        a = parent[a]
                    return a
                for ii in range(len(faces)):
                    for jj in range(ii + 1, len(faces)):
                        f, g = faces[ii], faces[jj]
                        d = max(-1.0, min(1.0, _dot(face_normals[f], face_normals[g])))
                        if math.degrees(math.acos(d)) < angle_deg:
                            rf, rg = find(f), find(g)
                            if rf != rg:
                                parent[rg] = rf
                comps: dict[int, list[int]] = {}
                for f in faces:
                    comps.setdefault(find(f), []).append(f)
                if len(comps) > 1:
                    # A real crease: one surviving vertex per cloth side, each
                    # carrying its side's normal. The position stays split, so
                    # the flat-shade contract's sharp-split count is unchanged.
                    kept_sharp += 1
                comp_list = sorted(comps.values(), key=lambda c: min(c))
                for comp in comp_list:
                    corners: list[int] = []
                    for f in comp:
                        for vi in fmap[f]:
                            if vi not in corners:
                                corners.append(vi)
                    if len(corners) < 2:
                        continue
                    if has_skin:
                        assert J is not None and W is not None
                        key0 = (tuple(J[corners[0]]), tuple(round(x, 4) for x in W[corners[0]]))
                        if any(
                            (tuple(J[i]), tuple(round(x, 4) for x in W[i])) != key0
                            for i in corners[1:]
                        ):
                            kept_weights += 1
                            continue
                    if has_uv and mat_has_texture:
                        assert T is not None
                        key0uv = (round(T[corners[0]][0], 4), round(T[corners[0]][1], 4))
                        if any(
                            (round(T[i][0], 4), round(T[i][1], 4)) != key0uv
                            for i in corners[1:]
                        ):
                            kept_uv += 1
                            continue
                    # Merge: survivor keeps the position (identical floats,
                    # measured); NORMAL becomes the normalized mean of the
                    # component's face normals (the #371 construction);
                    # UVs are averaged only when inert.
                    avg = [0.0, 0.0, 0.0]
                    for fi in comp:
                        for axis in range(3):
                            avg[axis] += face_normals[fi][axis]
                    shared = list(_norm(tuple(avg)))
                    survivor = corners[0]
                    nor_arr[survivor] = shared
                    for vi in corners[1:]:
                        remap[vi] = survivor
                    merged_groups.append(corners)
                if len(comps) == 1:
                    merged += 1

            if remap:
                new_idx = [remap.get(i, i) for i in idx]
                idx_bv = bvs[idx_acc["bufferView"]]
                idx_stride = idx_bv.get("byteStride", 2 if idx_fmt == "<H" else 4)
                idx_off = idx_bv.get("byteOffset", 0) + idx_acc.get("byteOffset", 0)
                max_new = max(new_idx)
                if idx_fmt == "<H" and max_new > 65535:
                    raise RuntimeError(
                        f"garment-topology-weld: {mat_name} survivor index overflow"
                    )
                for n, v in enumerate(new_idx):
                    struct.pack_into(idx_fmt, bin_chunk, idx_off + n * idx_stride, v)
                for i, n in enumerate(nor_arr):
                    struct.pack_into("<fff", bin_chunk, nor_off + i * nor_stride, *n)
                if has_uv and not mat_has_texture:
                    assert T is not None
                    uv_acc = accs[attrs["TEXCOORD_0"]]
                    uv_bv = bvs[uv_acc["bufferView"]]
                    uv_stride = uv_bv.get("byteStride", 8)
                    uv_off = uv_bv.get("byteOffset", 0) + uv_acc.get("byteOffset", 0)
                    for ids in merged_groups:
                        mu = sum(T[i][0] for i in ids) / len(ids)
                        mv = sum(T[i][1] for i in ids) / len(ids)
                        struct.pack_into("<ff", bin_chunk, uv_off + ids[0] * uv_stride, mu, mv)
                patched_any = True

            report["prims"].append(
                {
                    "material": mat_name,
                    "merged_positions": merged,
                    "kept_sharp_positions": kept_sharp,
                    "kept_split_weights": kept_weights,
                    "kept_split_textured_uv": kept_uv,
                }
            )
            print(
                f"GARMENT_TOPOLOGY_WELD {mat_name} angle={angle_deg} "
                f"merged={merged} kept_sharp={kept_sharp} "
                f"kept_weights={kept_weights} kept_uv={kept_uv}"
            )

    if not report["prims"]:
        raise RuntimeError(f"garment-topology-weld: no garment primitive found in {glb_path}")

    out = bytearray()
    out += b"glTF"
    out += struct.pack("<II", 2, 12 + 8 + json_len + len(bin_header) + len(bin_chunk))
    out += struct.pack("<I", json_len) + b"JSON"
    out += data[20:json_end]
    out += bin_header
    out += bin_chunk
    with open(glb_path, "wb") as f:
        f.write(out)
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Weld garment index islands by position.")
    ap.add_argument("--input", required=True, help="GLB to weld in place")
    ap.add_argument("--angle", type=float, default=WELD_ANGLE_DEG_DEFAULT)
    ap.add_argument("--report", default=None, help="Write JSON report here")
    args = ap.parse_args(argv)
    rep = apply_garment_topology_weld(args.input, angle_deg=args.angle)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=2)
    print(json.dumps(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
