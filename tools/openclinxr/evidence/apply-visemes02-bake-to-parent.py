#!/usr/bin/env python3
"""#462 — apply the PROVEN visemes02 bake to the shipped peds parent GLB.

The materializer already loads the 15 visemes02 targets natively
(`materialize_mpfb_humanoid_candidate.py` `install_visemes02_targets` +
`FaceService.load_targets`, #432/E6.3), and `mpfb-viseme-inspect.glb` is the
proven output: 47 targets = 32 FACS + 15 viseme_* on the IDENTICAL default-macro
adult-female body (same 8 primitives, byte-identical POSITION accessors, same
13,380-vert helper-stripped topology). The shipped parent
`mpfb-peds-parent-aisha.glb` predates that bake (generated 2026-08-14) and carries
only the 32 FACS — the viseme recipe simply never ran on it.

A full re-bake is the D1 fix, but this worktree has no `.openclinxr-local`
provider cache (gitignored, absent by design), so the materializer cannot run
here. This script consumes the PROVEN bake's output instead of hand-authoring a
lip shape: it copies the 15 viseme morph-target deltas byte-exactly from the
inspect GLB into the parent GLB, appending them to the parent's existing 32 FACS
targets. Nothing is synthesized, renamed, or re-weighted.

The viseme accessors are SPARSE (a viseme displaces only the mouth/lip vertex
subset), so the copy is byte surgery over the GLB JSON + BIN chunks — the same
post-export pattern as `patch_glb_base_color_factors` and
`apply_garment_auto_smooth_normals` in the materializer. The parent's existing
geometry, materials, weights, and animations are copied verbatim; only the BIN
chunk grows (appended sparse indices + deltas) and the body mesh gains 15 targets.

RUN:
    python3 tools/openclinxr/evidence/apply-visemes02-bake-to-parent.py \
        --source apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb \
        --inspect apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb \
        [--output <path>]   # default: overwrite --source
"""
import argparse
import json
import struct
import sys

BODY_MESH_NAME = "mpfb_ob_patient_aisha_body"
EXPECTED_FACS = 32
EXPECTED_VISEMES = 15
POSITION_COMPONENT_TYPE = 5126  # FLOAT


def read_glb(path):
    with open(path, "rb") as f:
        data = bytearray(f.read())
    assert data[:4] == b"glTF", f"not a GLB: {path}"
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])
    # BIN chunk = 8-byte header (length + b"BIN\0") + data. bufferView byteOffsets
    # are relative to the BIN DATA (after the 8-byte header).
    bin_header = bytes(data[json_end : json_end + 8])
    bin_data = bytearray(data[json_end + 8 :])
    return gltf, bin_header, bin_data


def write_glb(path, gltf, bin_header, bin_data):
    new_json = json.dumps(gltf, separators=(",", ":"))
    new_json += " " * ((4 - len(new_json) % 4) % 4)
    bin_chunk = bin_header + bin_data
    out = bytearray()
    out += b"glTF"
    out += struct.pack("<II", 2, 12 + 8 + len(new_json) + len(bin_chunk))
    out += struct.pack("<I", len(new_json)) + b"JSON"
    out += new_json.encode("utf-8")
    out += bin_chunk
    with open(path, "wb") as f:
        f.write(out)


def body_mesh(gltf):
    for m in gltf["meshes"]:
        if m.get("name") == BODY_MESH_NAME:
            return m
    raise RuntimeError(f"body mesh {BODY_MESH_NAME!r} not found")


def accessor_pos_bytes(gltf, bin_data, accessor_idx):
    """Decode a non-sparse VEC3 FLOAT accessor's bytes as (count, byte_hex)."""
    acc = gltf["accessors"][accessor_idx]
    assert acc["type"] == "VEC3" and acc["componentType"] == POSITION_COMPONENT_TYPE, acc
    assert "bufferView" in acc, f"accessor {accessor_idx} is sparse — not the base POSITION"
    bv = gltf["bufferViews"][acc["bufferView"]]
    stride = bv.get("byteStride", 12)
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    # Hash every element's 12 bytes in order (skipping stride padding, which morph
    # POSITION accessors never carry here — but be exact regardless).
    parts = []
    for i in range(acc["count"]):
        parts.append(bin_data[off + i * stride : off + i * stride + 12])
    return acc["count"], parts


