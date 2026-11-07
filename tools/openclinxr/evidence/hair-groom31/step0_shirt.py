#!/usr/bin/env python3
"""groom31 STEP 0: measure the shirt-inference on groom30 strands."""
import json, sys, time
import numpy as np
from pathlib import Path
E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
from children import sdf_sampler
import trimesh

STORE31 = Path("/Volumes/files/openclinxr-assets/store/hair-groom31")
STORE30 = Path("/Volumes/files/openclinxr-assets/store/hair-groom30")
SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"

def main():
    t0 = time.time()
    m = np.load(str(STORE31 / "aisha-meshes.npz"))
    sv = m["shirt_v"].astype(np.float64); sf = m["shirt_f"]
    tm = trimesh.Trimesh(vertices=sv, faces=sf, process=False)
    pq = trimesh.proximity.ProximityQuery(tm)
    s = np.load(str(STORE30 / "strands-30.npz"))
    pts = np.asarray(s["points"], dtype=np.float64)
    n, P, _ = pts.shape
    flat = pts.reshape(-1, 3)
    print("samples %d" % len(flat), flush=True)
    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    bv = np.empty(len(flat), dtype=np.float32)
    ch = 1 << 20
    for a in range(0, len(flat), ch):
        v, _ = sample(flat[a:a+ch])
        bv[a:a+ch] = v
    print("body-sd done %.0fs" % (time.time()-t0), flush=True)
    f = flat
    torso = (f[:,2]<1.55)&(np.abs(f[:,0])<0.35)&(f[:,1]>-0.25)&(f[:,1]<0.20)
    cand = torso & (bv>-2.0) & (bv<10.0)
    print("candidates %d" % int(cand.sum()), flush=True)
    ci = np.nonzero(cand)[0]
    sd = np.full(len(flat), np.nan, dtype=np.float32)
    cch = 200000
    for a in range(0, len(ci), cch):
        sd[ci[a:a+cch]] = pq.signed_distance(flat[ci[a:a+cch]])*1000.0
        print("shirt-sd %d/%d %.0fs" % (a, len(ci), time.time()-t0), flush=True)
    inside_shirt = np.zeros(len(flat), bool); inside_shirt[ci] = sd[ci] < 0.0
    inside_shirt &= (bv > 0.0)
    inside_body = bv < 0.0
    print("insideBody samples: %d" % int(inside_body.sum()), flush=True)
    regions = {
        "shoulders": (f[:,2]>=1.38)&(f[:,2]<1.50)&(np.abs(f[:,0])>=0.08)&(np.abs(f[:,0])<0.30),
        "back_mid": (f[:,1]>0.05)&(f[:,2]>=1.25)&(f[:,2]<1.45)&(np.abs(f[:,0])<0.15),
        "back_hem_L": (f[:,1]>0.05)&(f[:,2]>=1.05)&(f[:,2]<1.25)&(f[:,0]>=0),
        "back_hem_R": (f[:,1]>0.05)&(f[:,2]>=1.05)&(f[:,2]<1.25)&(f[:,0]<0),
        "nape": (f[:,1]>-0.02)&(f[:,1]<0.08)&(f[:,2]>=1.45)&(f[:,2]<1.55)&(np.abs(f[:,0])<0.08),
    }
    out = {"nStrands": int(n), "nSamples": int(len(flat)),
           "insideBody": int(inside_body.sum()),
           "insideShirt_total": int(inside_shirt.sum()),
           "nCandidates": int(cand.sum()),
           "shirtMesh": {"watertight": bool(tm.is_watertight),
                         "note": "open at neck/sleeves/hem; sign via embree ray votes"},
           "regions": {}}
    for name, mask in regions.items():
        rm = mask.reshape(n, P); ish = inside_shirt.reshape(n, P); ib = inside_body.reshape(n, P)
        r = {"nSamples": int(mask.sum()),
             "insideShirt": int((inside_shirt & mask).sum()),
             "insideBody": int((inside_body & mask).sum()),
             "nStrandsTouch": int(rm.any(axis=1).sum()),
             "nStrandsInsideShirt": int((ish & rm).any(axis=1).sum())}
        out["regions"][name] = r
        print(name, r, flush=True)
    np.savez_compressed(str(STORE31 / "step0-sd.npz"),
                        shirt_sd_mm=np.nan_to_num(sd).astype(np.float32),
                        body_sd_mm=bv, cand_mask=cand)
    (E / "step0.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))
    print("STEP0 done %.0fs" % (time.time()-t0), flush=True)

if __name__ == "__main__":
    main()
