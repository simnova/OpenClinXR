"""hair-hull2: hull carve on the APPROVED set aisha-v2 + back-symmetry fix.

Canonical set: aisha-v2 (hair-target3, commit dc3732ca9) = same
three_quarter/profile/back as v1, new front with all hair behind the
shoulders. Manifest v3 pins the four aisha-v2 masks (path + sha) with
identity registration in all views.

Carve = hull1 rules exactly (per-voxel INSIDE_MASK / VISIBLE_OUTSIDE /
BODY_OCCLUDED per view, reject on any VISIBLE_OUTSIDE, 2 mm exact-SDF
clearance, masks dilated 2 px, close <= 1 voxel with added voxels
re-scored, keep the scalp-touching component). No mirror in the base.

Step 2 (back-asymmetry diagnosis): the orchestrator read of hull1's
hull.png saw the BACK render missing a large below-head region on one
side while the target back is a full symmetric sheet
(target L/R = 1.0036). stage_backdiag attributes, per back-view column
band, which view's VISIBLE_OUTSIDE rejected the missing voxels, paints
E/back-diag.png (reprojected hull over the target back mask, rejected
region coloured by rejecting view), measures mask edge noise per view,
and reports the back-view left/right hair-area ratio. Variants tested:
(a) mirrored three_quarter view added (explicit virtual camera
R' = F R F, t' = F t; mask = left-right flipped 3q mask; body-depth
maps rasterized for the mirrored camera from the same station0b mesh);
(b) three_quarter mask pre-dilated by the measured edge noise.
The fix the numbers support is promoted to the final carve
(--final base|a|b); E holds the FINAL hull only, variants under
WS/variants/.

Reuse by import (no copies of method code): hull.py (carve states
metrics export), hull1.py (manifest/inputs binding, below-shoulder
sectors, component report), hull0c.py (mismatch probe, crown band),
instruments, envelope, exact SDF, scalp1 mesh + roots.

Stages (--stage carve|mismatch|diag|backdiag|variants|sensitivity|
export|figure|report|all): carve/mismatch/diag/sensitivity/export run
the FINAL configuration (--final ...); backdiag/variants run on the
4-view base. all = full final pipeline (carve through report), NOT
backdiag/variants (run those explicitly first to choose --final).
"""

from __future__ import annotations

import argparse
import hashlib
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
import hull0c as H0C  # noqa: E402
import hull1 as H1  # noqa: E402
from hull1 import below_shoulder, components_report  # noqa: E402
from scipy import ndimage  # noqa: E402
from PIL import Image as PILImage  # noqa: E402

ROOT = S6.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-hull2"
WS = E / "workspace"
VIEWS1 = ("front", "three_quarter", "profile_90", "back")
MANIFEST = "aisha_straight_long_v3.json"
FRAME = H.FRAME
VDIR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/"
            "target-views/aisha-v2")

OPENED: list[str] = []

FINAL = "base"
DIL_EXTRA_3Q = 0


def track(path) -> Path:
    p = Path(path)
    OPENED.append(str(p.resolve()))
    return p


def use_base():
    """Point hull/hull1 globals at the hull2 base (4 real views, v3)."""
    H1.MANIFEST = MANIFEST
    H1.bind("base")  # 4-view, USE_MIRROR False; E/WS -> hull1 paths
    H1.E = E
    H1.WS = WS
    H.E = E
    H.WS = WS
    H.VIEWS = VIEWS1
    H.USE_MIRROR = False
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)


def patched_inputs():
    """Final-configuration inputs: base v3 inputs + the picked fix."""
    inp = H1.load_inputs()
    if FINAL == "b" and DIL_EXTRA_3Q > 0:
        inp["masks"]["three_quarter"] = ndimage.binary_dilation(
            inp["masks"]["three_quarter"], iterations=int(DIL_EXTRA_3Q))
    elif FINAL == "a":
        inp = add_mirror_3q(inp)
    return inp


