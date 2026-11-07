"""hair-hull0c: carve UNION scalp-shell (fixes hull0b's bald dome).

Mechanism under test (step 1 measures, not assumes): the target masks come
from a different person; where Aisha's head is larger than the target's
head-plus-hair, the target hair outline falls INSIDE Aisha's skull, so every
voxel just outside Aisha's scalp projects outside some target mask and is
rejected. The carve is (target hair silhouette) minus (Aisha).

Pipeline:
  step 1  mismatch(): per view (front, profile_90, back) warp the bare-body
          render-frame cover (hair-cage1/body-depth.npz, topper excluded)
          into the target frame via the pinned registration similarity and
          report the region where the body lies OUTSIDE the registered
          (undilated) target hair mask above the hairline/ear line.
          -> E/mismatch.png + WS/mismatch.json
  step 2  shell(): voxels between the scalp1 scalp mesh (hair region only)
          and an offset t(z) = 6 + 4*clip((z-1560)/60,0,1) mm
          (10 mm at the crown z>=1620, 6 mm at/--below the occiput/temple
          line z<=1560; linear ramp between). The 10 mm crown value is the
          same hair-over-skull allowance the skull-mode registration
          already assumes (targetTripleProvenance: front a += 10mm * ...).
          Shell voxels must clear the exact SDF by > 2 mm (outside body).
          -> union = carve_final UNION shell
  step 3  diag_union(): hull0b diagnostics re-run on the union, with excess
          split into carve excess vs UNAVOIDABLE_HEAD_MISMATCH (shell-only
          excess pixels inside the step-1 poke region).
  step 4  export_union() + Blender figure + RESULT/DONE/GATES_PASS.

Reuse by import (no copies): hull.py (carve, states, metrics), instruments,
envelope, register model, exact SDF, scalp1 mesh + roots.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

S6 = Path(__file__).resolve().parent
HAIR_GROOM = S6.parent
sys.path.insert(0, str(S6))
sys.path.insert(0, str(HAIR_GROOM / "cage"))
sys.path.insert(0, str(HAIR_GROOM))
import envelope as ENV  # noqa: E402
import instruments as INS  # noqa: E402
import exact as EXACT  # noqa: E402
import hull as H  # noqa: E402
from scipy import ndimage  # noqa: E402

ROOT = S6.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-hull0c"
WS = E / "workspace"
E0B = ROOT / "tools/openclinxr/evidence/hair-hull0b"
H.E = E
H.WS = WS
H.USE_MIRROR = True

FRAME = H.FRAME
VIEWS = H.VIEWS

# Taper rule (stated): t(z) in mm, z in world mm.
T_Z_LO, T_Z_HI, T_MIN, T_MAX = 1560.0, 1620.0, 6.0, 10.0


def taper_t(z_mm):
    z = np.asarray(z_mm, dtype=np.float64)
    w = np.clip((z - T_Z_LO) / (T_Z_HI - T_Z_LO), 0.0, 1.0)
    return T_MIN + (T_MAX - T_MIN) * w


# ---------------------------------------------------------------- step 1
def warp_cover_to_target(cover, t):
    """Render-frame bool cover -> target-frame bool cover (nearest)."""
    s = float(t["scale"])
    rr, cc = np.mgrid[0:FRAME, 0:FRAME]
    rs = np.rint((rr - float(t["ty"])) / s).astype(np.int64)
    cs = np.rint((cc - float(t["tx"])) / s).astype(np.int64)
    ok = ((rs >= 0) & (rs < FRAME) & (cs >= 0) & (cs < FRAME))
    out = np.zeros((FRAME, FRAME), dtype=bool)
    out[ok] = np.asarray(cover)[rs[ok], cs[ok]]
    return out


def scalp_cover_render(inp, v):
    """Render-frame bool cover of the scalp1 scalp mesh (hair region only).

    Rasterizes the 778 scalp tris with the station rasterizer; the face
    is excluded by construction (no face-hole contamination).
    """
    verts = np.array(inp["scalp"]["verts"], dtype=np.float64)  # metres
    tris = np.array(inp["scalp"]["tris"], dtype=np.int64)
    cam = inp["cams"]["views"][v]
    # backface cull: the scalp is an open cap; without culling the far
    # side paints through the face opening (whole-head silhouette).
    loc = np.array(cam["location"], dtype=np.float64)
    a = verts[tris[:, 0]]
    n = np.cross(verts[tris[:, 1]] - a, verts[tris[:, 2]] - a)
    cen = (a + verts[tris[:, 1]] + verts[tris[:, 2]]) / 3.0
    front = (n * (cen - loc)).sum(axis=1) < 0.0
    tris = tris[front]
    cols, rows, dep = ENV.project_to_render(verts, cam, inp["sensor"])
    cover = np.zeros((FRAME, FRAME), dtype=bool)
    depth = np.full((FRAME, FRAME), np.inf)
    for tri in tris:
        INS.scan_triangle(
            cover, depth,
            cols[tri[0]], rows[tri[0]], dep[tri[0]],
            cols[tri[1]], rows[tri[1]], dep[tri[1]],
            cols[tri[2]], rows[tri[2]], dep[tri[2]])
    return cover


def poke_region(inp, v):
    """Step-1 poke: warped scalp cover OUTSIDE target mask, above line."""
    sc = scalp_cover_render(inp, v)
    warped = warp_cover_to_target(sc, inp["transforms"][v])
    mask = np.array(inp["masks"][v], dtype=bool)
    cutoff = hairline_cutoff_row(inp, v)
    rows = np.arange(FRAME)[:, None]
    above = np.broadcast_to(rows <= int(round(cutoff)), (FRAME, FRAME))
    return warped & ~mask & above, warped, mask, cutoff


def target_mmpix(inp, v):
    """Target-frame mm/px at the scalp centroid depth (stated approx)."""
    scalp = inp["scalp"]
    cen = (np.array(scalp["verts"], dtype=np.float64).mean(axis=0)
           / 1000.0)
    cam = inp["cams"]["views"][v]
    _, _, dep = ENV.project_to_render(cen[None, :], cam, inp["sensor"])
    focal = float(cam["lensMm"]) / float(inp["sensor"]) * FRAME
    render_mmpix = float(dep[0]) * 1000.0 / focal
    return render_mmpix / float(inp["transforms"][v]["scale"])


def hairline_cutoff_row(inp, v):
    """Max (lowest) target row of the scalp hairline loop in view v.

    Region rows 0..cutoff = 'above the hairline/ear line'. The loop runs
    frontal arc -> temples -> sideburns -> nape, so its lowest projected
    point is the ear/nape line per view.
    """
    loop = np.array(inp["scalp"]["loopPts"], dtype=np.float64)  # metres
    cam = inp["cams"]["views"][v]
    cols, rows, dep = ENV.project_to_render(loop, cam, inp["sensor"])
    t = inp["transforms"][v]
    s = float(t["scale"])
    rt = s * rows + float(t["ty"])
    ct = s * cols + float(t["tx"])
    ok = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME)
          & (dep > 0))
    assert ok.sum() > 100, (v, int(ok.sum()))
    return float(rt[ok].max())


def step_mismatch():
    WS.mkdir(parents=True, exist_ok=True)
    inp = H.load_inputs()
    out = {}
    panels = {}
    for v in VIEWS:
        poke, warped, mask, cutoff = poke_region(inp, v)
        mmpix = target_mmpix(inp, v)
        edt = ndimage.distance_transform_edt(~mask)
        d = edt[poke] if poke.any() else np.zeros(0)
        q = (lambda a, p: round(float(np.percentile(a, p)), 2)
             if a.size else 0.0)
        n = int(poke.sum())
        out[v] = {
            "cutoffTargetRow": round(float(cutoff), 1),
            "warpedScalpPx": int(warped.sum()),
            "targetMaskPx": int(mask.sum()),
            "pokeAreaPx": n,
            "pokeAreaMm2": round(n * mmpix ** 2, 1),
            "mmpix": round(mmpix, 4),
            "protrusionPx": {"max": q(d, 100), "p95": q(d, 95),
                             "p50": q(d, 50),
                             "mean": round(float(d.mean()), 2)
                             if d.size else 0.0},
            "protrusionMm": {"max": round(q(d, 100) * mmpix, 2),
                             "p95": round(q(d, 95) * mmpix, 2),
                             "p50": round(q(d, 50) * mmpix, 2)},
        }
        panels[v] = (mask, poke, warped)
        print("MISMATCH %s pokePx=%d pokeMm2=%.1f p95px=%.2f maxpx=%.2f "
              "cutoffRow=%.1f mmpix=%.4f"
              % (v, n, n * mmpix ** 2, q(d, 95), q(d, 100), cutoff,
                 mmpix), flush=True)
    (WS / "mismatch.json").write_text(json.dumps(out, indent=1))
    mismatch_fig(panels, out)
    return out


def mismatch_fig(panels, stats):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 3, figsize=(18, 7))
    for ax, v in zip(axes, VIEWS):
        mask, poke, warped = panels[v]
        rgb = np.zeros((FRAME, FRAME, 3), dtype=np.uint8)
        rgb[mask] = (90, 90, 90)
        rgb[warped & mask] = (45, 140, 60)
        rgb[poke] = (255, 40, 40)
        ax.imshow(rgb[::2, ::2])
        s = stats[v]
        ax.set_title("%s poke=%dpx/%.0fmm2 p95=%.1fpx/%.1fmm max=%.1fpx "
                     "(cutoff row %.0f)" % (
                         v, s["pokeAreaPx"], s["pokeAreaMm2"],
                         s["protrusionPx"]["p95"],
                         s["protrusionMm"]["p95"],
                         s["protrusionPx"]["max"],
                         s["cutoffTargetRow"]), fontsize=10)
        ax.set_aspect("equal")
        ax.axis("off")
    fig.suptitle("hair-hull0c step 1: Aisha SCALP silhouette (warped to "
                 "target) vs target hair mask above hairline/ear line: "
                 "poke = red, scalp-inside-mask = green, mask = gray "
                 "(1/2 subsample)")
    fig.tight_layout()
    fig.savefig(str(E / "mismatch.png"), dpi=100)
    plt.close(fig)


# ---------------------------------------------------------------- step 2
def build_shell(inp, xs, ys, zs, spacing):
    """Boolean shell grid: dist-to-scalp <= t(z), SDF > 2 mm."""
    verts = np.array(inp["scalp"]["verts"], dtype=np.float64) * 1000.0
    tris = np.array(inp["scalp"]["tris"], dtype=np.int64)
    nx, ny, nz = len(xs), len(ys), len(zs)
    shell = np.zeros((nx, ny, nz), dtype=bool)
    r = T_MAX  # stamp margin = max offset
    o = np.array([xs[0], ys[0], zs[0]])
    for tri in tris:
        a, b, c = verts[tri[0]], verts[tri[1]], verts[tri[2]]
        lo = np.floor((np.minimum(np.minimum(a, b), c) - r - o)
                      / spacing).astype(int)
        hi = np.floor((np.maximum(np.maximum(a, b), c) + r - o)
                      / spacing).astype(int)
        lo = np.maximum(lo, 0)
        hi = np.minimum(hi, np.array([nx, ny, nz]) - 1)
        if (hi < lo).any():
            continue
        gx = xs[lo[0]:hi[0] + 1]
        gy = ys[lo[1]:hi[1] + 1]
        gz = zs[lo[2]:hi[2] + 1]
        Gz, Gy, Gx = np.meshgrid(gz, gy, gx, indexing="ij")
        p = np.stack([Gx.ravel(), Gy.ravel(), Gz.ravel()], axis=1)
        d = H.pt_tri_dist(p, a, b, c)
        sel = d <= taper_t(p[:, 2]) + 1e-9
        if not sel.any():
            continue
        zz, yy, xx = np.unravel_index(np.nonzero(sel)[0],
                                      (len(gz), len(gy), len(gx)))
        shell[lo[0] + xx, lo[1] + yy, lo[2] + zz] = True
    n_raw = int(shell.sum())
    # outside-body only (exact SDF > 2 mm), chunked
    idx = np.stack(np.nonzero(shell), axis=1)
    pts = np.stack([xs[idx[:, 0]], ys[idx[:, 1]],
                    zs[idx[:, 2]]], axis=1)
    keep = np.zeros(len(idx), dtype=bool)
    for a in range(0, len(idx), 500_000):
        sdf = EXACT.query_exact(inp["egrid"], pts[a:a + 500_000])
        keep[a:a + 500_000] = sdf > H.SDF_CLEAR_MM
    removed = int((~keep).sum())
    shell[idx[~keep, 0], idx[~keep, 1], idx[~keep, 2]] = False
    print("SHELL raw=%d sdfRemoved=%d final=%d (%.1f mm^3)" % (
        n_raw, removed, int(shell.sum()),
        float(shell.sum()) * spacing ** 3), flush=True)
    return shell


# ------------------------------------------------------- union + diag
def splat_notocc(sel, states_packed, xs, ys, zs, inp):
    """Target-frame splat of voxels NOT body-occluded (state != 2)."""
    Xg, Yg, Zg = np.meshgrid(xs, ys, zs, indexing="ij")
    out = {}
    for vi, v in enumerate(inp["views"]):
        src, mir = H.view_source(v)
        st = H.unpack_state(states_packed, vi)
        use = sel & (st != 2)
        pts = np.stack([Xg[use], Yg[use], Zg[use]], axis=1)
        if mir:
            pts = H.mirror_points(pts)
        m = np.zeros((FRAME, FRAME), dtype=bool)
        if pts.shape[0]:
            cam = inp["cams"]["views"][src]
            cols, rows, _ = ENV.project_to_render(pts / 1000.0, cam,
                                                  inp["sensor"])
            t = inp["transforms"][src]
            s = float(t["scale"])
            ct = np.rint(s * cols + float(t["tx"])).astype(np.int64)
            rt = np.rint(s * rows + float(t["ty"])).astype(np.int64)
            ok = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME))
            m[rt[ok], ct[ok]] = True
        out[v] = m
    return out


def crown_band(final, xs, ys, zs, inp, z=1600.0):
    """Single extra thickness band at crown height (same ray method)."""
    spacing = float(xs[1] - xs[0])
    ox, oy, oz = float(xs[0]), float(ys[0]), float(zs[0])
    nx, ny, nz = len(xs), len(ys), len(zs)

    def occ_at(pts_mm):
        ix = np.rint((pts_mm[:, 0] - ox) / spacing).astype(int)
        iy = np.rint((pts_mm[:, 1] - oy) / spacing).astype(int)
        iz = np.rint((pts_mm[:, 2] - oz) / spacing).astype(int)
        ok = ((ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
              & (iz >= 0) & (iz < nz))
        o = np.zeros(pts_mm.shape[0], dtype=bool)
        o[ok] = final[ix[ok], iy[ok], iz[ok]]
        return o

    c = np.array([0.0, -50.0, z])
    th = []
    for k in range(72):
        phi = 2 * np.pi * k / 72
        d = np.array([np.cos(phi), np.sin(phi), 0.0])
        t = np.arange(0.0, 221.0, 1.0)
        pts = c[None, :] + t[:, None] * d[None, :]
        sdf = EXACT.query_exact(inp["egrid"], pts)
        inside = sdf < 0
        if not inside[0]:
            continue
        edge = np.nonzero(~inside)[0]
        if edge.size == 0:
            continue
        surf = float(edge[0])
        o = occ_at(pts)
        oo = np.nonzero(o)[0]
        oo = oo[oo >= surf]
        if oo.size == 0:
            continue
        th.append(float(oo.max() - oo.min()))
    th = np.array(th)
    q = lambda a, p: round(float(np.percentile(a, p)), 1) if a.size else 0.0
    return {"z": z, "nRays": 72, "nHair": int(th.size),
            "p50": q(th, 50), "p95": q(th, 95), "max": q(th, 100),
            "mean": round(float(th.mean()), 1) if th.size else 0.0,
            "values": [round(float(v), 1) for v in th]}


def main():
    import matplotlib
    matplotlib.use("Agg")
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)

    mm = step_mismatch()

    # carve (identical code + inputs to hull0b; scorched into this E).
    # Resume-safe: the carve is deterministic; skip if already on disk.
    if not (WS / "baseline_kept.npz").exists():
        H.stage_carve()
    else:
        H.load_inputs()  # re-track inputs log without recomputing
    inp = H.load_inputs()
    ws = np.load(str(WS / "baseline_kept.npz"))
    carve = np.array(ws["final"])
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    spacing = 2.0

    # shell + union
    shell = build_shell(inp, xs, ys, zs, spacing)
    dil = H.dilate_masks(inp["masks"], 2)
    occ = H.occluder_maps(inp["body"])
    sh_only_idx = np.stack(np.nonzero(shell & ~carve), axis=1)
    sh_pts = np.stack([xs[sh_only_idx[:, 0]], ys[sh_only_idx[:, 1]],
                       zs[sh_only_idx[:, 2]]], axis=1)
    sh_states = (H.states_for_points(sh_pts, inp, dil, occ)
                 if len(sh_only_idx) else
                 np.zeros((0, len(inp["views"])), dtype=np.uint8))
    states = np.array(ws["states_packed"])
    # unpack, fill shell-only, repack
    nv = len(inp["views"])
    full_states = np.zeros(carve.shape + (nv,), dtype=np.uint8)
    for vi in range(nv):
        full_states[..., vi] = H.unpack_state(states, vi)
    if len(sh_only_idx):
        for vi in range(nv):
            full_states[sh_only_idx[:, 0], sh_only_idx[:, 1],
                        sh_only_idx[:, 2], vi] = sh_states[:, vi]
    union = carve | shell
    viscount = (full_states == 0).sum(axis=-1).astype(np.uint8)
    viscount[~union] = 0
    packed = H.pack_states(full_states)

    # scalp-connected filter on the union: dominant touching label plus
    # any touching label that carries shell (shell must survive whole)
    lab, n_post, sizes = H.label_comps(union)
    contact = H.scalp_contact_mask(union.shape, xs, ys, zs, inp["scalp"],
                                   spacing)
    touch = sorted(set(np.unique(lab[union & contact]).tolist()) - {0})
    tsize = {int(ll): int((lab == ll).sum()) for ll in touch}
    dom = max(touch, key=lambda ll: tsize[ll]) if touch else 0
    sh_labels = (set(np.unique(
        lab[shell & union]).tolist()) - {0} if shell.any() else set())
    keep_labels = ({int(dom)} if dom else set()) | \
        {int(ll) for ll in touch if ll in sh_labels}
    final = np.zeros_like(union)
    for ll in keep_labels:
        final |= lab == ll
    dropped = {str(ll): sz for ll, sz in tsize.items()
               if ll not in keep_labels}
    sh_outside = int((shell & ~final).sum())
    print("UNION carve=%d shell=%d unionRaw=%d comps=%d touch=%d dom=%d "
          "keepLabels=%s droppedTouch=%s shellOutside=%d final=%d" % (
              int(carve.sum()), int(shell.sum()), int(union.sum()),
              n_post, len(touch), int(dom), sorted(keep_labels),
              dropped, sh_outside, int(final.sum())), flush=True)
    np.savez_compressed(
        str(WS / "union_kept.npz"), carve=carve, shell=shell,
        union=union, final=final, viscount=viscount,
        states_packed=packed, xs=xs, ys=ys, zs=zs,
        keep_labels=np.array(sorted(keep_labels)),
        dropped_touch=np.array(json.dumps(dropped)),
        shell_only_states=sh_states)
    # ---- diagnostics on the union
    splatU = splat_notocc(final, packed, xs, ys, zs, inp)
    for v in inp["views"]:
        np.save(str(WS / ("splat_union_%s.npy" % v)), splatU[v])
    splatC = splat_notocc(carve, packed, xs, ys, zs, inp)
    shell_only = final & ~carve
    splatS = splat_notocc(shell_only, packed, xs, ys, zs, inp)
    cm = H.contour_metrics({v: splatU[v] for v in VIEWS}, inp["masks"])
    # excess split (raw splats, same definition as contour_metrics)
    excess = {}
    for v in VIEWS:
        mask = np.array(inp["masks"][v], dtype=bool)
        edt_fill = ndimage.distance_transform_edt(~mask)
        ce = splatC[v] & ~mask
        se = splatS[v] & ~mask & ~splatC[v]
        poke, _, _, _ = poke_region(inp, v)
        unav = se & poke
        soth = se & ~poke
        st = lambda m: {  # noqa: E731
            "n": int(m.sum()),
            "p50": round(float(np.percentile(edt_fill[m], 50)), 2)
            if m.any() else 0.0,
            "p95": round(float(np.percentile(edt_fill[m], 95)), 2)
            if m.any() else 0.0,
            "max": round(float(edt_fill[m].max()), 2)
            if m.any() else 0.0}
        excess[v] = {"carve": st(ce), "unavoidableHeadMismatch": st(unav),
                     "shellOther": st(soth),
                     "pokePx": int(poke.sum())}
    th = H.thickness_bands(final, xs, ys, zs, inp)
    th["crown"] = crown_band(final, xs, ys, zs, inp)
    occd = H.occiput_depth(final, xs, ys, zs, inp)
    edt3 = ndimage.distance_transform_edt(~final) * spacing
    rxyz = np.array(inp["roots"]["xyz"], dtype=np.float64) * 1000.0
    ix = np.rint((rxyz[:, 0] - xs[0]) / spacing).astype(int)
    iy = np.rint((rxyz[:, 1] - ys[0]) / spacing).astype(int)
    iz = np.rint((rxyz[:, 2] - zs[0]) / spacing).astype(int)
    ok = ((ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
          & (iz >= 0) & (iz < len(zs)))
    dd = edt3[ix[ok], iy[ok], iz[ok]]
    prox_all = {"n": int(ok.sum()),
                "p50": round(float(np.percentile(dd, 50)), 2),
                "p95": round(float(np.percentile(dd, 95)), 2),
                "max": round(float(dd.max()), 2),
                "fracWithin6mm": round(float((dd <= 6.0).mean()), 4)}
    root_prox = {"all": prox_all}
    rz = rxyz[ok, 2]
    for bname, (zlo, zhi) in (("crown_z1560up", (1560.0, 1e9)),
                              ("mid_z1500_1560", (1500.0, 1560.0)),
                              ("nape_z below1500", (0.0, 1500.0))):
        sel = (rz >= zlo) & (rz < zhi)
        if not sel.any():
            root_prox[bname] = {"n": 0}
            continue
        d2 = dd[sel]
        root_prox[bname] = {
            "n": int(sel.sum()),
            "p50": round(float(np.percentile(d2, 50)), 2),
            "p95": round(float(np.percentile(d2, 95)), 2),
            "fracWithin6mm": round(float((d2 <= 6.0).mean()), 4)}
    xcheck = H.sdf_crosscheck(inp)
    bins = {str(k): int(((viscount[final]) == k).sum())
            for k in range(nv + 1)}
    vox_mm3 = spacing ** 3
    diag = {"contourUnion": cm, "excessSplit": excess,
            "thickness": th, "occiput": occd, "rootProx": root_prox,
            "sdfCrosscheck": xcheck,
            "volByVisCount": {k: {"n": n, "mm3": round(n * vox_mm3, 1)}
                              for k, n in bins.items()},
            "volMm3": round(float(final.sum()) * vox_mm3, 1),
            "keptFinal": int(final.sum()),
            "carveVox": int(carve.sum()),
            "shellVox": int(shell.sum()),
            "shellOnlyVox": int(shell_only.sum()),
            "shellOutsideKept": sh_outside,
            "nCompUnion": int(n_post),
            "touchLabels": [int(ll) for ll in touch],
            "keepLabels": sorted(keep_labels),
            "droppedTouch": {str(k): int(v)
                             for k, v in dropped.items()},
            "taperRule": "t(z)=6+4*clip((z-1560)/60,0,1) mm "
                         "(10 crown z>=1620, 6 at/below 1560)",
            "mismatch": mm}
    (WS / "diag_union.json").write_text(json.dumps(diag, indent=1))
    H.slices_fig(final, viscount, xs, ys, zs, th, inp)
    print(json.dumps(
        {"excessSplit": excess, "volByVisCount": diag["volByVisCount"],
         "rootProx": root_prox, "occiputWall": occd["posteriorWallMm"],
         "thickness": {k: {kk: v[kk] for kk in ("nHair", "p50", "p95",
                                                "max") if kk in v}
                       for k, v in th.items()}}, indent=1), flush=True)

    # ---- sensitivity on the union
    sens = {}
    # A: 1 mm re-carve + 1 mm shell
    res = H.carve_grids(inp, spacing=1.0, dil_px=2, store=True)
    filt = H.close_and_filter(res, inp, res["dil"], res["occ"])
    sh1 = build_shell(inp, res["xs"], res["ys"], res["zs"], 1.0)
    u1 = filt["final"] | sh1
    sp1 = H.pack_states(res["states"])
    nvv = len(inp["views"])
    fs1 = np.zeros(filt["final"].shape + (nvv,), dtype=np.uint8)
    for vi in range(nvv):
        fs1[..., vi] = H.unpack_state(sp1, vi)
    so1 = np.stack(np.nonzero(sh1 & ~filt["final"]), axis=1)
    if len(so1):
        pts1 = np.stack([res["xs"][so1[:, 0]], res["ys"][so1[:, 1]],
                         res["zs"][so1[:, 2]]], axis=1)
        st1 = H.states_for_points(pts1, inp, res["dil"], res["occ"])
        for vi in range(nvv):
            fs1[so1[:, 0], so1[:, 1], so1[:, 2], vi] = st1[:, vi]
    vc1 = (fs1 == 0).sum(axis=-1).astype(np.uint8)
    vc1[~u1] = 0
    spl1 = splat_notocc(u1, H.pack_states(fs1), res["xs"], res["ys"],
                        res["zs"], inp)
    cm1 = H.contour_metrics({v: spl1[v] for v in VIEWS}, inp["masks"])
    del res, sp1, fs1
    sens["spacing1mm"] = {
        "spacing": 1.0, "dilPx": 2, "keptFinal": int(u1.sum()),
        "volMm3": round(float(u1.sum()) * 1.0, 1),
        "shellVox": int(sh1.sum()),
        "nCompCarvePre": filt["n_pre"], "nCompCarvePost": filt["n_post"],
        "contour": cm1}
    # B: 2 mm re-carve undilated + baseline shell
    res2 = H.carve_grids(inp, spacing=2.0, dil_px=0, store=True)
    filt2 = H.close_and_filter(res2, inp, res2["dil"], res2["occ"])
    u2 = filt2["final"] | shell
    sp2 = H.pack_states(res2["states"])
    fs2 = np.zeros(filt2["final"].shape + (nvv,), dtype=np.uint8)
    for vi in range(nvv):
        fs2[..., vi] = H.unpack_state(sp2, vi)
    so2 = np.stack(np.nonzero(shell & ~filt2["final"]), axis=1)
    if len(so2):
        pts2 = np.stack([xs[so2[:, 0]], ys[so2[:, 1]],
                         zs[so2[:, 2]]], axis=1)
        st2 = H.states_for_points(pts2, inp, res2["dil"], res2["occ"])
        for vi in range(nvv):
            fs2[so2[:, 0], so2[:, 1], so2[:, 2], vi] = st2[:, vi]
    vc2 = (fs2 == 0).sum(axis=-1).astype(np.uint8)
    vc2[~u2] = 0
    spl2 = splat_notocc(u2, H.pack_states(fs2), xs, ys, zs, inp)
    cm2 = H.contour_metrics({v: spl2[v] for v in VIEWS}, inp["masks"])
    del res2, sp2, fs2
    sens["undilated"] = {
        "spacing": 2.0, "dilPx": 0, "keptFinal": int(u2.sum()),
        "volMm3": round(float(u2.sum()) * 8.0, 1),
        "shellVox": int(shell.sum()),
        "nCompCarvePre": filt2["n_pre"],
        "nCompCarvePost": filt2["n_post"],
        "contour": cm2}
    base_cm = cm
    for key in ("spacing1mm", "undilated"):
        c = sens[key]["contour"]
        maxd = 0.0
        fragile = []
        for v in VIEWS:
            for m in ("excessP95", "missP95"):
                d = abs(c[v][m] - base_cm[v][m])
                maxd = max(maxd, d)
                if d > 5.0:
                    fragile.append("%s/%s: base %s vs %s"
                                   % (v, m, base_cm[v][m], c[v][m]))
        sens[key]["maxContourDeltaPx"] = round(maxd, 2)
        sens[key]["fragile"] = fragile
    (WS / "sens_union.json").write_text(json.dumps(sens, indent=1))
    print(json.dumps({k: {kk: sens[k][kk] for kk in
                          ("keptFinal", "volMm3", "shellVox",
                           "maxContourDeltaPx", "fragile")}
                      for k in sens}, indent=1), flush=True)

    # ---- export union
    from skimage.measure import marching_cubes
    np.savez_compressed(
        str(E / "hull.npz"), occupancy=final, viscount=viscount,
        states_packed=packed,
        states_legend=np.array(["0=INSIDE_MASK", "1=VISIBLE_OUTSIDE",
                                "2=BODY_OCCLUDED"]),
        views=np.array(inp["views"]),
        mirror_profile=np.bool_(True),
        xs=xs, ys=ys, zs=zs, spacing=np.float64(2.0),
        crop=np.array([H.CROP["x0"], H.CROP["x1"], H.CROP["y0"],
                       H.CROP["y1"], H.CROP["z0"], H.CROP["z1"]]),
        shoulder_plane_z=np.float64(H.SHOULDER_PLANE_Z),
        sdf_clear_mm=np.float64(H.SDF_CLEAR_MM),
        dilation_px=np.int64(2),
        registration_p95_px=np.float64(0.0),
        shell_rule=np.array("t(z)=6+4*clip((z-1560)/60,0,1) mm"),
        shell_vox=np.int64(int(shell.sum())),
        carve_vox=np.int64(int(carve.sum())))
    verts, faces, _, _ = marching_cubes(final.astype(np.float32),
                                        level=0.5, spacing=(2.0, 2.0, 2.0))
    world_mm = verts + np.array([xs[0], ys[0], zs[0]])
    world_m = world_mm / 1000.0
    with open(WS / "hull_surface.obj", "w") as f:
        f.write("# hair-hull0c union surface (marching cubes, world m)\n")
        for p in world_m:
            f.write("v %.6f %.6f %.6f\n" % (p[0], p[1], p[2]))
        for t in faces:
            f.write("f %d %d %d\n" % (t[0] + 1, t[1] + 1, t[2] + 1))
    print("export hull.npz bytes=%d tris=%d"
          % ((E / "hull.npz").stat().st_size, len(faces)), flush=True)
    (E / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(H.OPENED + [str(Path(__file__).resolve())])))
        + "\n")


if __name__ == "__main__":
    main()
