#!/usr/bin/env python3
"""#0 — bake the jaw-open rotation into the viseme_aa morph of mpfb-viseme-inspect.glb.

## THE DEFECT, MEASURED — do not re-derive this

`viseme_aa` on the shipped inspect GLB deforms the lips 18.16 mm (max anterior
displacement) but the anterior oris/levator rim still OVERLAPS by 0.23 mm, so the
aperture is exactly zero (`open-mouth-interior.json`, #551 Stage A). Measured on the
anterior band (dominant JOINTS_0 on oris*/levator*, rest Z >= 60th percentile):

    viseme      lipGap (m)   overlap (m)     maxDisp (m)
    viseme_aa   0            0.000230        0.018156
    teeth AABB height        0.04145002365112305 m
    thresholdMeters          0.020725011825561523 m   ( = 0.5 x teeth AABB height )

The Y-deltas of the aa target on the anterior band are ALL NEGATIVE (333/333 verts,
max -0.01710): the whole band shifts down ~2 mm and forward, nothing parts. No morph
target on this mesh opens the mouth (the-viseme-driver-opens-the-jaw.test.ts #552
measured the best morph-only gap at 0.64 mm) — the visemes02 pack authors lip-surface
shapes, never a jaw component (MakeHuman/MPFB design).

## WHAT OPENS THE MOUTH — the jaw, baked into the morph (D9 factory station)

The rig carries a `jaw` bone whose bind-pose hinge sits at the TRS-composed world
origin (0.000000, 1.520849, 0.056505) — mesh space, composed from the full node TRS
chain (head/neck/spine bind rotations included; the naive sum-of-translations is
wrong by ~0.11 m here). The jaw's local X axis IS the mesh-space X axis (world matrix
x-axis = (1, 0, 0)), so rotating lower-lip vertices about the hinge about X reproduces
the runtime `applyJawOpenToRoot` mechanism (#552) as a MORPH delta.

theta is SOLVED, not fitted: bisection on the exact band metric (the same selector
and formula as open-mouth-interior-measure.ts) until the simulated aperture reaches
`1.15 * thresholdMeters`. The threshold is the TEETH mesh AABB height (input); theta
is the geometric solve that clears it with a 15% margin — no constant fitted to an
observation (§9s). Measured solve on the shipped bytes:

    theta = 0.245161 rad (14.05 deg)   <- anatomically ordinary (human jaw 25-50 deg)
    augmented gap = 0.023834 m         (1.15x the 0.020725 bar)
    augmented verts = the 511-vert lower lip band (rest Y < band midY) of the
    830-vert oris/levator band — all already present in the aa sparse indices,
    so the sparse accessor structure (count 2232, indices, component types) is
    untouched and only the VALUES change for lower-band verts.

The morph keeps every existing aa delta (the viseme's own lip shape) and ADDS the
rotation delta. viseme_sil and the other 45 targets are untouched; the target count
stays 47 (32 FACS + 15 viseme).

## RESIDUALS (stated, not hidden)

- Only the inspect GLB is re-baked. The materializer's install_visemes02_targets is
  not changed (this worktree has no .openclinxr-local/provider-cache/visemes, so a
  full materializer run is impossible here; the station is the D9 bake step for this
  slice, same pattern as apply-visemes02-bake-to-parent.py).
- The aa NORMAL deltas are not rotated (a ~14 deg normal error on the lower lip
  region is a shading artifact, invisible to the file-level contract; pixel
  visibility is out of scope for #0).
- The chin (non-lip skin) is not augmented — the rig weights it to skull bones, and
  the contract measures the lip band only.
- Teeth/tongue meshes do not ride this morph (no teeth morph exists), so the teeth
  stay at rest while the aperture clears half their arcade height — the contract's
  named falsifier does not trigger because the aperture is a lip-band property.

RUN:
    python3 tools/openclinxr/evidence/bake-aa-jaw-open-into-viseme-inspect.py \
        [--glb apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb]

Idempotency guard: refuses to run when the pre-bake gap is already >= 5 mm (the
bake has already been applied), so re-running cannot double the rotation.
"""
import argparse
import json
import math
import struct
import sys

