#!/usr/bin/env python3
"""Root-grown guide field v2: deterministic growth from (roots, spec params).

Head frame mm: X lateral, U anterior+ rel crown, D drop below crown.
world(m) = (X/1000, crown_y - U/1000, crown_z - D/1000).

Per guide (root r, unit outward normal n, azimuth az from atan2(X, U)):
  side = sign of root X (part plane pinning: no guide crosses X=0 above
    its release; crossing count is reported and gated 0).
  shell ride (J points): drops linspace(D_root, D_rel, J) on the offset
    section-ellipse shell (shell_h + lift, now with a lateral cos2az term
    so the crown can narrow sideways), lateral direction blended from the
    root radial dir to the departure dir (root azimuth pushed laterally
    by part_angle). j=0 is the shell point above the root.
  release: drop D_rel(az), U shifted by the relu(az) field so the side
    sector can release at or behind the ear-front plane.
  fall (K points): release -> shoulder waypoint (|X|=wpx(az) side-
    preserving, U=wpu(az) at drop 255 ~= the 1.405 m shoulder plane) via
    smoothstep, then straight fall with lateral spread + posterior drift;
    a mid-fall sway bow over the whole fall. Side-sector guides pass
    posterior to the acromion (U_wp < acromion U); violations reported.
  SDF projection: every sample (shell and fall, counted separately) with
    exact-SDF < 3.0 mm is pushed along the field gradient to >= 3.0 mm
    (<= 6 iterations); per-point distances are reported.

Numpy only (+ exact.py for the SDF). No renderer, no network.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

S4 = Path(__file__).resolve().parent
STATION_CAGE = S4.parent / "cage"
sys.path.insert(0, str(STATION_CAGE))
import exact as EXACT  # noqa: E402

CLEAR_MM = 3.0
PROJ_ITERS = 6
PROJ_EPS = 1.5


def param_names(spec):
    return [p["name"] for p in spec["params"]]


def default_values(spec):
    return np.array([p["init"] for p in spec["params"]], dtype=np.float64)


def load_roots(path):
    doc = np.load(str(path), allow_pickle=True)
    rule = str(doc["rule"][0]) if "rule" in doc.files else ""
    return {
        "pos": np.array(doc["pos_head"], dtype=np.float64),
        "nrm": np.array(doc["nrm_head"], dtype=np.float64),
        "crown": np.array(doc["crown"], dtype=np.float64),
        "rule": rule,
        "path": str(Path(path).resolve()),
    }


def smooth_anchors(anchors):
    """Median-3 filter per section column (station-owned smoothing).

    The station section table is a per-drop measurement with single-row
    glitches (drop-30 uback reads 0.1 mm between -53.4 and -77.5; the
    85-105 uback column oscillates +/-15 mm). The guide model is
    controlled by SMOOTH fields, so the shell reads a median-3 filtered
    copy; the raw table is never modified. Deterministic."""
    arr = np.asarray(anchors, dtype=np.float64)
    out = arr.copy()
    for col in (1, 2, 3):
        for i in range(arr.shape[0]):
            lo, hi = max(i - 1, 0), min(i + 2, arr.shape[0])
            out[i, col] = float(np.median(arr[lo:hi, col]))
    return out


def section_axes(anchors, h):
    """Head-section ellipse at drop h: (a=xmax, b=(uf-ub)/2, cu=(uf+ub)/2).

    anchors: rows [drop, xmax, ufront, uback] (station0b measured table).
    Linear interp per column, h clamped to the table range."""
    arr = np.asarray(anchors, dtype=np.float64)
    drops = arr[:, 0]
    h = min(max(float(h), float(drops[0])), float(drops[-1]))
    a = float(np.interp(h, drops, arr[:, 1]))
    uf = float(np.interp(h, drops, arr[:, 2]))
    ub = float(np.interp(h, drops, arr[:, 3]))
    return a, max((uf - ub) / 2.0, 1.0), (uf + ub) / 2.0


def departure(a, side, part):
    """Departure section angle: push |azimuth| away from the part toward
    the temples (front half) or the sides (back half), i.e. toward
    |th| = 90 deg, so |x| grows and no guide leaves its half-plane.
    |dep| = |a| + part for |a| <= 90, |a| - part above; continuous at
    |a| = 90 and always strictly inside (0, 180) for part in (0, 90),
    hence sin(dep) keeps the root's sign by construction."""
    aa = abs(float(a))
    push = float(part) if aa <= np.pi / 2.0 else -float(part)
    return float(side) * (aa + push)


