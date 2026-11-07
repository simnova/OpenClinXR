"""S1 mirror-pair scalp probe for hair-guides-11 (cap v5). Runs inside Blender.
TEST roots: R_i = flow roots with x-cx>2mm; L_i = mirror about body cx.
Levels: A=trace pl, B=head-projected scalp, C=+surface_walk. Compares path(R)
vs mirror(path(L)) point by point; dumps per-step quantities for 10 worst.
"""
import sys, argparse, importlib.util, json
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent

def load_hs():
    p = HERE.parent.parent / "hair-scene" / "hair_scene.py"
    # E=evidence/hair-guides11 -> parent=evidence, so hair-scene is ../hair-scene
    # fall back: search up to 3 levels
    if not p.exists():
        for cand in [HERE / "hair_scene.py",
                     HERE.parent / "hair-scene" / "hair_scene.py",
                     Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-p7/tools/openclinxr/evidence/hair-scene/hair_scene.py")]:
            if cand.exists():
                p = cand; break
    s = importlib.util.spec_from_file_location("oclx_hs", str(p))
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m

def wpts(obj):
    M = obj.matrix_world
    return np.array([tuple(M @ v.co) for v in obj.data.vertices])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]); out = Path(aa.out)
    out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); body = h.head
    bpy.context.view_layer.update()
    W = wpts(body)
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    medy = float(np.median(W[:, 1]))
    F = HERE.parent / "hair-cap5"
    cap = np.load(F / "cap-v5.npz"); fb = np.load(F / "flow-b-v5.npz", allow_pickle=True)
    V = np.array(cap["verts"]); cap_cx = float(cap["cx"])
    fB = np.array(fb["f"]); roots_all = np.array(fb["roots"])
    ear_y = float(cap["ear_y"]); ear_top = float(cap["ear_top"])
    print("BODY cx=%.6f medy=%.4f crown=%.4f cap_cx=%.9f" % (cx, medy, crown, cap_cx))
    print("nroots=%d" % len(roots_all))
    # mirror partner map for cap verts (about cap_cx)
    # brute force in numpy chunks (25k verts -> 25k queries)
    Vm = np.stack([-V[:, 0] + 2 * cap_cx, V[:, 1], V[:, 2]], axis=1)
    # chunked nearest
    partner = np.empty(len(V), dtype=int)
    for s in range(0, len(V), 2000):
        q = Vm[s:s + 2000]
        d2 = ((q[:, None, :] - V[None, :, :]) ** 2).sum(2)
        partner[s:s + 2000] = d2.argmin(1)
    pdist = np.linalg.norm(Vm - V[partner], axis=1)
    print("PARTNER max=%.6fmm" % (float(pdist.max()) * 1000))
    # TEST roots
    Rsel = roots_all[(roots_all[:, 0] - cap_cx) > 0.002]
    print("TEST R n=%d" % len(Rsel))
    Lsel = Rsel.copy(); Lsel[:, 0] = 2.0 * cx - Lsel[:, 0]
    # kd over cap verts
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd.insert(Vector(tuple(p)), i)
    kd.balance()
    ball = np.array(sorted(set(int(v) for v in cap["exit"]) | set(int(v) for v in cap["forehead"]) | set(int(v) for v in cap["slit"])))
    bkd = kdtree.KDTree(len(ball))
    for vi in ball: bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in np.array(cap["faces"])])
    w2l, l2w = body.matrix_world.inverted().copy(), body.matrix_world.copy()
    deps = bpy.context.evaluated_depsgraph_get()
    body.update_tag(); bpy.context.view_layer.update()
    bvh_body = BVHTree.FromObject(body, deps, deform=True, cage=False)

    def trace_detail(r):
        steps = []  # per iteration record
        p = Vector(tuple(r))
        pl = [np.array(tuple(r), dtype=float)]
        for it in range(100):
            co, vi, _ = kd.find(p)
            fv = np.array(fB[vi], dtype=float)
            nl = float(np.linalg.norm(fv))
            if nl < 1e-9:
                steps.append({"it": it, "branch": "zero-flow", "vi": int(vi)})
                break
            step = fv / nl * 0.002
            p_new = np.array(tuple(p), dtype=float) + step
            hit, nrm, _, _ = bvh_body.find_nearest(w2l @ Vector(tuple(p_new)))
            if hit is None:
                steps.append({"it": it, "branch": "no-hit", "vi": int(vi)})
                break
            p_proj = np.array(tuple(l2w @ hit), dtype=float)
            nrm = np.array(tuple(nrm), dtype=float)
            _, _, _, dist = capBVH.find_nearest(Vector(tuple(p_proj)))
            distf = float(dist) if dist is not None else None
            rec = {"it": it, "p": np.array(tuple(p), dtype=float),
                   "vi": int(vi), "vi_xyz": np.array(tuple(V[int(vi)])),
                   "fv": fv, "p_new": p_new, "hit": np.array(tuple(hit)),
                   "nrm": nrm, "p_proj": p_proj, "capdist": distf}
            if distf is None or distf > 0.0015:
                _, bi, _ = bkd.find(Vector(tuple(p_proj)))
                rec["branch"] = "exit"
                rec["bi"] = int(bi)
                steps.append(rec); pl.append(p_proj)
                return np.array(pl), int(bi), steps
            rec["branch"] = "cont"
            steps.append(rec)
            p = Vector(tuple(p_proj)); pl.append(p_proj)
        return np.array(pl), None, steps

    def mirror_x(P):
        Q = P.copy(); Q[:, 0] = 2.0 * cx - Q[:, 0]
        return Q

    pairs = len(Rsel)
    # run traces
    PR, BR, SR = [], [], []
    PL, BL, SL = [], [], []
    for r in Rsel:
        pl, bi, st = trace_detail(r)
        PR.append(pl); BR.append(bi); SR.append(st)
    for l in Lsel:
        pl, bi, st = trace_detail(l)
        PL.append(pl); BR.append(bi) if False else None
        PL[-1] = pl; SL.append(st)
    # need BL list
    # re-derive: SL corresponds to Lsel; BR already R bis; collect L bis
    # (trace_detail returned bi but we stored in SR/SL? store separately)
    # Recompute bis arrays properly:
    # SR holds step lists; bis stored alongside. Rebuild:
    # Actually PR/BR: BR_R; PL/B_L:
    # We appended wrong above for L. Fix: keep two bi lists.
    # SR/SL already hold steps; recover bi from last step.
    def exit_bi(steps):
        b = steps[-1].get("bi", None) if steps else None
        return b
    BRr = [exit_bi(s) for s in SR]
    BLl = [exit_bi(s) for s in SL]

    def level_stats(PA, PB_list, label):
        # PA: list of R paths; PB_list: list of L paths; mirror L then compare
        maxds = []; divks = []; lens = []
        for i in range(pairs):
            a = PA[i]; b = mirror_x(PL[i])
            m = min(len(a), len(b))
            lens.append((len(a), len(b)))
            if m == 0:
                maxds.append(np.nan); divks.append(-2); continue
            d = np.linalg.norm(a[:m] - b[:m], axis=1)
            # length penalty: if lengths differ, extra tail counts at full extent
            tail = 0.0
            if len(a) != len(b):
                tail = float(np.linalg.norm(a[-1] - b[-1]))
            maxds.append(max(float(d.max()), tail))
            k = next((k for k in range(m) if float(d[k]) > 0.001), -1)
            if k == -1 and len(a) != len(b):
                k = m  # diverges by length
            divks.append(int(k))
        maxds = np.array(maxds)
        print("%s pairs=%d maxd p50=%.3fmm p95=%.3fmm max=%.3fmm" % (
            label, pairs, float(np.nanpercentile(maxds, 50)) * 1000,
            float(np.nanpercentile(maxds, 95)) * 1000, float(np.nanmax(maxds)) * 1000))
        lk = np.array([(a, b) for a, b in lens])
        print("%s len R p50=%d L p50=%d len-differ=%d" % (
            label, int(np.median(lk[:, 0])), int(np.median(lk[:, 1])), int((lk[:, 0] != lk[:, 1]).sum())))
        dk = np.array(divks)
        print("%s diverge_k hist: " % label + str({int(k): int((dk == k).sum()) for k in sorted(set(dk.tolist()))[:12]}))
        return maxds, divks

    maxdA, divkA = level_stats(PR, PL, "LEVEL-A trace-pl")
    # Level B: head-projected scalp
    def project_scalp(pl):
        sc = []
        for q in pl:
            hit, nrm, _, _ = bvh_body.find_nearest(w2l @ Vector(tuple(q)))
            if hit is None: break
            hq = np.array(tuple(hit)); hn = np.array(tuple(nrm))
            sc.append(l2w @ Vector(tuple(hq)) if False else None)  # placeholder
        return None
    # proper projection in world space:
    def scalp_of(pl):
        sc = []
        for q in pl:
            hit, nrm, _, _ = bvh_body.find_nearest(w2l @ Vector(tuple(q)))
            if hit is None: break
            hq = np.array(tuple(l2w @ hit)); hn = np.array(tuple(nrm))
            sc.append(hq + hn * 0.003)
        return np.array(sc) if len(sc) else np.zeros((0, 3))
    SCR = [scalp_of(pl) for pl in PR]
    SCL = [scalp_of(pl) for pl in PL]
    # temporarily swap globals for level_stats (it uses PL closure) -> inline compare
    def cmp_lists(LR, LL, label):
        maxds = []; divks = []
        for i in range(pairs):
            a = LR[i]; b = LL[i].copy(); b[:, 0] = 2.0 * cx - b[:, 0]
            m = min(len(a), len(b))
            if m == 0:
                maxds.append(np.nan); divks.append(-2); continue
            d = np.linalg.norm(a[:m] - b[:m], axis=1)
            tail = float(np.linalg.norm(a[-1] - b[-1])) if len(a) != len(b) else 0.0
            maxds.append(max(float(d.max()), tail))
            k = next((k for k in range(m) if float(d[k]) > 0.001), (-1 if len(a) == len(b) else m))
            divks.append(int(k))
        maxds = np.array(maxds)
        print("%s pairs=%d maxd p50=%.3fmm p95=%.3fmm max=%.3fmm" % (
            label, pairs, float(np.nanpercentile(maxds, 50)) * 1000,
            float(np.nanpercentile(maxds, 95)) * 1000, float(np.nanmax(maxds)) * 1000))
        dk = np.array(divks)
        print("%s diverge_k hist: " % label + str({int(k): int((dk == k).sum()) for k in sorted(set(dk.tolist()))[:14]}))
        return maxds, divks
    maxdB, divkB = cmp_lists(SCR, SCL, "LEVEL-B scalp-proj")
    # worst-10 detail at LEVEL A
    order = np.argsort(maxdA, kind="stable")[::-1][:10]
    print("WORST10 level-A:")
    for rnk, i in enumerate(order):
        a = PR[i]; b = mirror_x(PL[i])
        m = min(len(a), len(b))
        d = np.linalg.norm(a[:m] - b[:m], axis=1)
        k = next((k for k in range(m) if float(d[k]) > 0.001), m)
        print("WORST %d pair=%d maxd=%.2fmm diverge_k=%d lenR=%d lenL=%d biR=%s biL=%s" % (
            rnk + 1, int(i), float(maxdA[i]) * 1000, int(k), len(a), len(PL[i]), str(BRr[i]), str(BLl[i])))
        for kk in ([k - 1, k] if k > 0 else [k]):
            if 0 <= kk < len(SR[i]) or kk < len(a):
                # step record index: steps[j] produced pl[j+1]; pl[0]=root
                # so pl index kk corresponds to step kk-1 (for kk>=1)
                for side, ST, PTH in (("R", SR[i], a), ("L", SL[i], mirror_x(PL[i]))):
                    if kk == 0:
                        print("  k=0 %s root=%s" % (side, np.round(PTH[0] * 1000, 3).tolist()))
                    elif kk - 1 < len(ST):
                        s = ST[kk - 1]
                        mir_vi = int(partner[int(s["vi"])]) if "vi" in s else -1
                        print("  k=%d %s pos=%s vi=%d vi_xyz=%s mirror_partner=%d fv=%s capdist=%s branch=%s" % (
                            kk, side,
                            np.round(PTH[kk] * 1000, 3).tolist() if kk < len(PTH) else "NA",
                            int(s.get("vi", -1)),
                            np.round(np.array(s.get("vi_xyz", [0, 0, 0])) * 1000, 2).tolist(),
                            mir_vi,
                            np.round(np.array(s.get("fv", [0, 0, 0])), 4).tolist(),
                            s.get("capdist"), s.get("branch")))
        # also compare vi mirror consistency at k-1
        if k - 1 >= 0 and (k - 1) < len(SR[i]) and (k - 1) < len(SL[i]):
            viR = int(SR[i][k - 1].get("vi", -1)); viL = int(SL[i][k - 1].get("vi", -1))
            print("  viR=%d partner(viR)=%d viL=%d match=%s" % (viR, int(partner[viR]) if viR >= 0 else -1, viL, str(int(partner[viR]) == viL if viR >= 0 else False)))
    # save
    np.savez(out / "s1-pair.npz",
             R=np.array(Rsel, dtype=np.float32), L=np.array(Lsel, dtype=np.float32),
             maxdA=np.array(maxdA), divkA=np.array(divkA),
             maxdB=np.array(maxdB), divkB=np.array(divkB))
    print("WROTE", out / "s1-pair.npz")

main()
