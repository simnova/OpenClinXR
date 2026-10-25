#!/usr/bin/env python3
"""G3 seal-render assembly: single-eye GLBs (new anterior in head frame +
post-refit lid/lash patches in pose) for render_eye_sheet.py.

Usage: python3 geometric-eye-g3-assembly.py <outdir>
Writes <outdir>/g3-<side>-<pose>.glb for (L,bind|closure|slit),(R,closure).
Assembly GLBs are scratch (not committed); renders land in the evidence dir.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(Path(
    "tools/openclinxr/asset-pipeline/realism-head/lid-conform").resolve()))
import lid_conform_core as core  # noqa: E402

M = 1000.0
STORE = Path("/Volumes/files/openclinxr-assets/store/lid-conform")

# ---- G2 anterior meshes, eye-local mm (store-first; large binary outside git) ----
EYE_STORE = Path("/Volumes/files/openclinxr-assets/store/geometric-eye")


def eye_glb(name):
    p = EYE_STORE / name / f"{name}.glb"
    if p.exists():
        return p
    local = HERE / f"{name}.glb"
    if local.exists():
        return local
    raise SystemExit(f"missing {name}.glb: store {p} absent and no local copy")


raw = eye_glb("geometric-eye-anterior").read_bytes()
off = 12
chunks = {}
while off < len(raw):
    cl, ct = struct.unpack("<II", raw[off:off + 8])
    chunks[ct] = raw[off + 8:off + 8 + cl]
    off += 8 + cl
g2 = json.loads(chunks[0x4E4F534A])
buf = chunks[0x004E4942]

def g2acc(i):
    a = g2["accessors"][i]
    bv = g2["bufferViews"][a["bufferView"]]
    bo = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]] * a["count"]
    fmt = {5125: "I", 5126: "f"}[a["componentType"]]
    import array
    arr = array.array(fmt, buf[bo:bo + n * array.array(fmt).itemsize])
    return np.asarray(arr, dtype=np.float64).reshape(a["count"], -1)

anterior = {}
for m in g2["meshes"]:
    pr = m["primitives"][0]
    anterior[m["name"]] = {
        "pos": g2acc(pr["attributes"]["POSITION"]),
        "nrm": g2acc(pr["attributes"]["NORMAL"]),
        "uv": g2acc(pr["attributes"]["TEXCOORD_0"]),
        "idx": g2acc(pr["indices"]).astype(np.int64).ravel(),
        "mat": g2["materials"][pr["material"]],
    }
disc_png = {}
for side in ("L", "R"):
    disc_png[side] = (HERE / f"geometric-eye-iris-disc-{side}.png").read_bytes()

# ---- bake: centres + post-refit posed patches ----
js, blob = core.load_glb(str(STORE / "aisha-lidconform.glb"))
worlds = core.node_worlds(js)
bn = core.resolve_body_mesh_name(js)
body0, bidx = core.skin_mesh(js, blob, worlds, bn)
tris = bidx.reshape(-1, 3)
ref = json.loads((HERE / "geometric-eye-g3-refit.json").read_text())
DV = np.zeros_like(body0)
for s in "LR":
    for k, v in ref["displacements"][s].items():
        DV[int(k)] = np.array(v) / M
cn = core.resolve_cornea_mesh_names(js)
cor = {}
for n in cn:
    pts, _ = core.skin_mesh(js, blob, worlds, n)
    cor[n] = pts
cl = max(cn, key=lambda m: cor[m][:, 0].mean())
cr = min(cn, key=lambda m: cor[m][:, 0].mean())
gn = core.resolve_globe_mesh_name(js)
gp, _ = core.skin_mesh(js, blob, worlds, gn)

def kasa(pts):
    a = np.concatenate([2.0 * pts, np.ones((len(pts), 1))], axis=1)
    b = (pts ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    return sol[:3]

C = {}
for s, refc in (("L", cor[cl].mean(axis=0)), ("R", cor[cr].mean(axis=0))):
    side = gp[np.linalg.norm(gp - cor[cl].mean(axis=0), axis=1)
              < np.linalg.norm(gp - cor[cr].mean(axis=0), axis=1)] \
        if s == "L" else gp[np.linalg.norm(
            gp - cor[cl].mean(axis=0), axis=1) >= np.linalg.norm(
            gp - cor[cr].mean(axis=0), axis=1)]
    C[s], _ = kasa(side), None
    C[s] = kasa(side)

ln = core.resolve_lash_mesh_name(js)
lash0, lash_idx = core.skin_mesh(js, blob, worlds, ln)
lash_tris = lash_idx.reshape(-1, 3)

POSES = {"bind": {}, "closure": {"eye-left-closure": 1.0,
                                 "eye-right-closure": 1.0},
         "slit": {"eye-left-slit": 1.0, "eye-right-slit": 1.0}}

def vnormals(pos, tris):
    fn = core.face_normals(pos, tris)
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, tris[:, k], fn)
    l = np.linalg.norm(vn, axis=1)
    l[l < 1e-18] = 1e-18
    return vn / l[:, None]

def write_glb(path, parts):
    buf = bytearray()
    views, accs = [], []

    def push(arr):
        off = len(buf)
        buf.extend(arr.tobytes())
        while len(buf) % 4:
            buf.extend(b"\x00")
        views.append({"buffer": 0, "byteOffset": off,
                      "byteLength": len(arr.tobytes())})
        return len(views) - 1
    def acc(view, ctype, count, etype):
        accs.append({"bufferView": view, "componentType": ctype,
                     "count": count, "type": etype})
        return len(accs) - 1
    meshes, images, textures, materials = [], [], [], []
    img_view = {}
    for side in ("L", "R"):
        off = len(buf)
        buf.extend(disc_png[side])
        while len(buf) % 4:
            buf.extend(b"\x00")
        img_view[side] = len(views)
        views.append({"buffer": 0, "byteOffset": off,
                      "byteLength": len(disc_png[side])})
        images.append({"name": f"iris-disc-{side}", "mimeType": "image/png",
                       "bufferView": img_view[side]})
        textures.append({"source": len(images) - 1})
    mat_index = {}
    def mat(m):
        key = m["name"]
        if key not in mat_index:
            mat_index[key] = len(materials)
            materials.append(m)
        return mat_index[key]
    g3mats = {
        "g3_eyes_sclera": {"name": "g3_eyes_sclera",
                           "pbrMetallicRoughness": {
                               "baseColorFactor": [0.93, 0.92, 0.88, 1.0],
                               "roughnessFactor": 0.35}},
        "g3_cornea_cap": {"name": "g3_cornea_cap", "alphaMode": "BLEND",
                          "doubleSided": True, "pbrMetallicRoughness": {
                              "baseColorFactor": [1, 1, 1, 0.08],
                              "roughnessFactor": 0.05}},
        "g3_eyes_iris_L": {"name": "g3_eyes_iris_L",
                           "pbrMetallicRoughness": {
                               "baseColorTexture": {"index": 0},
                               "roughnessFactor": 0.55}},
        "g3_eyes_iris_R": {"name": "g3_eyes_iris_R",
                           "pbrMetallicRoughness": {
                               "baseColorTexture": {"index": 1},
                               "roughnessFactor": 0.55}},
        "g3_lid_skin": {"name": "g3_lid_skin", "doubleSided": True,
                        "pbrMetallicRoughness": {
                            "baseColorFactor": [0.72, 0.55, 0.45, 1.0],
                            "roughnessFactor": 0.6}},
        "g3_lash": {"name": "g3_lash", "doubleSided": True,
                    "pbrMetallicRoughness": {
                        "baseColorFactor": [0.08, 0.06, 0.05, 1.0],
                        "roughnessFactor": 0.5}},
    }
    nodes = []
    for name, P_, N_, UV_, IX_, mname, tenuv in parts:
        prim = {"attributes": {
            "POSITION": acc(push(P_.astype(np.float32)), 5126, len(P_),
                            "VEC3"),
            "NORMAL": acc(push(N_.astype(np.float32)), 5126, len(N_), "VEC3")},
            "indices": acc(push(IX_.astype(np.uint32)), 5125, len(IX_),
                           "SCALAR"),
            "material": mat(g3mats[mname])}
        if UV_ is not None:
            prim["attributes"]["TEXCOORD_0"] = acc(
                push(UV_.astype(np.float32)), 5126, len(UV_), "VEC2")
            # g3_eyes_iris_L/R already point at textures[0]/[1] (L/R PNGs).
        meshes.append({"name": name, "primitives": [prim]})
        nodes.append({"name": name, "mesh": len(meshes) - 1})
    gltf = {"asset": {"version": "2.0", "generator": "g3-assembly"},
            "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
            "nodes": nodes, "meshes": meshes, "materials": materials,
            "textures": textures, "images": images,
            "samplers": [{"magFilter": 9729, "minFilter": 9987}],
            "accessors": accs, "bufferViews": views,
            "buffers": [{"byteLength": len(buf)}]}
    jb = json.dumps(gltf, separators=(",", ":")).encode()
    while len(jb) % 4:
        jb += b" "
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(buf))
    glb += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    glb += struct.pack("<II", len(buf), 0x004E4942) + bytes(buf)
    path.write_bytes(glb)

JOBS = [("L", "bind"), ("L", "closure"), ("L", "slit"), ("R", "closure")]
for side, pose in JOBS:
    if pose == "bind":
        pb = body0 + DV
    else:
        side_word = "left" if side == "L" else "right"
        pw, _ = core.skin_mesh(js, blob, worlds, bn, morph_weights={
            f"eye-{side_word}-{pose}": 1.0})
        pb = pw + DV
    parts = []
    for key, mname, tenuv in (("sclera", "g3_eyes_sclera", None),
                              ("cap", "g3_cornea_cap", None),
                              ("disc", f"g3_eyes_iris_{side}",
                               0 if side == "L" else 1)):
        a = anterior[f"eye_geo_{key}_{side}"]
        # centre the eye on the origin (eye-local == eye-centred already;
        # lid/lash patches shift from head frame to eye frame).
        parts.append((f"g3_{key}_{side}", a["pos"] / M,
                          a["nrm"],
                          a["uv"] if key == "disc" else None, a["idx"],
                          mname, tenuv))
    near = np.linalg.norm(pb - C[side], axis=1) <= 0.018
    tm = near[tris].all(axis=1)
    pv = pb[near] - C[side]
    remap = np.full(len(pb), -1, dtype=np.int64)
    remap[np.nonzero(near)[0]] = np.arange(near.sum())
    pt = remap[tris[tm]]
    parts.append((f"g3_lid_patch_{side}_{pose}", pv, vnormals(pv, pt),
                  None, pt.ravel(), "g3_lid_skin", None))
    lnr = np.linalg.norm(lash0 - C[side], axis=1) <= 0.018
    ltm = lnr[lash_tris].all(axis=1)
    if ltm.sum() > 10:
        lv = lash0[lnr] - C[side]
        remap = np.full(len(lash0), -1, dtype=np.int64)
        remap[np.nonzero(lnr)[0]] = np.arange(lnr.sum())
        lt = remap[lash_tris[ltm]]
        parts.append((f"g3_lash_patch_{side}", lv, vnormals(lv, lt),
                      None, lt.ravel(), "g3_lash", None))
    out = OUT / f"g3-{side}-{pose}.glb"
    write_glb(out, parts)
    print("wrote", out, f"{out.stat().st_size/1e6:.1f}MB", flush=True)
