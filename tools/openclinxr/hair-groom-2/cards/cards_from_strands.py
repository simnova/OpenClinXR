"""Hair cards clustered from the groom's evaluated child strands (Blender 5.2 headless).

    Blender --background --factory-startup --python cards_from_strands.py -- \
        --body <actor.glb> --groom-round <dir> --out <cards.npz> --budget <n> [--stations 32]

Replaces v1 cards.py (guide pairing) for this lane. cards-r1 built cards from the 700 guides: card
roots sat on guide roots up to one Poisson radius from the part (wide notched part), card length was
the untrimmed guide length (A3: card tip median 1.094 m vs strand 1.188 m), and the width vector came
from the horizontal radial, which is parallel to the strand tangent on the crown (twist 65.9 deg,
crown card ends standing off the scalp). Here every card is a cluster of the groom's own child
strands (strands.npz, after Trim and the clearance push):

  1. clusters: k-means per side of the part (children carry the groom's side: local x sign), K per
     side = budget x side share; features = head-local root plus the points 30, 80 and 200 mm along
     the strand (mm, one weight), so strands that leave the same root patch in different directions
     land on different cards. Init = farthest-point sampling from the lowest strand index; fixed
     iteration count; an emptied cluster keeps its previous centre.
  2. card length = 98th percentile of the member arc lengths (the trimmed strands): the atlas tile is
     groomed with the same Trim randomOffset, so its alpha ends the strands between (1 - offset) and
     1 x the card length, the members' own spread (s1 at the median: side silhouette bottom +26.9 mm,
     A3 FAIL, because the tile trim shortened an already-median card). Centreline station j = mean of
     the members that reach arc length j/(S-1) x that length, taken at that arc length. Averaging at
     equal arc FRACTIONS mixed points 20 % apart along the fall and cut the shoulder bend (s1 probe:
     699 vertices up to 21.5 mm inside the posed upper back).
  3. frame: outward O = 3D radial from the head centre (groom head_frame), blended toward the
     nearest body/garment face normal within 30 mm; W = O x T, smoothed along the card. The card
     lies tangent to the scalp on the crown and to the back/shirt where it rests on them.
  3b. root end: station 0 moves back along the first tangent to the 2nd percentile of the member
     roots, so card roots reach the part edge instead of stopping at the cluster's mean root.
     The member roots' extent along the tangent (p2..p98) is kept per card (card_root_depth_mm):
     atlas_bake.py spreads the tile's roots over it so the root end is staggered, not a cut line.
  4. width per station = p2..p98 span of the member offsets along W (card edges asymmetric about
     the centreline), smoothed along the card; floor = 2 strand root diameters.
  5. clearance: every vertex pushed to >= recipe clearanceMm off the POSED body (the body the groom
     used), then off the garments as open cloth (groom.push_out); each push's count / max recorded.
  6. UV u across, v root->tip; atlas cell = card index % 4.
  4b. layers: a cluster whose member depth spread (p10..p90 along the card normal, median over
     stations) is above the median over clusters gets a second, outer card: cards at the member depth
     median and 90th percentile along the outward card normal, root station kept on the root line (the 25/75 % split
     put the inner card against the body: body push 4.6 mm vs the 2.2 mm V4(b) gate). One card at the member mean
     collapsed the hanging volume: s2 side silhouette bottom 1.197 m vs strands 1.192 m (A3 +26.3 mm)
     with the cards visibly thinner than the strands behind the back. Two layers on every cluster at
     450 clusters lost E1 (above-ear root density L 0.23): the clusters are kept at 800 (s2, E1 pass)
     and the second layer goes where the depth is.
Writes cards.npz in the v1 schema (card_verts, card_tris, card_uv, vert_card, card_layer,
card_width_mm, card_cell, card_rand, card_root, n_cards, budget, push_*) plus card_local (S,3 per
card head-local centreline) and cluster records.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import bpy  # noqa: F401
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "groom"))
import groom  # noqa: E402

FEATURE_ARC_MM = (30.0, 80.0, 200.0)   # points along each strand used as cluster features
KMEANS_ITERS = 25
W_SMOOTH_PASSES = 4
WIDTH_PCT = (2.0, 98.0)
WIDTH_SMOOTH = 5                         # stations in the moving average of the width
PUSH_PASSES = 3
SURFACE_BLEND_M = 0.030                  # card normal follows the nearest body/garment face within this
GOLD = 0.6180339887498949
LENGTH_PCT = 98.0                        # card length = this percentile of member lengths (see 2.)
MIN_REACH = 3
EDGE_HALVINGS = 4
LAYER_Q = (50.0, 90.0)                   # card depth quantiles of the members (inner, outer)
ROOT_PCT = 2.0                           # card root end = this percentile of member roots along the tangent


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--body", required=True)
    p.add_argument("--groom-round", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--budget", type=int, required=True)
    p.add_argument("--stations", type=int, default=24)
    p.add_argument("--clusters", type=int, default=800)
    p.add_argument("--atlas-px", type=int, default=2048, help="atlas edge (px); one unique cell per card")
    p.add_argument("--cell-w", type=int, default=16, help="atlas cell width (px, across the card)")
    p.add_argument("--members-out", default=None,
                   help="card-members.npz: each card's member strands in its own frame (atlas_from_members.py)")
    p.add_argument("--cyl-band-mm", type=float, default=0.0,
                   help="cards-r4: card outward blends from the head radial to the horizontal radial over this "
                        "band below the head centre (0 = spherical radial, cards-r3)")
    p.add_argument("--surface-blend-mm", type=float, default=SURFACE_BLEND_M * 1000.0,
                   help="card normal follows the nearest body/garment face within this distance (mm)")
    p.add_argument("--push-smooth", type=int, default=0,
                   help="cards-r4: garment push applied per station to both card edges (larger of the two) and "
                        "averaged over this many stations, then re-pushed; 0 = per-vertex push (cards-r3). "
                        "Per-vertex pushes of one edge folded the cards over the collar back (D3 shelf)")
    p.add_argument("--layers", type=int, default=2, choices=(1, 2),
                   help="cards per cluster, at the member depth quantiles LAYER_Q along the card normal")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def arc(P):
    """P (N,K,3) -> cumulative arc length (N,K)."""
    seg = np.linalg.norm(np.diff(P, axis=1), axis=2)
    return np.concatenate([np.zeros((len(P), 1)), np.cumsum(seg, 1)], 1)


def sample_at(P, s, targets):
    """Positions at arc lengths `targets` (N,T) along each strand (clamped to the tip)."""
    N, K, _ = P.shape
    t = np.minimum(targets, s[:, -1:])
    out = np.empty(targets.shape + (3,))
    for j in range(targets.shape[1]):
        i = np.clip((s < t[:, j:j + 1]).sum(1), 1, K - 1)
        s0, s1 = s[np.arange(N), i - 1], s[np.arange(N), i]
        f = ((t[:, j] - s0) / np.maximum(s1 - s0, 1e-12))[:, None]
        out[:, j] = P[np.arange(N), i - 1] * (1 - f) + P[np.arange(N), i] * f
    return out


def kmeans(X, K):
    n = len(X)
    # farthest-point init from strand 0
    cen = [0]
    d = ((X - X[0]) ** 2).sum(1)
    for _ in range(K - 1):
        j = int(np.argmax(d))
        cen.append(j)
        d = np.minimum(d, ((X - X[j]) ** 2).sum(1))
    C = X[cen].copy()
    xx = (X ** 2).sum(1)[:, None]
    lab = np.zeros(n, np.int64)
    for _ in range(KMEANS_ITERS):
        D = xx + (C ** 2).sum(1)[None] - 2.0 * X @ C.T
        lab = np.argmin(D, 1)
        for k in range(K):
            m = lab == k
            if m.any():
                C[k] = X[m].mean(0)
    return lab


def outward(C, centre, colliders, cyl_band_m=0.0, blend_m=SURFACE_BLEND_M):
    """Card normal field: head radial from the head centre, blended toward the nearest collider
    face normal (body, garments) by w = 1 - d / SURFACE_BLEND_M, so a card lying on the upper back
    or shirt is tangent to that surface instead of to a sphere around the head."""
    O = C - centre[None]
    O /= np.linalg.norm(O, axis=1, keepdims=True).clip(1e-12, None)
    if cyl_band_m > 0.0:
        # cards-r4: below the head centre the spherical radial turns parallel to a hanging strand
        # (down-back at the nape), so W = O x T flips there (s1: 1,114 station steps > 20 deg twist at
        # z 1.40-1.45 on the back, the D3 shelf crumples). Blend to the horizontal (cylindrical)
        # radial over cyl_band_m below the centre: a hanging card then faces straight out.
        Oc = C - centre[None]
        Oc[:, 2] = 0.0
        Oc /= np.linalg.norm(Oc, axis=1, keepdims=True).clip(1e-12, None)
        t = np.clip((centre[2] - C[:, 2]) / cyl_band_m, 0.0, 1.0)[:, None]
        O = (1.0 - t) * O + t * Oc
        O /= np.linalg.norm(O, axis=1, keepdims=True).clip(1e-12, None)
    for i in range(len(C)):
        best = None
        for c in colliders:
            loc, nrm, _, dist = c.tree.find_nearest(Vector(C[i]))
            if loc is not None and (best is None or dist < best[0]):
                best = (dist, np.array(nrm[:]))
        if best is None or best[0] >= blend_m:
            continue
        nr = best[1] if np.dot(best[1], O[i]) >= 0 else -best[1]
        w = 1.0 - best[0] / blend_m
        o = (1.0 - w) * O[i] + w * nr
        O[i] = o / max(np.linalg.norm(o), 1e-12)
    return O


def frames(C, O):
    S = len(C)
    T = np.empty_like(C)
    T[1:-1] = C[2:] - C[:-2]
    T[0], T[-1] = C[1] - C[0], C[-1] - C[-2]
    T /= np.linalg.norm(T, axis=1, keepdims=True).clip(1e-12, None)
    W = np.cross(O, T)
    n = np.linalg.norm(W, axis=1)
    good = n > 1e-3
    if not good.any():
        W[:] = np.cross([0.0, 0.0, 1.0], T[0])
        n = np.linalg.norm(W, axis=1)
        good = n > 1e-6
    W[good] /= n[good, None]
    gi = np.where(good)[0]
    for i in range(S):   # degenerate stations take the nearest good one
        if not good[i]:
            W[i] = W[gi[np.argmin(np.abs(gi - i))]]
    for i in range(1, S):  # sign continuity
        if np.dot(W[i], W[i - 1]) < 0:
            W[i] = -W[i]
    for _ in range(W_SMOOTH_PASSES):
        Wn = W.copy()
        Wn[1:-1] = 0.25 * W[:-2] + 0.5 * W[1:-1] + 0.25 * W[2:]
        W = Wn
    W -= T * (W * T).sum(1, keepdims=True)
    W /= np.linalg.norm(W, axis=1, keepdims=True).clip(1e-12, None)
    dots = np.abs((W[:-1] * W[1:]).sum(1)).clip(0, 1)
    return T, W, float(np.degrees(np.arccos(dots)).max())


def atlas_layout(n, A, cw):
    """Unique atlas cell per card: columns of width cw px, rows of equal height filling the atlas."""
    cols = A // cw
    rows = -(-n // cols)
    ch = A // rows
    c = np.arange(n)
    return np.stack([(c % cols) * cw, (c // cols) * ch, np.full(n, cw), np.full(n, ch)], 1).astype(np.int64)


def project_members(P, s, off, Lc, Cl, W, N, le, he):
    """Member strand points (M,K,3 world; s their arc lengths) in the card's own frame.
    Station j of the card holds the members at arc j/(S-1) x Lc (step 2), so a point at arc s sits at
    fractional station s/seg; on the first segment, which runs from the moved root end Cl[0] to Cl[1],
    the member's own root offset along the card (off, from step 3b) is interpolated out by station 1.
    Returns u (0..1 between the card edges le..he), v (0..1 root..tip = card_uv v; > 1 past the card
    tip), depth (m along the card normal N from the card plane)."""
    S = len(Cl)
    seg = Lc / (S - 1)
    seg0 = max(float(np.linalg.norm(Cl[1] - Cl[0])), 1e-9)
    o = np.clip(off, 0.0, seg0)[:, None]
    f = np.where(s < seg, (o + (s / seg) * (seg0 - o)) / seg0, s / seg)
    fc = np.clip(f, 0.0, S - 1)
    j0 = np.minimum(np.floor(fc).astype(np.int64), S - 2)
    t = (fc - j0)[..., None]

    def at(X):
        X = X if X.ndim == 2 else X[:, None]
        r = X[j0] * (1 - t) + X[j0 + 1] * t
        return r if r.shape[-1] > 1 else r[..., 0]
    d = P - at(Cl)
    uo = (d * at(W)).sum(-1)
    lo, hi = at(le), at(he)
    return (uo - lo) / np.maximum(hi - lo, 1e-9), f / (S - 1), (d * at(N)).sum(-1)


def smooth1d(x, k):
    pad = k // 2
    xp = np.concatenate([np.full(pad, x[0]), x, np.full(pad, x[-1])])
    return np.convolve(xp, np.ones(k) / k, mode="valid")


def main():
    a = cli()
    t0 = time.time()
    gr = Path(a.groom_round)
    rc = json.loads((gr / "recipe.json").read_text())
    d = np.load(gr / "strands.npz")
    off = d["offsets"]
    sizes = np.diff(off)
    if len(np.unique(sizes)) != 1:
        raise RuntimeError("strands.npz: variable point counts not handled")
    K0 = int(sizes[0])
    Pw = d["positions"].astype(np.float64).reshape(-1, K0, 3)
    Pl = d["localPositions"].astype(np.float64).reshape(-1, K0, 3) * 1000.0  # mm
    n = len(Pw)

    body, garments, rig, hidden = groom.load_body(Path(a.body))
    bbm = groom.world_bmesh(body)
    origin, R, centre, _ = groom.head_frame(rig, bbm)
    bbm.free()
    R = np.array(R)
    origin = np.array(origin)
    centre_w = origin + R.T @ centre   # head centre, world
    # strands.npz local frame must be this head frame (same body, same code)
    chk = (R @ (Pw[:, 0] - origin).T).T * 1000.0
    if np.abs(chk - Pl[:, 0]).max() > 0.1:
        raise RuntimeError("head frame mismatch vs strands.npz localPositions")

    # 1. features + per-side k-means
    sl = arc(Pl)
    feat = np.concatenate([Pl[:, 0]] + [sample_at(Pl, sl, np.full((n, 1), m))[:, 0]
                                        for m in FEATURE_ARC_MM], 1)
    side = np.where(Pl[:, 0, 0] >= 0.0, 1, -1)
    labels = np.full(n, -1, np.int64)
    K_total = a.clusters
    base = 0
    side_k = {}
    for sgn in (1, -1):
        idx = np.where(side == sgn)[0]
        k = int(round(K_total * len(idx) / n))
        side_k[sgn] = k
        lab = kmeans(feat[idx], k)
        labels[idx] = lab + base
        base += k
    print("KMEANS_DONE", side_k, round(time.time() - t0, 1), flush=True)

    # 2-4. cards
    S = a.stations
    body_only = groom.Collider([body])
    colliders = [body_only] + ([groom.Collider(garments, open_cloth=True)] if garments else [])
    hold = float(rc["clearanceMm"]) / 1000.0
    seat = []
    sw = arc(Pw)
    frac = np.linspace(0.0, 1.0, S)
    floor = 4.0 * rc["strand"]["rootRadiusMm"] / 1000.0
    V, UV, VC, F = [], [], [], []
    card_width, card_root, card_local, members_n, twist_max = [], [], [], [], 0.0
    root_depth = []
    cut = []
    shrunk = [0]
    card_layer, card_rd, depth_spread = [], [], []
    clus = []
    order = np.unique(labels[labels >= 0])
    lens = sw[:, -1]
    for cid, k in enumerate(order):
        m = np.where(labels == k)[0]
        lm = np.sort(lens[m])
        # every station is a mean of >= MIN_REACH members (a lone member's tip hung onto the arm)
        Lc = min(float(np.percentile(lm, LENGTH_PCT)), float(lm[max(len(lm) - MIN_REACH, 0)]))
        for _ in range(2):
            Pm = sample_at(Pw[m], sw[m], np.broadcast_to(Lc * frac[None], (len(m), S)))
            reach = lens[m][:, None] >= (Lc * frac[None] - 1e-9)     # (members, S)
            reach[:, 0] = True
            wgt = reach / reach.sum(0, keepdims=True)
            C = (Pm * wgt[:, :, None]).sum(0)
            # a flat card cannot wrap a convex body part: the card ends before the first station
            # whose member mean lies inside the body (s3 probe: a tip mean 5 mm inside the posed arm)
            inside = [j for j in range(1, S) if body_only.signed(Vector(C[j]))[0] < 0.0]
            if not inside:
                break
            cut.append(Lc * (1.0 - frac[inside[0] - 1]))
            Lc = Lc * frac[inside[0] - 1]
        # root end at the member root nearest the part side: station 0 moves back along the first
        # tangent to the ROOT_PCT percentile of the member roots (the mean root sat half a cluster
        # away from the part and left a notched band between the two sides' cards)
        tg = C[1] - C[0]
        tg /= max(np.linalg.norm(tg), 1e-12)
        tr = (Pm[:, 0] - C[0]) @ tg
        ext = float(np.percentile(tr, ROOT_PCT))
        root_depth.append(float(np.percentile(tr, 100.0 - ROOT_PCT)) - ext)
        if ext < 0.0:
            C[0] = C[0] + ext * tg
            # the tangent line leaves the curved scalp: seat the moved root end on the scalp at the
            # strand clearance, as the groom seats its roots (construction, not the V4(b) push)
            sd_r, loc_r, nrm_r = body_only.signed(Vector(C[0]))
            if loc_r is not None and sd_r < hold:
                seat.append(hold - sd_r)
                C[0] = np.array((loc_r + nrm_r * hold)[:])
            Pm[:, 0] = Pm[:, 0] - np.outer((Pm[:, 0] - C[0]) @ tg, tg)   # member roots on that line
        T, W, tw = frames(C, outward(C, centre_w, colliders, a.cyl_band_mm / 1000.0,
                                       a.surface_blend_mm / 1000.0))
        twist_max = max(twist_max, tw)
        offs = np.where(reach, ((Pm - C[None]) * W[None]).sum(2), np.nan)   # (members, S)
        lo = smooth1d(np.nanpercentile(offs, WIDTH_PCT[0], axis=0), WIDTH_SMOOTH)
        hi = smooth1d(np.nanpercentile(offs, WIDTH_PCT[1], axis=0), WIDTH_SMOOTH)
        short = (hi - lo) < floor
        mid = 0.5 * (hi + lo)
        lo[short], hi[short] = mid[short] - floor / 2, mid[short] + floor / 2
        N = np.cross(T, W)
        N *= np.where((N * (C - centre_w[None])).sum(1, keepdims=True) < 0, -1.0, 1.0)  # outward
        dep = np.where(reach, ((Pm - C[None]) * N[None]).sum(2), np.nan)   # member depth offsets
        spread = float(np.nanmedian(np.nanpercentile(dep, 90, axis=0) - np.nanpercentile(dep, 10, axis=0)))
        clus.append((C, W, N, lo, hi, dep, len(m), root_depth[-1], spread, m, tr - min(ext, 0.0), Lc))
    # outer layer only where the members fill depth: spread above the median over clusters
    spread_cut = float(np.median([c[8] for c in clus]))
    mem_u, mem_v, mem_d, mem_card, card_wm, card_arc, card_nmem = [], [], [], [], [], [], []
    for (C, W, N, lo, hi, dep, nm, rdep, spread, m, roff, Lc) in clus:
        nl = 2 if (a.layers == 2 and spread > spread_cut) else 1
        # members split between the layer cards by their mean depth: the outer card (member depth p90)
        # stands for the members past the midpoint of the two card planes, the inner card for the rest
        mdep = np.nanmean(dep, 1)
        dqs = [smooth1d(np.nan_to_num(np.nanpercentile(dep, LAYER_Q[li], axis=0)), WIDTH_SMOOTH) for li in range(nl)]
        if nl == 2:
            thr = 0.5 * (float(np.median(np.maximum(dqs[0], 0.0))) + float(np.median(dqs[1])))
            mem_sets = [mdep <= thr, mdep > thr]
        else:
            mem_sets = [np.ones(len(m), bool)]
        for li in range(nl):
            q = LAYER_Q[li]
            dq = smooth1d(np.nan_to_num(np.nanpercentile(dep, q, axis=0)), WIDTH_SMOOTH)
            dq = np.maximum(dq, 0.0)      # never inward of the member mean (body side; s3 probe 4.6 mm push)
            dq[0] = 0.0                                   # roots stay on the seated root line
            Cl = C + dq[:, None] * N
            le, he = lo.copy(), hi.copy()
            for j in range(1, S):
                # an edge that would enter the body (a wide card across a convex arm or shoulder)
                # is pulled toward the centreline, halving up to EDGE_HALVINGS times
                for e in (le, he):
                    for _ in range(EDGE_HALVINGS):
                        if body_only.signed(Vector(Cl[j] + e[j] * W[j]))[0] >= 0.0:
                            break
                        e[j] *= 0.5
                        shrunk[0] += 1
            verts = np.empty((2 * S, 3))
            verts[0::2] = Cl + le[:, None] * W
            verts[1::2] = Cl + he[:, None] * W
            uv = np.empty((2 * S, 2))
            uv[0::2, 0], uv[1::2, 0] = 0.0, 1.0
            uv[:, 1] = np.repeat(frac, 2)
            ci = len(card_layer)
            vo = 2 * S * ci
            for i in range(S - 1):
                a0, b0, c0, d0 = vo + 2 * i, vo + 2 * i + 1, vo + 2 * i + 2, vo + 2 * i + 3
                F.append((a0, c0, b0))
                F.append((b0, c0, d0))
            V.append(verts)
            UV.append(uv)
            VC.append(np.full(2 * S, ci, np.int64))
            card_layer.append(li)
            card_width.append(float(hi[0] - lo[0]) * 1000.0)
            card_root.append(Cl[0])
            members_n.append(nm)
            card_rd.append(rdep)
            depth_spread.append(spread)
            if a.members_out:
                sel = m[mem_sets[li]]
                u, v, dd = project_members(Pw[sel], sw[sel], roff[mem_sets[li]], Lc, Cl, W, N, le, he)
                mem_u.append(u.astype(np.float32))
                mem_v.append(v.astype(np.float32))
                mem_d.append(dd.astype(np.float32))
                mem_card.append(np.full(len(sel), ci, np.int64))
                card_nmem.append(len(sel))
                card_wm.append(float(np.median(he - le)))
                card_arc.append(float(np.linalg.norm(np.diff(Cl, axis=0), axis=1).sum()))
    verts = np.vstack(V)
    nc = len(card_layer)
    lo_b, hi_b = 0.5 * a.budget, 1.5 * a.budget
    if not (lo_b <= nc <= hi_b):
        raise RuntimeError("card count %d outside [0.5, 1.5] x budget %d" % (nc, a.budget))

    # 5. clearance: garments as open cloth first, then the body (V4(b) measures this push), so the
    # body clearance is the last word (s1 probe: body-then-garment left 9 collar-back vertices inside)
    clr = float(rc["clearanceMm"]) / 1000.0
    before = verts.copy()
    pushes = []
    for ci_, cs in enumerate((colliders[1:], colliders[:1])):
        b0 = verts.copy()
        if ci_ == 0 and a.push_smooth > 0:
            # one rigid push per station: the pushed displacement of the two edges, the larger one for
            # both, averaged along the card; the per-vertex pass below then only tops up the remainder
            q0 = verts.copy()
            for i in range(len(verts)):
                q = groom.push_out(Vector(verts[i]), cs, clr)
                q0[i] = q[:]
            d = (q0 - verts).reshape(nc, -1, 2, 3)
            nrm = np.linalg.norm(d, axis=3)
            pick = np.where((nrm[..., 0] >= nrm[..., 1])[..., None], d[..., 0, :], d[..., 1, :])
            k = a.push_smooth
            sm = np.stack([np.stack([smooth1d(pick[c, :, j], k) for j in range(3)], 1) for c in range(nc)])
            sm = np.where((np.linalg.norm(sm, axis=2) < np.linalg.norm(pick, axis=2))[..., None], pick, sm)
            verts = verts + np.repeat(sm, 2, axis=1).reshape(-1, 3)
        for _ in range(PUSH_PASSES):
            moved = 0
            for i in range(len(verts)):
                p = Vector(verts[i])
                q = groom.push_out(p, cs, clr)
                if (q - p).length > 0.0:
                    verts[i] = q[:]
                    moved += 1
            if moved == 0:
                break
        pushes.append(np.linalg.norm(verts - b0, axis=1))
    push = np.linalg.norm(verts - before, axis=1)
    sd0 = np.array([body_only.signed(Vector(v))[0] for v in before])
    pl = (R @ (verts[push > 0] - origin).T).T * 1000.0
    big = push > 0.0022
    sd = np.array([body_only.signed(Vector(v))[0] for v in verts])
    cl_w = 0.5 * (verts[0::2] + verts[1::2])                 # centrelines after the push
    cl_local = (R @ (cl_w - origin).T).T
    tips = cl_w.reshape(nc, S, 3)[:, -1, 2]
    stip = Pw[:, -1, 2]
    rec = {
        "tool": "tools/openclinxr/hair-groom-2/cards/cards_from_strands.py",
        "groomRound": str(gr), "strandsSha256": sha(gr / "strands.npz"), "bodySha256": sha(a.body),
        "strands": int(n), "cards": nc, "perSide": {str(k): v for k, v in side_k.items()},
        "stations": S, "triangles": len(F), "vertices": int(len(verts)),
        "membersPerCard": {"min": int(min(members_n)), "median": float(np.median(members_n)),
                           "max": int(max(members_n))},
        "cardWidthMmRoot": {"p10": float(np.percentile(card_width, 10)), "median": float(np.median(card_width)),
                            "p90": float(np.percentile(card_width, 90))},
        "twistMaxDeg": twist_max, "clusters": int(len(order)), "layers": a.layers,
        "outerLayerSpreadCutMm": spread_cut * 1000,
        "memberDepthSpreadP10P90Mm": {"median": float(np.median(depth_spread) * 1000),
                                      "p90": float(np.percentile(depth_spread, 90) * 1000)},
        "rootDepthMm": {"p10": float(np.percentile(root_depth, 10) * 1000), "median": float(np.median(root_depth) * 1000),
                        "p90": float(np.percentile(root_depth, 90) * 1000)},
        "edgeHalvings": shrunk[0],
        "insideCut": {"cards": len(cut), "maxMm": float(max(cut) * 1000) if cut else 0.0},
        "rootSeat": {"cards": len(seat), "maxMm": float(max(seat) * 1000) if seat else 0.0},
        "push": {"holdMm": clr * 1000, "count": int((push > 0).sum()), "maxMm": float(push.max() * 1000),
                 "against": "garments open cloth, then posed body (groom.load_body), groom.push_out",
                 "prePushBodyMinMm": float(sd0.min() * 1000), "prePushBodyBelowHold": int((sd0 < clr).sum()),
                 "p50p99Mm": [float(np.percentile(push[push > 0], q) * 1000) for q in (50, 99)] if (push > 0).any() else [],
                 "over2p2mm": int(big.sum()),
                 "bodyPushCount": int((pushes[1] > 0).sum()), "bodyPushMaxMm": float(pushes[1].max() * 1000),
                 "garmentPushCount": int((pushes[0] > 0).sum()),
                 "garmentPushMaxMm": float(pushes[0].max() * 1000),
                 "over2p2mmBodyBelowHold": int((big & (sd0 < clr)).sum()),
                 "pushedLocalZMm": [float(pl[:, 2].min()), float(pl[:, 2].max())] if len(pl) else []},
        "clearanceBody": {"minSignedMm": float(sd.min() * 1000), "negative": int((sd < 0).sum())},
        "tipZ": {"cardMedian": float(np.median(tips)), "cardP10": float(np.percentile(tips, 10)),
                 "cardP90": float(np.percentile(tips, 90)), "strandMedian": float(np.median(stip)),
                 "strandP10": float(np.percentile(stip, 10)), "strandP90": float(np.percentile(stip, 90))},
    }
    payload = {
        "card_verts": verts, "card_tris": np.array(F, np.int64), "card_uv": np.vstack(UV),
        "vert_card": np.concatenate(VC), "card_layer": np.array(card_layer, np.int64),
        "card_width_mm": np.array(card_width), "card_cell": np.arange(nc, dtype=np.int64) % 4,
        "card_rand": ((np.arange(nc) + 1) * GOLD) % 1.0, "card_root": np.array(card_root),
        "card_local": cl_local.reshape(nc, S, 3), "card_members": np.array(members_n, np.int64),
        "card_root_depth_mm": np.array(card_rd) * 1000.0,
        "n_cards": np.int64(nc), "n_clusters": np.int64(len(order)), "n_guides": np.int64(n),
        "budget": np.int64(a.budget), "push_count": np.int64(int((push > 0).sum())),
        "push_max_mm": np.float64(push.max() * 1000), "min_clearance_mm": np.float64(sd.min() * 1000),
        "garment_prox_min_mm": np.float64(np.nan), "twist_max_deg": np.float64(twist_max),
        "signed_body_m": sd, "prepush_signed_body_m": sd0, "push_m": push, "push_body_m": pushes[1], "push_garment_m": pushes[0],
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cells = atlas_layout(nc, a.atlas_px, a.cell_w)
    luv = np.vstack(UV)
    vcard = np.concatenate(VC)
    cx = cells[vcard]
    # atlas UV (Blender/glTF-flipped v: 1 = image top); a 1 px border of every cell is left to the bake's
    # transparent gutter so bilinear filtering does not read the neighbouring card
    au = (cx[:, 0] + 1 + luv[:, 0] * (cx[:, 2] - 2)) / a.atlas_px
    av = 1.0 - (cx[:, 1] + 1 + luv[:, 1] * (cx[:, 3] - 2)) / a.atlas_px
    payload["card_atlas_uv"] = np.stack([au, av], 1)
    payload["card_atlas_cell_px"] = cells
    payload["atlas_px"] = np.int64(a.atlas_px)
    rec["atlas"] = {"px": a.atlas_px, "cellPx": [int(cells[0, 2]), int(cells[0, 3])], "cells": nc,
                    "rule": "unique cell per card; columns of --cell-w px, rows of equal height; 1 px gutter"}
    np.savez(str(out), **dict(sorted(payload.items())))
    if a.members_out:
        np.savez(a.members_out, u=np.concatenate(mem_u), v=np.concatenate(mem_v), depth_m=np.concatenate(mem_d),
                 card=np.concatenate(mem_card), card_width_m=np.array(card_wm), card_arc_m=np.array(card_arc),
                 card_members=np.array(card_nmem, np.int64))
        rec["membersOut"] = {"path": a.members_out, "sha256": sha(a.members_out), "strands": int(sum(card_nmem)),
                             "perCard": {"min": int(min(card_nmem)), "median": float(np.median(card_nmem)),
                                         "max": int(max(card_nmem))}}
    rec["cardsSha256"] = sha(out)
    rec["seconds"] = time.time() - t0
    (out.parent / "cards-record.json").write_text(json.dumps(rec, indent=1))
    print("CARDS_DONE", json.dumps(rec), flush=True)


main()
