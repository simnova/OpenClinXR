#!/usr/bin/env python3
"""G6 gate: independent re-derivation from the finished head GLB (never trusts
the assembly report). GREEN 10/10 required.
"""
import hashlib
import json
import struct
import subprocess
import sys
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


HEAD = eye_glb("geometric-eye-g6-head")
STORE = Path("/Volumes/files/openclinxr-assets/store/lid-conform/aisha-lidconform.glb")
P = json.loads((HERE / "geometric-eye-g1-params.json").read_text())
Rr, Dd = P["resolved"], P["iris_disc"]
REFIT = json.loads((HERE / "geometric-eye-g3-refit.json").read_text())
TOOL = Path("tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py")
checks = []


def check(name, ok, detail=""):
    checks.append({"name": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (" | " + str(detail) if detail else ""), flush=True)


def load(path):
    raw = Path(path).read_bytes()
    jl = struct.unpack("<I", raw[12:16])[0]
    g = json.loads(raw[12 + 8:12 + 8 + jl])
    rest = raw[12 + 8 + jl:]
    return g, bytearray(rest[8:] if rest[4:8] == b"BIN\x00" else rest)


DT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


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


g, blob = load(HEAD)
gb, blobb = load(STORE)

# 1. new eye meshes present, old slots gone from scene
names = [m.get("name") for m in g["meshes"]]
check("six-g6-eye-meshes", all(any(n == f"g6_eye_geo_{k}_{s}" for n in names)
                               for s in "LR" for k in ("sclera", "cap", "disc")), names)
scene_nodes = set()
def walk(ns):
    for i in ns:
        scene_nodes.add(i)
        walk(g["nodes"][i].get("children", []))
walk(g["scenes"][g.get("scene", 0)]["nodes"])
used = {g["nodes"][i].get("mesh") for i in scene_nodes if g["nodes"][i].get("mesh") is not None}
used_names = {g["meshes"][i]["name"] for i in used}
check("no-old-eye-mesh-in-scene", not any("eye_cornea_high_poly" in n or n.startswith("makeclothes_library_eyes_high_poly") for n in used_names), sorted(used_names))

# 2-4. per-side census in head frame (POSITION rows are head-frame at bind)
def kasa(pts):
    a = np.concatenate([2.0 * pts, np.ones((len(pts), 1))], axis=1)
    b = (pts ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    c = sol[:3]
    return c, float(np.sqrt(max(sol[3] + c @ c, 0.0)))

mesh_of = {m["name"]: m for m in g["meshes"]}
C = {}
for s in "LR":
    S = rd(g, blob, mesh_of[f"g6_eye_geo_sclera_{s}"]["primitives"][0]["attributes"]["POSITION"])
    c, r = kasa(S)
    C[s] = c
    check(f"{s}-sclera-R", abs(r * M - Rr["scleral_radius_mm"]) / Rr["scleral_radius_mm"] <= 0.05, round(r * M, 4))
    V = rd(g, blob, mesh_of[f"g6_eye_geo_cap_{s}"]["primitives"][0]["attributes"]["POSITION"])
    cc = np.array([c[0], c[1], c[2] + (Rr["apex_z_mm"] - Rr["cap_radius_mm"]) / M])
    rc = np.linalg.norm(V - cc, axis=1)
    check(f"{s}-cap-r", abs(rc.mean() * M - Rr["cap_radius_mm"]) / Rr["cap_radius_mm"] <= 0.05, round(float(rc.mean() * M), 4))
    apex = float(V[:, 2].max() * M)
    check(f"{s}-apex", abs(apex - (float(c[2]) * M + Rr["apex_z_mm"])) <= 0.05 * Rr["apex_z_mm"], round(apex, 3))
    D = rd(g, blob, mesh_of[f"g6_eye_geo_disc_{s}"]["primitives"][0]["attributes"]["POSITION"])
    check(f"{s}-disc-dia", abs((D[:, 0].max() - D[:, 0].min()) * M - Dd["dia_mm"]) / Dd["dia_mm"] <= 0.05, round(float((D[:, 0].max() - D[:, 0].min()) * M), 3))
    check(f"{s}-disc-plane", abs(float(D[:, 2].mean() * M) - (float(c[2]) * M + Dd["plane_z_mm"])) <= 0.05 * abs(Dd["plane_z_mm"]), round(float(D[:, 2].mean() * M), 4))
    cx = float(S[:, 0].mean() * M)
    check(f"{s}-side-sign", (cx > 0) if s == "L" else (cx < 0), round(cx, 2))

# 5. refit displacements present on body prim0 (vs store base)
bi = next(i for i, m in enumerate(g["meshes"]) if m.get("name") == "mpfb_ob_patient_aisha_body")
pos = rd(g, blob, g["meshes"][bi]["primitives"][0]["attributes"]["POSITION"])
bbi = next(i for i, m in enumerate(gb["meshes"]) if m.get("name") == "mpfb_ob_patient_aisha_body")
bpos = rd(gb, blobb, gb["meshes"][bbi]["primitives"][0]["attributes"]["POSITION"])
errs = []
for s in "LR":
    for k, v in REFIT["displacements"][s].items():
        errs.append(float(np.linalg.norm((pos[int(k)] - bpos[int(k)]) * M - np.array(v))))
check("refit-rows-match", max(errs) <= 1e-3, f"max {max(errs):.5f}mm n={len(errs)}")

# 6. body morph targets untouched (seal numbers carry)
same = all(json.dumps(g["accessors"][t["POSITION"]], sort_keys=True)
           == json.dumps(gb["accessors"][u["POSITION"]], sort_keys=True)
           for t, u in zip(g["meshes"][bi]["primitives"][0].get("targets", []),
                           gb["meshes"][bbi]["primitives"][0].get("targets", [])))
check("body-morphs-identical", same and len(g["meshes"][bi]["primitives"][0].get("targets", [])) == len(gb["meshes"][bbi]["primitives"][0].get("targets", [])))

# 7. lash mesh carries T2b/A3 morphs + blinkFollow re-measured (independent tool run)
ln = next(m["name"] for m in g["meshes"] if "eyelash" in m.get("name", ""))
lt = next(m for m in g["meshes"] if m.get("name") == ln)["primitives"][0].get("targets", [])
check("lash-has-morphs", len(lt) > 0, len(lt))
r = subprocess.run(["mise", "exec", "--", "python3", str(TOOL), str(HEAD), "--measure"],
                   capture_output=True, text=True, cwd=Path(".").resolve(), timeout=600)
check("measure-runs", r.returncode == 0, r.stderr[-300:] if r.returncode else "")
meas = json.loads(r.stdout) if r.returncode == 0 else {}
bf = meas.get("blinkFollow", {})
ok = all(bf.get(s, {}).get("pass") for s in ("L", "R"))
check("blinkfollow-green", ok, {s: (bf.get(s, {}).get("lidMarginVerts"), bf.get(s, {}).get("travelPct")) for s in ("L", "R")})

n = sum(1 for c in checks if c["pass"])
print(f"G6GATE {n}/{len(checks)}", "GREEN" if n == len(checks) else "RED", flush=True)
sys.exit(0 if n == len(checks) else 1)
