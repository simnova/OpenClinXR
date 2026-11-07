"""groom34 residual analysis: WHERE do post-mask shell/column strands come from? (E driver)"""
import sys
import numpy as np
from pathlib import Path
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom" / "strands"))
import gates34 as G  # noqa: E402

S = Path("/Volumes/files/openclinxr-assets/store/hair-groom34")
P = np.load(S / "ear-proxy.npz")
D = np.load(S / "build-mask20" / "strands.npz")
pts = np.ascontiguousarray(np.asarray(D["points"], dtype=np.float64))
n, Pm, _ = pts.shape
proot = np.asarray(D["roots"], dtype=np.float64)  # per-strand parent root pos?
print("roots field shape:", proot.shape, "parent:", np.asarray(D["parent"]).shape,
      "side:", np.unique(np.asarray(D["side"]), return_counts=True))

for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
    sv = np.asarray(P[nm + "_shell_v"], dtype=np.float64)
    sf = np.asarray(P[nm + "_shell_f"])
    r = G.segments_in_shell(pts, sv, sf)
    has = np.zeros(n, dtype=bool)
    # recompute per-strand hits (same algorithm, keep mask)
    sv = np.ascontiguousarray(sv); sf = np.ascontiguousarray(sf, dtype=np.int64)
    tris = sv[sf]
    tmin, tmax = tris.min(axis=1), tris.max(axis=1)
    sbmin, sbmax = sv.min(axis=0), sv.max(axis=0)
    hit = np.zeros((n, Pm - 1), dtype=bool)
    for a in range(0, n, 40000):
        sl = slice(a, min(a + 40000, n))
        p0 = pts[sl, :-1, :].reshape(-1, 3); p1 = pts[sl, 1:, :].reshape(-1, 3)
        smin = np.minimum(p0, p1); smax = np.maximum(p0, p1)
        cand = ((smax[:, 0] >= sbmin[0]) & (smin[:, 0] <= sbmax[0])
                & (smax[:, 1] >= sbmin[1]) & (smin[:, 1] <= sbmax[1])
                & (smax[:, 2] >= sbmin[2]) & (smin[:, 2] <= sbmax[2]))
        ci = np.nonzero(cand)[0]
        if not len(ci):
            continue
        q0, q1 = p0[ci], p1[ci]
        dv = q1 - q0
        pierced = np.zeros(len(ci), dtype=bool)
        for t in range(len(tris)):
            if pierced.all():
                break
            if not ((tmax[t] >= smin[ci].min(axis=0)).all()
                    and (tmin[t] <= smax[ci].max(axis=0)).all()):
                continue
            pierced |= G._mt_intersect(q0, dv, tris[t, 0], tris[t, 1], tris[t, 2])
        rest = np.nonzero(~pierced)[0]
        if len(rest):
            mid = (q0[rest] + q1[rest]) / 2.0
            dd = np.zeros(len(rest), dtype=np.int32)
            dvx = np.zeros_like(mid); dvx[:, 0] = 1.0
            for t in range(len(tris)):
                dd += G._mt_intersect(mid, dvx, tris[t, 0], tris[t, 1], tris[t, 2]).astype(np.int32)
            pierced[rest] |= (dd % 2) == 1
        full = np.zeros(p0.shape[0], dtype=bool); full[ci] = pierced
        hit[sl] = full.reshape(min(40000, n - a), Pm - 1)
    hs = hit.any(axis=1)
    print(f"== {nm}: strands {hs.sum()} segs {hit.sum()} (gate check {r['nSegments']}/{r['nStrands']})")
    # parent roots of hit strands + distance to outer patch
    outer = sv[:len(sv) // 2]
    tree = cKDTree(outer)
    pr = proot[hs]
    dd, _ = tree.query(pr)
    print(f"  root-proxy dist mm: min {dd.min()*1000:.1f} p10 {np.percentile(dd,10)*1000:.1f} "
          f"p50 {np.median(dd)*1000:.1f} p90 {np.percentile(dd,90)*1000:.1f} max {dd.max()*1000:.1f}")
    print(f"  root |x| mm: p10 {np.percentile(np.abs(pr[:,0]),10)*1000:.1f} p50 {np.median(np.abs(pr[:,0]))*1000:.1f} "
          f"p90 {np.percentile(np.abs(pr[:,0]),90)*1000:.1f}")
    print(f"  root y mm: p10 {np.percentile(pr[:,1],10)*1000:.1f} p50 {np.median(pr[:,1])*1000:.1f} p90 {np.percentile(pr[:,1],90)*1000:.1f}")
    print(f"  root z: p10 {np.percentile(pr[:,2],10)*1000:.2f} p50 {np.median(pr[:,2])*1000:.2f} p90 {np.percentile(pr[:,2],90)*1000:.2f}")
    # entering segment midpoints
    si, sj = np.nonzero(hit)
    mid = (pts[si, sj, :] + pts[si, sj + 1, :]) / 2
    print(f"  entry mid y mm: p10 {np.percentile(mid[:,1],10)*1000:.1f} p50 {np.median(mid[:,1])*1000:.1f} p90 {np.percentile(mid[:,1],90)*1000:.1f}")
    print(f"  entry mid z: p10 {np.percentile(mid[:,2],10)*1000:.2f} p50 {np.median(mid[:,2])*1000:.2f} p90 {np.percentile(mid[:,2],90)*1000:.2f}")