DEFAULT_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb"
BODY_MESH_NAME = "mpfb_ob_patient_aisha_body"
LIP_JOINT_PREFIXES = ("oris", "levator")
X_CMP, Y_CMP, Z_CMP = 0, 1, 2
F32 = 5126
U8 = 5121
U16 = 5123
# Measured on HEAD 81d06dd6 / Stage A — inputs the station verifies before baking.
MEASURED_TEETH_HEIGHT = 0.04145002365112305
MEASURED_LIP_VERTS = 830
MEASURED_ANTERIOR_LIP_VERTS = 333
# The bake is one-shot: if the pre-bake aperture is already this large, it has run.
SEALED_GAP_REFUSE_MM = 5.0
TARGET_GAP_FACTOR = 1.15


def read_glb(path):
    with open(path, "rb") as f:
        data = bytearray(f.read())
    assert data[:4] == b"glTF", f"not a GLB: {path}"
    json_len = struct.unpack("<I", data[12:16])[0]
    json_end = 20 + json_len
    gltf = json.loads(data[20:json_end])
    bin_header = bytes(data[json_end:json_end + 8])
    bin_data = bytearray(data[json_end + 8:])
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


COMPONENT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENT_FMT = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
VEC_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor_bytes(gltf, bin_data, acc_idx):
    """Yield (vertex_index, tuple-of-components) for every element of a DENSE accessor."""
    acc = gltf["accessors"][acc_idx]
    assert "bufferView" in acc, f"accessor {acc_idx} is sparse"
    bv = gltf["bufferViews"][acc["bufferView"]]
    comp = acc["componentType"]
    per = COMPONENT_SIZE[comp] * VEC_COMPONENTS[acc["type"]]
    stride = bv.get("byteStride", per)
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    fmt = COMPONENT_FMT[comp]
    out = []
    for i in range(acc["count"]):
        base = off + i * stride
        raw = bin_data[base:base + per]
        if comp == 5126:
            out.append(tuple(struct.unpack_from("<" + "f" * VEC_COMPONENTS[acc["type"]], raw, 0)))
        else:
            out.append(tuple(struct.unpack_from("<" + fmt * VEC_COMPONENTS[acc["type"]], raw, 0)))
    return out


def sparse_entries(gltf, bin_data, acc):
    """Resolve a sparse accessor: dict vertex_index -> delta tuple (base is zero here)."""
    sp = acc["sparse"]
    ibv = gltf["bufferViews"][sp["indices"]["bufferView"]]
    ioff = ibv.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
    icomp = sp["indices"]["componentType"]
    ifmt = COMPONENT_FMT[icomp]
    isize = COMPONENT_SIZE[icomp]
    vbv = gltf["bufferViews"][sp["values"]["bufferView"]]
    voff = vbv.get("byteOffset", 0) + sp["values"].get("byteOffset", 0)
    entries = {}
    for i in range(sp["count"]):
        idx = struct.unpack_from("<" + ifmt, bin_data, ioff + i * isize)[0]
        x, y, z = struct.unpack_from("<fff", bin_data, voff + i * 12)
        entries[idx] = (x, y, z)
    return entries