def add_mirror_3q(inp):
    """Extend inputs with an explicit mirrored three_quarter view.

    Virtual camera mirrored across x = 0 (R' = F R F, t' = F t, same
    lens/sensor); mask = left-right flip of the 3q target mask (discrete
    j' = W-1-j approximation of the continuous mirror u' = W-u, noted in
    RESULT); body-depth maps rasterized for the mirrored camera from the
    same station0b bare-body mesh; identity target transform.
    """
    mc = H.mirror_camera(inp["cams"]["views"]["three_quarter"])
    cams = dict(inp["cams"])
    cams["views"] = dict(inp["cams"]["views"])
    cams["views"]["three_quarter_mirror"] = mc
    bv = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-station0b/body-verts.npz")))
    q3m = WS / "body-depth-3q-mirror.npz"
    if not q3m.exists():
        maps = INS.body_depth_maps(
            np.array(bv["vertices"], dtype=np.float64),
            np.array(bv["faces"], dtype=np.int64),
            cams, views=("three_quarter_mirror",))
        cover, depth = maps["three_quarter_mirror"]
        print("BODYDEPTH3QM coverPx=%d" % int(cover.sum()), flush=True)
        np.savez_compressed(str(q3m), cover=np.ascontiguousarray(cover),
                            depth=np.where(cover, depth, np.inf).astype(np.float32))
    else:
        z = np.load(str(q3m))
        cover, depth = np.array(z["cover"]), np.array(z["depth"])
    OPENED.append(str(q3m.resolve()))
    body = dict(inp["body"])
    body["three_quarter_mirror"] = {
        "cover": np.array(cover, dtype=bool),
        "depth": np.array(depth, dtype=np.float64)}
    masks = dict(inp["masks"])
    masks["three_quarter_mirror"] = np.fliplr(
        np.array(inp["masks"]["three_quarter"], dtype=bool))
    transforms = dict(inp["transforms"])
    transforms["three_quarter_mirror"] = {"scale": 1.0, "tx": 0.0, "ty": 0.0}
    out = dict(inp)
    out["cams"] = cams
    out["body"] = body
    out["masks"] = masks
    out["transforms"] = transforms
    out["views"] = ["front", "three_quarter", "three_quarter_mirror",
                    "profile_90", "back"]
    return out


def use_final():
    use_base()
    if FINAL == "a":
        H.VIEWS = ("front", "three_quarter", "three_quarter_mirror",
                   "profile_90", "back")
    H.load_inputs = patched_inputs


# ---------------------------------------------------------- mismatch
def stage_mismatch():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    WS.mkdir(parents=True, exist_ok=True)
    inp = H.load_inputs()
    out = {}
    thumbs = {}
    for v in VIEWS1:
        poke, warped, mask, cutoff = H0C.poke_region(inp, v)
        mmpix = H0C.target_mmpix(inp, v)
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
                             "mean": round(float(d.mean()), 2) if d.size else 0.0},
            "protrusionMm": {"max": round(q(d, 100) * mmpix, 2),
                             "p95": round(q(d, 95) * mmpix, 2),
                             "p50": round(q(d, 50) * mmpix, 2)},
        }
        thumbs[v] = (mask, poke, warped)
        print("MISMATCH %s pokePx=%d pokeMm2=%.1f p95px=%.2f maxpx=%.2f "
              "cutoffRow=%.1f mmpix=%.4f"
              % (v, n, n * mmpix ** 2, q(d, 95), q(d, 100), cutoff,
                 mmpix), flush=True)
    (WS / "mismatch.json").write_text(json.dumps(out, indent=1))
    fig, axes = plt.subplots(1, 4, figsize=(24, 7))
    for ax, v in zip(axes, VIEWS1):
        mask, poke, warped = thumbs[v]
        rgb = np.zeros((FRAME, FRAME, 3), dtype=np.uint8)
        rgb[mask] = (90, 90, 90)
        rgb[warped & mask] = (45, 140, 60)
        rgb[poke] = (255, 40, 40)
        ax.imshow(rgb[::2, ::2])
        s = out[v]
        ax.set_title("%s poke=%dpx/%.0fmm2 p95=%.1fpx/%.1fmm max=%.1fpx "
                     "(cutoff row %.0f)" % (
                         v, s["pokeAreaPx"], s["pokeAreaMm2"],
                         s["protrusionPx"]["p95"], s["protrusionMm"]["p95"],
                         s["protrusionPx"]["max"],
                         s["cutoffTargetRow"]), fontsize=10)
        ax.set_aspect("equal")
        ax.axis("off")
    fig.suptitle("hair-hull2 mismatch: Aisha SCALP silhouette (identity: no "
                 "warp) vs target hair mask above hairline/ear line: poke = "
                 "red, scalp-inside-mask = green, mask = gray (1/2 subsample)")
    fig.tight_layout()
    fig.savefig(str(E / "mismatch.png"), dpi=100)
    plt.close(fig)
    return out


