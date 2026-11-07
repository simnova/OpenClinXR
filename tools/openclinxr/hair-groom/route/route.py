"""hair-route0 S7: minimum-cost guide routing through the hair hull.

NO gravity blend, NO streamline-then-project (those made the crown rings
and rails in guides0/1). Guides are discrete minimum-cost paths on a
26-neighbour voxel graph over the eroded hull, solved per root with
directed A* (turn-angle curvature lives in the edge cost, not in a
post-process), smoothed once, accepted only inside the hull / outside
the body.

Stages (--step):
  spec-graph  freeze E/route-spec.json + E/spec-sha-before-route.txt,
              build the eroded graph -> E/graph.npz
  route       Poisson roots, endpoint bands, directed A* per root,
              Catmull-Rom smooth + acceptance -> E/paths.npz
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

import common as C

S7 = Path(__file__).resolve().parent
E = C.E

OFFSETS = np.array(
    [[dx, dy, dz] for dx in (-1, 0, 1) for dy in (-1, 0, 1)
     for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)],
    dtype=np.int64)
NDIR = 26
DIRNORM = OFFSETS / np.linalg.norm(OFFSETS, axis=1, keepdims=True)
TURN = np.arccos(np.clip(DIRNORM @ DIRNORM.T, -1.0, 1.0)).astype(np.float64)


def spec_dict():
    return {
        "method": "directed-A* minimum-cost paths on 26-neighbour "
                  "eroded-hull graph; no gravity blend, no "
                  "streamline-then-project",
        "coverage_radius_mm": 3.0,
        "erosion_rule": "hull occupancy distance-transform >= 3.0 mm "
                        "(2 mm grid) AND exact-SDF >= 3.0 mm",
        "graph": "26-neighbour over eroded voxels",
        "roots": {"source": "hair-scalp1/roots.npz (14155)",
                  "rule": "greedy Poisson subset, crown-first order, "
                          "adaptive spacing to land 300-500 roots",
                  "attach": "nearest eroded-graph node (euclidean, mm)",
                  "side": "sign(root_x_mm) vs centre part x=0 "
                          "(|x|<1mm -> +1)"},
        "ear_plane_rule": "y_ear_mm = median y of scalp hairline-loop "
                          "points with |x| above the 80th percentile "
                          "(sideburn anchor, data-driven); root world y < "
                          "y_ear -> curtain family, else back family",
        "endpoint_bands": "per (sector, side): curtain-L/R (root x<0 / "
                          "x>=0, y<y_ear), back-L/R (root x<0 / x>=0, "
                          "y>=y_ear; pools overlap +-2 mm so bundles can "
                          "meet at the occiput). Pool = x-binned (10 mm "
                          "bins) lowest 25 eroded voxels per bin within "
                          "z <= sector_min_z + 20 mm: a hem-spanning "
                          "pool. Assignment is quantile-matched in "
                          "lateral scalp order (member x-rank -> pool "
                          "x-rank, local search outward from the "
                          "quantile target biased to the bottom 6 mm of "
                          "the slab (rank penalty max(0,z-(zmin+6))/3, "
                          "so guides end at the hem, not mid-slab) with "
                          "hard same-sign rule "
                          "(endpoint_x * root_x >= 0), global "
                          "x-monotonicity vs all previously assigned "
                          "neighbours (no order flips), preferred "
                          "endpoint spacing 4 mm (relax 2.5 mm) over a "
                          "hard distinct-voxel floor (no endpoint voxel "
                          "is ever shared: spacing >= 2 mm always, so "
                          "roots cannot collapse into one channel). "
                          "6 mm is unsatisfiable: "
                          "~274 back guides share a ~170 mm hem; 4 mm "
                          "still guarantees distinct-voxel channels on "
                          "the 2 mm grid.",
        "part_rule": "w_part * len_mm added on nodes whose x-sign "
                     "opposes the root's sign (roots |x|<3 mm exempt); "
                     "keeps left hair left of the centre part without "
                     "hard-blocking the midline",
        "edge_cost": "w_len*len_mm + w_up*max(0,dz_mm) + "
                     "w_curve*turn_rad + "
                     "w_body*bodyterm*len_mm + w_bnd*bndterm*len_mm + "
                     "w_coh*min(usage,3)*len_mm (saturating coherence: "
                     "the first paths through a node repel, an "
                     "established channel stays cheap; w_coh = 1.0 "
                     "because x-monotone endpoint assignment already "
                     "carries neighbour coherence and usage is only "
                     "anti-collapse; uncapped usage drives late-order "
                     "roots past the expansion cap even though "
                     "zero-usage paths exist and accept)",
        "components": "routing graph = largest 26-connected component "
                      "of the eroded set (sliver labels dropped at "
                      "graph build; count recorded)",
        "weights": {"w_len": 1.0, "w_up": 8.0, "w_curve": 16.0,
                    "w_body": 6.0, "w_bnd": 4.0, "w_coh": 1.0,
                    "w_part": 5.0},
        "w_curve_note": "raised 6 -> 16 after the first gated run showed "
                        "azimuthal circling (mean |azimuthal tangent| "
                        "0.45 in the crown band, guides0 rings 0.58): a "
                        "diagonal shortcut across the dome saves length "
                        "but pays continuous turn; 16 prices a "
                        "quarter-turn of extra spiral above the "
                        "corner-cutting saving while dome-following "
                        "(turn ~0.03 rad/edge) stays affordable. "
                        "Weight tuning inside the frozen six-term cost, "
                        "not a new term.",
        "bodyterm": "((clip(8-sdf_mm,0,8))/8)^2",
        "bndterm": "((clip(6-bnd_mm,0,6))/6)^2 "
                   "(bnd = dist to hull boundary)",
        "heuristic": "weighted A* (eps=3.0) on w_len * euclidean mm: "
                     "all other terms non-negative so eps=1 is admissible; "
                     "eps=3 bounds suboptimality x3 and keeps 250 mm "
                     "crown-to-hem searches inside the expansion cap "
                     "(calibration probe: unweighted A* exhausts 150k "
                     "expansions on crown->hem, eps=3 finds it in "
                     "3639 expansions / 0.05 s; eps=2 needs 32960)",
        "expansions_cap": 150000,
        "order": "scalp order (y, x) with usage-map coherence; "
                 "retry passes over unreachable roots at usage scales "
                 "1.0, 0.25, 0.0 (same cap, same acceptance) recover "
                 "load casualties; levels recorded",
        "smooth": "centripetal Catmull-Rom through path nodes, 2 mm "
                  "resample; fallback = collinear-decimated voxel "
                  "polyline (always inside eroded hull, SDF>=3)",
        "accept": "routed portion (arc beyond the first 8 mm) must "
                  "lie inside hull occupancy with exact-SDF > 0 "
                  "(outside body) and arc fraction inside the eroded "
                  "hull >= 0.95; the root leader (first 8 mm of arc, "
                  "root-to-first-node attachment through the coverage "
                  "rind) is exempt from hull/eroded containment "
                  "because roots live <= 4.5 mm off the hull by hull0c "
                  "construction, but must satisfy exact-SDF > -1 mm "
                  "(not buried); leader length recorded and reported "
                  "(p50/max; long leaders traverse non-eroded hull "
                  "under the same acceptance check)",
        "tube_r_mm": 3.0,
    }


def sha_of_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def step_spec_graph():
    E.mkdir(parents=True, exist_ok=True)
    spec = spec_dict()
    C.track(S7 / "route.py")
    inp = C.load_all()
    hull = inp["hull"]
    occ = np.array(hull["occupancy"], dtype=bool)
    xs = np.array(hull["xs"], dtype=np.float64)
    ys = np.array(hull["ys"], dtype=np.float64)
    zs = np.array(hull["zs"], dtype=np.float64)
    spacing = float(hull["spacing"])
    assert abs(spacing - 2.0) < 1e-9, spacing
    assert occ.shape == (len(xs), len(ys), len(zs)), occ.shape

    (E / "route-spec.json").write_text(json.dumps(spec, indent=1) + "\n")
    sha = sha_of_file(E / "route-spec.json")
    (E / "spec-sha-before-route.txt").write_text(sha + "\n")
    print("SPEC_SHA %s" % sha, flush=True)

    bnd = ndimage.distance_transform_edt(occ).astype(np.float64) * spacing
    er_nom = bnd >= spec["coverage_radius_mm"]
    print("erode-nominal kept=%d / %d" % (int(er_nom.sum()),
                                          int(occ.sum())), flush=True)
    idx = np.stack(np.nonzero(er_nom), axis=1)
    pts = np.stack([xs[idx[:, 0]], ys[idx[:, 1]],
                    zs[idx[:, 2]]], axis=1)
    sdf = np.zeros(len(idx), dtype=np.float64)
    for a in range(0, len(idx), 200_000):
        sdf[a:a + 200_000] = C.EXACT.query_exact(
            inp["egrid"], pts[a:a + 200_000])
    keep = sdf >= 3.0
    print("sdf>=3 kept=%d removed=%d (min %.2f max %.2f)" % (
        int(keep.sum()), int((~keep).sum()), float(sdf.min()),
        float(sdf.max())), flush=True)
    eroded = np.zeros_like(occ)
    eroded[idx[keep, 0], idx[keep, 1], idx[keep, 2]] = True
    lab, nlab = ndimage.label(
        eroded, structure=np.ones((3, 3, 3), dtype=np.int64))
    sizes = ndimage.sum(eroded, lab, index=np.arange(1, nlab + 1))
    main = int(np.argmax(sizes)) + 1
    dropped = int(eroded.sum()) - int((lab == main).sum())
    print("components=%d main=%d droppedSlivers=%d" % (
        nlab, int((lab == main).sum()), dropped), flush=True)
    selm = lab[idx[keep, 0], idx[keep, 1], idx[keep, 2]] == main
    idx = idx[keep][selm]
    sdf = sdf[keep][selm]
    K = len(idx)
    node_xyz = np.stack([xs[idx[:, 0]], ys[idx[:, 1]],
                         zs[idx[:, 2]]], axis=1)
    node_bnd = bnd[idx[:, 0], idx[:, 1], idx[:, 2]]
    idx3d = np.full(occ.shape, -1, dtype=np.int32)
    idx3d[idx[:, 0], idx[:, 1], idx[:, 2]] = np.arange(
        K, dtype=np.int32)
    print("NODES %d" % K, flush=True)
    np.savez_compressed(
        str(E / "graph.npz"), node_xyz=node_xyz,
        node_sdf=sdf.astype(np.float64),
        node_bnd=node_bnd.astype(np.float64),
        node_idx=idx.astype(np.int32),
        xs=xs, ys=ys, zs=zs, spacing=np.float64(spacing),
        coverage_radius_mm=np.float64(spec["coverage_radius_mm"]),
        dropped_slivers=np.int64(dropped),
        spec_sha=np.array([sha]))
    print("WROTE graph.npz bytes=%d" % (
        (E / "graph.npz").stat().st_size), flush=True)
    C.write_inputs_log([S7 / "route.py", E / "route-spec.json"])
    return sha


# ------------------------------------------------------------- adjacency
def build_adjacency(graph_path):
    g = np.load(str(graph_path))
    xs, ys = np.array(g["xs"]), np.array(g["ys"])
    zs = np.array(g["zs"])
    spacing = float(g["spacing"])
    K = len(g["node_xyz"])
    node_xyz = np.array(g["node_xyz"])
    node_sdf = np.array(g["node_sdf"])
    node_bnd = np.array(g["node_bnd"])
    nidx = np.array(g["node_idx"], dtype=np.int64)
    nx, ny, nz = len(xs), len(ys), len(zs)
    idx3d = np.full((nx, ny, nz), -1, dtype=np.int32)
    idx3d[nidx[:, 0], nidx[:, 1], nidx[:, 2]] = np.arange(K, dtype=np.int32)
    w = json.loads((E / "route-spec.json").read_text())["weights"]
    tbig = ((np.clip(8.0 - node_sdf, 0, 8)) / 8.0) ** 2
    tbrd = ((np.clip(6.0 - node_bnd, 0, 6)) / 6.0) ** 2
    nbr_nb = np.full((K, NDIR), -1, dtype=np.int32)
    nbr_static = np.zeros((K, NDIR), dtype=np.float32)
    nbr_len = np.zeros((K, NDIR), dtype=np.float32)
    edge_len = np.linalg.norm(OFFSETS, axis=1) * spacing
    for d in range(NDIR):
        dx, dy, dz = (int(OFFSETS[d, 0]), int(OFFSETS[d, 1]),
                      int(OFFSETS[d, 2]))
        x0, x1 = max(0, -dx), min(nx, nx - dx)
        y0, y1 = max(0, -dy), min(ny, ny - dy)
        z0, z1 = max(0, -dz), min(nz, nz - dz)
        A = idx3d[x0:x1, y0:y1, z0:z1]
        B = idx3d[x0 + dx:x1 + dx, y0 + dy:y1 + dy, z0 + dz:z1 + dz]
        ok = (A >= 0) & (B >= 0)
        au, bu = A[ok], B[ok]
        dzmm = float(dz) * spacing
        up = w["w_up"] * max(0.0, dzmm)
        stat = (edge_len[d] * (w["w_len"] + w["w_body"]
                * (tbig[au] + tbig[bu]) / 2.0 + w["w_bnd"]
                * (tbrd[au] + tbrd[bu]) / 2.0) + up).astype(np.float32)
        nbr_nb[au, d] = bu
        nbr_static[au, d] = stat
        nbr_len[au, d] = np.float32(edge_len[d])
    n_edges = int((nbr_nb >= 0).sum())
    print("ADJ K=%d edges=%d mean-deg=%.1f" % (
        K, n_edges, n_edges / K), flush=True)
    return {"K": K, "node_xyz": node_xyz, "node_sdf": node_sdf,
            "node_bnd": node_bnd, "idx3d": idx3d, "xs": xs, "ys": ys,
            "zs": zs, "spacing": spacing, "nbr_nb": nbr_nb,
            "nbr_static": nbr_static, "nbr_len": nbr_len,
            "node_sx": np.sign(node_xyz[:, 0]).astype(np.int8),
            "spec_sha": str(g["spec_sha"][0])}


# ---------------------------------------------------------------- roots
def poisson_roots(xyz_mm, lo=300, hi=500):
    order = np.lexsort((xyz_mm[:, 0], xyz_mm[:, 2]))[::-1]
    best = None
    for spacing in (14.0, 12.0, 11.0, 10.0, 9.0, 8.0, 7.0, 6.0):
        acc = []
        acc_xyz = np.zeros((0, 3))
        for i in order:
            p = xyz_mm[i]
            if len(acc) == 0:
                acc.append(int(i))
                acc_xyz = p[None, :]
                continue
            d = np.linalg.norm(acc_xyz - p[None, :], axis=1).min()
            if d >= spacing:
                acc.append(int(i))
                acc_xyz = np.vstack([acc_xyz, p[None, :]])
            if len(acc) >= hi + 50:
                break
        n = len(acc)
        if best is None or (abs(n - (lo + hi) / 2)
                             < abs(len(best) - (lo + hi) / 2)):
            best = (spacing, acc)
        if lo <= n <= hi:
            break
    spacing, acc = best
    print("POISSON spacing=%.1f n=%d" % (spacing, len(acc)), flush=True)
    return np.array(sorted(acc), dtype=np.int64), spacing


# -------------------------------------------------------------- endpoints
def endpoint_bands(adj, y_ear):
    xyz = adj["node_xyz"]
    bk = xyz[:, 1] >= y_ear
    groups = {
        "CL": (xyz[:, 1] < y_ear) & (xyz[:, 0] <= 2.0),
        "CR": (xyz[:, 1] < y_ear) & (xyz[:, 0] >= -2.0),
        "BKL": bk & (xyz[:, 0] <= 2.0),
        "BKR": bk & (xyz[:, 0] >= -2.0),
    }
    bands = {}
    for name, sel in groups.items():
        sel = np.nonzero(sel)[0]
        zmin = xyz[sel, 2].min()
        hem = sel[xyz[sel, 2] <= zmin + 20.0]
        hx = xyz[hem, 0]
        x0, x1 = hx.min(), hx.max()
        keep = []
        b = x0
        while b <= x1 + 1e-9:
            inb = hem[(hx >= b) & (hx < b + 10.0)]
            if len(inb):
                o = np.argsort(xyz[inb, 2], kind="stable")[:25]
                keep.append(inb[o])
            b += 10.0
        cand = (np.concatenate(keep).astype(np.int64) if keep
                else np.array([], dtype=np.int64))
        bands[name] = {"nodes": cand, "zmin": float(zmin)}
        print("BAND %s n=%d zmin=%.1f xspan=[%.0f,%.0f]" % (
            name, len(cand), zmin,
            float(xyz[cand, 0].min()) if len(cand) else 0.0,
            float(xyz[cand, 0].max()) if len(cand) else 0.0), flush=True)
    return bands


def assign_endpoints(roots_xyz, roots_side, adj, bands, y_ear):
    xyz = adj["node_xyz"]
    fam_c = roots_xyz[:, 1] < y_ear
    groups = {
        "CL": [i for i in range(len(roots_xyz))
               if fam_c[i] and roots_xyz[i, 0] < 0],
        "CR": [i for i in range(len(roots_xyz))
               if fam_c[i] and roots_xyz[i, 0] >= 0],
        "BKL": [i for i in range(len(roots_xyz))
                if not fam_c[i] and roots_xyz[i, 0] < 0],
        "BKR": [i for i in range(len(roots_xyz))
                if not fam_c[i] and roots_xyz[i, 0] >= 0],
    }
    out = np.full(len(roots_xyz), -1, dtype=np.int64)
    relax = {"spacing2.5": 0, "distinctOnly": 0, "monotone": 0,
             "failed": 0}
    for name, members in groups.items():
        members = sorted(members, key=lambda i: roots_xyz[i, 0])
        cand = bands[name]["nodes"]
        cxyz = xyz[cand]
        porder = np.argsort(cxyz[:, 0], kind="stable")
        P = len(cand)
        M = len(members)
        arx, acx, aid = [], [], []
        aid_set = set()
        for k, i in enumerate(members):
            rx = float(roots_xyz[i, 0])
            tgt = round(k * (P - 1) / (M - 1)) if M > 1 else P // 2
            feas = cxyz[:, 0] * rx >= 0
            pos_in_x = np.empty(P, dtype=np.float64)
            pos_in_x[porder] = np.arange(P, dtype=np.float64)
            prefer_full = [int(j) for j in porder[np.argsort(
                np.abs(pos_in_x[porder] - tgt)
                + np.maximum(0.0, cxyz[porder, 2]
                             - (bands[name]["zmin"] + 6.0)) / 3.0,
                kind="stable")] if feas[j]]
            pick = -1
            for drop_mono in (False, True):
                for minsep, window in ((4.0, 41), (2.5, 41), (2.0, None),
                                       (0.0, None)):
                    prefer = (prefer_full[:window] if window is not None
                              else prefer_full)
                    for j in prefer:
                        c = int(cand[j])
                        if c in aid_set:
                            continue  # hard distinct-voxel floor
                        cx = float(xyz[c, 0])
                        if arx and not drop_mono and (
                                (np.array(arx) - rx)
                                * (np.array(acx) - cx) < -1e-9).any():
                            continue
                        if aid and np.linalg.norm(
                                xyz[np.array(aid)] - xyz[c],
                                axis=1).min() < minsep:
                            continue
                        pick = c
                        if minsep == 2.5:
                            relax["spacing2.5"] += 1
                        elif minsep < 2.5:
                            relax["distinctOnly"] += 1
                        break
                    if pick >= 0:
                        break
                if pick >= 0:
                    if drop_mono:
                        relax["monotone"] += 1
                    break
            if pick < 0:
                rem = [c for c in (int(cand[j]) for j in prefer_full)
                       if c not in aid_set]
                if rem:
                    pick = rem[0]
                    relax["distinctOnly"] += 1
                else:
                    pick = int(cand[int(prefer_full[0])])
                    relax["failed"] += 1
                relax["monotone"] += 1
            out[i] = pick
            arx.append(rx)
            acx.append(float(xyz[pick, 0]))
            aid.append(pick)
            aid_set.add(pick)
        print("ASSIGN %s n=%d" % (name, len(members)), flush=True)
    print("RELAX %s" % (relax,), flush=True)
    return out


ADJ_ATTACH = {}


# ------------------------------------------------------------- directed A*
def astar(adj, start, goal, usage, w, cap=150000, eps=3.0,
          root_sign=0):
    nbr_nb, nbr_static = adj["nbr_nb"], adj["nbr_static"]
    nbr_len = adj["nbr_len"]
    xyz = adj["node_xyz"]
    K = adj["K"]
    if start == goal:
        return [start], 0
    g = np.full((K, NDIR + 1), np.inf, dtype=np.float32)
    parent = np.full((K, NDIR + 1), -1, dtype=np.int32)
    gx, gy, gz = (xyz[goal, 0], xyz[goal, 1], xyz[goal, 2])
    dx = xyz[:, 0] - gx
    dy = xyz[:, 1] - gy
    dz = xyz[:, 2] - gz
    h = (eps * w["w_len"] * np.sqrt(dx * dx + dy * dy + dz * dz)
         ).astype(np.float32)
    wc = float(w["w_curve"])
    wcoh = float(w["w_coh"])
    uc = np.minimum(usage, 3.0)
    if root_sign != 0 and float(w.get("w_part", 0.0)) > 0:
        badv = ((adj["node_sx"].astype(np.int64) * int(root_sign) < 0)
                .astype(np.float32) * float(w["w_part"]))
    else:
        badv = None
    g[start, NDIR] = 0.0

    def pen(v, ln):
        p = wcoh * float(uc[v])
        if badv is not None:
            p += float(badv[v])
        return p * float(ln)

    heap = []
    nb0 = nbr_nb[start]
    for d in range(NDIR):
        v = int(nb0[d])
        if v < 0:
            continue
        c = float(nbr_static[start, d]) + pen(v, nbr_len[start, d])
        if c < g[v, d]:
            g[v, d] = c
            parent[v, d] = start * (NDIR + 1) + NDIR
            heapq.heappush(heap, (c + float(h[v]), c, v, d))
    exp = 0
    while heap:
        f, c, u, du = heapq.heappop(heap)
        if c > g[u, du]:
            continue
        if u == goal:
            seq = [(u, du)]
            while True:
                p = int(parent[seq[-1][0], seq[-1][1]])
                if p < 0:
                    break
                seq.append((p // (NDIR + 1), p % (NDIR + 1)))
            seq = seq[::-1]
            return [s[0] for s in seq], exp
        exp += 1
        if exp > cap:
            return None, exp
        turn = TURN[du]
        nbs = nbr_nb[u]
        for d in range(NDIR):
            v = int(nbs[d])
            if v < 0:
                continue
            nc = (c + float(nbr_static[u, d]) + wc * float(turn[d])
                  + pen(v, nbr_len[u, d]))
            if nc < g[v, d]:
                g[v, d] = nc
                parent[v, d] = u * (NDIR + 1) + du
                heapq.heappush(heap, (nc + float(h[v]), nc, v, d))
    return None, exp


# --------------------------------------------------------------- smoothing
def catmull_rom(pts, samples_per_seg=4):
    pts = np.asarray(pts, dtype=np.float64)
    if len(pts) < 3:
        return pts.copy()
    ext = np.vstack([pts[0] - (pts[1] - pts[0]) * 0.5, pts,
                     pts[-1] + (pts[-1] - pts[-2]) * 0.5])
    out = [ext[1]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(1, samples_per_seg + 1):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t
                              + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.array(out)


def resample_2mm(pts):
    pts = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = seg.sum()
    if total <= 0:
        return pts.copy()
    n = max(int(np.ceil(total / 2.0)) + 1, 2)
    t = np.linspace(0.0, 1.0, n)
    cum = np.concatenate([[0.0], np.cumsum(seg)]) / total
    out = np.zeros((n, 3))
    j = 0
    for k in range(n):
        while j < len(seg) - 1 and cum[j + 1] < t[k]:
            j += 1
        f = 0.0 if cum[j + 1] == cum[j] else (
            (t[k] - cum[j]) / (cum[j + 1] - cum[j]))
        out[k] = pts[j] * (1 - f) + pts[j + 1] * f
    return out


def step_route():
    E.mkdir(parents=True, exist_ok=True)
    sha = (E / "spec-sha-before-route.txt").read_text().strip()
    assert sha == sha_of_file(E / "route-spec.json"), "spec sha drift!"
    spec = json.loads((E / "route-spec.json").read_text())
    w = spec["weights"]
    C.track(S7 / "route.py")
    inp = C.load_all()
    adj = build_adjacency(E / "graph.npz")
    assert adj["spec_sha"] == sha, "graph sha drift!"

    roots_mm = np.array(inp["roots"]["xyz"], dtype=np.float64) * 1000.0
    sel, spacing = poisson_roots(roots_mm)
    rxyz = roots_mm[sel]
    side = np.where(rxyz[:, 0] < -1.0, -1.0, 1.0)

    loop = np.array(inp["scalp"]["loopPts"], dtype=np.float64) * 1000.0
    ax = np.abs(loop[:, 0])
    y_ear = float(np.median(loop[ax >= np.percentile(ax, 80), 1]))
    print("Y_EAR %.1f" % y_ear, flush=True)

    xyz = adj["node_xyz"]
    from scipy.spatial import cKDTree
    leader, attach = cKDTree(xyz).query(rxyz, k=1)
    attach = attach.astype(np.int64)
    leader = np.asarray(leader, dtype=np.float64)
    print("LEADER max=%.2f p95=%.2f p50=%.2f" % (
        float(leader.max()), float(np.percentile(leader, 95)),
        float(np.percentile(leader, 50))), flush=True)
    global ADJ_ATTACH
    ADJ_ATTACH = {i: int(attach[i]) for i in range(len(rxyz))}

    bands = endpoint_bands(adj, y_ear)
    ends = assign_endpoints(rxyz, side, adj, bands, y_ear)

    usage = np.zeros(adj["K"], dtype=np.float32)
    occ = np.array(inp["hull"]["occupancy"], dtype=bool)
    xs, ys, zs = adj["xs"], adj["ys"], adj["zs"]
    sp = adj["spacing"]
    idx3d = adj["idx3d"]
    guides = [None] * len(rxyz)
    status = ["unreachable"] * len(rxyz)
    stat = {"unreachable": 0, "smooth": 0, "fallback": 0,
            "retry_recovered": 0, "leader_max": 0.0}
    stat["leader_max"] = float(leader.max())
    order = sorted(range(len(rxyz)), key=lambda i: (rxyz[i, 1], rxyz[i, 0]))

    def attempt(i, use):
        rx = float(rxyz[i, 0])
        rs = 0 if abs(rx) < 3.0 else (1 if rx > 0 else -1)
        path, exp = astar(adj, int(attach[i]), int(ends[i]), use, w,
                          cap=spec["expansions_cap"], root_sign=rs)
        if path is None:
            return False
        for u in path:
            usage[u] += 1.0
        nodes = xyz[np.array(path)]
        curve = np.vstack([rxyz[i][None, :], nodes])
        sm = resample_2mm(catmull_rom(curve))
        ok, _ = check_curve(sm, occ, idx3d, xs, ys, zs, sp,
                            inp["egrid"])
        if ok:
            guides[i] = sm
            status[i] = "smooth"
            stat["smooth"] += 1
            return True
        fb = decimate_collinear(curve)
        ok2, _ = check_curve(fb, occ, idx3d, xs, ys, zs, sp,
                             inp["egrid"])
        if ok2:
            guides[i] = fb
            status[i] = "fallback"
            stat["fallback"] += 1
            return True
        return False

    for n, i in enumerate(order):
        attempt(i, usage)
        if (n + 1) % 50 == 0:
            print("routed %d/%d unreach=%d" % (
                n + 1, len(rxyz),
                sum(1 for s in status if s == "unreachable")), flush=True)
    stat["retry_levels"] = {}
    for scale in (1.0, 0.25, 0.0):
        retry = [i for i in order if status[i] == "unreachable"]
        if not retry:
            break
        use = usage if scale == 1.0 else usage * scale
        n0 = len(retry)
        for i in retry:
            if status[i] == "unreachable" and attempt(i, use):
                stat["retry_recovered"] += 1
        stat["retry_levels"][str(scale)] = n0 - sum(
            1 for i in retry if status[i] == "unreachable")
    stat["unreachable"] = sum(1 for s in status if s == "unreachable")
    print(json.dumps(stat), flush=True)
    okg = [gg for gg in guides if gg is not None]
    if not okg:
        raise RuntimeError("all %d roots unreachable" % len(guides))
    maxlen = max(len(gg) for gg in okg)
    arr = np.full((len(rxyz), maxlen, 3), np.nan)
    for i, gg in enumerate(guides):
        if gg is not None:
            arr[i, :len(gg)] = gg
    np.savez_compressed(
        str(E / "paths.npz"), curves_mm=arr,
        status=np.array(status), roots_mm=rxyz, roots_side=side,
        roots_sel=sel, attach=attach, ends=ends, leader_mm=leader,
        y_ear_mm=np.float64(y_ear), poisson_spacing_mm=np.float64(spacing),
        spec_sha=np.array([sha]), crown=np.asarray(inp["crown"]),
        stats=np.array([json.dumps(stat)]))
    print("WROTE paths.npz bytes=%d" % (
        (E / "paths.npz").stat().st_size), flush=True)
    C.write_inputs_log([S7 / "route.py"])


def check_curve(pts, occ, idx3d, xs, ys, zs, sp, egrid):
    ix = np.rint((pts[:, 0] - xs[0]) / sp).astype(int)
    iy = np.rint((pts[:, 1] - ys[0]) / sp).astype(int)
    iz = np.rint((pts[:, 2] - zs[0]) / sp).astype(int)
    nx, ny, nz = occ.shape
    inb = ((ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
           & (iz >= 0) & (iz < nz))
    if not inb.all():
        return False, 0.0
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    lead = arc <= 8.0
    body = ~lead
    if not body.any():
        return False, 0.0
    if not occ[ix[body], iy[body], iz[body]].all():
        return False, 0.0
    er = idx3d[ix, iy, iz] >= 0
    frac_er = float(er.mean())
    sdf = np.zeros(len(pts))
    for a in range(0, len(pts), 200_000):
        sdf[a:a + 200_000] = C.EXACT.query_exact(egrid, pts[a:a + 200_000])
    if not (sdf[body] > 0).all():
        return False, frac_er
    if not (sdf[lead] > -1.0).all():
        return False, frac_er
    frac_er_beyond = float(er[body].mean())
    return frac_er_beyond >= 0.95, frac_er_beyond


def decimate_collinear(pts, tol=0.5):
    pts = np.asarray(pts, dtype=np.float64)
    keep = [0]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[keep[-1]], pts[i], pts[i + 1]
        ab = b - a
        n = np.linalg.norm(ab)
        if n < 1e-9:
            continue
        d = np.linalg.norm(np.cross(ab / n, c - a))
        if d > tol:
            keep.append(i)
    keep.append(len(pts) - 1)
    return resample_2mm(pts[np.array(keep)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True,
                    choices=["spec-graph", "route"])
    args = ap.parse_args()
    if args.step == "spec-graph":
        step_spec_graph()
    else:
        step_route()


if __name__ == "__main__":
    main()
