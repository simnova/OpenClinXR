"""hair-groom38: shape-preserving ear collide against the inflated proxy.

New stage, default OFF elsewhere (standalone script; no existing
behaviour touched). Runs on groom36's children (NOT groom37): collision
against the proxy as a final, shape-preserving relaxation, the way
groom tools do guide/strand collide.

Collider (union): the 3 mm inflated ear shell per side
(store/hair-groom34/ear-proxy.npz) + body SDF
(hair-cage1/body-exact-sdf.npz, 0.3 mm clearance) + the shirt field
groom33 used (store/hair-groom31/shirt-sdf-4mm.npz, clear 0.5 mm, same
near/z rules as the build: shirt branch within 10 mm of its surface
and below z 1.40).

Move set: ONLY strands with >= 1 segment inside the ear shell
(gates34.def segment test: pierce OR midpoint-inside) OR in the
earlobe column (gates34.earlobe_columns full-strands predicate).
Every other strand stays byte-identical (proven by comparison).

Pins: the root (sample 0) and the first 20 mm of arc from the root
(original shape) are infinitely massive. No gravity, no integration:
pure XPBD-style projection iterations (20-50):
  * segment-length constraints, rest = strand's own pre-collide
    lengths (stiffness 1.0);
  * bending constraints as second-neighbour distances, rest =
    strand's own pre-collide |p[i+2]-p[i]| (stiffness 0.25);
  * contact constraints pushing samples out of the collider along the
    shell normal.
A moved strand slides around the BACK of the ear (posterior, +y) or
above it, never forward: if a shell-contact correction points forward
(anterior = -y in hair space: the eyes sit at y=-0.1246, anterior of
the ears at y~-0.07, Blender-measured from the body GLB), the anterior
component is stripped (projected onto the posterior tangent); a
pure-anterior exit falls back to posterior+up. Column-box contacts push
posterior (+y) out of the box only (anterior exit forbidden by the
same rule). No trims, no radius changes, no occlusion/render tricks,
no gravity settle, no interpolation-weight changes.

Column strands hang in free air (no shell contact below the lobe), so
without a column-box contact they could never leave the box: the box
itself is treated as keep-out, exited posteriorly only.

Usage:
  mise exec -- python3 tools/openclinxr/hair-groom/strands/ear_collide.py \
    --in /Volumes/files/openclinxr-assets/store/hair-groom36/build-36/strands.npz \
    --outdir /Volumes/files/openclinxr-assets/store/hair-groom38/build-38 \
    [--iters 30]
Writes outdir/strands.npz + outdir/build.json (stats, provenance).
Deterministic: no randomness; rebuilds are sha-identical.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
EVID = HERE.parents[2] / "openclinxr" / "evidence"
STORE = Path("/Volumes/files/openclinxr-assets/store")

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(EVID / "hair-groom35"))
import gates34 as G  # noqa: E402
from children import sdf_sampler  # noqa: E402
from residual35 import shell_hits  # noqa: E402 (import, no copy)

PROXY = STORE / "hair-groom34/ear-proxy.npz"
BODY_SDF = EVID / "hair-cage1/body-exact-sdf.npz"
SHIRT_SDF = STORE / "hair-groom31/shirt-sdf-4mm.npz"
BODY_MARGIN_MM = 0.3
SHIRT_CLEAR_MM = 0.5
SHELL_OVER_MM = 0.2
PIN_ARC_MM = 20.0
BEND_STIFF = 0.25


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def column_mask(pts, sides, nm):
    """Inline copy of the gates34.earlobe_columns full-strands predicate.

    gates34 returns counts only; the solver needs indices. Predicate is
    identical (same fields, same bounds); provenance: gates34.py
    earlobe_columns.
    """
    s = sides[nm]
    sgn = s["sgn"]
    flat = pts[:, 1:, :].reshape(-1, 3)
    n, Pm, _ = pts.shape
    sm = ((flat[:, 2] < s["zmin"])
          & (flat[:, 1] >= s["yback"])
          & (flat[:, 1] <= s["yfront"])
          & ((flat[:, 0] * sgn) > 0)
          & (np.abs(flat[:, 0]) >= s["xmin"] - 0.005)
          & (np.abs(flat[:, 0]) <= s["xmax"]))
    return sm.reshape(n, Pm - 1).any(axis=1)


def closest_on_tris(p, tris):
    """Closest point on each of k tris to each point. p (m,3), tris (m,k,3,3).

    Returns closest (m,3), dist2 (m,). Ericson 5.1.2, vectorized over k.
    """
    a = tris[:, :, 0, :]
    ab = tris[:, :, 1, :] - a
    ac = tris[:, :, 2, :] - a
    ap = p[:, None, :] - a
    d1 = (ab * ap).sum(-1)
    d2 = (ac * ap).sum(-1)
    d3 = (ab * ab).sum(-1)
    d4 = (ab * ac).sum(-1)
    d5 = (ac * ac).sum(-1)
    denom = d3 * d5 - d4 * d4
    v = (d5 * d1 - d4 * d2) / np.maximum(denom, 1e-30)
    w = (d3 * d2 - d4 * d1) / np.maximum(denom, 1e-30)
    v = np.clip(v, 0.0, 1.0)
    w = np.clip(w, 0.0, 1.0)
    mask = (v + w) > 1.0
    v = np.where(mask, 1.0 - w, v)
    w = np.where(mask, 1.0 - v, w)
    # edge cases (vertex/edge regions) fall back to segment projection
    best = a + ab * v[:, :, None] + ac * w[:, :, None]
    # refine: also test the three edges explicitly for robustness
    cand = [best]
    for q0, q1 in ((0, 1), (1, 2), (2, 0)):
        e0 = tris[:, :, q0, :]
        e = tris[:, :, q1, :] - e0
        t = ((p[:, None, :] - e0) * e).sum(-1) / np.maximum(
            (e * e).sum(-1), 1e-30)
        cand.append(e0 + e * np.clip(t, 0.0, 1.0)[:, :, None])
    cand = np.stack(cand, axis=2)  # (m,k,4,3)
    d2all = ((cand - p[:, None, None, :]) ** 2).sum(-1)
    bi = d2all.reshape(len(p), -1).argmin(axis=1)
    kk = np.arange(len(p))
    flat = cand.reshape(len(p), -1, 3)
    return flat[kk, bi], d2all.reshape(len(p), -1)[kk, bi]


class ShellCollider:
    """Nearest-surface + inside-parity queries against one shell mesh."""

    def __init__(self, verts, faces):
        self.sv = np.ascontiguousarray(verts, dtype=np.float64)
        self.sf = np.ascontiguousarray(faces, dtype=np.int64)
        self.tris = self.sv[self.sf]
        self.cent = self.tris.mean(axis=1)
        self.tree = cKDTree(self.cent)
        self.sbmin = self.sv.min(axis=0)
        self.sbmax = self.sv.max(axis=0)

    def inside(self, p):
        """Parity (+X ray, gates34 MT) for points near the bbox."""
        p = np.ascontiguousarray(p, dtype=np.float64)
        out = np.zeros(len(p), dtype=bool)
        near = ((p[:, 0] >= self.sbmin[0]) & (p[:, 0] <= self.sbmax[0])
                & (p[:, 1] >= self.sbmin[1]) & (p[:, 1] <= self.sbmax[1])
                & (p[:, 2] >= self.sbmin[2]) & (p[:, 2] <= self.sbmax[2]))
        idx = np.nonzero(near)[0]
        if not len(idx):
            return out
        q = p[idx]
        dv = np.zeros_like(q)
        dv[:, 0] = 1.0
        dd = np.zeros(len(q), dtype=np.int32)
        for t in range(len(self.tris)):
            dd += G._mt_intersect(q, dv, self.tris[t, 0],
                                  self.tris[t, 1],
                                  self.tris[t, 2]).astype(np.int32)
        out[idx] = (dd % 2) == 1
        return out

    def exit_vectors(self, p, k=12):
        """(closest - p) exit vector per point (outward by construction)."""
        p = np.ascontiguousarray(p, dtype=np.float64)
        _, ji = self.tree.query(p, k=min(k, len(self.tris)))
        if ji.ndim == 1:
            ji = ji[:, None]
        tris = self.tris[ji]  # (m,k,3,3)
        close, d2 = closest_on_tris(p, tris)
        return close - p, np.sqrt(np.maximum(d2, 0.0))


def sdf_gradient(sample, p, eps_m=0.0005):
    """Central-difference gradient of an SDF sampler at points (m,3)."""
    p = np.ascontiguousarray(p, dtype=np.float64)
    e = eps_m
    outs = []
    for ax in range(3):
        dp = np.zeros_like(p)
        dp[:, ax] = e
        vp, ip = sample(p + dp)
        vm, im = sample(p - dp)
        g = np.full(len(p), np.nan)
        ok = ip & im
        g[ok] = (vp[ok] - vm[ok]) / (2.0 * e)
        outs.append(g)
    return np.stack(outs, axis=1)


def _posterior_step(ev, dd, over):
    """Shell exit step with the posterior rule.

    ev/dd: exit vectors/distances from ShellCollider. Anterior exits
    (anterior is -y) become posterior-tangent strides (capped): the
    strand slides around the BACK of the ear or above it, never forward.
    """
    need = dd + over
    nv = np.linalg.norm(ev, axis=1)
    step = np.zeros_like(ev)
    good = nv > 1e-12
    step[good] = (ev[good] / nv[good][:, None]) \
        * need[good][:, None]
    ant = step[:, 1] < 0
    if ant.any():
        cn = np.linalg.norm(step[ant], axis=1)
        nhat = step[ant] / np.maximum(cn, 1e-12)[:, None]
        yhat = np.array([0.0, 1.0, 0.0])
        t = yhat[None, :] - (nhat[:, 1])[:, None] * nhat
        tl = np.linalg.norm(t, axis=1)
        weak = tl < 0.2
        t[weak] = np.array([0.0, 1.0, 0.35])  # posterior+up
        tl = np.linalg.norm(t, axis=1)
        stride = np.minimum(np.maximum(cn, 0.004), 0.012)
        step[ant] = (t / tl[:, None]) * stride[:, None]
    return step


def _body_feasible(body_sample, dest, margin_mm):
    """Body SDF value >= margin at destinations (mm units)."""
    bv, bi = body_sample(dest)
    return bi & (bv >= margin_mm), bv


def resolve_contacts(cur, free, free_flat, shell, s, sides_nm, sides,
                     body_sample, shirt_sample, over, body_need_mm,
                     shirt_need_mm):
    """One joint contact pass with an inner loop over the active set.

    The shell push must land body-feasible (halved up to 3x otherwise):
    the shell wall stands ~3 mm off the pinna skin, so a full exit step
    can overshoot into flesh and then the body push throws the point
    back into the shell (limit cycle). Column/body/shirt follow; the
    active subset is re-checked until clear (cap 6 inner rounds).
    Returns (n_shell_viol, n_col_viol, pushed_mask).
    """
    m, Pm, _ = cur.shape
    flat = cur.reshape(-1, 3)
    inside = shell.inside(flat).reshape(m, Pm)
    mid = (cur[:, :-1, :] + cur[:, 1:, :]) / 2.0
    mid_in = shell.inside(mid.reshape(-1, 3)).reshape(m, Pm - 1)
    thru = mid_in & ~inside[:, :-1] & ~inside[:, 1:]
    push = inside & free
    if thru.any():
        ti, tj = np.nonzero(thru)
        cand = np.stack([cur[ti, tj, :], cur[ti, tj + 1, :]], axis=1)
        ev, dd = shell.exit_vectors(cand.reshape(-1, 3))
        ev = ev.reshape(-1, 2, 3)
        dd = dd.reshape(-1, 2)
        pick_end = (dd[:, 1] < dd[:, 0]).astype(int)
        for trow, segj, end in zip(ti, tj, pick_end):
            if free[trow, segj + end]:
                push[trow, segj + end] = True
    cf = cur[:, 1:, :].reshape(-1, 3)
    sgn = sides[sides_nm]["sgn"]
    incol = ((cf[:, 2] < s["zmin"])
             & (cf[:, 1] >= s["yback"])
             & (cf[:, 1] <= s["yfront"])
             & ((cf[:, 0] * sgn) > 0)
             & (np.abs(cf[:, 0]) >= s["xmin"] - 0.005)
             & (np.abs(cf[:, 0]) <= s["xmax"])).reshape(m, Pm - 1)
    colpush = np.zeros((m, Pm), dtype=bool)
    colpush[:, 1:] = incol & free[:, 1:]
    bflat = cur.reshape(-1, 3)
    bv, bi = body_sample(bflat)
    bneg = bi & free_flat & (bv < BODY_MARGIN_MM)
    sflat = cur.reshape(-1, 3)
    svv, si = shirt_sample(sflat)
    snear = si & free_flat & (np.abs(svv) < 10.0) & (sflat[:, 2] < 1.40)
    sneg = snear & (svv < SHIRT_CLEAR_MM)
    pushed = np.zeros((m, Pm), dtype=bool)
    n_shell = int(inside.sum() + thru.sum())
    n_col = int(incol.sum())
    for _ in range(6):
        act = push | colpush | bneg.reshape(m, Pm) | sneg.reshape(m, Pm)
        if not act.any():
            break
        ai, aj = np.nonzero(act)
        # --- shell pushes with flesh-halving ---
        if push[ai, aj].any():
            si_, sj_ = ai[push[ai, aj]], aj[push[ai, aj]]
            pp = cur[si_, sj_, :]
            ev, dd = shell.exit_vectors(pp)
            step = _posterior_step(ev, dd, over)
            final = np.zeros_like(step)
            done = np.zeros(len(si_), dtype=bool)
            trial = step.copy()
            for _h in range(4):
                live = ~done
                if not live.any():
                    break
                dest = pp[live] + trial[live]
                feas, _ = _body_feasible(body_sample, dest,
                                         BODY_MARGIN_MM)
                take = np.nonzero(live)[0][feas]
                final[take] = trial[take]
                done[take] = True
                trial[live] *= 0.5
            # infeasible remainder (destination in flesh): hold still
            # this inner round; the body pass + outer rounds continue.
            cur[si_, sj_, :] += final
            pushed[si_, sj_] = True
        # --- column pushes (posterior +y exit only), flesh-checked ---
        if colpush[ai, aj].any():
            ci_, cj_ = ai[colpush[ai, aj]], aj[colpush[ai, aj]]
            tgt = s["yfront"] + 0.001
            want = np.maximum(cur[ci_, cj_, 1], tgt)
            dest = cur[ci_, cj_, :].copy()
            dest[:, 1] = want
            feas, _ = _body_feasible(body_sample, dest, BODY_MARGIN_MM)
            dest[~feas, 1] = (cur[ci_, cj_, 1][~feas] + want[~feas]) \
                / 2.0
            cur[ci_, cj_, :] = dest
            pushed[ci_, cj_] = True
        # --- body pushes ---
        bflat = cur.reshape(-1, 3)
        bv, bi = body_sample(bflat)
        bneg = bi & free_flat & (bv < BODY_MARGIN_MM)
        if bneg.any():
            g = sdf_gradient(body_sample, bflat[bneg])
            gl = np.linalg.norm(g, axis=1)
            okg = gl > 1e-9
            step = np.zeros_like(g)
            step[okg] = (g[okg] / gl[okg][:, None]) \
                * ((body_need_mm - bv[bneg][okg]) / 1000.0)[:, None]
            bflat[bneg] += step
            pushed.reshape(-1)[np.nonzero(bneg)[0]] = True
        # --- shirt pushes ---
        sflat = cur.reshape(-1, 3)
        svv, si = shirt_sample(sflat)
        snear = si & free_flat & (np.abs(svv) < 10.0) \
            & (sflat[:, 2] < 1.40)
        sneg = snear & (svv < SHIRT_CLEAR_MM)
        if sneg.any():
            g = sdf_gradient(shirt_sample, sflat[sneg])
            gl = np.linalg.norm(g, axis=1)
            okg = gl > 1e-9
            step = np.zeros_like(g)
            step[okg] = (g[okg] / gl[okg][:, None]) \
                * ((shirt_need_mm - svv[sneg][okg]) / 1000.0)[:, None]
            sflat[sneg] += step
            pushed.reshape(-1)[np.nonzero(sneg)[0]] = True
        cur = bflat.reshape(m, Pm, 3)
        # re-check the active subset only (cheap)
        sub = cur[ai, aj]
        still_shell = shell.inside(sub)
        bv2, bi2 = body_sample(sub)
        still_body = bi2 & (bv2 < BODY_MARGIN_MM)
        cf2 = sub
        in2 = ((cf2[:, 2] < s["zmin"])
               & (cf2[:, 1] >= s["yback"])
               & (cf2[:, 1] <= s["yfront"])
               & ((cf2[:, 0] * sgn) > 0)
               & (np.abs(cf2[:, 0]) >= s["xmin"] - 0.005)
               & (np.abs(cf2[:, 0]) <= s["xmax"]))
        if not (still_shell.any() or still_body.any() or in2.any()):
            break
        push = np.zeros((m, Pm), dtype=bool)
        ss = still_shell & free[ai, aj]
        push[ai[ss], aj[ss]] = True
        colpush = np.zeros((m, Pm), dtype=bool)
        kk = in2 & free[ai, aj]
        colpush[ai[kk], aj[kk]] = True
        bneg = np.zeros(m * Pm, dtype=bool)
        bb = still_body & free_flat[ai * Pm + aj]
        lin = ai * Pm + aj
        bneg[lin[bb]] = True
        # sneg (shirt, far-field, small): keep round-start state.
    return cur, n_shell, n_col, pushed


def solve_side(pts_all, idx, shell, sides_nm, sides, body_sample,
               shirt_sample, iters):
    """Relax moved strands of one side. Returns new positions + stats."""
    sub = pts_all[idx].astype(np.float64)  # (m,32,3)
    m, Pm, _ = sub.shape
    orig = sub.copy()
    seg = np.linalg.norm(np.diff(orig, axis=1), axis=2)  # rest lengths
    bend = np.linalg.norm(orig[:, 2:, :] - orig[:, :-2, :],
                          axis=2)  # rest 2nd-neighbour
    arc = np.zeros((m, Pm))
    arc[:, 1:] = np.cumsum(seg, axis=1)
    pinned = arc <= PIN_ARC_MM / 1000.0
    pinned[:, 0] = True
    free = ~pinned
    s = sides[sides_nm]
    over = SHELL_OVER_MM / 1000.0
    # NOTE: sdf_sampler returns MILLIMETRES (grid units); thresholds and
    # steps below are mm, converted to metres on application.
    body_need_mm = BODY_MARGIN_MM + 0.2
    shirt_need_mm = SHIRT_CLEAR_MM + 0.2
    free_flat = free.reshape(-1)
    cur = sub.copy()
    viol_hist = []
    # held: samples pushed by contacts are treated as infinitely massive
    # during distance/bending passes, so the chain settles around them
    # instead of dragging them back inside (limit cycle for shallow
    # penetrations: bending rest is the penetrating pre-collide shape).
    # Sticky: a pushed sample stays held STICKY rounds after its last
    # push, so the chain fully conforms before release. Refreshed below.
    STICKY = 4
    held_n = np.zeros((m, Pm), dtype=np.int32)
    for it in range(iters):
        held = held_n > 0
        wfree = free & ~held
        # --- segment lengths (PBD, stiffness 1) ---
        for a in range(Pm - 1):
            pa = cur[:, a, :]
            pb = cur[:, a + 1, :]
            vec = pb - pa
            d = np.linalg.norm(vec, axis=1)
            ok = d > 1e-12
            wa = (wfree[:, a]).astype(float)
            wb = (wfree[:, a + 1]).astype(float)
            W = wa + wb
            use = ok & (W > 0)
            corr = np.zeros_like(vec)
            corr[use] = ((d[use] - seg[use, a]) / d[use])[:, None] \
                * vec[use]
            cur[:, a, :][use] += (wa[use] / W[use])[:, None] \
                * corr[use]
            cur[:, a + 1, :][use] -= (wb[use] / W[use])[:, None] \
                * corr[use]
        # --- bending: 2nd-neighbour distance (stiffness BEND_STIFF) ---
        for a in range(Pm - 2):
            pa = cur[:, a, :]
            pc = cur[:, a + 2, :]
            vec = pc - pa
            d = np.linalg.norm(vec, axis=1)
            ok = d > 1e-12
            wa = (wfree[:, a]).astype(float)
            wc = (wfree[:, a + 2]).astype(float)
            W = wa + wc
            use = ok & (W > 0)
            corr = np.zeros_like(vec)
            corr[use] = BEND_STIFF * ((d[use] - bend[use, a])
                                     / d[use])[:, None] * vec[use]
            cur[:, a, :][use] += (wa[use] / W[use])[:, None] \
                * corr[use]
            cur[:, a + 2, :][use] -= (wc[use] / W[use])[:, None] \
                * corr[use]
        # --- joint contacts (inner loop over the active set) ---
        cur, n_shell, n_col, pushed_now = resolve_contacts(
            cur, free, free_flat, shell, s, sides_nm, sides,
            body_sample, shirt_sample, over, body_need_mm,
            shirt_need_mm)
        nviol = int(n_shell + n_col)
        viol_hist.append(nviol)
        # sticky refresh: pushed samples get STICKY rounds; others decay
        held_n = np.maximum(held_n - 1, 0)
        held_n[pushed_now] = STICKY
    newlen = np.linalg.norm(np.diff(cur, axis=1), axis=2).sum(axis=1)
    oldlen = seg.sum(axis=1)
    newbend = np.linalg.norm(cur[:, 2:, :] - cur[:, :-2, :], axis=2)
    stats = {"nMoved": int(m),
             "iters": int(iters),
             "violHist": [int(v) for v in viol_hist],
             "lenDeltaMm": {"max": round(float(np.abs(newlen - oldlen)
                                               .max() * 1000.0), 4),
                            "mean": round(float(np.abs(newlen - oldlen)
                                                .mean() * 1000.0), 4)},
             "bendDeltaMm": {"max": round(float(np.abs(newbend - bend)
                                                .max() * 1000.0), 4),
                             "mean": round(float(np.abs(newbend - bend)
                                                 .mean() * 1000.0), 4)}}
    return cur, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--iters", type=int, default=30)
    args = ap.parse_args()
    assert 20 <= args.iters <= 50, "brief: 20-50 iterations"
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    D = np.load(args.inp, allow_pickle=True)
    pts = np.ascontiguousarray(np.asarray(D["points"], dtype=np.float64))
    n, Pm, _ = pts.shape
    print("loaded", args.inp, pts.shape, flush=True)

    P = np.load(str(PROXY))
    sides = G.mirrored_sides()
    shells = {}
    for nm in ("xpos", "xneg"):
        shells[nm] = ShellCollider(np.asarray(P[nm + "_shell_v"],
                                              dtype=np.float64),
                                   np.asarray(P[nm + "_shell_f"]))
    body_sample, _ = sdf_sampler(np.load(str(BODY_SDF),
                                         allow_pickle=True))
    shirt_sample, _ = sdf_sampler(np.load(str(SHIRT_SDF),
                                          allow_pickle=True))

    # --- move set (both sides) ---
    move = {}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        hit = shell_hits(pts,
                         np.asarray(P[nm + "_shell_v"], dtype=np.float64),
                         np.asarray(P[nm + "_shell_f"]))
        hs = hit.any(axis=1)
        col = column_mask(pts, sides, nm)
        move[nm] = hs | col
        print("moveset %s: shellStrands=%d columnStrands=%d union=%d"
              % (nm, int(hs.sum()), int(col.sum()),
                 int(move[nm].sum())), flush=True)
    # pinned-sample-in-shell audit (unfixable by construction)
    arc0 = np.zeros((n, Pm))
    arc0[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1),
                                            axis=2), axis=1)
    pinned_all = (arc0 <= PIN_ARC_MM / 1000.0)
    pin_audit = {}
    for nm in ("xpos", "xneg"):
        pin_in = shells[nm].inside(pts[pinned_all].reshape(-1, 3))
        pin_audit[nm] = int(pin_in.sum())
        print("pinned-samples-inside-shell %s: %d"
              % (nm, pin_audit[nm]), flush=True)
    roots_in = {}
    for nm in ("xpos", "xneg"):
        roots_in[nm] = int(shells[nm].inside(pts[:, 0, :]).sum())
        print("roots-inside-shell %s: %d" % (nm, roots_in[nm]),
              flush=True)

    new = pts.copy()
    stats = {"pinArcMm": PIN_ARC_MM, "iters": args.iters,
             "pinnedSamplesInShell": pin_audit,
             "rootsInShell": roots_in, "perSide": {}}
    for nm in ("xpos", "xneg"):
        idx = np.nonzero(move[nm])[0]
        if not len(idx):
            stats["perSide"][nm] = {"nMoved": 0}
            continue
        cur, st = solve_side(pts, idx, shells[nm], nm, sides,
                             body_sample, shirt_sample, args.iters)
        new[idx] = cur
        # post-hoc shell/column counts on the moved subset
        hit = shell_hits(new[idx],
                         np.asarray(P[nm + "_shell_v"], dtype=np.float64),
                         np.asarray(P[nm + "_shell_f"]))
        col = column_mask(new, sides, nm)[idx]
        st["shellSegsAfter"] = int(hit.sum())
        st["shellStrandsAfter"] = int(hit.any(axis=1).sum())
        st["columnStrandsAfter"] = int(col.sum())
        stats["perSide"][nm] = st
        print("side %s: moved=%d lenMax=%.4fmm bendMax=%.4fmm "
              "shellSegsAfter=%d colAfter=%d viol=%s"
              % (nm, st["nMoved"], st["lenDeltaMm"]["max"],
                 st["bendDeltaMm"]["max"], st["shellSegsAfter"],
                 st["columnStrandsAfter"], st["violHist"]),
              flush=True)

    # --- byte-identical proof for unmoved + pinned samples ---
    moved_any = move["xpos"] | move["xneg"]
    unmoved = ~moved_any
    maxdiff_unmoved = float(np.abs(new[unmoved] - pts[unmoved]).max())
    # pinned samples of moved strands must also be unchanged
    arc_m = np.zeros((moved_any.sum(), Pm))
    dmm = np.linalg.norm(np.diff(pts[moved_any], axis=1), axis=2)
    arc_m[:, 1:] = np.cumsum(dmm, axis=1)
    pin_m = arc_m <= PIN_ARC_MM / 1000.0
    md = np.abs(new[moved_any] - pts[moved_any])
    maxdiff_pinned = float(md[pin_m].max()) if pin_m.any() else 0.0
    stats["byteIdentical"] = {"nUnmoved": int(unmoved.sum()),
                              "maxAbsDiffUnmoved": maxdiff_unmoved,
                              "maxAbsDiffPinned": maxdiff_pinned}
    print("byte-identical: unmoved=%d maxdiff=%.2e pinnedMaxDiff=%.2e"
          % (int(unmoved.sum()), maxdiff_unmoved, maxdiff_pinned),
          flush=True)

    out = {"points": new.astype(np.float32)}
    for k in D.files:
        if k == "points":
            continue
        out[k] = np.asarray(D[k])
    np.savez_compressed(str(outdir / "strands.npz"), **out)
    sha = sha256(str(outdir / "strands.npz"))[:16]
    build = {"inputs": {"base": str(args.inp),
                        "baseSha256": sha256(args.inp)[:16],
                        "proxy": str(PROXY),
                        "bodySdf": str(BODY_SDF),
                        "shirtSdf": str(SHIRT_SDF)},
             "counts": {"children": int(n), "pointsPer": int(Pm)},
             "sha256": sha,
             "collide": stats}
    (outdir / "build.json").write_text(json.dumps(build, indent=1)
                                       + "\n")
    print("WROTE", outdir / "strands.npz", "sha", sha, flush=True)


if __name__ == "__main__":
    main()