def shell_point(h, theta, lift, azr, p, anchors):
    """Offset-shell point at drop h / section angle theta (head mm)."""
    a, b, cu = section_axes(anchors, h)
    d = float(shell_h(h, azr, p)) + float(lift)
    return np.array([(a + d) * np.sin(theta),
                     cu + (b + d) * np.cos(theta), h])


def head_to_world(pts_head, crown):
    pts = np.asarray(pts_head, dtype=np.float64)
    world = np.empty_like(pts)
    world[:, 0] = pts[:, 0] / 1000.0
    world[:, 1] = float(crown[1]) - pts[:, 1] / 1000.0
    world[:, 2] = float(crown[2]) - pts[:, 2] / 1000.0
    return world


def shell_h(h, azr, p):
    return np.maximum(
        p["sh_base"] + p["sh_elev"] * h / 100.0
        + p["sh_cos"] * np.cos(azr) + p["sh_sin"] * np.sin(azr)
        + p["sh_c2"] * np.cos(2.0 * azr), 0.5)


def release_drop(d_root, azr, p):
    return max(float(p["rel_c0"] + p["rel_c1"] * np.cos(azr)
                     + p["rel_s1"] * np.sin(azr)), d_root + 10.0)


def release_u_off(azr, p):
    """Release-point U offset: smooth azimuth field (side sector can sit
    at or behind the ear-front plane)."""
    return float(p["relu_c0"] + p["relu_c1"] * np.cos(azr)
                 + p["relu_s1"] * np.sin(azr))


def waypoint(azr, side, p):
    """Shoulder waypoint at drop H_WP: lateral magnitude (side-preserving)
    and posterior position, both smooth azimuth fields."""
    xwp = float(side) * float(p["wpx_c0"] + p["wpx_c1"] * np.cos(azr))
    uwp = float(p["wpu_c0"] + p["wpu_c1"] * np.cos(azr)
                + p["wpu_s1"] * np.sin(azr))
    return xwp, uwp


def end_drop(d_rel, azr, p):
    return max(float(p["end_c0"] + p["end_c1"] * np.cos(azr)
                     + p["end_s1"] * np.sin(azr)
                     + p["end_c2"] * np.cos(2.0 * azr)
                     + p["hem_u"] * (1.0 - np.cos(azr)) / 2.0),
               d_rel + 30.0)