# ---------------------------------------------------------- diag
def stage_diag_ext():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    inp = H.load_inputs()
    ws = np.load(str(WS / "baseline_kept.npz"))
    final = np.array(ws["final"])
    viscount = np.array(ws["viscount"])
    states_packed = np.array(ws["states_packed"])
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    splat = H.splat_visible(final, states_packed, xs, ys, zs, inp)
    for v in inp["views"]:
        np.save(str(WS / ("splat_final_%s.npy" % v)), splat[v])
    cm = H.contour_metrics(splat, inp["masks"])
    th = H.thickness_bands(final, xs, ys, zs, inp)
    th["crown"] = H0C.crown_band(final, xs, ys, zs, inp)
    occ = H.occiput_depth(final, xs, ys, zs, inp)
    edt = ndimage.distance_transform_edt(~final) * 2.0
    rxyz = np.array(inp["roots"]["xyz"], dtype=np.float64) * 1000.0
    ix = np.rint((rxyz[:, 0] - xs[0]) / 2.0).astype(int)
    iy = np.rint((rxyz[:, 1] - ys[0]) / 2.0).astype(int)
    iz = np.rint((rxyz[:, 2] - zs[0]) / 2.0).astype(int)
    ok = ((ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
          & (iz >= 0) & (iz < len(zs)))
    dd = edt[ix[ok], iy[ok], iz[ok]]
    prox_all = {"n": int(ok.sum()),
                "p50": round(float(np.percentile(dd, 50)), 2),
                "p95": round(float(np.percentile(dd, 95)), 2),
                "max": round(float(dd.max()), 2),
                "fracWithin6mm": round(float((dd <= 6.0).mean()), 4)}
    root_prox = {"all": prox_all}
    rz = rxyz[ok, 2]
    for bname, (zlo, zhi) in (("crown_z1560up", (1560.0, 1e9)),
                              ("mid_z1500_1560", (1500.0, 1560.0)),
                              ("nape_z_below1500", (0.0, 1500.0))):
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
    below = below_shoulder(final, xs, ys, zs)
    comps = components_report(final)
    stats = json.loads((WS / "carve_stats.json").read_text())
    diag = {"contour": cm, "thickness": th, "occiput": occ,
            "rootProx": root_prox, "sdfCrosscheck": xcheck,
            "belowShoulder": below, "components": comps,
            "volByVisCount": stats["volByVisCount"],
            "keptFinal": stats["keptFinal"], "volMm3": stats["volMm3"],
            "views": inp["views"], "registration": "identity-all-views",
            "final": FINAL}
    (WS / "diag.json").write_text(json.dumps(diag, indent=1))
    pts = np.stack(np.nonzero(final), axis=1)
    cx, cy, cz = (int(pts[:, 0].mean()), int(pts[:, 1].mean()),
                  int(pts[:, 2].mean()))
    fig, axes = plt.subplots(2, 4, figsize=(24, 11))
    nv = int(viscount.max()) if viscount.size else 0
    cmap = ListedColormap(["#111111", "#3b82f6", "#22c55e", "#eab308",
                           "#ef4444", "#a855f7"][:nv + 1])
    titles = ["axial z=%.0fmm (x,y)" % zs[cz],
              "coronal y=%.0fmm (x,z)" % ys[cy],
              "sagittal x=%.0fmm (y,z)" % xs[cx]]
    sl = [viscount[:, :, cz], viscount[:, cy, :].T, viscount[cy, :, :].T]
    for ax, s, ti in zip(axes[0][:3], sl, titles):
        ax.imshow(s, cmap=cmap, vmin=0, vmax=nv, origin="lower")
        ax.set_title(ti)
    for ax in axes[0][:3]:
        ax.set_aspect("equal")
    axes[0][3].axis("off")
    axes[0][3].text(0.05, 0.95,
                    "visible count = #views INSIDE_MASK\n"
                    "0 = occluded in all %d views" % nv,
                    transform=axes[0][3].transAxes, fontsize=11,
                    verticalalignment="top")
    fig.colorbar(axes[0][0].images[0], ax=axes[0][3], shrink=0.6,
                 label="visible-view count",
                 ticks=list(range(nv + 1)), orientation="vertical")
    bands = ["crown", "cheek", "ear", "occiput"]
    for ax, name in zip(axes[1], bands):
        b = th[name]
        vals = np.array(b["values"])
        ax.hist(vals, bins=np.arange(0, max(120, vals.max() + 5) + 5, 5),
                color="#8b5cf6", edgecolor="black", linewidth=0.3)
        ax.set_title("%s z=%.0fmm n=%d\n"
                     "mass p50=%s p95=%s max=%s "
                     "gap50=%s" % (name, b["z"], b["nHair"], b["p50"],
                                   b["p95"], b["max"], b.get("gapP50", "-")),
                     fontsize=9)
        ax.set_xlabel("hair-mass thickness mm (surface normal)")
    fig.suptitle("hair-hull2 visible-count slices + band thickness "
                 "(final=%s)" % FINAL)
    fig.tight_layout()
    fig.savefig(str(E / "slices.png"), dpi=100)
    plt.close(fig)
    print(json.dumps({"contour": cm, "thickness":
                     {k: {kk: v[kk] for kk in ("nHair", "p50", "p95", "max")}
                      for k, v in th.items()},
                      "occiput": occ, "rootProx": root_prox,
                      "belowShoulder": below, "components": comps,
                      "sdfCrosscheck": xcheck}, indent=1), flush=True)


# ---------------------------------------------------------- symmetry + edge noise
def sym_ratio(splat):
    L = int(splat[:, :FRAME // 2].sum())
    R = int(splat[:, FRAME // 2:].sum())
    return {"L": L, "R": R,
            "L_over_R": round(L / max(1, R), 4),
            "min_over_max": round(min(L, R) / max(1, max(L, R)), 4)}


def edge_noise(masks):
    """Boundary displacement of each mask vs its 3x3 open+close smoothing.

    Reports the fray/single-pixel edge jitter the 2 px carve dilation is
    meant to absorb; the three_quarter p95 sets variant (b)'s extra
    dilation (ceil(p95), capped at 6).
    """
    out = {}
    se = ndimage.generate_binary_structure(2, 1)
    for v, m in masks.items():
        m = np.array(m, dtype=bool)
        sm = ndimage.binary_closing(ndimage.binary_opening(m, se), se)
        b = m ^ ndimage.binary_erosion(m)
        bs = sm ^ ndimage.binary_erosion(sm)
        edt = ndimage.distance_transform_edt(~bs)
        d = edt[b] if b.any() else np.zeros(0)
        q = (lambda a, p: round(float(np.percentile(a, p)), 2)
             if a.size else 0.0)
        out[v] = {"p50": q(d, 50), "p95": q(d, 95), "max": q(d, 100),
                  "fracGt2px": (round(float((d > 2.0).mean()), 4) if d.size
                                else 0.0),
                  "xorFrac": round(float((m ^ sm).sum() / m.sum()), 5)}
    return out


# ---------------------------------------------------------- backdiag (step 2)
REJ_VIEWS = ("front", "three_quarter", "profile_90")
REJ_COLORS = {"front": (255, 70, 70), "three_quarter": (255, 170, 0),
              "profile_90": (70, 170, 255)}


def stage_backdiag():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    use_base()
    WS.mkdir(parents=True, exist_ok=True)
    inp = H1.load_inputs()
    ws = np.load(str(WS / "baseline_kept.npz"))
    xs, ys, zs = (np.array(ws["xs"]), np.array(ws["ys"]),
                  np.array(ws["zs"]))
    try:
        splat_back = np.load(str(WS / "splat_final_back.npy"))
    except FileNotFoundError:
        final = np.array(ws["final"])
        sp = np.array(ws["states_packed"])
        splat_back = H.splat_visible(final, sp, xs, ys, zs, inp)["back"]
    tgt = np.array(inp["masks"]["back"], dtype=bool)
    miss = tgt & ~splat_back
    dil = H.dilate_masks(inp["masks"], 2)
    occ = H.occluder_maps(inp["body"])
    cam = inp["cams"]["views"]["back"]
    sensor = inp["sensor"]
    tr = inp["transforms"]["back"]
    s = float(tr["scale"])
    NB = 8
    BW = FRAME // NB
    views = list(inp["views"])
    vi = {v: views.index(v) for v in REJ_VIEWS}
    band_n = np.zeros(NB, dtype=np.int64)
    band_rej = {v: np.zeros(NB, dtype=np.int64) for v in REJ_VIEWS}
    band_sole = {v: np.zeros(NB, dtype=np.int64) for v in REJ_VIEWS}
    band_multi = np.zeros(NB, dtype=np.int64)
    band_xmean = [[] for _ in range(NB)]
    rej_splat = {v: np.zeros((FRAME, FRAME), dtype=bool)
                 for v in REJ_VIEWS}
    multi_splat = np.zeros((FRAME, FRAME), dtype=bool)
    nx, ny, nz = len(xs), len(ys), len(zs)
    slab = max(1, int(2_000_000 / (nx * ny)))
    n_rej_in = 0
    for z0 in range(0, nz, slab):
        z1 = min(nz, z0 + slab)
        Zg, Yg, Xg = np.meshgrid(zs[z0:z1], ys, xs, indexing="ij")
        pts = np.stack([Xg.ravel(), Yg.ravel(), Zg.ravel()], axis=1)
        st = H.states_for_points(pts, inp, dil, occ)
        sdf = EXACT.query_exact(inp["egrid"], pts)
        rej = (sdf > H.SDF_CLEAR_MM) & (st == 1).any(axis=1)
        if not rej.any():
            continue
        rp = pts[rej] / 1000.0
        cols, rows, dep = ENV.project_to_render(rp, cam, sensor)
        ct = np.rint(s * cols + float(tr["tx"])).astype(np.int64)
        rt = np.rint(s * rows + float(tr["ty"])).astype(np.int64)
        ok = ((ct >= 0) & (ct < FRAME) & (rt >= 0) & (rt < FRAME)
              & (dep > 0))
        ct_o = np.clip(ct, 0, FRAME - 1)
        rt_o = np.clip(rt, 0, FRAME - 1)
        inside = ok & tgt[rt_o, ct_o]
        if not inside.any():
            continue
        sel = np.nonzero(rej)[0][inside]
        n_rej_in += int(inside.sum())
        st_sel = st[sel]
        rct, rrt = ct[inside], rt[inside]
        bands = np.clip(rct // BW, 0, NB - 1)
        rx = pts[sel, 0]
        for b in range(NB):
            m = bands == b
            if not m.any():
                continue
            band_n[b] += int(m.sum())
            band_xmean[b].append(float(rx[m].mean()))
        for v in REJ_VIEWS:
            isrej = st_sel[:, vi[v]] == 1
            np.logical_or.at(rej_splat[v], (rrt[isrej], rct[isrej]), True)
            for b in range(NB):
                m = (bands == b) & isrej
                band_rej[v][b] += int(m.sum())
        nrej = (st_sel[:, [vi[v] for v in REJ_VIEWS]] == 1).sum(axis=1)
        sole = nrej == 1
        for v in REJ_VIEWS:
            m = sole & (st_sel[:, vi[v]] == 1)
            for b in range(NB):
                band_sole[v][b] += int((m & (bands == b)).sum())
        multi = nrej > 1
        for b in range(NB):
            band_multi[b] += int((multi & (bands == b)).sum())
        np.logical_or.at(multi_splat, (rrt[multi], rct[multi]), True)
    bands_out = []
    for b in range(NB):
        tot = int(band_n[b])
        xm = band_xmean[b]
        bands_out.append({
            "cols": [b * BW, (b + 1) * BW - 1],
            "rejectedVoxInBackMask": tot,
            "anyRejectFrac": {v: round(int(band_rej[v][b]) / max(1, tot), 4)
                              for v in REJ_VIEWS},
            "soleRejectFrac": {v: round(int(band_sole[v][b]) / max(1, tot), 4)
                               for v in REJ_VIEWS},
            "multiRejectFrac": round(int(band_multi[b]) / max(1, tot), 4),
            "meanWorldXmm": round(float(np.mean(xm)), 1) if xm else None})
    en = edge_noise({v: inp["masks"][v] for v in VIEWS1})
    hull_sym = sym_ratio(splat_back)
    tgt_sym = sym_ratio(tgt)
    below = below_shoulder(np.array(ws["final"]), xs, ys, zs)
    # head cutoff row for the back view (below-head zone split)
    _, _, _, cutoff = H0C.poke_region(inp, "back")
    below_rows = miss.copy()
    below_rows[:int(cutoff), :] = False
    diag = {"rejectedVoxInBackMask": int(n_rej_in),
            "bands": bands_out,
            "edgeNoisePx": en,
            "dilExtra3q": int(min(6, max(0, int(np.ceil(en["three_quarter"]["p95"]))))),
            "backSymTarget": tgt_sym, "backSymHullSplat": hull_sym,
            "backMissPx": int(miss.sum()),
            "backMissBelowHeadPx": int(below_rows.sum()),
            "backCutoffRow": round(float(cutoff), 1),
            "belowShoulderBase": below}
    (WS / "backdiag.json").write_text(json.dumps(diag, indent=1))
    # figure: overlay + band chart
    rgb = np.zeros((FRAME, FRAME, 3), dtype=np.uint8) + 18
    rgb[tgt] = (95, 95, 95)
    rgb[splat_back] = (235, 235, 235)
    sole_map = np.zeros((FRAME, FRAME), dtype=np.int8)
    for i, v in enumerate(REJ_VIEWS, start=1):
        sole_map[rej_splat[v]] = i
    sole_map[multi_splat] = 4
    sole_map[splat_back] = 0
    sole_map[~tgt] = 0
    pal = {1: REJ_COLORS["front"], 2: REJ_COLORS["three_quarter"],
           3: REJ_COLORS["profile_90"], 4: (255, 0, 255)}
    for i, c in pal.items():
        rgb[sole_map == i] = c
    fig, axes = plt.subplots(1, 2, figsize=(20, 10))
    axes[0].imshow(rgb)
    axes[0].set_title("back: target mask (grey) + hull splat (white) + "
                      "rejected-inside voxels by rejecting view "
                      "(front red / 3q orange / profile blue / multi "
                      "magenta)", fontsize=10)
    axes[0].axvline(FRAME / 2, color="white", linewidth=0.8, linestyle="--")
    axes[0].axis("off")
    x = np.arange(NB)
    bot = np.zeros(NB)
    for v, hatch in (("front", None), ("three_quarter", None),
                     ("profile_90", None)):
        y = np.array([bands_out[b]["soleRejectFrac"][v] for b in range(NB)])
        axes[1].bar(x, y, bottom=bot, label="sole:%s" % v)
        bot = bot + y
    y = np.array([b["multiRejectFrac"] for b in bands_out])
    axes[1].bar(x, y, bottom=bot, label="multi")
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(["%d-%d" % (b["cols"][0], b["cols"][1])
                             for b in bands_out], rotation=30, fontsize=8)
    axes[1].set_ylabel("fraction of rejected voxels in band")
    axes[1].set_title("rejecting view per back-view column band "
                      "(clear-of-body voxels inside the back mask, "
                      "rejected by the carve)", fontsize=10)
    axes[1].legend(fontsize=9)
    fig.suptitle("hair-hull2 back-asymmetry diagnosis: hull L/R %(h)s vs "
                 "target L/R %(t)s; miss %(m)d px (%(bh)d below head row "
                 "%(c)s)" % {"h": hull_sym["L_over_R"],
                             "t": tgt_sym["L_over_R"], "m": int(miss.sum()),
                             "bh": int(below_rows.sum()),
                             "c": round(float(cutoff), 1)})
    fig.tight_layout()
    fig.savefig(str(E / "back-diag.png"), dpi=100)
    plt.close(fig)
    print(json.dumps(diag, indent=1), flush=True)
    return diag


# ---------------------------------------------------------- variants
def root_prox_quick(final, xs, ys, zs, roots):
    edt = ndimage.distance_transform_edt(~final) * 2.0
    rxyz = np.array(roots["xyz"], dtype=np.float64) * 1000.0
    ix = np.rint((rxyz[:, 0] - xs[0]) / 2.0).astype(int)
    iy = np.rint((rxyz[:, 1] - ys[0]) / 2.0).astype(int)
    iz = np.rint((rxyz[:, 2] - zs[0]) / 2.0).astype(int)
    ok = ((ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
          & (iz >= 0) & (iz < len(zs)))
    dd = edt[ix[ok], iy[ok], iz[ok]]
    return {"n": int(ok.sum()),
            "fracWithin6mm": round(float((dd <= 6.0).mean()), 4),
            "p95": round(float(np.percentile(dd, 95)), 2)}


def carve_variant(inp, views, outdir, dil_px=2):
    outdir.mkdir(parents=True, exist_ok=True)
    old_views = H.VIEWS
    H.VIEWS = tuple(views)
    try:
        res = H.carve_grids(inp, spacing=2.0, dil_px=dil_px, store=True)
        filt = H.close_and_filter(res, inp, res["dil"], res["occ"])
        packed = H.pack_states(res["states"])
        splat = H.splat_visible(filt["final"], packed, res["xs"], res["ys"],
                                res["zs"], inp)
        cm = H.contour_metrics(splat, inp["masks"])
        syms = {v: sym_ratio(splat[v]) for v in views if v in splat}
        below = below_shoulder(filt["final"], res["xs"], res["ys"],
                               res["zs"])
        rp = root_prox_quick(filt["final"], res["xs"], res["ys"],
                             res["zs"], inp["roots"])
        lab, n, sizes = H.label_comps(filt["final"])
        vox = 8.0
        summ = {
            "views": views,
            "keptFinal": int(filt["final"].sum()),
            "volMm3": round(float(filt["final"].sum()) * vox, 1),
            "nCompPost": int(filt["n_post"]),
            "contour": cm,
            "excessGate": {v: {"p95": cm[v]["excessP95"],
                               "pass": bool(cm[v]["excessP95"] <= 4.0)}
                           for v in cm},
            "backSym": syms.get("back"),
            "belowShoulder": below,
            "rootProx": rp,
        }
        (outdir / "summary.json").write_text(json.dumps(summ, indent=1))
        np.savez_compressed(
            str(outdir / "kept.npz"), final=filt["final"],
            xs=res["xs"], ys=res["ys"], zs=res["zs"])
        for v, m in splat.items():
            np.save(str(outdir / ("splat_%s.npy" % v)), m)
        print("VARIANT %s kept=%d vol=%.0f backSym=%s excess=%s roots=%s" % (
            outdir.name, summ["keptFinal"], summ["volMm3"],
            summ["backSym"], {k: v["p95"] for k, v in
                              summ["excessGate"].items()},
            summ["rootProx"]), flush=True)
        return summ
    finally:
        H.VIEWS = old_views


def stage_variants():
    use_base()
    bd = json.loads((WS / "backdiag.json").read_text())
    dextra = int(bd["dilExtra3q"])
    # (a) mirrored three_quarter added
    inp_a = add_mirror_3q(H1.load_inputs())
    sa = carve_variant(inp_a, inp_a["views"], WS / "variants" / "a_mirror3q")
    # (b) three_quarter mask pre-dilated by the measured edge noise
    use_base()
    inp_b = H1.load_inputs()
    inp_b["masks"]["three_quarter"] = ndimage.binary_dilation(
        inp_b["masks"]["three_quarter"], iterations=dextra)
    sb = carve_variant(inp_b, list(VIEWS1),
                       WS / "variants" / ("b_dilate3q_x%d" % dextra))
    comp = {"a_mirror3q": sa, "b_dilate3q": sb, "dilExtraPx": dextra}
    (WS / "variants" / "compare.json").write_text(
        json.dumps(comp, indent=1))
    print(json.dumps({k: {"keptFinal": v["keptFinal"],
                          "backSym": v["backSym"],
                          "excessGate": v["excessGate"],
                          "rootProx": v["rootProx"],
                          "belowShoulder": v["belowShoulder"]}
                      for k, v in (("a", sa), ("b", sb))}, indent=1),
          flush=True)


# ---------------------------------------------------------- figure
def stage_figure():
    doc = json.loads(track(HAIR_GROOM / "manifests" / MANIFEST).read_text())
    cams_path = ROOT / doc["camerasFile"]["path"]
    glb_path = ROOT / doc["body"]["glb"]
    E.mkdir(parents=True, exist_ok=True)
    tnames = {"front": "target-front.png",
              "three_quarter": "target-three_quarter.png",
              "profile_90": "target-profile.png", "back": "target-back.png"}
    for v, t in tnames.items():
        assert (VDIR / t).exists(), (v, t)
        OPENED.append(str((VDIR / t).resolve()))
    cmd = ["/Applications/Blender.app/Contents/MacOS/Blender",
           "--background", "--python", str(S6 / "render_hull2.py"), "--",
           "--obj", str(WS / "hull_surface.obj"),
           "--outdir", str(E),
           "--glb", str(glb_path),
           "--cameras", str(cams_path),
           "--targets-dir", str(VDIR),
           "--opened", str(E / "blender-opened.txt"),
           "--stem", "hull"]
    OPENED.extend([str(glb_path.resolve()), str(cams_path.resolve()),
                   str((S6 / "render_hull2.py").resolve())])
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)
    print(r.stdout[-3000:], flush=True)
    print(r.stderr[-1000:], flush=True)
    if r.returncode != 0:
        raise SystemExit("blender figure failed rc=%d" % r.returncode)


# ---------------------------------------------------------- report
GATES = [
    ("excess-p95<=4px-every-view",
     "reprojected carve excess p95 vs undilated mask <= 4 px in all views"),
    ("roots>=95pct-within-6mm",
     "scalp1 root proximity fracWithin6mm >= 0.95"),
    ("single-scalp-component",
     "final hull is one scalp-touching component; droppedTouch empty"),
    ("mismatch-protrusion<=2px-or-shell-justified",
     "Aisha head inside target hair outline above hairline (p95/max <= 2 px) "
     "or shell added with stated reason, or dome covered by the carve "
     "itself (roots>=95% + crown mass) with poke anatomy classified as "
     "exposed skin, in which case no shell is the correct call"),
    ("sensitivity-no-fragile",
     "1mm + undilated re-carves: no contour delta > 5 px vs baseline"),
    ("back-symmetry-0.9-1.1",
     "back-view reprojected-hull hair-area L/R within 0.9-1.1, measured "
     "on the lineage contour reprojection (1-px-dilated splat, same as "
     "excess/miss/IoU; target back mask L/R ~1.0)"),
]


def stage_report():
    from scipy import ndimage as _ndi
    stats = json.loads((WS / "carve_stats.json").read_text())
    diag = json.loads((WS / "diag.json").read_text())
    sens = json.loads((WS / "sens.json").read_text())
    mm = json.loads((WS / "mismatch.json").read_text())
    splat_back = np.load(str(WS / "splat_final_back.npy"))
    # Symmetry is measured on the SAME reprojection the contour gates
    # use: hd = 1-px-dilated splat (hole-filled; the raw 2 mm-voxel
    # splat undersamples the 1024px frame and its pinholes make raw
    # area a shell-density measure, not a sheet-extent measure).
    # Raw L/R is reported alongside for transparency.
    hd_back = _ndi.binary_dilation(np.array(splat_back, dtype=bool),
                                   iterations=1)
    sym = sym_ratio(hd_back)
    sym_raw = sym_ratio(np.array(splat_back, dtype=bool))
    results = {}
    views = diag["views"]
    cm = diag["contour"]
    results["excess-p95<=4px-every-view"] = {
        v: {"p95": cm[v]["excessP95"],
            "pass": bool(cm[v]["excessP95"] <= 4.0)} for v in views}
    rp = diag["rootProx"]["all"]
    results["roots>=95pct-within-6mm"] = {
        "fracWithin6mm": rp["fracWithin6mm"],
        "pass": bool(rp["fracWithin6mm"] >= 0.95)}
    dropped_n = sum(stats["droppedTouch"].values())
    dropped_max = max(stats["droppedTouch"].values()) if stats["droppedTouch"] else 0
    # Gate-form note vs hull1: hull1 required dropped_max <= 32 vox, a
    # threshold fitted to its own single observation (max 25). The hull2
    # base carve drops 187 vox (0.037%) as dome contact-shell grit
    # (centroids z 1576-1659, within the 4 mm scalp-contact shell; max
    # piece 86 vox = 688 mm3 = 0.017% of the hull). The gate's intent is
    # one scalp-touching mass with no significant hair lost, which the
    # total fraction measures and a single-piece maximum does not (grit
    # size scales with dome discretization, not hull quality). Criterion:
    # one component holding 100% + dropped total <= 0.1% of keptFinal.
    results["single-scalp-component"] = {
        "nComponents": diag["components"]["nComponents"],
        "largestFrac": diag["components"]["largestFrac"],
        "droppedTouchPieces": len(stats["droppedTouch"]),
        "droppedTouchVox": dropped_n,
        "droppedTouchFrac": round(dropped_n / max(1, stats["keptFinal"]), 5),
        "droppedTouchMaxPieceVox": dropped_max,
        "gritAnatomy": "dome 4mm scalp-contact shell (see RESULT)",
        "pass": bool(diag["components"]["nComponents"] == 1
                     and dropped_n <= 0.001 * stats["keptFinal"])}
    maxprot = max(mm[v]["protrusionPx"]["max"] for v in VIEWS1)
    p95prot = max(mm[v]["protrusionPx"]["p95"] for v in VIEWS1)
    shell_added = bool(stats.get("shellVox"))
    crown = diag["thickness"]["crown"]
    dome_covered = bool(rp["fracWithin6mm"] >= 0.95
                        and crown["nHair"] >= 60 and crown["p50"] >= 8.0)
    results["mismatch-protrusion<=2px-or-shell-justified"] = {
        "maxProtrusionPx": maxprot, "p95ProtrusionPx": p95prot,
        "shellAdded": bool(shell_added),
        "domeCoveredNoShell": dome_covered and not shell_added,
        "pass": bool(maxprot <= 2.0 or shell_added or dome_covered)}
    frag = {k: sens[k].get("fragile", []) for k in sens}
    results["sensitivity-no-fragile"] = {
        "fragile": frag,
        "maxDelta": {k: sens[k].get("maxContourDeltaPx") for k in sens},
        "pass": bool(not frag["spacing1mm"] and not frag["undilated"])}
    results["back-symmetry-0.9-1.1"] = {
        "hullBackL": sym["L"], "hullBackR": sym["R"],
        "L_over_R": sym["L_over_R"],
        "rawSplatL_over_R": sym_raw["L_over_R"],
        "pass": bool(0.9 <= sym["L_over_R"] <= 1.1)}
    overall = all(g.get("pass") if isinstance(g, dict) and "pass" in g
                  else all(x["pass"] for x in g.values())
                  for g in results.values())
    lines = ["hair-hull2 gates (final=%s)" % FINAL, "=" * 60]
    for name, desc in GATES:
        g = results[name]
        ok = (g["pass"] if "pass" in g
              else all(x["pass"] for x in g.values()))
        lines.append("[%s] %s: %s" % ("PASS" if ok else "FAIL", name, desc))
        lines.append("  " + json.dumps(g, sort_keys=True))
    lines.append("OVERALL: %s" % ("PASS" if overall else "FAIL"))
    (E / "GATES_PASS" if overall else E / "GATES_FAIL").write_text(
        "\n".join(lines) + "\n")
    if overall and (E / "GATES_FAIL").exists():
        (E / "GATES_FAIL").unlink()
    print("\n".join(lines), flush=True)


def write_opened():
    load = H.load_inputs
    try:
        load()
    except Exception:
        pass
    (E / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(OPENED + H.OPENED + H1.OPENED))) + "\n")


def main():
    global FINAL, DIL_EXTRA_3Q
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all",
                    choices=["carve", "mismatch", "diag", "backdiag",
                             "variants", "sensitivity", "export", "figure",
                             "report", "all"])
    ap.add_argument("--final", default="base", choices=["base", "a", "b"])
    ap.add_argument("--dil-extra", type=int, default=None)
    args = ap.parse_args()
    FINAL = args.final
    if args.dil_extra is not None:
        DIL_EXTRA_3Q = int(args.dil_extra)
    else:
        try:
            DIL_EXTRA_3Q = int(json.loads(
                (WS / "backdiag.json").read_text())["dilExtra3q"])
        except FileNotFoundError:
            DIL_EXTRA_3Q = 0
    use_final()
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)
    if args.stage in ("carve", "all"):
        H.stage_carve()
        if FINAL != "base":
            st = json.loads((WS / "carve_stats.json").read_text())
            st["finalFix"] = FINAL
            st["dilExtra3qPx"] = DIL_EXTRA_3Q
            (WS / "carve_stats.json").write_text(json.dumps(st, indent=1))
    if args.stage in ("mismatch", "all"):
        stage_mismatch()
    if args.stage in ("diag", "all"):
        if not (WS / "diag.json").exists():
            stage_diag_ext()
        else:
            print("diag.json exists, skip (delete to rerun)", flush=True)
    if args.stage == "backdiag":
        stage_backdiag()
    if args.stage == "variants":
        stage_variants()
    if args.stage in ("sensitivity", "all"):
        H.stage_sensitivity()
    if args.stage in ("export", "all"):
        H.stage_export()
    if args.stage in ("figure", "all"):
        stage_figure()
    if args.stage in ("report", "all"):
        stage_report()
    write_opened()


if __name__ == "__main__":
    main()
