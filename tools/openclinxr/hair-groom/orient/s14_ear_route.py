#!/usr/bin/env python3
"""Groom27 STEP 0: SIDE-guide posterior re-route around the ear (guide-side earlobe fix).

Operator rule: no hair may come out from below the earlobe. Groom26
dropped 65 below-lobe roots (1,300 strands) but 4,996 strands from HIGHER
roots still hang through the ear column below the lobe (side drape), and
the profile-xpos box holds 770 hair px (target 0). Child-side fixes were
tried and reverted in groom26 (tuck-blend doubled the count; positional
sweep made a cheek slab) -- so the fix is GUIDE-side (this stage).

Method (station's existing tuck routing, groom4 tuck.py / earframe rule):
from the point where a side guide's path reaches the ear's top/front,
pass between the back of the pinna and the skull (posterior of the
pinna shell, clear of the skull by SDF projection) and continue down
behind the ear. Concretely per target guide (world metres):
  - keep arc < 40 mm VERBATIM (lock window; byte-identical head-mm bits);
  - splice at max(45 mm arc, ear-vicinity entry, rider-correspondence):
    posterior bypass to the hem: y forced to the tuck corridor
    (earframe yPost + 11 mm) wherever the original path lies anterior
    of it, x/z track the original path (minimal displacement);
  - per-guide corridor target raised by rider translations: riders are
    rigid translations of the backbone (child(f) = root + G(f) - G(0)),
    so a rider with dy = child_root_y - guide_root_y needs the guide
    at corridor - dy: target = yPost + 11 - min(0, min dy) + 6 mm;
  - displacement budget vs guides-8a (the --pool-ref): max sample
    displacement <= 58 mm so rerouted guides STAY in the child pool
    (pool-max-move-mm 60) and riders follow the new shape; target
    reduced (x0.85 steps) while over budget; capped/partial flagged;
  - SDF projection to >= 1.5 mm body clearance + pinna >= 3 mm, then
    re-verify the column test (with margin) on the final path;
  - never delete guides; guides outside the target set are
    byte-identical (head-mm bits copied exactly).

Target set (written to route-report.json with ids/roots/counts):
  TIER1 = guides whose own path enters the ear column below the lobe
  (same 3D test as earlobe_gate.py) AND splice-feasible, PLUS guides
  that dominantly feed (>=10 dominant column strands or wsum >= 25)
  column strands via guide_idx/guide_w.
  SKIP-short = through-guides shorter than the 40 mm verbatim window
  (2138 27 mm + five 1-19 mm below-lobe stubs: reroute impossible).
  SKIP-tail = feeders below the dominance threshold (documented).
  SKIP-riderless = through-guides with zero riders (own-path violation
  only; rerouted only if the back-crossing gate stays green, since they
  move no strands but count in the BACK crossing graph).

Outputs: <outdir>/<stem>.npz (guides-27 schema = guides-26 + route array)
  + <outdir>/<stem>-route.json (report) .
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

S14 = Path(__file__).resolve().parent
sys.path.insert(0, str(S14))
import common_o as CO  # noqa: E402

STRANDS = S14.parent / "strands"
sys.path.insert(0, str(STRANDS))
import frames as F  # noqa: E402
from children import sdf_sampler  # noqa: E402

P_IN = 41
VERBATIM_MM = 40.0
SPLICE_MIN_MM = 45.0
CORRIDOR_UP_MM = 11.0
GUIDE_MARGIN_MM = 12.0
RIDER_MARGIN_MM = 6.0
DISP_BUDGET_MM = 58.0
POOL_CAP_MM = 60.0
SDF_CLEAR_MM = 1.5
SDF_PROJ_TGT_MM = 1.7
PIN_CLEAR_MM = 3.0
SHELL_CLEAR_MM = 1.0
SHELL_ITERS = 40
DOM_N = 10
WSUM_MIN = 25.0


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--guides", required=True)
    p.add_argument("--ref", required=True,
                   help="pool-ref guides (guides-8a.npz)")
    p.add_argument("--roots", required=True)
    p.add_argument("--sdf", required=True)
    p.add_argument("--pinna", required=True)
    p.add_argument("--ear-frame", required=True)
    p.add_argument("--strands", required=True,
                   help="groom26 strands.npz (rider mapping)")
    p.add_argument("--outdir", required=True)
    p.add_argument("--stem", default="guides-27")
    p.add_argument("--dom-n", type=int, default=DOM_N)
    p.add_argument("--wsum-min", type=float, default=WSUM_MIN)
    p.add_argument("--corridor-up-mm", type=float, default=CORRIDOR_UP_MM)
    p.add_argument("--skip-ids", default="",
                    help="comma-separated guide ids to skip (disproportionate)")
    p.add_argument("--ear-shell", default="",
                    help="groom36: inflated ear shell npz (ear-proxy.npz "
                    "schema: <side>_shell_v/_f) used as an obstacle; "
                    "empty = off (legacy behaviour)")
    return p.parse_args()


def smoothstep(t):
    t = np.clip(np.asarray(t, dtype=np.float64), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def main():
    t0 = time.time()
    args = cli()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    for f in (args.guides, args.ref, args.roots, args.sdf,
              args.pinna, args.ear_frame, args.strands):
        CO.track(f)
    CO.track(S14 / "s14_ear_route.py")

    src = np.load(args.guides, allow_pickle=True)
    head_in = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    n, Pin, _ = head_in.shape
    assert Pin == P_IN, (Pin, P_IN)
    curves = F.head_to_world(head_in, crown)
    roots = curves[:, 0].copy()
    tuck = (np.asarray(src["tuck"]) > 0.5) if "tuck" in src \
        else np.zeros(n, dtype=bool)

    ref = np.load(args.ref, allow_pickle=True)
    W8 = F.head_to_world(np.asarray(ref["curves_head"], dtype=np.float64),
                         np.asarray(ref["crown"], dtype=np.float64))
    assert W8.shape == curves.shape, (W8.shape, curves.shape)
    disp8 = np.linalg.norm(curves - W8, axis=2).max(axis=1) * 1000.0

    pin = np.load(args.pinna, allow_pickle=True)
    pxyz = np.asarray(pin["xyz"], dtype=np.float64)
    sides = {}
    for key, sgn, nm in (("idx_earXpos", 1.0, "xpos"),
                         ("idx_earXneg", -1.0, "xneg")):
        pv = pxyz[np.asarray(pin[key])]
        sides[nm] = {"sgn": sgn, "pv": pv,
                     "zmin": float(pv[:, 2].min()),
                     "yfront": float(pv[:, 1].max()),
                     "yback": float(pv[:, 1].min()),
                     "xmin": float(np.abs(pv[:, 0]).min()),
                     "xmax": float(np.abs(pv[:, 0]).max()),
                     "zTop": float(pv[:, 2].max())}
    trees = {nm: cKDTree(s["pv"]) for nm, s in sides.items()}
    earframe = json.loads(Path(args.ear_frame).read_text())
    yPost = {nm: float(earframe["sides"][nm]["yPostMm"]) / 1000.0
             for nm in sides}

    # ---- groom36: inflated ear shell obstacle (default OFF).
    shell = {}
    shell_trees = {}
    if str(args.ear_shell):
        CO.track(args.ear_shell)
        SH = np.load(str(args.ear_shell), allow_pickle=True)
        for nm in sides:
            sv = np.ascontiguousarray(
                np.asarray(SH[nm + "_shell_v"], dtype=np.float64))
            sf = np.ascontiguousarray(
                np.asarray(SH[nm + "_shell_f"], dtype=np.int64))
            shell[nm] = {"v": sv, "f": sf}
            shell_trees[nm] = cKDTree(sv)
        print("EAR-SHELL obstacle %s sides=%s" % (
            args.ear_shell, sorted(shell)), flush=True)

    D = np.load(args.strands, allow_pickle=True)
    pts = np.asarray(D["points"], dtype=np.float64)
    gw = np.asarray(D["guide_w"], dtype=np.float64)
    gi = np.asarray(D["guide_idx"], dtype=np.int64)
    cxyz = np.asarray(D["roots"], dtype=np.float64)
    nstr, P, _ = pts.shape
    assert P == 32, P

    def col_mask(arr, s, sgn):
        # arr (...,3) world metres; earlobe_gate.py test verbatim.
        return ((arr[..., 2] < s["zmin"])
                & (arr[..., 1] >= s["yback"])
                & (arr[..., 1] <= s["yfront"])
                & ((arr[..., 0] * sgn) > 0)
                & (np.abs(arr[..., 0]) >= s["xmin"] - 0.005)
                & (np.abs(arr[..., 0]) <= s["xmax"]))

    # ---- guide column test (41-pt world curves, s>=1 like gate).
    through = {}
    for nm, s in sides.items():
        hit = []
        for j in range(n):
            c = curves[j, 1:]
            if col_mask(c, s, s["sgn"]).any():
                hit.append(j)
        through[nm] = hit
    through_all = sorted(set(through["xpos"]) | set(through["xneg"]))
    print("THROUGH guides xpos=%s xneg=%s" % (
        through["xpos"], through["xneg"]), flush=True)

    # ---- rider mapping: per guide, riders + dominant-column riders.
    col_strand = np.zeros(nstr, dtype=bool)
    for nm, s in sides.items():
        flat = pts[:, 1:, :].reshape(-1, 3)
        sm = col_mask(flat, s, s["sgn"])
        col_strand |= sm.reshape(nstr, P - 1).any(axis=1)
    col_idx = np.nonzero(col_strand)[0]
    print("COLUMN strands total=%d (xpos=%d xneg=%d)" % (
        int(col_strand.sum()),
        int((col_mask(pts[:, 1:, :].reshape(-1, 3),
                      sides["xpos"], 1.0)).reshape(nstr, P - 1).any(
                          axis=1).sum()),
        int((col_mask(pts[:, 1:, :].reshape(-1, 3),
                      sides["xneg"], -1.0)).reshape(nstr, P - 1).any(
                          axis=1).sum())), flush=True)
    rider_n = defaultdict(int)
    for i in range(nstr):
        for g in set(gi[i].tolist()):
            rider_n[g] += 1
    dom_n_thr = int(args.dom_n)
    wsum_thr = float(args.wsum_min)
    corridor_up = float(args.corridor_up_mm)
    skip_ids = set(int(x) for x in str(args.skip_ids).split(",")
                   if x.strip()) if args.skip_ids else set()
    dom_wsum = defaultdict(float)
    dom_n = defaultdict(int)
    dom_dy = defaultdict(list)  # guide -> dy list (dominant col riders)
    for i in col_idx.tolist():
        k = int(np.argmax(gw[i]))
        dom = int(gi[i][k])
        for g, w in zip(gi[i].tolist(), gw[i].tolist()):
            dom_wsum[g] += w
        if float(gw[i][k]) >= 0.5:
            dom_n[dom] += 1
            dom_dy[dom].append(float(cxyz[i][1] - curves[dom, 0, 1]))
    feeders = sorted(g for g in dom_wsum
                     if dom_n[g] >= dom_n_thr or dom_wsum[g] >= wsum_thr)
    print("FEEDERS (nDom>=%d or wsum>=%.0f): %s" % (
        dom_n_thr, wsum_thr, [(g, dom_n[g], round(dom_wsum[g], 1))
                          for g in feeders]), flush=True)

    # ---- arc lengths + vicinity entry.
    seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
    arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seg, axis=1)],
                         axis=1)
    total = arc[:, -1] * 1000.0

    def side_of(j):
        return "xpos" if roots[j, 0] >= 0 else "xneg"

    # rider-correspondence arc: min guide-arc over dominant riders'
    # through-samples (fraction mapping f=s/31 -> arc f*total).
    rider_arc_need = {}
    for g, dys in dom_dy.items():
        fmin = 1.0
        for i in col_idx.tolist():
            k = int(np.argmax(gw[i]))
            if int(gi[i][k]) != g or float(gw[i][k]) < 0.5:
                continue
            nm = side_of(g)
            s = sides[nm]
            m = col_mask(pts[i, 1:], s, s["sgn"])
            ss = np.nonzero(m)[0]
            if len(ss):
                fmin = min(fmin, float((ss.min() + 1) / 31.0))
        rider_arc_need[g] = fmin * float(total[g])

    tier1 = sorted(set(through_all) | set(feeders))
    # ---- groom36 shell target set (only when --ear-shell is given):
    # guides whose own path has segments in either inflated shell, plus
    # guides that dominantly feed shell-hit child strands.
    shell_cross = {"xpos": [], "xneg": []}
    shell_feeders = []
    shell_dom_n = {}
    shell_dom_wsum = {}
    if shell:
        import gates34 as _G  # noqa: E402 (primitive import, no copy)

        def _shell_rows(arr, sv, sf):
            """Row mask: rows with >=1 segment piercing the closed shell
            or with a segment midpoint inside it (gates34 definition)."""
            arr = np.ascontiguousarray(arr, dtype=np.float64)
            sv = np.ascontiguousarray(sv, dtype=np.float64)
            sf = np.ascontiguousarray(sf, dtype=np.int64)
            tris = sv[sf]
            tmin, tmax = tris.min(axis=1), tris.max(axis=1)
            sbmin, sbmax = sv.min(axis=0), sv.max(axis=0)
            out = np.zeros(arr.shape[0], dtype=bool)
            for a in range(0, arr.shape[0], 40000):
                sl = slice(a, min(a + 40000, arr.shape[0]))
                p0 = arr[sl, :-1, :].reshape(-1, 3)
                p1 = arr[sl, 1:, :].reshape(-1, 3)
                smin = np.minimum(p0, p1)
                smax = np.maximum(p0, p1)
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
                    pierced |= _G._mt_intersect(
                        q0, dv, tris[t, 0], tris[t, 1], tris[t, 2])
                rest = np.nonzero(~pierced)[0]
                if len(rest):
                    mid = (q0[rest] + q1[rest]) / 2.0
                    dvx = np.zeros_like(mid)
                    dvx[:, 0] = 1.0
                    dd = np.zeros(len(rest), dtype=np.int32)
                    for t in range(len(tris)):
                        dd += _G._mt_intersect(
                            mid, dvx, tris[t, 0], tris[t, 1],
                            tris[t, 2]).astype(np.int32)
                    pierced[rest] |= (dd % 2) == 1
                full = np.zeros(p0.shape[0], dtype=bool)
                full[ci] = pierced
                out[sl] = full.reshape(arr[sl].shape[0], -1).any(axis=1)
            return out

        for nm in sides:
            shell_cross[nm] = sorted(
                int(j) for j in np.nonzero(
                    _shell_rows(curves, shell[nm]["v"],
                               shell[nm]["f"]))[0].tolist())
        print("SHELL-CROSS guides xpos=%s xneg=%s" % (
            shell_cross["xpos"], shell_cross["xneg"]), flush=True)
        sh_hit = np.zeros(nstr, dtype=bool)
        for nm in sides:
            sh_hit |= _shell_rows(pts, shell[nm]["v"], shell[nm]["f"])
        sh_idx = np.nonzero(sh_hit)[0].tolist()
        print("SHELL strands total=%d" % len(sh_idx), flush=True)
        _sd_n = defaultdict(int)
        _sd_w = defaultdict(float)
        for i in sh_idx:
            k = int(np.argmax(gw[i]))
            dom = int(gi[i][k])
            for g, w in zip(gi[i].tolist(), gw[i].tolist()):
                _sd_w[g] += w
            if float(gw[i][k]) >= 0.5:
                _sd_n[dom] += 1
        shell_dom_n = dict(_sd_n)
        shell_dom_wsum = {g: round(v, 1) for g, v in _sd_w.items()}
        shell_feeders = sorted(g for g in _sd_w
                              if _sd_n[g] >= dom_n_thr
                              or _sd_w[g] >= wsum_thr)
        print("SHELL-FEEDERS (nDom>=%d or wsum>=%.0f): %s" % (
            dom_n_thr, wsum_thr, [(g, _sd_n[g], round(_sd_w[g], 1))
                                  for g in shell_feeders]), flush=True)
        tier1 = sorted(set(tier1) | set(shell_cross["xpos"])
                       | set(shell_cross["xneg"]) | set(shell_feeders))
    report = {"through": {k: v for k, v in through.items()},
              "nColumnStrands": int(col_strand.sum()),
              "feeders": {str(g): {"nDom": dom_n[g],
                                   "wsum": round(dom_wsum[g], 1)}
                          for g in feeders},
              "guides": {}}
    skip_short, skip_tail, skip_riderless = [], [], []
    skip_big = []
    targets = []
    for g in tier1:
        nm = side_of(g)
        s = sides[nm]
        if g in skip_ids:
            skip_big.append(g)
            report["guides"][str(g)] = {
                "decision": "SKIP-disproportionate",
                "reason": "operator skip-list: riders >> residual strands",
                "rootMm": [round(float(v) * 1000.0, 1) for v in roots[g]],
                "side": nm, "nRiders": int(rider_n.get(g, 0)),
                "nDomCol": int(dom_n.get(g, 0))}
            continue
        if total[g] < VERBATIM_MM + 5.0:
            skip_short.append(g)
            report["guides"][str(g)] = {
                "decision": "SKIP-short",
                "reason": "len %.1f mm < verbatim %.0f: whole guide "
                          "is take-off" % (total[g], VERBATIM_MM),
                "rootMm": [round(float(v) * 1000.0, 1) for v in roots[g]],
                "side": nm, "nRiders": int(rider_n.get(g, 0)),
                "nDomCol": int(dom_n.get(g, 0))}
            continue
        if g not in through_all and g not in feeders \
                and g not in shell_cross["xpos"] \
                and g not in shell_cross["xneg"] \
                and g not in shell_feeders:
            skip_tail.append(g)
            continue
        if g in through_all and rider_n.get(g, 0) == 0 \
                and g not in feeders and g not in shell_feeders \
                and g not in shell_cross["xpos"] \
                and g not in shell_cross["xneg"]:
            skip_riderless.append(g)
            report["guides"][str(g)] = {
                "decision": "SKIP-riderless",
                "reason": "own path enters column but zero riders: "
                          "reroute moves no strands (crossing-gated)",
                "rootMm": [round(float(v) * 1000.0, 1) for v in roots[g]],
                "side": nm, "nRiders": 0,
                "nDomCol": int(dom_n.get(g, 0))}
            continue
        c = curves[g]
        vic = ((c[:, 2] < s["zTop"] + 0.015)
               & (c[:, 1] >= s["yback"] - 0.010)
               & (c[:, 1] <= s["yfront"] + 0.010)
               & ((c[:, 0] * s["sgn"]) > 0)
               & (np.abs(c[:, 0]) >= s["xmin"] - 0.025)
               & (np.abs(c[:, 0]) <= s["xmax"] + 0.025))
        ke = int(np.nonzero(vic)[0][0]) if vic.any() else len(c) - 1
        a_entry = float(arc[g, ke]) * 1000.0
        a_rider = float(rider_arc_need.get(g, total[g])) - 15.0
        a_splice = max(SPLICE_MIN_MM, min(a_entry, a_rider))
        if a_splice >= total[g] - 5.0:
            skip_short.append(g)
            report["guides"][str(g)] = {
                "decision": "SKIP-short",
                "reason": "splice arc %.0f >= len %.0f-5" % (
                    a_splice, total[g]),
                "rootMm": [round(float(v) * 1000.0, 1) for v in roots[g]],
                "side": nm, "nRiders": int(rider_n.get(g, 0)),
                "nDomCol": int(dom_n.get(g, 0))}
            continue
        targets.append(g)
        dys = dom_dy.get(g, [])
        report["guides"][str(g)] = {
            "decision": "REROUTE",
            "side": nm,
            "rootMm": [round(float(v) * 1000.0, 1) for v in roots[g]],
            "ownThrough": bool(g in through_all),
            "ownShellCross": bool(
                g in shell_cross["xpos"] or g in shell_cross["xneg"]),
            "nDomShell": int(shell_dom_n.get(g, 0)),
            "wsumShell": float(shell_dom_wsum.get(g, 0.0)),
            "nRiders": int(rider_n.get(g, 0)),
            "nDomCol": int(dom_n.get(g, 0)),
            "wsumCol": round(float(dom_wsum.get(g, 0.0)), 1),
            "lenMm": round(float(total[g]), 1),
            "spliceArcMm": round(a_splice, 1),
            "riderDyMm": [round(float(np.median(dys)) * 1000.0, 1),
                          round(float(np.min(dys)) * 1000.0, 1),
                          round(float(np.max(dys)) * 1000.0, 1)]
            if dys else None,
            "disp8Mm": round(float(disp8[g]), 1)}
    print("TARGETS (%d): %s" % (len(targets), targets), flush=True)
    print("SKIP-short %s tail %s riderless %s big %s" % (
        skip_short, skip_tail, skip_riderless, skip_big), flush=True)

    # ---- SDF sampler for body clearance.
    sdoc = np.load(args.sdf, allow_pickle=True)
    sample, _grid = sdf_sampler(sdoc)

    def sdf_at(P):
        v, _ = sample(np.asarray(P, dtype=np.float64))
        return np.asarray(v, dtype=np.float64)

    head_out = head_in.copy()
    routed = np.zeros(n, dtype=np.float64)
    per_guide = {}
    for g in targets:
        nm = side_of(g)
        s = sides[nm]
        tree = trees[nm]
        c = curves[g].copy()
        a = arc[g] * 1000.0
        ks = int(np.searchsorted(a, report["guides"][str(g)][
            "spliceArcMm"], side="left"))
        ks = max(ks, int((a < VERBATIM_MM).sum()))
        ks = min(ks, P_IN - 4)
        yC = yPost[nm] + corridor_up / 1000.0
        dys = np.asarray(dom_dy.get(g, [0.0]), dtype=np.float64)
        extra = float(max(0.0, -np.min(dys)))
        tgt = yC + extra + RIDER_MARGIN_MM / 1000.0 \
            + GUIDE_MARGIN_MM / 1000.0 * (1.0 if g in through_all else 0.0)
        # desired posterior target per bypass sample: at least tgt
        # wherever the original lies anterior of it.
        want = np.maximum(c[ks:, 1], tgt)
        push0 = want - c[ks:, 1]
        # smoothstep ramp of the push over arc 45..60 mm.
        ramp = smoothstep((a[ks:] - SPLICE_MIN_MM)
                          / (60.0 - SPLICE_MIN_MM))
        # disp-budget search on the push scale.
        W8g = W8[g]
        scale, final_disp, iters = 1.0, None, 0
        new = None
        while True:
            iters += 1
            byp = c.copy()
            byp[ks:, 1] = c[ks:, 1] + push0 * ramp * scale
            # light smoothing across the splice (sigma 1 sample).
            sm = ndimage.gaussian_filter1d(byp, 1.0, axis=0,
                                           mode="nearest")
            sm[:ks] = c[:ks]
            # body clearance: SDF >= 1.5 mm (push along gradient).
            cur = sm.copy()
            for _ in range(25):
                vv = sdf_at(cur[ks:])
                need = np.nonzero(vv < SDF_PROJ_TGT_MM)[0]
                if not len(need):
                    break
                sub = cur[ks:][need]
                grad = np.zeros_like(sub)
                for ax in range(3):
                    dd = np.zeros_like(sub)
                    dd[:, ax] = 0.002
                    v1, _ = sample(sub + dd)
                    v0, _ = sample(sub - dd)
                    grad[:, ax] = (np.asarray(v1) - np.asarray(v0)) \
                        / 0.004
                gl = np.linalg.norm(grad, axis=1)
                bad = ~(np.isfinite(gl)) | (gl < 1e-9)
                grad[bad] = np.array([0.0, 1.0, 0.0])
                gl[bad] = 1.0
                step = np.minimum((SDF_PROJ_TGT_MM - vv[need]) / 1000.0,
                                  0.004)
                cur[ks:][need] = sub + (grad / gl[:, None]) \
                    * step[:, None]
            # pinna clearance >= 3 mm.
            for _ in range(30):
                dd, ji = tree.query(cur[ks:], k=1)
                need = np.nonzero(dd < PIN_CLEAR_MM / 1000.0)[0]
                if not len(need):
                    break
                away = cur[ks:][need] - s["pv"][ji[need]]
                al = np.linalg.norm(away, axis=1)
                al[al < 1e-12] = 1e-12
                cur[ks:][need] = cur[ks:][need] + away / al[:, None] \
                    * ((PIN_CLEAR_MM / 1000.0 - dd[need] + 0.0002)[:,
                                                                  None])
            # groom36 inflated-shell clearance (only with --ear-shell).
            if shell:
                stree = shell_trees[nm]
                sV = shell[nm]["v"]
                sF = shell[nm]["f"]
                for _ in range(SHELL_ITERS):
                    sd, sj = stree.query(cur[ks:], k=1)
                    need = np.nonzero(sd < SHELL_CLEAR_MM / 1000.0)[0]
                    if not len(need):
                        break
                    away = cur[ks:][need] - sV[sj[need]]
                    al = np.linalg.norm(away, axis=1)
                    al[al < 1e-12] = 1e-12
                    cur[ks:][need] = cur[ks:][need] + away / al[:, None] \
                        * ((SHELL_CLEAR_MM / 1000.0 - sd[need]
                            + 0.0002)[:, None])
                for _ in range(10):
                    if not bool(_shell_rows(cur[None, :, :], sV, sF)[0]):
                        break
                    sd, sj = stree.query(cur[ks:], k=1)
                    near = np.nonzero(sd < 0.010)[0]
                    if not len(near):
                        near = np.arange(cur[ks:].shape[0])
                    away = cur[ks:][near] - sV[sj[near]]
                    al = np.linalg.norm(away, axis=1)
                    al[al < 1e-12] = 1e-12
                    cur[ks:][near] = cur[ks:][near] + away / al[:, None] \
                        * 0.002
            cur[:ks] = c[:ks]
            disp = float(np.linalg.norm(cur - W8g, axis=1).max()
                         * 1000.0)
            if disp <= DISP_BUDGET_MM or scale < 0.15:
                final_disp = disp
                new = cur
                break
            scale *= 0.85
        # column re-test (with 6 mm margin box).
        mgn = 0.006
        cm = ((new[1:, 2] < s["zmin"])
              & (new[1:, 1] >= s["yback"] - mgn)
              & (new[1:, 1] <= s["yfront"] + mgn)
              & ((new[1:, 0] * s["sgn"]) > 0)
              & (np.abs(new[1:, 0]) >= s["xmin"] - 0.005 - mgn)
              & (np.abs(new[1:, 0]) <= s["xmax"] + mgn))
        dd, _ = tree.query(new, k=1)
        vv = sdf_at(new)
        maxpush = float(np.linalg.norm(new - c, axis=1).max()
                        * 1000.0)
        shell_stat = {}
        if shell:
            sV = shell[nm]["v"]
            sF = shell[nm]["f"]
            sd, _ = shell_trees[nm].query(new, k=1)
            nsh = int(_G.segments_in_shell(new[None, :, :], sV, sF)[
                "nSegments"])
            shell_stat = {
                "shellSegs": nsh,
                "minShellMm": round(float(sd.min()) * 1000.0, 2),
                "shellClear": bool(nsh == 0),
            }
        per_guide[str(g)] = {
            "spliceIdx": ks,
            "pushScale": round(scale, 3),
            "maxPushMm": round(maxpush, 1),
            "dispVs8aMm": round(final_disp, 1),
            "poolKept": bool(final_disp <= POOL_CAP_MM),
            "colMargin6mm": bool(not cm.any()),
            "minPinnaMm": round(float(dd.min()) * 1000.0, 2),
            "minSdfMm": round(float(np.nanmin(vv)), 2),
            "hemDeltaMm": [round(float((new[-1] - c[-1])[i] * 1000.0),
                                 1)
                             for i in range(3)],
            "lenDeltaPct": round(
                (float(np.linalg.norm(np.diff(new, axis=0), axis=1)
                       .sum() / max(float(np.linalg.norm(
                           np.diff(c, axis=0), axis=1).sum()), 1e-9))
                 - 1.0) * 100.0, 1)}
        if shell_stat:
            per_guide[str(g)].update(shell_stat)
        report["guides"][str(g)].update(per_guide[str(g)])
        # world -> head-mm bits (verbatim region copied exactly below).
        for j in range(P_IN):
            if j < ks:
                continue
            p = new[j]
            head_out[g, j, 0] = p[0] * 1000.0
            head_out[g, j, 1] = (float(crown[1]) - p[1]) * 1000.0
            head_out[g, j, 2] = (float(crown[2]) - p[2]) * 1000.0
        routed[g] = 1.0

    # ---- take-off + untouched verification.
    verb = arc < VERBATIM_MM / 1000.0
    exact_take = bool(np.array_equal(head_out[verb], head_in[verb]))
    untouched = np.nonzero(routed < 0.5)[0]
    exact_unt = bool(np.array_equal(head_out[untouched], head_in[untouched]))
    h = hashlib.sha256()
    h.update(np.ascontiguousarray(head_out).tobytes())
    out_hash = h.hexdigest()
    h2 = hashlib.sha256()
    h2.update(np.ascontiguousarray(head_in).tobytes())
    in_hash = h2.hexdigest()
    print("TAKEOFF verbatim40 byteIdentical=%s untouched=%s "
          "(%d guides)" % (exact_take, exact_unt, len(untouched)),
          flush=True)

    payload = {k: np.asarray(src[k]) for k in src.files}
    payload["curves_head"] = head_out.astype(np.float64)
    payload["spec_sha"] = np.array(["earroute27"])
    payload["verdict"] = np.array(["EARROUTE27"])
    payload["route"] = routed
    payload["roots_file"] = np.array([
        "guides-26 SIDE posterior ear re-route (s14, tuck corridor): "
        "%d rerouted, verbatim 40 mm take-off, rest byte-identical%s" % (
            int(routed.sum()),
            "; +inflated-shell obstacle %s" % args.ear_shell
            if shell else "")])
    np.savez_compressed(out / (args.stem + ".npz"), **payload)
    report.update({
        "nGuides": int(n), "nRerouted": int(routed.sum()),
        "skipShort": skip_short, "skipTail": skip_tail,
        "skipBig": skip_big,
        "skipRiderless": skip_riderless,
        "shellObstacle": str(args.ear_shell) if shell else None,
        "shellCross": shell_cross if shell else None,
        "shellFeeders": {str(g): {"nDom": shell_dom_n.get(g, 0),
                                  "wsum": shell_dom_wsum.get(g, 0.0)}
                         for g in shell_feeders} if shell else None,
        "shellStillCrossing": sorted(
            int(g) for g, v in per_guide.items()
            if shell and not v.get("shellClear", True)) if shell else None,
        "takeoff": {"verbatimMm": VERBATIM_MM,
                    "byteIdentical": exact_take, "pass": exact_take},
        "untouchedIdentical": {"n": int(len(untouched)),
                               "byteIdentical": exact_unt,
                               "pass": exact_unt},
        "inputSha256": in_hash, "outputSha256": out_hash,
        "seconds": round(time.time() - t0, 1)})
    (out / (args.stem + "-route.json")).write_text(
        json.dumps(report, indent=1) + "\n")
    print("WROTE %s/%s.npz rerouted=%d in %.0fs" % (
        out, args.stem, int(routed.sum()), time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