def grow_guides(values, spec, roots, egrid=None, anchors=None):
    """Grow all guides. Returns dict with curves_head (G,M,3), az, etc."""
    names = param_names(spec)
    p = dict(zip(names, [float(v) for v in values]))
    if anchors is None:
        raise ValueError("anchors table required (station head sections)")
    anchors = smooth_anchors(anchors)
    pos = roots["pos"]
    G = pos.shape[0]
    J = int(spec.get("shellSamples", 12))
    K = int(spec.get("fallSamples", 29))
    M = J + K
    azr = np.arctan2(pos[:, 0], pos[:, 1])
    side = np.where(pos[:, 0] >= 0.0, 1.0, -1.0)
    curves = np.zeros((G, M, 3))
    d_rel = np.zeros(G)
    d_end = np.zeros(G)
    u_rel = np.zeros(G)
    x_wp = np.zeros(G)
    u_wp = np.zeros(G)
    cross = np.zeros(G, dtype=bool)
    part = np.radians(float(p["part_angle"]))
    lift = float(p["lift"])
    h_wp = float(spec.get("waypointDropMm", 255.0))
    acr_u = float(spec.get("acromionUmm", -16.9))
    for g in range(G):
        dr = float(pos[g, 2])
        a = float(azr[g])
        drel = release_drop(dr, a, p)
        dend = end_drop(drel, a, p)
        d_rel[g], d_end[g] = drel, dend
        # shell ride: section angle blended root -> departure, radius on
        # the offset head-section ellipse (station-measured shell)
        dep = departure(a, float(side[g]), part)
        hs = np.linspace(dr, drel, J)
        th = a + (dep - a) * np.linspace(0.0, 1.0, J)
        for j in range(J):
            curves[g, j] = shell_point(float(hs[j]), float(th[j]), lift,
                                       a, p, anchors)
            if curves[g, j, 0] * float(side[g]) < 0.0:
                cross[g] = True
        # release + shoulder waypoint
        xr, ur_shell = float(curves[g, J - 1, 0]), float(curves[g, J - 1, 1])
        ur = ur_shell + release_u_off(a, p)
        xwp, uwp = waypoint(a, float(side[g]), p)
        u_rel[g], x_wp[g], u_wp[g] = ur, xwp, uwp
        # fall
        hf = np.linspace(drel, dend, K)
        cA = float(np.cos(a))
        for k in range(K):
            h = float(hf[k])
            frac = min(max((h - drel) / max(dend - drel, 1e-9), 0.0), 1.0)
            bow = float(p["sway"]) * np.sin(np.pi * frac)
            if drel < h_wp and h <= h_wp:
                t = min(max((h - drel) / (h_wp - drel), 0.0), 1.0)
                ts = t * t * (3.0 - 2.0 * t)
                x = xr + (xwp - xr) * ts
                u = ur + (uwp - ur) * ts + bow
            elif drel < h_wp:
                # below the shoulder: straight fall off the waypoint
                x = (xwp + float(side[g]) * float(p["spread0"])
                     * (h - h_wp) / 100.0
                     * (1.0 + float(p["spread1"]) * cA))
                u = (uwp + float(p["drift"]) * (h - h_wp) / 100.0 + bow)
            else:
                # release below the shoulder (rare): straight fall
                x = (xr + float(side[g]) * float(p["spread0"])
                     * (h - drel) / 100.0
                     * (1.0 + float(p["spread1"]) * cA))
                u = ur + float(p["drift"]) * (h - drel) / 100.0 + bow
            curves[g, J + k, 0] = x
            curves[g, J + k, 1] = u
            curves[g, J + k, 2] = h
    azd = np.degrees(azr)
    side_sector = (np.abs(azd) >= 45.0) & (np.abs(azd) <= 135.0)
    acr_viol = side_sector & (d_end > h_wp) & (u_wp > acr_u)
    out = {"curves_head": curves, "az": azd, "side": side,
           "d_rel": d_rel, "d_end": d_end, "u_rel": u_rel,
           "x_wp": x_wp, "u_wp": u_wp, "n_shell": J,
           "n_cross_part": int(cross.sum()),
           "cross_idx": np.nonzero(cross)[0].astype(np.int64),
           "n_acr_viol": int(acr_viol.sum()),
           "acr_viol_idx": np.nonzero(acr_viol)[0].astype(np.int64),
           "acr_hinge": np.maximum(u_wp - acr_u, 0.0) * side_sector.astype(
               np.float64) * (d_end > h_wp).astype(np.float64),
           "side_sector": side_sector,
           "h_wp": h_wp, "acr_u": acr_u}
    if egrid is not None:
        proj = project_clearance(curves, J, roots["crown"], egrid)
        out.update(proj)
    return out


