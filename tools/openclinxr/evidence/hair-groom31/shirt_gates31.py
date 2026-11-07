#!/usr/bin/env python3
"""groom31 shirt-aware gates: inside-shirt samples + hem-box shirt occlusion.
For strands-30 and strands-31 (store): (a) inside-shirt count = shirtSDF<0
& bodySDF>0 & |shirtSDF|<10mm (near-band trustworthy sign); (b) back hem L/R
boxes: hair samples projecting into the box, fraction behind the shirt
surface along the camera ray (embree first-hit vs sample depth)."""
import json
import numpy as np
from pathlib import Path
import trimesh
E = Path(__file__).resolve().parent
ROOT = E.parents[3]
import sys
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
from children import sdf_sampler
STORE = Path("/Volumes/files/openclinxr-assets/store")
CAME = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json").read_text())
SENSOR = float(CAME["cameras-scorer-v3"] if False else CAME["sensorWidthMm"])
M = np.array(CAME["views"]["back"]["matrixWorld"], dtype=np.float64)
INV = np.linalg.inv(M); F = float(CAME["views"]["back"]["lensMm"]) / SENSOR * 1024.0
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
sys.path.insert(0, str(E.parent / "hair-groom19"))
import rulers19 as R  # noqa
from PIL import Image

def project(pts):
    hw = np.ones((len(pts), 4)); hw[:, :3] = pts
    lc = (INV @ hw.T).T; dep = -lc[:, 2]
    cc = np.full(len(pts), -1.0); rr = np.full(len(pts), -1.0)
    ok = dep > 0
    cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * F
    rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * F
    return cc, rr, dep

def main():
    m = np.load(str(STORE / "hair-groom31/aisha-meshes.npz"))
    tm = trimesh.Trimesh(vertices=m["shirt_v"].astype(np.float64),
                         faces=m["shirt_f"], process=False)
    bs = np.load(str(ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"), allow_pickle=True)
    bsample, _ = sdf_sampler(bs)
    sh = np.load(str(STORE / "hair-groom31/shirt-sdf-4mm.npz"), allow_pickle=True)
    hsample, _ = sdf_sampler(sh)
    tB = np.array(Image.open(str(SCR / "mask-back.png"))) > 127
    ys, xs = np.nonzero(tB)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    W = x1 - x0; low0 = y0 + 2 * (y1 - y0) // 3; edge = int(round(0.15 * W))
    boxes = {"left": (low0, y1, x0, x0 + edge),
             "right": (low0, y1, x1 - edge, x1)}
    cam_pos = np.array(M[:3, 3], dtype=np.float64)
    out = {"boxesPx": {k: v for k, v in boxes.items()}}
    for tag, sp in (("groom30", STORE / "hair-groom30/strands-30.npz"),
                    ("groom31", STORE / "hair-groom31/strands-31.npz")):
        D = np.load(str(sp), allow_pickle=True)
        pts = np.asarray(D["points"], dtype=np.float64)
        rad = np.asarray(D["radii"], dtype=np.float64)
        flat = pts.reshape(-1, 3)
        bv, bi = bsample(flat[::1])
        sv, si = hsample(flat[::1])
        near = si & (np.abs(sv) < 10.0)
        inshirt = near & (sv < 0.0) & bi & (bv > 0.0)
        inbody = bi & (bv < 0.0)
        cc, rr, dep = project(flat)
        ci = np.clip(np.round(cc).astype(int), 0, 1023)
        ri = np.clip(np.round(rr).astype(int), 0, 1023)
        vis = (rad.reshape(-1) > 1e-6) & (dep > 0) & (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
        g = {"insideShirt": int(inshirt.sum()),
             "insideBody": int(inbody.sum()), "hem": {}}
        for nm, (r0, r1, c0, c1) in boxes.items():
            inb = vis & (ri >= r0) & (ri < r1) & (ci >= c0) & (ci < c1)
            idx = np.nonzero(inb)[0]
            g["hem"][nm] = {"nHairSamples": int(len(idx))}
            if len(idx):
                # rays from camera through these samples, first shirt hit
                from trimesh.ray import ray_pyembree as _rp
                r = _rp.RayMeshIntersector(tm)
                dirs = flat[idx] - cam_pos
                L = np.linalg.norm(dirs, axis=1); dirs = dirs / L[:, None]
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
        out[tag] = g
        print(tag, json.dumps(g), flush=True)
    (E / "shirt-gates31.json").write_text(json.dumps(out, indent=1))
    print("WROTE E/shirt-gates31.json")

if __name__ == "__main__":
    main()
