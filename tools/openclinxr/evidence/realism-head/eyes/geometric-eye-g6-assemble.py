#!/usr/bin/env python3
"""G6 full-head bake: splice the G2 geometric anterior segment into the
Aisha lid-conform head bake + apply the G3 lid refit + re-run T2b/A3 lashes.

In (read-only): store aisha-lidconform.glb (sha pinned to the G3 refit map),
  G2 geometric-eye-anterior.glb + disc PNGs, G3 refit JSON.
Out: geometric-eye-g6-head.glb (in-lane full-head bake) + report JSON.

Splice rule (wired by POSITION, never by mesh/bone names — the bake's
'left'/'right' mesh names disagree in sign with the G3 +x=L convention):
  +x side (G3-L) reuses the joint of the old mesh covering +x (joint 117);
  -x side (G3-R) reuses joint 122. New POSITION rows = Kasa centre C[s] +
  G2 eye-local verts / 1000 (mesh-local frame == head frame at bind; the
  gate asserts skinned-minus-raw on the carried meshes and new-vs-old
  skinned centroids per side).
Old eye mesh slots 10/11/12 are replaced in place (sclera_L/cap_L/disc_L);
sclera_R/cap_R/disc_R appended with three new scene nodes. No morph targets
existed on the old eye meshes, so none are owed to the new ones.
"""
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
M = 1000.0
EYE_STORE = Path("/Volumes/files/openclinxr-assets/store/geometric-eye")


def eye_glb(name):
    """Store-first GLB resolution (large binaries live outside git)."""
    p = EYE_STORE / name / f"{name}.glb"
    if p.exists():
        return p
    local = HERE / f"{name}.glb"
    if local.exists():
        return local
    raise SystemExit(f"missing {name}.glb: store {p} absent and no local copy")


STORE = Path("/Volumes/files/openclinxr-assets/store/lid-conform")
BAKE = STORE / "aisha-lidconform.glb"
REFIT = HERE / "geometric-eye-g3-refit.json"
G2GLB = eye_glb("geometric-eye-anterior")
TOOL = Path("tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py")
OUT_GLB = EYE_STORE / "geometric-eye-g6-head" / "geometric-eye-g6-head.glb"
OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
REPORT = HERE / "geometric-eye-g6-report.json"
TMP = Path(tempfile.mkdtemp(prefix="g6head_"))
PRE = TMP / "g6-prelash.glb"
POST = TMP / "g6-lash.glb"

sys.path.insert(0, str(Path(
    "tools/openclinxr/asset-pipeline/realism-head/lid-conform").resolve()))
import lid_conform_core as core  # noqa: E402

CTINV = {"u1": 5121, "u2": 5123, "u4": 5125, "f4": 5126}
DT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def load_glb(path):
    raw = Path(path).read_bytes()
    assert raw[:4] == b"glTF", path
    jl = struct.unpack("<I", raw[12:16])[0]
    g = json.loads(raw[12 + 8:12 + 8 + jl])
    rest = raw[12 + 8 + jl:]
    blob = bytearray(rest[8:] if rest[4:8] == b"BIN\x00" else rest)
    return g, blob


def save_glb(g, blob, path):
    g["buffers"][0]["byteLength"] = len(blob)
    nj = json.dumps(g, separators=(",", ":")).encode()
    while len(nj) % 4:
        nj += b" "
    Path(path).write_bytes(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(nj) + 8 + len(blob))
                           + struct.pack("<I", len(nj)) + b"JSON" + nj
                           + struct.pack("<I", len(blob)) + b"BIN\x00" + bytes(blob))


def rd(g, blob, ai):
    ac = g["accessors"][ai]
    bv = g["bufferViews"][ac["bufferView"]]
    base = bv.get("byteOffset", 0) + ac.get("byteOffset", 0)
    n, nc = ac["count"], NC[ac["type"]]
    dt = DT[ac["componentType"]]
    st = bv.get("byteStride")
    if st and st != nc * np.dtype(dt).itemsize:
        s = np.frombuffer(blob, dtype=np.uint8, count=n * st, offset=base).reshape(n, st)
        sz = np.dtype(dt).itemsize
        return np.stack([s[:, k * sz:(k + 1) * sz].copy().view(dt).reshape(n)
                         for k in range(nc)], 1).astype(np.float64)
    return np.frombuffer(blob, dtype=dt, count=n * nc, offset=base).reshape(n, nc).astype(np.float64)