def project_clearance(curves, n_shell, crown, egrid):
    """Push every sample with exact-SDF < 3mm out along the gradient."""
    G, M, _ = curves.shape
    world_mm = head_to_world(curves.reshape(-1, 3), crown) * 1000.0
    sdf = EXACT.query_exact(egrid, world_mm)
    moved = np.zeros(G * M)
    n_iter = 0
    for _ in range(PROJ_ITERS):
        need = np.nonzero(sdf < CLEAR_MM)[0]
        if need.size == 0:
            break
        n_iter += 1
        pts = world_mm[need]
        grad = np.zeros_like(pts)
        for ax in range(3):
            step = np.zeros_like(pts)
            step[:, ax] = PROJ_EPS
            grad[:, ax] = (EXACT.query_exact(egrid, pts + step)
                           - EXACT.query_exact(egrid, pts - step)) / (
                2.0 * PROJ_EPS)
        lens = np.linalg.norm(grad, axis=1)
        stuck = lens < 1e-9
        lens[stuck] = 1.0
        push = (CLEAR_MM - sdf[need])[:, None] * grad / lens[:, None]
        push[stuck] = 0.0
        world_mm[need] += push
        moved[need] += np.linalg.norm(push, axis=1)
        sdf = EXACT.query_exact(egrid, world_mm)
    head = world_mm.copy()
    head[:, 1] = (float(crown[1]) - world_mm[:, 1] / 1000.0) * 1000.0
    head[:, 2] = (float(crown[2]) - world_mm[:, 2] / 1000.0) * 1000.0
    proj_head = head.reshape(G, M, 3)
    shell_m = moved.reshape(G, M)[:, :n_shell]
    fall_m = moved.reshape(G, M)[:, n_shell:]
    sdf_img = sdf.reshape(G, M)
    return {
        "curves_head": proj_head,
        "proj_iters": n_iter,
        "proj_dist": moved.reshape(G, M),
        "n_proj_shell": int((shell_m > 1e-9).sum()),
        "max_proj_shell_mm": round(float(shell_m.max()), 3),
        "n_proj_fall": int((fall_m > 1e-9).sum()),
        "max_proj_fall_mm": round(float(fall_m.max()), 3),
        "min_sdf_mm": round(float(sdf.min()), 3),
        "n_below3_mm": int((sdf < CLEAR_MM).sum()),
        "n_inside_mm": int((sdf < 0.0).sum()),
    }


def guide_hash(grown):
    digest = hashlib.sha256()
    digest.update(np.ascontiguousarray(
        grown["curves_head"]).tobytes())
    return digest.hexdigest()


def save_guides(path, grown, spec_sha, values, names, extra=None):
    payload = {
        "curves_head": np.asarray(grown["curves_head"], dtype=np.float64),
        "az_deg": np.asarray(grown["az"], dtype=np.float64),
        "side": np.asarray(grown["side"], dtype=np.float64),
        "d_rel": np.asarray(grown["d_rel"], dtype=np.float64),
        "d_end": np.asarray(grown["d_end"], dtype=np.float64),
        "param_names": np.array(names),
        "param_values": np.asarray(values, dtype=np.float64),
        "spec_sha": np.array([spec_sha]),
    }
    if extra:
        for k, v in extra.items():
            payload[k] = v
    np.savez(str(path), **dict(sorted(payload.items())))