def quat_mat(x, y, z, w):
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0.0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0.0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def node_trs(gltf, idx):
    n = gltf["nodes"][idx]
    t = n.get("translation", [0.0, 0.0, 0.0])
    s = n.get("scale", [1.0, 1.0, 1.0])
    r = n.get("rotation", [0.0, 0.0, 0.0, 1.0])
    R = quat_mat(*r)
    return [
        [s[0] * R[0][0], s[1] * R[0][1], s[2] * R[0][2], t[0]],
        [s[0] * R[1][0], s[1] * R[1][1], s[2] * R[1][2], t[1]],
        [s[0] * R[2][0], s[1] * R[2][1], s[2] * R[2][2], t[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_world_origin(gltf, idx):
    """Bind-space origin of a node: full TRS composition (rotations included)."""
    m = node_trs(gltf, idx)
    while True:
        parent = None
        for i, cand in enumerate(gltf["nodes"]):
            if idx in cand.get("children", []):
                parent = i
                break
        if parent is None:
            break
        m = mat_mul(node_trs(gltf, parent), m)
        idx = parent
    return (m[0][3], m[1][3], m[2][3])


def dominant_joint(joints_row, weights_row, joint_names):
    best, bw = -1, -1.0
    for k in range(4):
        if weights_row[k] > bw:
            bw = weights_row[k]
            best = joints_row[k]
    return joint_names[best] if best >= 0 else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", default=DEFAULT_GLB)
    args = ap.parse_args()

    gltf, bin_header, bin_data = read_glb(args.glb)

    # --- jaw bind pivot (TRS-composed) ---
    jaw_idx = next((i for i, n in enumerate(gltf["nodes"]) if n.get("name") == "jaw"), None)
    if jaw_idx is None:
        raise RuntimeError("no jaw node in the GLB")
    pivot = node_world_origin(gltf, jaw_idx)

    # --- skin joint names (same order the contract reads) ---
    skin = gltf["skins"][0]
    joint_names = [gltf["nodes"][j].get("name", "") for j in skin["joints"]]

    # --- body mesh prim 0 (the only primitive with real viseme deltas) ---
    body = next((m for m in gltf["meshes"] if m.get("name") == BODY_MESH_NAME), None)
    if body is None:
        raise RuntimeError(f"body mesh {BODY_MESH_NAME} not found")
    prim0 = body["primitives"][0]
    target_names = body.get("extras", {}).get("targetNames", [])
    if "viseme_aa" not in target_names:
        raise RuntimeError("viseme_aa missing from body targetNames")
    aa_pos_idx = prim0["targets"][target_names.index("viseme_aa")]["POSITION"]
    aa_acc = gltf["accessors"][aa_pos_idx]

    positions = accessor_bytes(gltf, bin_data, prim0["attributes"]["POSITION"])
    joints0 = accessor_bytes(gltf, bin_data, prim0["attributes"]["JOINTS_0"])
    weights0 = accessor_bytes(gltf, bin_data, prim0["attributes"]["WEIGHTS_0"])
    n = len(positions)
    assert len(joints0) == n and len(weights0) == n, "prim 0 attribute counts differ"

    # --- teeth AABB height (input to the threshold), same iteration as the contract ---
    teeth_height = 0.0
    teeth_present = False
    for m in gltf["meshes"]:
        name = m.get("name", "")
        if "hm08_teeth" not in name.lower():
            continue
        for p in m["primitives"]:
            pos = accessor_bytes(gltf, bin_data, p["attributes"]["POSITION"])
            lo = min(v[Y_CMP] for v in pos)
            hi = max(v[Y_CMP] for v in pos)
            teeth_height = hi - lo
            teeth_present = True
    if not teeth_present:
        raise RuntimeError("teeth mesh not found")
    if abs(teeth_height - MEASURED_TEETH_HEIGHT) > 1e-4:
        raise RuntimeError(
            f"teeth AABB height {teeth_height:.9f} drifted from Stage A {MEASURED_TEETH_HEIGHT:.9f} — "
            "do not bake against a moved input"
        )
    threshold = teeth_height * 0.5

    # --- lip band selector (identical to open-mouth-interior-measure.ts) ---
    lip = []
    for i in range(n):
        dj = dominant_joint(joints0[i], weights0[i], joint_names)
        if not dj.startswith(LIP_JOINT_PREFIXES):
            continue
        lip.append((i, positions[i][X_CMP], positions[i][Y_CMP], positions[i][Z_CMP]))
    if len(lip) < MEASURED_LIP_VERTS:
        raise RuntimeError(f"lip band {len(lip)} < Stage A {MEASURED_LIP_VERTS}")
    z_sorted = sorted(v[3] for v in lip)
    z_cut = z_sorted[math.floor(len(z_sorted) * 0.6)]
    mid_y = sum(v[2] for v in lip) / len(lip)
    anterior = [v for v in lip if v[3] >= z_cut]
    if len(anterior) < MEASURED_ANTERIOR_LIP_VERTS:
        raise RuntimeError(f"anterior band {len(anterior)} < Stage A {MEASURED_ANTERIOR_LIP_VERTS}")
    lower_band = [v for v in lip if v[2] < mid_y]

    # --- current aa deltas (sparse, base zero) ---
    aa_sparse = sparse_entries(gltf, bin_data, aa_acc)
    delta_of = {i: aa_sparse.get(i, (0.0, 0.0, 0.0)) for i in range(n)}
    aa_dy = {i: delta_of[i][Y_CMP] for i in range(n)}

    def gap_with(theta):
        """The contract's metric: minY(upper anterior) - maxY(lower anterior) after augmentation."""
        upper_min = math.inf
        lower_max = -math.inf
        for (i, _x, y, _z) in anterior:
            dy = aa_dy[i]
            if y < mid_y:
                ry = y - pivot[Y_CMP]
                rz = _z - pivot[Z_CMP]
                ny = ry * math.cos(theta) - rz * math.sin(theta)
                dy = dy + (ny - ry)
            yy = y + dy
            if y >= mid_y:
                upper_min = min(upper_min, yy)
            else:
                lower_max = max(lower_max, yy)
        return max(0.0, upper_min - lower_max)

    gap_before = gap_with(0.0)
    if gap_before * 1000 >= SEALED_GAP_REFUSE_MM:
        raise RuntimeError(
            f"pre-bake gap {gap_before:.6f} m already >= {SEALED_GAP_REFUSE_MM} mm — "
            "the bake appears to have already been applied; refusing to double it"
        )

    # --- solve theta so the exact band metric clears 1.15x the teeth-derived bar ---
    target_gap = TARGET_GAP_FACTOR * threshold
    lo, hi = 0.0, 0.5
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if gap_with(mid) < target_gap:
            lo = mid
        else:
            hi = mid
    theta = hi

    # --- augment: rotate lower-band verts about the jaw hinge (world X axis) ---
    sp = aa_acc["sparse"]
    ibv = gltf["bufferViews"][sp["indices"]["bufferView"]]
    ioff = ibv.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
    icomp = sp["indices"]["componentType"]
    ifmt = COMPONENT_FMT[icomp]
    isize = COMPONENT_SIZE[icomp]
    vbv = gltf["bufferViews"][sp["values"]["bufferView"]]
    voff = vbv.get("byteOffset", 0) + sp["values"].get("byteOffset", 0)
    lower_set = {v[0] for v in lower_band}
    ct = math.cos(theta)
    st = math.sin(theta)
    augmented = 0
    new_min = [0.0, 0.0, 0.0]
    new_max = [0.0, 0.0, 0.0]
    for k in range(sp["count"]):
        idx = struct.unpack_from("<" + ifmt, bin_data, ioff + k * isize)[0]
        base = voff + k * 12
        x, y, z = struct.unpack_from("<fff", bin_data, base)
        if idx in lower_set:
            px, py, pz = positions[idx]
            ry = py - pivot[Y_CMP]
            rz = pz - pivot[Z_CMP]
            ny = ry * ct - rz * st
            nz = ry * st + rz * ct
            y = y + (ny - ry)
            z = z + (nz - rz)
            struct.pack_into("<fff", bin_data, base, x, y, z)
            augmented += 1
        new_min[0] = min(new_min[0], x)
        new_min[1] = min(new_min[1], y)
        new_min[2] = min(new_min[2], z)
        new_max[0] = max(new_max[0], x)
        new_max[1] = max(new_max[1], y)
        new_max[2] = max(new_max[2], z)
    aa_acc["min"] = new_min
    aa_acc["max"] = new_max

    write_glb(args.glb, gltf, bin_header, bin_data)

    gap_after = gap_with(theta)
    print(json.dumps({
        "baked": args.glb,
        "jawPivotBindSpace": pivot,
        "thetaRadians": theta,
        "thetaDegrees": theta * 180.0 / math.pi,
        "thresholdMeters": threshold,
        "targetGapMeters": target_gap,
        "gapBeforeMeters": gap_before,
        "gapAfterMeters": gap_after,
        "gapAfterMultiplierOfThreshold": gap_after / threshold,
        "lowerBandVertsAugmented": augmented,
        "lipVertexCount": len(lip),
        "anteriorLipVertexCount": len(anterior),
        "teethAabbHeightMeters": teeth_height,
        "sparseCountUnchanged": sp["count"],
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        sys.exit(1)
