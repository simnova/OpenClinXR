#!/usr/bin/env python3
"""groom32: shirt gates via groom31's shirt_gates31.py (import, no copy).

1. Runs sg.main() verbatim with E->E32 (reproduces groom30/groom31 rows).
2. Appends the groom32 row (build-31 strands, pre-settle) using the same
   mesh/samplers/projection code path. Writes E32/shirt-gates32.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import trimesh

E32 = Path(__file__).resolve().parent
E31 = E32.parent / "hair-groom31"
sys.path.insert(0, str(E31))

import shirt_gates31 as sg  # noqa: E402

sg.E = E32
sg.main()

base = json.loads((E32 / "shirt-gates31.json").read_text())

m = np.load(str(sg.STORE / "hair-groom31/aisha-meshes.npz"))
tm = trimesh.Trimesh(vertices=m["shirt_v"].astype(np.float64),
                     faces=m["shirt_f"], process=False)
bs = np.load(str(sg.ROOT / "tools/openclinxr/evidence/hair-cage1"
                 "/body-exact-sdf.npz"), allow_pickle=True)
bss, _ = sg.sdf_sampler(bs)
sh = np.load(str(sg.STORE / "hair-groom31/shirt-sdf-4mm.npz"),
             allow_pickle=True)
hss, _ = sg.sdf_sampler(sh)
tB = base  # boxes recomputed identically to main()
from PIL import Image as _I  # noqa: E402
tBm = np.array(_I.open(str(sg.SCR / "mask-back.png"))) > 127
ys, xs = np.nonzero(tBm)
y0, y1 = int(ys.min()), int(ys.max()) + 1
x0, x1 = int(xs.min()), int(xs.max()) + 1
W = x1 - x0
low0 = y0 + 2 * (y1 - y0) // 3
edge = int(round(0.15 * W))
boxes = {"left": (low0, y1, x0, x0 + edge),
         "right": (low0, y1, x1 - edge, x1)}
cam_pos = np.array(sg.M[:3, 3], dtype=np.float64)

D = np.load(str(E31 / "build-31/strands.npz"), allow_pickle=True)
pts = np.asarray(D["points"], dtype=np.float64)
rad = np.asarray(D["radii"], dtype=np.float64)
flat = pts.reshape(-1, 3)
bv, bi = bss(flat)
sv, si = hss(flat)
near = si & (np.abs(sv) < 10.0)
inshirt = near & (sv < 0.0) & bi & (bv > 0.0)
inbody = bi & (bv < 0.0)
cc, rr, dep = sg.project(flat)
ci = np.clip(np.round(cc).astype(int), 0, 1023)
ri = np.clip(np.round(rr).astype(int), 0, 1023)
vis = (rad.reshape(-1) > 1e-6) & (dep > 0) & (cc >= 0) & (cc < 1024) \
    & (rr >= 0) & (rr < 1024)
g = {"insideShirt": int(inshirt.sum()),
     "insideBody": int(inbody.sum()), "hem": {}}
for nm, (r0, r1, c0, c1) in boxes.items():
    inb = vis & (ri >= r0) & (ri < r1) & (ci >= c0) & (ci < c1)
    idx = np.nonzero(inb)[0]
    g["hem"][nm] = {"nHairSamples": int(len(idx))}
    if len(idx):
        from trimesh.ray import ray_pyembree as _rp
        r = _rp.RayMeshIntersector(tm)
        dirs = flat[idx] - cam_pos
        L = np.linalg.norm(dirs, axis=1)
        dirs = dirs / L[:, None]
        origins = np.repeat(cam_pos[None, :], len(idx), axis=0)
        locs, idx_ray, _ = r.intersects_location(
            origins, dirs, multiple_hits=False)
        hdep = np.full(len(idx), np.inf)
        if len(idx_ray):
            hdep[idx_ray] = np.linalg.norm(locs - cam_pos, axis=1)
        behind = hdep < L - 0.001
        g["hem"][nm]["nBehindShirt"] = int(behind.sum())
        g["hem"][nm]["hiddenFrac"] = round(
            float(behind.sum() / len(idx)), 4)
print("groom32", json.dumps(g), flush=True)
base["groom32"] = g
base["note"] = ("groom30/groom31 rows by shirt_gates31.main verbatim; "
                "groom32 row same code path on build-31/strands.npz "
                "(pre-settle)")
(E32 / "shirt-gates32.json").write_text(json.dumps(base, indent=1))
print("WROTE E/shirt-gates32.json")
