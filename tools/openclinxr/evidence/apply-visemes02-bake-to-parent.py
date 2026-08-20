#!/usr/bin/env python3
"""#462 — apply the PROVEN visemes02 bake to a shipped peds parent GLB.

The materializer already loads the 15 visemes02 targets natively
(`materialize_mpfb_humanoid_candidate.py` `install_visemes02_targets` +
`FaceService.load_targets`, #432/E6.3), and `mpfb-viseme-inspect.glb` is the
proven output: 47 targets = 32 FACS + 15 viseme_* on the default-macro
adult-female body. The shipped parents (`generated-humanoids/mpfb-peds-parent-aisha.glb`
and the runtime-loaded `xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb`)
predate that bake and carry only the 32 FACS.

A full re-bake is the D1 fix, but this worktree has no `.openclinxr-local`
provider cache (gitignored, absent by design), so the materializer cannot run
here. This script consumes the PROVEN bake's output instead of hand-authoring a
lip shape: it copies the 15 viseme morph-target deltas from the inspect GLB into
the target GLB, appending them to the target's existing 32 FACS targets.

The viseme accessors are SPARSE. Measurement shows the 15 visemes displace ONLY
the body-skin primitive (prim 0: viseme_aa max 18.2 mm, matching E6.3); every
other primitive's POSITION deltas are literally zero (the exporter's normal
delta on those prims is <1.5e-7 — float noise). Two transfer modes:

  - EXACT: the target's body POSITION is byte-identical to the inspect's (the
    `generated-humanoids` source). Every sparse delta is copied verbatim.
  - ORDER-PRESERVED: the target was re-exported by a later stage (the
    `motion-bind` retarget). Its only significant-viseme primitive (prim 0) must
    match the inspect's vertex count and ORDER (per-index position delta below a
    small tolerance — the retarget's float re-quantization is ~2e-6, a vertex
    REORDER is ~cm, so the tolerance separates them). That primitive's sparse
    deltas are copied verbatim; the zero-delta primitives get dense-zero targets
    at the target's own vertex count, so no sparse index can mis-index a
    reordered primitive.

Nothing is synthesized, renamed, or re-weighted. Existing geometry, materials,
weights, and animations are copied verbatim; only the BIN chunk grows and the
body mesh gains 15 targets.

RUN:
    python3 tools/openclinxr/evidence/apply-visemes02-bake-to-parent.py \
        --source <target-glb> \
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
# Below this a per-index POSITION delta is float re-quantization (same vertex);
# a genuine vertex reorder moves a vertex centimetres (measured prim 6: 0.1186 m).
ORDER_TOLERANCE = 1e-3
# A primitive whose largest |viseme POSITION delta| is below this carries no real
# viseme displacement (measured prims 1-7: literal 0.0; prim 0: 0.018 m).
SIGNIFICANT_DELTA = 1e-6


def read_glb(path):
    with open(path, "rb") as f:
        data = bytearray(f.read())
    assert data[:4] == b"glTF", f"not a GLB: {path}"
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])
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
    acc = gltf["accessors"][accessor_idx]
    assert acc["type"] == "VEC3" and acc["componentType"] == POSITION_COMPONENT_TYPE, acc
    assert "bufferView" in acc, f"accessor {accessor_idx} is sparse — not the base POSITION"
    bv = gltf["bufferViews"][acc["bufferView"]]
    stride = bv.get("byteStride", 12)
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    parts = []
    for i in range(acc["count"]):
        parts.append(bin_data[off + i * stride : off + i * stride + 12])
    return acc["count"], parts


def position_arrays(gltf, bin_data, prim):
    acc = gltf["accessors"][prim["attributes"]["POSITION"]]
    bv = gltf["bufferViews"][acc["bufferView"]]
    stride = bv.get("byteStride", 12)
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return acc["count"], off, stride


def prim_viseme_pos_significance(ins_gltf, ins_bin):
    """Per-primitive max |viseme POSITION delta| across the 15 visemes (metres)."""
    sig = []
    for prim in body_mesh(ins_gltf)["primitives"]:
        maxmag = 0.0
        for target in prim["targets"][EXPECTED_FACS:]:
            acc = ins_gltf["accessors"][target["POSITION"]]
            sp = acc["sparse"]
            vbv = ins_gltf["bufferViews"][sp["values"]["bufferView"]]
            voff = vbv.get("byteOffset", 0)
            for i in range(sp["count"]):
                base = voff + i * 12
                x, y, z = struct.unpack_from("<fff", ins_bin, base)
                maxmag = max(maxmag, abs(x), abs(y), abs(z))
        sig.append(maxmag)
    return sig


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

    sm = body_mesh(src_gltf)
    im = body_mesh(ins_gltf)
    if len(sm["primitives"]) != len(im["primitives"]):
        raise RuntimeError(
            f"primitive count differs: source {len(sm['primitives'])} vs inspect {len(im['primitives'])}"
        )
    names = viseme_names(im)

    src_tn = sm.get("extras", {}).get("targetNames", [])
    if len(src_tn) != EXPECTED_FACS:
        raise RuntimeError(f"source body has {len(src_tn)} targets, expected {EXPECTED_FACS} FACS")
    if any(n.startswith("viseme_") for n in src_tn):
        raise RuntimeError("source body already carries viseme targets — nothing to do")

    sig = prim_viseme_pos_significance(ins_gltf, ins_bin)

    # Decide the mode: byte-identical body topology vs a re-export whose only
    # significant-viseme primitive must still preserve vertex order.
    exact = True
    for i, (sp, ip) in enumerate(zip(sm["primitives"], im["primitives"])):
        s_count, s_parts = accessor_pos_bytes(src_gltf, src_bin, sp["attributes"]["POSITION"])
        i_count, i_parts = accessor_pos_bytes(ins_gltf, ins_bin, ip["attributes"]["POSITION"])
        if s_count != i_count or s_parts != i_parts:
            exact = False
            break
    if not exact:
        for i, (sp, ip) in enumerate(zip(sm["primitives"], im["primitives"])):
            if sig[i] < SIGNIFICANT_DELTA:
                continue
            s_count, off_s, stride_s = position_arrays(src_gltf, src_bin, sp)
            i_count, off_i, stride_i = position_arrays(ins_gltf, ins_bin, ip)
            if s_count != i_count:
                raise RuntimeError(
                    f"primitive {i} carries a real viseme delta but the vertex count "
                    f"differs (source {s_count} vs inspect {i_count}) — refusing to mis-index"
                )
            for k in range(s_count):
                sx, sy, sz = struct.unpack_from("<fff", src_bin, off_s + k * stride_s)
                ix, iy, iz = struct.unpack_from("<fff", ins_bin, off_i + k * stride_i)
                if max(abs(sx - ix), abs(sy - iy), abs(sz - iz)) > ORDER_TOLERANCE:
                    raise RuntimeError(
                        f"primitive {i} carries a real viseme delta but vertex {k} was reordered "
                        f"(delta {max(abs(sx - ix), abs(sy - iy), abs(sz - iz)):.4g} m) — "
                        "refusing to mis-index the sparse deltas"
                    )

    copied_bv = {}
    appended = bytearray()

    def append_bytes(raw: bytes) -> int:
        nonlocal appended
        while len(appended) % 4 != 0:
            appended.append(0)
        off = len(src_bin) + len(appended)
        appended += raw
        return off

    zero_buf_cache = {}

    def copy_sparse_target(target):
        """Copy one inspect viseme target (POSITION + NORMAL sparse accessors) verbatim."""
        new_target = {}
        for attr in ("POSITION", "NORMAL"):
            acc = ins_gltf["accessors"][target[attr]]
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
            new_target[attr] = len(src_gltf["accessors"]) - 1
        return new_target

    def zero_position_target(prim_index, count):
        if prim_index in zero_buf_cache:
            return {"POSITION": zero_buf_cache[prim_index]}
        raw = bytes(count * 12)
        off = append_bytes(raw)
        bv_idx = len(src_gltf["bufferViews"])
        src_gltf["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(raw)})
        acc_idx = len(src_gltf["accessors"])
        src_gltf["accessors"].append(
            {
                "componentType": POSITION_COMPONENT_TYPE,
                "count": count,
                "type": "VEC3",
                "min": [0.0, 0.0, 0.0],
                "max": [0.0, 0.0, 0.0],
                "bufferView": bv_idx,
            }
        )
        zero_buf_cache[prim_index] = acc_idx
        return {"POSITION": acc_idx}

    for prim_index, (sp, ip) in enumerate(zip(sm["primitives"], im["primitives"])):
        if exact:
            for target in ip["targets"][EXPECTED_FACS:]:
                sp["targets"].append(copy_sparse_target(target))
        else:
            target_verts = accessor_pos_bytes(src_gltf, src_bin, sp["attributes"]["POSITION"])[0]
            for target in ip["targets"][EXPECTED_FACS:]:
                if sig[prim_index] >= SIGNIFICANT_DELTA:
                    sp["targets"].append(copy_sparse_target(target))
                else:
                    sp["targets"].append(zero_position_target(prim_index, target_verts))

    sm.setdefault("extras", {})["targetNames"] = src_tn + names

    if appended:
        src_bin += appended
        src_bin_header = struct.pack("<I", len(src_bin)) + b"BIN\x00"

    write_glb(out_path, src_gltf, src_bin_header, src_bin)
    mode = "exact" if exact else "order-preserved"
    print(f"VISEMES02_TRANSFER {out_path} mode={mode} added {EXPECTED_VISEMES} viseme targets "
          f"({len(src_tn)} FACS preserved; +{len(appended)} BIN bytes, "
          f"{len(copied_bv)} sparse bufferViews copied, {len(zero_buf_cache)} zero prims)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        sys.exit(1)
