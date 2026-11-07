"""hair-route0 STEP 3: gates + regional score -> E/gates.json.

Reads E/paths.npz. Metrics:
  unreachable, endpoint coverage/bands, boundary fraction (4 mm),
  crown-band horizontal tangent (vs guides0 reference), part crossings,
  back-centre gap, occluded tube raster -> regional p50/p95 per region
  (front/profile/back) + depth-aware face guards.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

import common as C

S7 = Path(__file__).resolve().parent
E = C.E
FRAME = 1024
CROWN_BAND = (1570.0, 1640.0)
TANGENT_GATE = 0.45
GAP_GATE_MM = 20.0


def load_paths():
    P = np.load(str(E / "paths.npz"))
    n = len(P["roots_mm"])
    curves = [np.array(P["curves_mm"][i]) for i in range(n)]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    return P, curves


def boundary_frac(curves, occ, xs, ys, zs, sp):
    bnd = ndimage.distance_transform_edt(occ).astype(np.float64) * sp
    num = den = 0.0
    for c in curves:
        ix = np.clip(np.rint((c[:, 0] - xs[0]) / sp).astype(int),
                     0, occ.shape[0] - 1)
        iy = np.clip(np.rint((c[:, 1] - ys[0]) / sp).astype(int),
                     0, occ.shape[1] - 1)
        iz = np.clip(np.rint((c[:, 2] - zs[0]) / sp).astype(int),
                     0, occ.shape[2] - 1)
        seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
        mid = bnd[ix[:-1], iy[:-1], iz[:-1]]
        num += float(seg[mid < 4.0].sum())
        den += float(seg.sum())
    return num / den if den else 0.0


def crown_tangent(curves_mm):
    vals = []
    for c in curves_mm:
        w = c / 1.0
        sel = (w[:-1, 2] >= CROWN_BAND[0]) & (w[:-1, 2] <= CROWN_BAND[1])
        if not sel.any():
            continue
        t = np.diff(w, axis=0)[sel]
        n = np.linalg.norm(t, axis=1)
        n[n == 0] = 1.0
        vals.append(np.sqrt(t[:, 0] ** 2 + t[:, 1] ** 2) / n)
    v = np.concatenate(vals) if vals else np.zeros(0)
    return {"mean": round(float(v.mean()), 4) if v.size else 0.0,
            "n": int(v.size)}


def guides0_reference():
    g = np.load(str(C.ROOT / "tools/openclinxr/evidence/hair-guides0"
                    / "guides.npz"), allow_pickle=True)
    C.track(C.ROOT / "tools/openclinxr/evidence/hair-guides0/guides.npz")
    crown = np.array(g["crown"], dtype=np.float64)
    ch = np.array(g["curves_head"], dtype=np.float64)
    world_m = C.head_to_world(ch.reshape(-1, 3), crown).reshape(
        ch.shape[0], ch.shape[1], 3)
    curves_mm = [world_m[i] * 1000.0 for i in range(world_m.shape[0])]
    return crown_tangent(curves_mm)


def azimuth_tangent(curves_mm, crown_m):
    cx, cy = float(crown_m[0]) * 1000.0, float(crown_m[1]) * 1000.0
    vals = []
    for c in curves_mm:
        sel = (c[:-1, 2] >= CROWN_BAND[0]) & (c[:-1, 2] <= CROWN_BAND[1])
        if not sel.any():
            continue
        t = np.diff(c, axis=0)[sel]
        n = np.linalg.norm(t, axis=1)
        n[n == 0] = 1.0
        mx, my = c[:-1, 0][sel] - cx, c[:-1, 1][sel] - cy
        r = np.sqrt(mx * mx + my * my)
        r[r < 1.0] = 1.0
        az = np.abs(t[:, 0] * (-my / r) + t[:, 1] * (mx / r)) / n
        vals.append(az)
    v = np.concatenate(vals) if vals else np.zeros(0)
    return {"mean": round(float(v.mean()), 4) if v.size else 0.0,
            "n": int(v.size)}


def part_crossings(P, curves):
    """Part crossings. Measurement rule (stated): a crossing is an
    opposite-side excursion > 2 mm (one grid voxel). Sub-voxel sign
    dust from paths using midline (x=0) voxels is reported as
    rawFlips but is not a part crossing: no visible rail can be
    0.1 mm wide on a 2 mm grid."""
    rx = np.array(P["roots_mm"])[:, 0]
    raw = 0
    over = 0
    maxexc = 0.0
    for i, c in enumerate(curves):
        if abs(float(rx[i])) < 3.0:
            continue
        s = np.sign(float(rx[i]))
        opp = c[:, 0] * s < 0
        if opp.any():
            raw += 1
            exc = float((-c[opp, 0] * s).max())
            maxexc = max(maxexc, exc)
            if exc > 2.0:
                over += 1
    return {"rawFlips": raw, "crossingsOver2mm": over,
            "maxExcursionMm": round(maxexc, 2)}


def back_gap(P):
    ends = np.array(P["ends"])
    adj = np.load(str(E / "graph.npz"))
    ex = np.array(adj["node_xyz"])[ends][:, 0]
    fam = np.array(P["roots_mm"])[:, 1] < float(P["y_ear_mm"])
    bx = sorted(float(v) for v in ex[~fam] if abs(float(v)) <= 80.0)
    gaps = [b - a for a, b in zip(bx, bx[1:])] if len(bx) > 1 else []
    return {"n": len(bx), "maxGapMm": round(max(gaps), 2) if gaps else 0.0}


def endpoint_coverage(P):
    """3D nearest-neighbour spacing per band (mm): the enforced
    quantity (distinct-voxel floor => NN >= 2.0 always)."""
    ends = np.array(P["ends"])
    xyz = np.array(np.load(str(E / "graph.npz"))["node_xyz"])[ends]
    fam = np.array(P["roots_mm"])[:, 1] < float(P["y_ear_mm"])
    rx = np.array(P["roots_mm"])[:, 0]
    out = {}
    for name, m in (("CL", fam & (rx < 0)), ("CR", fam & (rx >= 0)),
                    ("BKL", ~fam & (rx < 0)), ("BKR", ~fam & (rx >= 0))):
        ex = xyz[m]
        nn = []
        if len(ex) > 1:
            d2 = ((ex[:, None, :] - ex[None, :, :]) ** 2).sum(axis=2)
            np.fill_diagonal(d2, np.inf)
            nn = list(np.sqrt(d2.min(axis=1)))
        nn = np.array(nn)
        out[name] = {"n": int(m.sum()),
                     "nnMinMm": round(float(nn.min()), 2) if nn.size else 0.0,
                     "nnP50Mm": round(float(np.percentile(nn, 50)), 2)
                     if nn.size else 0.0,
                     "fracNNunder2mm": round(float((nn < 2.0).mean()), 3)
                     if nn.size else 0.0,
                     "fracNNunder4mm": round(float((nn < 4.0).mean()), 3)
                     if nn.size else 0.0}
    return out


def tube_raster(curves_mm, crown_m, inp, tube_r_mm=3.0):
    sensor = inp["sensor"]
    cams = inp["cams"]
    out = {}
    for view in ("front", "profile_90", "back"):
        cam = cams["views"][view]
        focal = float(cam["lensMm"]) / float(sensor) * FRAME
        cover = np.zeros((FRAME, FRAME), dtype=bool)
        depth = np.full((FRAME, FRAME), np.inf)
        _, bdepth = inp["body"][view][
            "cover"], inp["body"][view]["depth"]
        bdepth = np.array(bdepth, dtype=np.float64)
        for c in curves_mm:
            pts = (np.asarray(c, dtype=np.float64) / 1000.0)
            cols, rows, dep = C.ENV.project_to_render(pts, cam, sensor)
            rr = tube_r_mm / 1000.0 * focal / np.maximum(dep, 1e-6)
            for k in range(len(pts)):
                if dep[k] <= 0:
                    continue
                r = float(rr[k])
                if r < 0.5:
                    r = 0.5
                c0, r0 = float(cols[k]), float(rows[k])
                xlo, xhi = max(int(c0 - r), 0), min(int(c0 + r), FRAME - 1)
                ylo, yhi = max(int(r0 - r), 0), min(int(r0 + r), FRAME - 1)
                if xhi < xlo or yhi < ylo:
                    continue
                yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
                disc = (xx - c0) ** 2 + (yy - r0) ** 2 <= r * r
                if not disc.any():
                    continue
                win_b = bdepth[ylo:yhi + 1, xlo:xhi + 1]
                vis = disc & (dep[k] < win_b - 0.0005)
                if not vis.any():
                    continue
                sub = np.zeros_like(disc, dtype=bool)
                cur = depth[ylo:yhi + 1, xlo:xhi + 1]
                sub[vis] = dep[k] < cur[vis]
                cur[sub] = dep[k]
                depth[ylo:yhi + 1, xlo:xhi + 1] = cur
                cov = cover[ylo:yhi + 1, xlo:xhi + 1]
                cov |= vis
                cover[ylo:yhi + 1, xlo:xhi + 1] = cov
        out[view] = (cover, depth)
    return out


def regional_pq(fitted, target):
    bf = fitted ^ ndimage.binary_erosion(fitted)
    bt = target ^ ndimage.binary_erosion(target)
    edt_t = ndimage.distance_transform_edt(~bt)
    edt_f = ndimage.distance_transform_edt(~bf)
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    out_f = ~target[fr, fc] if fr.size else np.zeros(0, dtype=bool)
    out_t = ~fitted[tr, tc] if tr.size else np.zeros(0, dtype=bool)
    de = edt_t[fr, fc][out_f] if fr.size else np.zeros(0)
    dm = edt_f[tr, tc][out_t] if tr.size else np.zeros(0)
    q = lambda a, p: round(float(np.percentile(a, p)), 1) if a.size else 0.0
    return ({"excessN": int(out_f.sum()), "excessP50": q(de, 50),
             "excessP95": q(de, 95),
             "missN": int(out_t.sum()), "missP50": q(dm, 50),
             "missP95": q(dm, 95)},
            (fr[out_f], fc[out_f], de))


def scalp_poke_masks(inp):
    """Step-1-style poke: warped scalp silhouette outside the target
    hair mask above the hairline/ear line (hull0c mechanism: Aisha's
    head is bigger than the target's head-plus-hair, so crown hair
    necessarily projects outside the mask there). Per view target
    frame bool. Shell-overhang excess inside poke is UNAVOIDABLE
    head mismatch, not a routing defect."""
    out = {}
    for view in ("front", "profile_90", "back"):
        verts = np.array(inp["scalp"]["verts"], dtype=np.float64)
        tris = np.array(inp["scalp"]["tris"], dtype=np.int64)
        cam = inp["cams"]["views"][view]
        loc = np.array(cam["location"], dtype=np.float64)
        a = verts[tris[:, 0]]
        n = np.cross(verts[tris[:, 1]] - a, verts[tris[:, 2]] - a)
        cen = (a + verts[tris[:, 1]] + verts[tris[:, 2]]) / 3.0
        keep = tris[(n * (cen - loc)).sum(axis=1) < 0.0]
        cols, rows, dep = C.ENV.project_to_render(verts, cam, inp["sensor"])
        cover = np.zeros((FRAME, FRAME), dtype=bool)
        depth = np.full((FRAME, FRAME), np.inf)
        for tri in keep:
            C.INS.scan_triangle(
                cover, depth,
                cols[tri[0]], rows[tri[0]], dep[tri[0]],
                cols[tri[1]], rows[tri[1]], dep[tri[1]],
                cols[tri[2]], rows[tri[2]], dep[tri[2]])
        t = inp["transforms"][view]
        s = float(t["scale"])
        rr, cc = np.mgrid[0:FRAME, 0:FRAME]
        rs = np.rint((rr - float(t["ty"])) / s).astype(np.int64)
        cs = np.rint((cc - float(t["tx"])) / s).astype(np.int64)
        ok = ((rs >= 0) & (rs < FRAME) & (cs >= 0) & (cs < FRAME))
        warped = np.zeros((FRAME, FRAME), dtype=bool)
        warped[ok] = cover[rs[ok], cs[ok]]
        loop = np.array(inp["scalp"]["loopPts"], dtype=np.float64)
        lc, lr, ld = C.ENV.project_to_render(loop, cam, inp["sensor"])
        rt = s * lr + float(t["ty"])
        ct = s * lc + float(t["tx"])
        ok2 = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME)
               & (ld > 0))
        cutoff = float(rt[ok2].max())
        rows2 = np.arange(FRAME)[:, None]
        above = np.broadcast_to(rows2 <= int(round(cutoff)),
                                (FRAME, FRAME))
        mask = np.array(inp["masks"][view], dtype=bool)
        out[view] = warped & ~mask & above
    return out


def main():
    E.mkdir(parents=True, exist_ok=True)
    C.track(S7 / "gates.py")
    inp = C.load_all()
    P, curves = load_paths()
    n = len(curves)
    status = [str(s) for s in P["status"]]
    occ = np.array(inp["hull"]["occupancy"], dtype=bool)
    hull = inp["hull"]
    xs = np.array(hull["xs"], dtype=np.float64)
    ys = np.array(hull["ys"], dtype=np.float64)
    zs = np.array(hull["zs"], dtype=np.float64)

    gates = {"nGuides": n,
             "unreachable": int(sum(1 for s in status
                                    if s == "unreachable")),
             "specSha": str(P["spec_sha"][0])}
    gates["endpointCoverage"] = endpoint_coverage(P)
    gates["boundaryFrac4mm"] = round(boundary_frac(
        curves, occ, xs, ys, zs, 2.0), 4)
    gates["crownTangent"] = crown_tangent(curves)
    gates["crownAzimuth"] = azimuth_tangent(curves, np.asarray(P["crown"]))
    gates["crownTangentGuides0"] = guides0_reference()
    gates["crownBandMm"] = list(CROWN_BAND)
    gates["crownTangentGate"] = TANGENT_GATE
    gates["partCrossings"] = part_crossings(P, curves)
    gates["backCentreGap"] = back_gap(P)
    gates["backCentreGapGateMm"] = GAP_GATE_MM
    leader = np.array(P["leader_mm"], dtype=np.float64)
    gates["leaderMm"] = {"max": round(float(leader.max()), 2),
                         "p95": round(float(np.percentile(leader, 95)), 2),
                         "p50": round(float(np.percentile(leader, 50)), 2),
                         "nOver8mm": int((leader > 8).sum())}
    gates["yEarMm"] = float(P["y_ear_mm"])

    render_cover = tube_raster(curves, np.asarray(P["crown"]), inp)
    body_maps = {v: (np.array(inp["body"][v]["cover"], dtype=bool),
                      np.array(inp["body"][v]["depth"], dtype=np.float64))
                 for v in ("front", "profile_90", "back")}
    union = C.INS.occluded_union(render_cover, body_maps,
                                 inp["transforms"])
    regions = C.INS.region_definitions(inp["landmarks"])
    rmasks = C.INS.region_masks(regions)
    poke = scalp_poke_masks(inp)
    gates["pokePx"] = {v: int(poke[v].sum())
                       for v in ("front", "profile_90", "back")}
    reg = {}
    dense = {}
    for view in ("front", "profile_90", "back"):
        reg[view] = {}
        dense[view] = {}
        tgt = np.array(inp["masks"][view], dtype=bool)
        union_d = ndimage.binary_dilation(union[view], iterations=3)
        union_w = ndimage.binary_dilation(union[view], iterations=11)
        for name in ("crown", "side_curtain_L", "side_curtain_R", "hem",
                     "face_opening"):
            m = rmasks[view][name] if name in rmasks[view] else np.zeros(
                (FRAME, FRAME), dtype=bool)
            stats, (er, ec, de) = regional_pq(union[view] & m, tgt & m)
            if er.size:
                in_poke = poke[view][er, ec]
                out_de = de[~in_poke]
                q = lambda a, p: round(float(np.percentile(a, p)), 1) \
                    if a.size else 0.0
                stats["excessN_poke"] = int(in_poke.sum())
                stats["excessN_nonpoke"] = int((~in_poke).sum())
                stats["excessP50_nonpoke"] = q(out_de, 50)
                stats["excessP95_nonpoke"] = q(out_de, 95)
            else:
                stats["excessN_poke"] = 0
                stats["excessN_nonpoke"] = 0
                stats["excessP50_nonpoke"] = 0.0
                stats["excessP95_nonpoke"] = 0.0
            reg[view][name] = stats
            dstats, _ = regional_pq(union_d & m, tgt & m)
            wstats, _ = regional_pq(union_w & m, tgt & m)
            dense[view][name] = {
                "missN": dstats["missN"], "missP50": dstats["missP50"],
                "missP95": dstats["missP95"],
                "missP50_dil11": wstats["missP50"],
                "missP95_dil11": wstats["missP95"]}
    gates["regional"] = reg
    gates["regionalDenseProxy"] = dense
    guards = C.INS.guard_definitions(inp["landmarks"])
    boxes = C.INS.guard_boxes_render(guards, inp["transforms"])
    refs = C.INS.face_ref_depths(
        {"brow": inp["brow"], "menton": inp["menton"]}, inp["cams"])
    gates["faceGuards"] = C.INS.face_guard_depth(render_cover, refs, boxes)
    (E / "gates.json").write_text(json.dumps(gates, indent=1) + "\n")
    print(json.dumps({k: v for k, v in gates.items()
                      if k != "regional"}, indent=1), flush=True)
    print("REGIONAL " + json.dumps(reg), flush=True)
    C.write_inputs_log([S7 / "gates.py"])


if __name__ == "__main__":
    main()