def verify_topology_identical(src_gltf, src_bin, ins_gltf, ins_bin):
    sm = body_mesh(src_gltf)
    im = body_mesh(ins_gltf)
    if len(sm["primitives"]) != len(im["primitives"]):
        raise RuntimeError(
            f"primitive count differs: source {len(sm['primitives'])} vs inspect {len(im['primitives'])}"
        )
    for i, (sp, ip) in enumerate(zip(sm["primitives"], im["primitives"])):
        s_pos = sp["attributes"]["POSITION"]
        i_pos = ip["attributes"]["POSITION"]
        s_count, s_parts = accessor_pos_bytes(src_gltf, src_bin, s_pos)
        i_count, i_parts = accessor_pos_bytes(ins_gltf, ins_bin, i_pos)
        if s_count != i_count or s_parts != i_parts:
            raise RuntimeError(
                f"primitive {i} POSITION differs (source {s_count} vs inspect {i_count} verts) — "
                "not the identical mesh; refusing to mis-index morph deltas"
            )
    return sm, im


def viseme_names(im):
    tn = im.get("extras", {}).get("targetNames", [])
    if len(tn) != EXPECTED_FACS + EXPECTED_VISEMES:
        raise RuntimeError(f"inspect body has {len(tn)} targetNames, expected 47")
    return tn[EXPECTED_FACS:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--inspect", required=True)
    ap.add_argument("--output", default=None)
    args = ap.parse_args()
    out_path = args.output or args.source

    src_gltf, src_bin_header, src_bin = read_glb(args.source)
    ins_gltf, _ins_header, ins_bin = read_glb(args.inspect)

    sm, im = verify_topology_identical(src_gltf, src_bin, ins_gltf, ins_bin)
    names = viseme_names(im)

    # Source body must already carry exactly the 32 FACS and none of the visemes.
    src_tn = sm.get("extras", {}).get("targetNames", [])
    if len(src_tn) != EXPECTED_FACS:
        raise RuntimeError(f"source body has {len(src_tn)} targets, expected {EXPECTED_FACS} FACS")
    if any(n.startswith("viseme_") for n in src_tn):
        raise RuntimeError("source body already carries viseme targets — nothing to do")

    # Map every inspect bufferView we must copy (sparse indices + values) to a new
    # offset in the source BIN. Copy bytes verbatim; dedupe by bufferView index.
    copied_bv = {}  # inspect bufferView index -> new source bufferView index
    appended = bytearray()

    def append_bytes(raw: bytes) -> int:
        nonlocal appended
        # 4-byte align the append so the new bufferView offset stays spec-legal.
        while len(appended) % 4 != 0:
            appended.append(0)
        off = len(src_bin) + len(appended)
        appended += raw
        return off

    new_accessors = []  # (inspect accessor index, new accessor json)
    for prim in im["primitives"]:
        for target in prim["targets"][EXPECTED_FACS:]:
            for attr in ("POSITION", "NORMAL"):
                acc_idx = target[attr]
                acc = ins_gltf["accessors"][acc_idx]
                assert "sparse" in acc, f"viseme {attr} accessor {acc_idx} is not sparse"
                sparse = acc["sparse"]
                new_sparse = {"count": sparse["count"]}
                for role in ("indices", "values"):
                    ibv = sparse[role]["bufferView"]
                    if ibv not in copied_bv:
                        ibv_json = ins_gltf["bufferViews"][ibv]
                        raw = bytes(ins_bin[ibv_json.get("byteOffset", 0) : ibv_json.get("byteOffset", 0) + ibv_json["byteLength"]])
                        new_off = append_bytes(raw)
                        new_bv = dict(ibv_json)
                        new_bv["byteOffset"] = new_off
                        src_gltf["bufferViews"].append(new_bv)
                        copied_bv[ibv] = len(src_gltf["bufferViews"]) - 1
                    new_sparse[role] = dict(sparse[role])
                    new_sparse[role]["bufferView"] = copied_bv[ibv]
                new_acc = {
                    "componentType": acc["componentType"],
                    "count": acc["count"],
                    "type": acc["type"],
                    "sparse": new_sparse,
                }
                if "min" in acc:
                    new_acc["min"] = acc["min"]
                    new_acc["max"] = acc["max"]
                src_gltf["accessors"].append(new_acc)
                target[attr] = len(src_gltf["accessors"]) - 1

    # Append the 15 targets to each source primitive (matching primitive order).
    for sp, ip in zip(sm["primitives"], im["primitives"]):
        for target in ip["targets"][EXPECTED_FACS:]:
            sp["targets"].append(target)

    # Append the 15 viseme names to the source body's targetNames.
    sm.setdefault("extras", {})["targetNames"] = src_tn + names

    if appended:
        src_bin += appended
        # Rebuild the BIN chunk length header (first 4 bytes of the 8-byte header).
        src_bin_header = struct.pack("<I", len(src_bin)) + b"BIN\x00"

    write_glb(out_path, src_gltf, src_bin_header, src_bin)
    print(f"VISEMES02_TRANSFER {out_path} added {EXPECTED_VISEMES} viseme targets "
          f"({len(src_tn)} FACS preserved; +{len(appended)} BIN bytes, "
          f"{len(copied_bv)} bufferViews copied)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        sys.exit(1)