def selftests(spec, roots_path, alt_roots_path, egrid, anchors):
    """determinism / zero-lift shell ride / roots swap. Returns failures."""
    fails = []
    roots = load_roots(roots_path)
    vals = default_values(spec)
    names = param_names(spec)
    g1 = grow_guides(vals, spec, roots, egrid, anchors)
    g2 = grow_guides(vals, spec, roots, egrid, anchors)
    h1, h2 = guide_hash(g1), guide_hash(g2)
    print("SELFTEST determinism %s" % ("PASS" if h1 == h2 else "FAIL"),
          flush=True)
    if h1 != h2:
        fails.append("determinism hash mismatch %s vs %s" % (h1, h2))
    # zero lift: shell-phase points ride the offset section ellipse.
    # Checked on the pure growth math (egrid=None): the analytic shell
    # and the true scalp differ by +/-2-3 mm (mesh faceting + section
    # measurement), so WITH the SDF projection active the composed
    # output trades shell adherence for body clearance by design; the
    # projection step is measured separately (n_proj/max_proj reports).
    vals0 = vals.copy()
    vals0[names.index("lift")] = 0.0
    g0 = grow_guides(vals0, spec, roots, None, anchors)
    pd = dict(zip(names, [float(v) for v in vals0]))
    J = int(spec.get("shellSamples", 12))
    worst = 0.0
    # grow_guides smooths the section table once; the check reads the
    # same once-smoothed table so both sides agree exactly.
    sanchors = smooth_anchors(anchors)
    for g in range(roots["pos"].shape[0]):
        a = float(np.radians(g0["az"][g]))
        part = np.radians(float(pd["part_angle"]))
        side = 1.0 if roots["pos"][g, 0] >= 0.0 else -1.0
        dep = departure(a, side, part)
        for j in range(J):
            pt = g0["curves_head"][g, j]
            h = float(pt[2])
            ea, eb, ecu = section_axes(sanchors, h)
            d = float(shell_h(h, a, pd))
            q = ((float(pt[0]) / (ea + d)) ** 2
                 + ((float(pt[1]) - ecu) / (eb + d)) ** 2)
            worst = max(worst, abs(1.0 - q) * min(ea + d, eb + d))
    ok = worst <= 1.0
    print("SELFTEST zero-lift shell worst=%.3fmm N=%d %s"
          % (worst, roots["pos"].shape[0], "PASS" if ok else "FAIL"),
          flush=True)
    if not ok:
        fails.append("zero-lift shell deviation %.3fmm" % worst)
    # roots swap: different file, no code change
    alt = load_roots(alt_roots_path)
    g3 = grow_guides(vals, spec, alt, egrid, anchors)
    ok = (g3["curves_head"].shape[0] == alt["pos"].shape[0]
          and g3["curves_head"].shape[1] == g1["curves_head"].shape[1])
    print("SELFTEST roots-swap N=%d %s"
          % (alt["pos"].shape[0], "PASS" if ok else "FAIL"), flush=True)
    if not ok:
        fails.append("roots swap shape mismatch")
    # part-plane pinning: no guide crosses X=0 above its release
    nc = int(g1["n_cross_part"])
    print("SELFTEST part-crossing n=%d %s"
          % (nc, "PASS" if nc == 0 else "FAIL"), flush=True)
    if nc != 0:
        fails.append("part-plane crossing n=%d" % nc)
    # shoulder routing: every side-sector guide with its end below the
    # shoulder passes posterior to the acromion at the waypoint
    nv = int(g1["n_acr_viol"])
    nside = int(g1["side_sector"].sum())
    ok = nv == 0 and nside > 0
    print("SELFTEST acromion side=%d viol=%d %s"
          % (nside, nv, "PASS" if ok else "FAIL"), flush=True)
    if not ok:
        fails.append("acromion violation n=%d (side=%d)" % (nv, nside))
    return fails, h1


def load_anchors(cage_spec_path):
    return json.loads(Path(cage_spec_path).read_text())["anchors"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--roots", required=True)
    ap.add_argument("--exact-sdf", required=True)
    ap.add_argument("--cage-spec", required=True)
    ap.add_argument("--alt-roots", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    spec = json.loads(Path(args.spec).read_text())
    egrid = EXACT.load_exact(args.exact_sdf)
    anchors = load_anchors(args.cage_spec)
    if args.selftest:
        assert args.alt_roots, "--alt-roots required for --selftest"
        fails, _ = selftests(spec, args.roots, args.alt_roots, egrid,
                             anchors)
        print("SELFTEST %s (%d fails)"
              % ("PASS" if not fails else "FAIL", len(fails)), flush=True)
        if fails:
            raise SystemExit(1)
        return
    roots = load_roots(args.roots)
    grown = grow_guides(default_values(spec), spec, roots, egrid, anchors)
    print("GUIDES hash=%s n_proj_fall=%d max_proj_fall=%.2fmm "
          "n_proj_shell=%d min_sdf=%.2fmm"
          % (guide_hash(grown), grown["n_proj_fall"],
             grown["max_proj_fall_mm"], grown["n_proj_shell"],
             grown["min_sdf_mm"]), flush=True)
    if args.out:
        import hashlib as _hl
        sha = _hl.sha256(Path(args.spec).read_bytes()).hexdigest()
        save_guides(args.out, grown, sha, default_values(spec),
                    param_names(spec))


if __name__ == "__main__":
    main()