def append(g, blob, arr, ctype, gtype):
    conv = {"u1": np.uint8, "u2": np.uint16, "u4": np.uint32, "f4": np.float32}[ctype]
    a = np.ascontiguousarray(arr).astype(conv)
    off = len(blob)
    blob.extend(a.tobytes())
    while len(blob) % 4:
        blob.extend(b"\x00")
    g["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(a.tobytes())})
    g["accessors"].append({"bufferView": len(g["bufferViews"]) - 1,
                           "componentType": CTINV[ctype], "count": len(a), "type": gtype})
    return len(g["accessors"]) - 1


bake_bytes = BAKE.read_bytes()
bake_sha = hashlib.sha256(bake_bytes).hexdigest()
ref = json.loads(REFIT.read_text())
assert ref.get("bake_sha256") == bake_sha, "refit map not for this bake"

g, blob = load_glb(BAKE)
js, blob2 = core.load_glb(str(BAKE))
worlds = core.node_worlds(js)

# ---- side centres (G3 convention: +x = L), re-derived on this bake ----
cor_names = core.resolve_cornea_mesh_names(js)
cor = {}
for n in cor_names:
    pts, _ = core.skin_mesh(js, blob2, worlds, n)
    cor[n] = pts
cn = list(cor)
cl = max(cn, key=lambda m: cor[m][:, 0].mean())
cr = min(cn, key=lambda m: cor[m][:, 0].mean())
gname = core.resolve_globe_mesh_name(js)
gpts, _ = core.skin_mesh(js, blob2, worlds, gname)


def kasa(pts):
    a = np.concatenate([2.0 * pts, np.ones((len(pts), 1))], axis=1)
    b = (pts ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    c = sol[:3]
    return c, float(np.sqrt(max(sol[3] + c @ c, 0.0)))


C = {}
for s, refc in (("L", cor[cl].mean(axis=0)), ("R", cor[cr].mean(axis=0))):
    side = gpts[np.linalg.norm(gpts - cor[cl].mean(axis=0), axis=1)
                < np.linalg.norm(gpts - cor[cr].mean(axis=0), axis=1)] \
        if s == "L" else gpts[np.linalg.norm(gpts - cor[cl].mean(axis=0), axis=1)
                              >= np.linalg.norm(gpts - cor[cr].mean(axis=0), axis=1)]
    C[s], _ = kasa(side)
    print(f"C[{s}]", [round(float(v) * M, 3) for v in C[s]], flush=True)

# ---- old eye meshes: skinned-vs-raw (bind identity) + side wiring ----
old_skin_gap, old_side = {}, {}
for mi, key in ((10, "globe"), (11, "cornea_named_left"), (12, "cornea_named_right")):
    m = g["meshes"][mi]
    sk, _ = core.skin_mesh(js, blob2, worlds, m["name"])
    raw = rd(g, blob, m["primitives"][0]["attributes"]["POSITION"])
    gap = float(np.abs(sk - raw).max() * M)
    old_skin_gap[key] = round(gap, 4)
    J = rd(g, blob, m["primitives"][0]["attributes"]["JOINTS_0"])[:, 0].astype(int)
    uj, cu = np.unique(J, return_counts=True)
    old_side[key] = {"skinned_cx_mm": round(float(sk[:, 0].mean() * M), 3),
                     "joints": {int(a): int(b) for a, b in zip(uj, cu)}}
    print(key, "bind gap mm", round(gap, 4), old_side[key], flush=True)

# wire by position: +x side mesh -> joint of old +x mesh
j_plus = next(j for j, d in ((11, old_side["cornea_named_left"]),
                             (12, old_side["cornea_named_right"]))
              if d["skinned_cx_mm"] > 0)
JMAP = {"L": int(next(iter(old_side[("cornea_named_left" if j_plus == 11 else "cornea_named_right")]["joints"]))),
        "R": int(next(iter(old_side[("cornea_named_right" if j_plus == 11 else "cornea_named_left")]["joints"])))}
print("JMAP (+x=L)", JMAP, flush=True)

# ---- G2 anterior meshes ----
raw2 = G2GLB.read_bytes()
off = 12
chunks = {}
while off < len(raw2):
    cl_, ct = struct.unpack("<II", raw2[off:off + 8])
    chunks[ct] = raw2[off + 8:off + 8 + cl_]
    off += 8 + cl_
g2 = json.loads(chunks[0x4E4F534A])
buf2 = chunks[0x004E4942]


def g2acc(i):
    a = g2["accessors"][i]
    bv = g2["bufferViews"][a["bufferView"]]
    bo = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = NC[a["type"]] * a["count"]
    fmt = {5125: "I", 5126: "f", 5123: "H"}[a["componentType"]]
    import array
    arr = array.array(fmt, bytes(buf2[bo:bo + n * array.array(fmt).itemsize]))
    return np.asarray(arr, dtype=np.float64).reshape(a["count"], -1)


anterior = {}
for m in g2["meshes"]:
    pr = m["primitives"][0]
    anterior[m["name"]] = {"pos": g2acc(pr["attributes"]["POSITION"]),
                           "nrm": g2acc(pr["attributes"]["NORMAL"]),
                           "uv": g2acc(pr["attributes"]["TEXCOORD_0"]),
                           "idx": g2acc(pr["indices"]).astype(np.int64).ravel()}

disc_png = {s: (HERE / f"geometric-eye-iris-disc-{s}.png").read_bytes() for s in ("L", "R")}

# ---- new primitives in head frame ----
new_prims = {}
for s in ("L", "R"):
    for key in ("sclera", "cap", "disc"):
        a = anterior[f"eye_geo_{key}_{s}"]
        P = C[s] + a["pos"] / M
        J = np.zeros((len(P), 4), dtype=np.uint16)
        J[:, 0] = JMAP[s]
        W = np.zeros((len(P), 4), dtype=np.float32)
        W[:, 0] = 1.0
        prim = {"attributes": {
            "POSITION": append(g, blob, P, "f4", "VEC3"),
            "NORMAL": append(g, blob, a["nrm"], "f4", "VEC3"),
            "TEXCOORD_0": append(g, blob, a["uv"], "f4", "VEC2"),
            "JOINTS_0": append(g, blob, J, "u2", "VEC4"),
            "WEIGHTS_0": append(g, blob, W, "f4", "VEC4")},
            "indices": append(g, blob, a["idx"].astype(np.uint32), "u4", "SCALAR")}
        new_prims[(s, key)] = prim

# ---- materials / images / textures ----
for s in ("L", "R"):
    off = len(blob)
    blob.extend(disc_png[s])
    while len(blob) % 4:
        blob.extend(b"\x00")
    g["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(disc_png[s])})
    g["images"].append({"name": f"g6-iris-disc-{s}", "mimeType": "image/png",
                        "bufferView": len(g["bufferViews"]) - 1})
    g["textures"].append({"source": len(g["images"]) - 1})
ntex = len(g["textures"])
g.setdefault("samplers", []).append({"magFilter": 9729, "minFilter": 9987})
samp = len(g["samplers"]) - 1
for t in g["textures"][-2:]:
    t["sampler"] = samp
m_sclera = len(g["materials"])
g["materials"].append({"name": "g6_eyes_sclera",
                       "pbrMetallicRoughness": {"baseColorFactor": [0.93, 0.92, 0.88, 1.0],
                                               "roughnessFactor": 0.35}})
m_cap = len(g["materials"])
g["materials"].append({"name": "g6_cornea_cap", "alphaMode": "BLEND", "doubleSided": True,
                       "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 0.08],
                                               "roughnessFactor": 0.05}})
m_disc = {}
for s, ti in (("L", ntex - 2), ("R", ntex - 1)):
    m_disc[s] = len(g["materials"])
    g["materials"].append({"name": f"g6_eyes_iris_{s}",
                           "pbrMetallicRoughness": {"baseColorTexture": {"index": ti},
                                                   "roughnessFactor": 0.55}})
new_prims[("L", "sclera")]["material"] = m_sclera
new_prims[("R", "sclera")]["material"] = m_sclera
new_prims[("L", "cap")]["material"] = m_cap
new_prims[("R", "cap")]["material"] = m_cap
new_prims[("L", "disc")]["material"] = m_disc["L"]
new_prims[("R", "disc")]["material"] = m_disc["R"]

# ---- swap meshes 10/11/12, append R side ----
g["meshes"][10] = {"name": "g6_eye_geo_sclera_L", "primitives": [new_prims[("L", "sclera")]]}
g["meshes"][11] = {"name": "g6_eye_geo_cap_L", "primitives": [new_prims[("L", "cap")]]}
g["meshes"][12] = {"name": "g6_eye_geo_disc_L", "primitives": [new_prims[("L", "disc")]]}
mesh_R = {}
for key in ("sclera", "cap", "disc"):
    g["meshes"].append({"name": f"g6_eye_geo_{key}_R", "primitives": [new_prims[("R", key)]]})
    mesh_R[key] = len(g["meshes"]) - 1
for ni, key in ((142, "sclera"), (148, "cap"), (149, "disc")):
    g["nodes"][ni]["mesh"] = 10 + ("sclera", "cap", "disc").index(key)
    g["nodes"][ni]["name"] = f"g6_eye_geo_{key}_L"
parent = next(i for i, n in enumerate(g["nodes"]) if 142 in n.get("children", []))
new_nodes = []
for key in ("sclera", "cap", "disc"):
    g["nodes"].append({"name": f"g6_eye_geo_{key}_R", "mesh": mesh_R[key], "skin": 0})
    new_nodes.append(len(g["nodes"]) - 1)
# base-bake quirk: cornea nodes 148/149 are scene-orphans (no parent lists
# them; only node 142 is under the rig). Repurposed L nodes must be linked
# or no importer will draw them.
linked = g["nodes"][parent].setdefault("children", [])
for ni in (148, 149):
    if ni not in linked:
        linked.append(ni)
linked.extend(new_nodes)
print("repurposed nodes 142/148/149 -> L meshes; new R nodes", new_nodes, "under", parent, flush=True)

# ---- G3 refit on body prim0 ----
bi = next(i for i, m in enumerate(g["meshes"]) if m.get("name") == "mpfb_ob_patient_aisha_body")
prim0 = g["meshes"][bi]["primitives"][0]
pos = rd(g, blob, prim0["attributes"]["POSITION"])
assert len(pos) == 37699
tgt_before = [json.dumps(g["accessors"][t["POSITION"]], sort_keys=True)
              for t in prim0.get("targets", [])]
applied = 0
for s in ("L", "R"):
    for k, v in ref["displacements"][s].items():
        pos[int(k)] += np.array(v) / M
        applied += 1
prim0["attributes"]["POSITION"] = append(g, blob, pos, "f4", "VEC3")
tgt_after = [json.dumps(g["accessors"][t["POSITION"]], sort_keys=True)
             for t in prim0.get("targets", [])]
assert tgt_before == tgt_after, "body morph targets must stay byte-identical"
save_glb(g, blob, PRE)
print("wrote prelash", PRE, f"{PRE.stat().st_size/1e6:.1f}MB applied", applied, flush=True)


def run_tool(args):
    r = subprocess.run(["mise", "exec", "--", "python3", str(TOOL)] + args,
                       capture_output=True, text=True, cwd=Path(".").resolve(), timeout=900)
    if r.returncode != 0:
        print(r.stdout[-4000:], flush=True)
        print(r.stderr[-4000:], flush=True)
        raise SystemExit(f"tool failed: {args}")
    return r.stdout


bake_report = json.loads(run_tool([str(PRE), str(POST)]))
meas = json.loads(run_tool([str(POST), "--measure"]))
post_bytes = POST.read_bytes()
import shutil
shutil.copy(POST, OUT_GLB)

report = {
    "slice": "G6-full-head-bake (G2 anterior spliced into Aisha lid-conform bake + G3 refit + T2b/A3)",
    "bake_in": {"file": str(BAKE), "sha256": bake_sha},
    "centres_m": {s: [round(float(v), 6) for v in C[s]] for s in "LR"},
    "old_eye_bind_gap_mm": old_skin_gap,
    "joint_map": JMAP,
    "refit_applied_rows": applied,
    "t2b": bake_report.get("t2b"),
    "a3": bake_report.get("a3"),
    "blinkFollow": meas.get("blinkFollow"),
    "blinkFollowPass": meas.get("pass"),
    "head_sha256": hashlib.sha256(post_bytes).hexdigest(),
    "head_bytes": len(post_bytes),
    "notTested": ["socket show-through at yaw (no socket/aperture in GLB; edgeAtYaw stays OPEN per compat falsifier)"],
    "notEvidenceFor": ["clinical_validity", "production_asset_readiness", "quest_readiness", "exam_equivalence"],
}
REPORT.write_text(json.dumps(report, indent=2))
print(json.dumps({"applied": applied, "blinkFollowPass": meas.get("pass"),
                  "blinkFollow": meas.get("blinkFollow"),
                  "head": OUT_GLB.name, "MB": round(len(post_bytes) / 1e6, 1)}, indent=2), flush=True)
