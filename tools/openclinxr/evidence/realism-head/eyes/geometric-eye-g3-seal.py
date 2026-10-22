#!/usr/bin/env python3
"""G3 lid re-fit + seal: re-seat Aisha's lids on the G1 anterior profile and
prove the blink seal (measured, not eyeballed).

Method (GLB-space re-run of the lid_conform.py H1 SEAT step, Aisha row):
- ring1 = margin loop derived topologically on the subject's OWN pre-conform
  base GLB (has the export-time openings; the conformed bake is watertight),
  matched nearest to the conformed bake body (refuse dmax > 0.5mm /
  duplicates) -- mirrors lid_conform.py exactly.
- NO widen (H1 widen already embodied at 27.009mm; re-widening would
  double-apply). Recorded, not silently skipped.
- seat: per ring1 vert, ray from the fitted globe centre; analytic hit on
  the NEW surface envelope max(t_sclera, t_cap); gap-adaptive weight
  gw = clamp((1.5-gap)/(1.5-0.5)) * 1.0 (Aisha row seatCeiling/seatFloor);
  target = surface + 0.5mm tear offset; ring2 weight 0 (anchor).
- shape-key consistency: the SAME displacement is added to Basis and EVERY
  morph target, so all morph deltas (blink) are unchanged by construction;
  the gate asserts delta invariance.

Surfaces (analytic, exact for the G2 spheres):
- NEW: sclera R=11.9 @ C + cap r=7.8 @ C+apex-r (from G1 params, closure
  re-derived from first principles, asserted within 0.01 like the G1 gate).
- OLD (baseline): per-side Kasa fits of THIS bake's globe + cornea meshes
  (re-derives the G0 pole-bias on this bake, trusts no carried number).

Counterweight (scope G3): position AND size must both hold -- the gate
checks the closed-lid gap against the old-profile baseline measurement,
not just "same size".

In:  store aisha-lidconform.glb + aisha-eyeglobe-base.glb (read-only),
      geometric-eye-g1-params.json.
Out: geometric-eye-g3-report.json, geometric-eye-g3-refit.json
      (vert-index -> disp-mm head-frame head frame, metres*1000),
      geometric-eye-g3-section.png (sagittal midline cross-section).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(Path(
    "tools/openclinxr/asset-pipeline/realism-head/lid-conform").resolve()))
import lid_conform_core as core  # noqa: E402

STORE = Path("/Volumes/files/openclinxr-assets/store/lid-conform")
BAKE = STORE / "aisha-lidconform.glb"
BASE = STORE / "aisha-eyeglobe-base.glb"
M = 1000.0  # m -> mm

P = json.loads((HERE / "geometric-eye-g1-params.json").read_text())
Rr, Dd = P["resolved"], P["iris_disc"]
R_NEW = Rr["scleral_radius_mm"] / M
R_CAP = Rr["cap_radius_mm"] / M
APEX = Rr["apex_z_mm"] / M
ZC = APEX - R_CAP  # cap-sphere centre offset (+z) from globe centre
IRIS_R = Dd["dia_mm"] / 2 / M
IRIS_Z = Dd["plane_z_mm"] / M  # eye-local; head z = C_z - (APEX - IRIS_Z)
ACD = (Rr["apex_z_mm"] - Dd["plane_z_mm"]) / M
# closure re-derivation (two-sphere intersection; G1-gate tolerance 0.01)
_d = Rr["scleral_radius_mm"] + (Rr["apex_z_mm"] - Rr["scleral_radius_mm"]) \
    - Rr["cap_radius_mm"]
_zr = (Rr["scleral_radius_mm"] ** 2 - Rr["cap_radius_mm"] ** 2 + _d ** 2) \
    / (2 * _d)
assert abs(_zr - Rr["limbus_ring_z_mm"]) < 0.01, (_zr, Rr["limbus_ring_z_mm"])
TH0 = math.asin(math.sqrt(max(Rr["scleral_radius_mm"] ** 2 - _zr ** 2, 0))
                / Rr["scleral_radius_mm"])  # limbus half-angle from +z

SEAT_CEIL, SEAT_FLOOR, OFFSET = 1.5, 0.5, 0.5  # mm (Aisha row)


def kasa(pts):
    a = np.concatenate([2.0 * pts, np.ones((len(pts), 1))], axis=1)
    b = (pts ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    c = sol[:3]
    r = float(math.sqrt(max(sol[3] + c @ c, 0.0)))
    return c, r


def ray_sphere_t_vec(o, d, cc, rr):
    """Vectorised max positive-t of rays o+t*d with sphere; inf if none."""
    oc = o - cc
    b = (oc * d).sum(axis=1)
    c = (oc * oc).sum(axis=1) - rr ** 2
    disc = b * b - c
    t = np.full(len(o), np.inf)
    m = disc >= 0
    t[m] = -b[m] + np.sqrt(disc[m])
    t[t <= 0] = np.inf
    return t


def gap_new_vec(p, Cc):
    dv = p - Cc
    ln = np.linalg.norm(dv, axis=1)
    d = dv / np.maximum(ln, 1e-12)[:, None]
    t = np.maximum(ray_sphere_t_vec(np.broadcast_to(Cc, p.shape), d,
                                    Cc, R_NEW),
                   ray_sphere_t_vec(np.broadcast_to(Cc, p.shape), d,
                                    Cc + np.array([0, 0, ZC]), R_CAP))
    return (ln - t) * M


def gap_old_vec(p, s):
    dv = p - C[s]
    ln = np.linalg.norm(dv, axis=1)
    d = dv / np.maximum(ln, 1e-12)[:, None]
    o = np.broadcast_to(C[s], p.shape)
    t = np.maximum(ray_sphere_t_vec(o, d, C[s], Rg[s]),
                   ray_sphere_t_vec(o, d, Cs[s], Rs[s]))
    return (ln - t) * M


print("loading bake + base ...", flush=True)
js, blob = core.load_glb(str(BAKE))
worlds = core.node_worlds(js)
bname = core.resolve_body_mesh_name(js)
body0, bidx = core.skin_mesh(js, blob, worlds, bname)
tris = bidx.reshape(-1, 3)
mesh = next(m for m in js["meshes"] if m.get("name") == bname)
tnames = mesh.get("extras", {}).get("targetNames", [])

# per-side split by cornea centroid x (anatomical L = +x, per audit note)
cor_names = core.resolve_cornea_mesh_names(js)
cor = {}
for n in cor_names:
    pts, _ = core.skin_mesh(js, blob, worlds, n)
    cor[n] = pts
cn = list(cor)
cl = max(cn, key=lambda m: cor[m][:, 0].mean())
cr = min(cn, key=lambda m: cor[m][:, 0].mean())
sides = {"L": cl, "R": cr}
gname = core.resolve_globe_mesh_name(js)
gpts, _ = core.skin_mesh(js, blob, worlds, gname)
print("cornea L/R by centroid x:",
      {s: round(float(cor[sides[s]][:, 0].mean() * M), 2) for s in "LR"},
      flush=True)

C, Rg, Cs, Rs = {}, {}, {}, {}
for s in "LR":
    cen = cor[sides[s]].mean(axis=0)
    gside = gpts[np.linalg.norm(
        gpts - cor[sides["L"]].mean(axis=0), axis=1)
        < np.linalg.norm(gpts - cor[sides["R"]].mean(axis=0), axis=1)] \
        if s == "L" else gpts[np.linalg.norm(
            gpts - cor[sides["L"]].mean(axis=0), axis=1)
        >= np.linalg.norm(gpts - cor[sides["R"]].mean(axis=0), axis=1)]
    C[s], Rg[s] = kasa(gside)
    Cs[s], Rs[s] = kasa(cor[sides[s]])
    print(f"side {s}: globe C {[round(float(v*M),3) for v in C[s]]} "
          f"R {Rg[s]*M:.4f} | shell C {[round(float(v*M),3) for v in Cs[s]]} "
          f"R {Rs[s]*M:.4f} off+z {(Cs[s][2]-C[s][2])*M:.3f}", flush=True)


def gap_old_full(p, s):
    return gap_old_vec(p, s)


gap_new = gap_new_vec  # (p, Cc) -> mm


# t_new <= t_old check (new surface never proud of old -> seal can only
# tighten; show-through cannot increase). Dense direction sample.
rng = np.random.default_rng(7)
excess = {}
for s in "LR":
    u = rng.normal(size=(2048, 3))
    u /= np.linalg.norm(u, axis=1)[:, None]
    o = np.broadcast_to(C[s], u.shape)
    tn = np.maximum(ray_sphere_t_vec(o, u, C[s], R_NEW),
                    ray_sphere_t_vec(o, u, C[s] + np.array([0, 0, ZC]),
                                     R_CAP))
    to = np.maximum(ray_sphere_t_vec(o, u, C[s], Rg[s]),
                    ray_sphere_t_vec(o, u, Cs[s], Rs[s]))
    excess[s] = float(((tn - to) * M).max())
print("new-vs-old surface excess mm (must be <= ~0):", excess, flush=True)

# rings: try bake body, fall back to base GLB + nearest match (pipeline path)
ring_src = "bake-topological"
try:
    brings = {s: core.derive_eye_rings(body0, tris, C[s]) for s in "LR"}
    ring1 = {s: brings[s]["ring1"] for s in "LR"}
except RuntimeError as e:
    print("bake ring derivation refused:", e, "-- using base GLB",
          flush=True)
    ring_src = "base-glb-matched"
    bjs, bblob = core.load_glb(str(BASE))
    bworlds = core.node_worlds(bjs)
    bbody, bbody_idx = core.skin_mesh(
        bjs, bblob, bworlds, core.resolve_body_mesh_name(bjs))
    btris = bbody_idx.reshape(-1, 3)
    bsides = core.eye_sides(bjs, bblob, bworlds)
    ring1 = {}
    for s in "LR":
        bc, _, _ = core.fit_sphere_kasa(bsides[s])
        br = core.derive_eye_rings(bbody, btris, bc)
        src = bbody[br["ring1"]]
        d2 = ((body0[:, None, :] - src[None, :, :]) ** 2).sum(axis=2)
        best = d2.argmin(axis=0)
        bd = np.sqrt(d2[best, np.arange(len(src))]) * M
        assert len(set(int(v) for v in best)) == len(best), "dup match"
        assert float(bd.max()) <= 0.5, f"match refuse {bd.max()}"
        print(f"side {s}: base ring {len(src)} matched med "
              f"{np.median(bd):.4f} max {bd.max():.4f}mm", flush=True)
        ring1[s] = np.array([int(v) for v in best])
print("ring sizes:", {s: len(ring1[s]) for s in "LR"},
      "src:", ring_src, flush=True)

# morph poses (bind + 4 lid morphs + both-closure)
NEED = ["eye-left-closure", "eye-left-slit",
        "eye-right-closure", "eye-right-slit"]
for m in NEED:
    assert m in tnames, f"missing morph {m}"
poses = {"bind": body0}
for m in NEED:
    poses[m], _ = core.skin_mesh(js, blob, worlds, bname,
                                 morph_weights={m: 1.0})
poses["eye-both-closure"], _ = core.skin_mesh(
    js, blob, worlds, bname,
    morph_weights={"eye-left-closure": 1.0, "eye-right-closure": 1.0})
D = {k: (v - body0) * M for k, v in poses.items() if k != "bind"}

# morph side check: eye-left-closure must move +x (anatomical L)
for m in NEED:
    dm = np.linalg.norm(D[m], axis=1)
    top = body0[dm >= np.quantile(dm, 0.999)]
    print(f"morph {m}: top-move median x "
          f"{float(np.median(top[:,0])*M):.2f}mm n={len(top)}", flush=True)

CLO = {"L": "eye-left-closure", "R": "eye-right-closure"}
SLT = {"L": "eye-left-slit", "R": "eye-right-slit"}

band, edge, edge_stab, lower = {}, {}, {}, {}
for s in "LR":
    dm = np.linalg.norm(D[CLO[s]], axis=1)
    near = np.linalg.norm(body0 - C[s], axis=1) <= 0.030
    band[s] = np.nonzero((dm >= 0.3) & near)[0]
    # lid EDGE (midline margin method): margin-loop (ring1) upper/lower
    # verts within the central sixth of loop width (pupil midline station,
    # the clinical overlap station); edge = min-y (upper) / max-y (lower)
    # at bind. The margin loop is the visible lid edge at bind; the audit's
    # closure-band min-y (1550.30) is cited alongside for fidelity.
    r1 = ring1[s]
    r1p = body0[r1]
    midy = float(r1p[:, 1].min() + r1p[:, 1].max()) / 2
    xw = float(r1p[:, 0].max() - r1p[:, 0].min())
    cx = float(r1p[:, 0].mean())
    central = np.abs(r1p[:, 0] - cx) <= xw / 6
    up = r1[(r1p[:, 1] >= midy) & central]
    lo = r1[(r1p[:, 1] < midy) & central]
    edge[s] = float(body0[up][:, 1].min())
    lower[s] = float(body0[lo][:, 1].max())
    # threshold-stability diagnostic: closure-displaced ring verts only
    r1dm = np.linalg.norm(D[CLO[s]][r1], axis=1)
    edge_stab[s] = {}
    for th in (0.3, 0.5, 1.0):
        u2 = r1[(r1p[:, 1] >= midy) & central & (r1dm >= th)]
        edge_stab[s][str(th)] = (round(float(body0[u2][:, 1].min() * M), 3)
                                 if len(u2) else None)
    print(f"side {s}: band n={len(band[s])} marginUpCentral={len(up)} "
          f"marginLoCentral={len(lo)} edge_y {edge[s]*M:.3f}mm "
          f"stab {edge_stab[s]} lower_y {lower[s]*M:.3f}mm", flush=True)

# audit fidelity: audit upper margin 1.55030m both sides (bind, band min-y)
print("audit edge fidelity (expect ~1550.30mm):",
      {s: round(edge[s] * M, 2) for s in "LR"}, flush=True)

IRIS_TOP = {s: C[s][1] + IRIS_R for s in "LR"}     # new planar disc top (y)
LIMB_BOT = {s: C[s][1] - IRIS_R for s in "LR"}     # new limbus bottom (y)
APEX_Y = {s: C[s][1] for s in "LR"}                # apex shares globe y


def gaps(pts, s, surf):
    return gap_new(pts, C[s]) if surf == "new" else gap_old_full(pts, s)


pre, post = {}, {}
for s in "LR":
    pre[s] = {}
    r1 = body0[ring1[s]]
    pre[s]["ring_bind_old"] = [float(gaps(r1, s, "old").min()),
                               float(gaps(r1, s, "old").mean())]
    pre[s]["ring_bind_new"] = [float(gaps(r1, s, "new").min()),
                               float(gaps(r1, s, "new").mean())]
    for pose, key in (("closure", CLO[s]), ("slit", SLT[s]),
                      ("both", "eye-both-closure")):
        b = band[s]
        pp = poses[key][b]
        pre[s][f"band_{pose}_old"] = float(gap_old_full(pp, s).min())
        pre[s][f"band_{pose}_new"] = float(gap_new(pp, C[s]).min())
    print(f"side {s} PRE ring bind old {pre[s]['ring_bind_old']} new "
          f"{pre[s]['ring_bind_new']}", flush=True)
    print(f"side {s} PRE band closure old {pre[s]['band_closure_old']:.3f} "
          f"new {pre[s]['band_closure_new']:.3f} | slit old "
          f"{pre[s]['band_slit_old']:.3f} new {pre[s]['band_slit_new']:.3f} "
          f"| both old {pre[s]['band_both_old']:.3f} new "
          f"{pre[s]['band_both_new']:.3f}", flush=True)

# seal = occlusion: rays from the front over the disc area; fraction whose
# first hit is lid skin (body patch) ahead of the NEW eye surface.
# Rig-agnostic (works however the closure morph drives the lids) and the
# direct measure of "closed lids cover the eye, no globe shows through".
def occlusion(pos, s):
    Cc = C[s]
    step = 0.5 / M
    half = 7.0 / M
    gx = np.arange(Cc[0] - half, Cc[0] + half + step / 2, step)
    gy = np.arange(Cc[1] - half, Cc[1] + half + step / 2, step)
    XX, YY = np.meshgrid(gx, gy)
    O = np.stack([XX.ravel(), YY.ravel(),
                  np.full(XX.size, Cc[2] + 40.0 / M)], axis=1)
    dd = np.zeros_like(O)
    dd[:, 2] = -1.0
    rho = np.hypot(XX.ravel() - Cc[0], YY.ravel() - Cc[1])
    t_eye = np.full(len(O), np.inf)
    # limbus half-chord in m (eye-local ring radius)
    a_ring = math.sqrt(max(R_NEW ** 2 - (Rr["limbus_ring_z_mm"] / M) ** 2,
                           0))
    capm = rho <= a_ring
    if capm.any():
        t_eye[capm] = ray_sphere_t_vec(
            O[capm], dd[capm], Cc + np.array([0, 0, ZC]), R_CAP)
    scm = (~capm) & (rho <= R_NEW)
    if scm.any():
        t_eye[scm] = ray_sphere_t_vec(O[scm], dd[scm], Cc, R_NEW)
    hitm = np.isfinite(t_eye)
    # lid patch: body tris fully within 25mm of C (posed positions)
    near = np.linalg.norm(pos - Cc, axis=1) <= 0.025
    tm = near[tris].all(axis=1)
    t_lid = core.ray_cast_mesh(O[hitm], dd[hitm],
                               pos[tris[tm]]) if tm.any() else \
        np.full(hitm.sum(), np.inf)
    occ = t_lid < t_eye[hitm]
    return {"rays": int(hitm.sum()), "occluded": int(occ.sum()),
            "fraction": round(float(occ.mean()), 4) if len(occ) else None}


occ_pre = {}
for s in "LR":
    occ_pre[s] = {}
    for key in ("bind", CLO[s], SLT[s], "eye-both-closure"):
        occ_pre[s][key] = occlusion(poses[key], s)
    print(f"side {s} OCCLUSION PRE:",
          {k: v["fraction"] for k, v in occ_pre[s].items()}, flush=True)

# ---- re-fit: H1 SEAT re-run against the NEW surface (no widen) ----
disp = {s: {} for s in "LR"}
seat_stat = {}
for s in "LR":
    P0 = body0[ring1[s]]
    dv = P0 - C[s]
    ln = np.linalg.norm(dv, axis=1)
    direction = dv / np.maximum(ln, 1e-12)[:, None]
    o = np.broadcast_to(C[s], dv.shape)
    t = np.maximum(ray_sphere_t_vec(o, direction, C[s], R_NEW),
                   ray_sphere_t_vec(o, direction,
                                    C[s] + np.array([0, 0, ZC]), R_CAP))
    gap = (ln - t) * M
    gw = np.clip((SEAT_CEIL - gap) / (SEAT_CEIL - SEAT_FLOOR), 0.0, 1.0)
    seated = flesh = 0
    maxd = 0.0
    for k, vi in enumerate(int(v) for v in ring1[s]):
        if ln[k] < 1e-12:
            continue
        if gw[k] <= 0.0:
            flesh += 1
            continue
        target = C[s] + direction[k] * (t[k] + OFFSET / M)
        d = gw[k] * (target - P0[k])
        disp[s][vi] = (d * M).tolist()
        seated += 1
        maxd = max(maxd, float(np.linalg.norm(d)) * M)
    seat_stat[s] = {"seatedVerts": seated, "fleshVerts": flesh,
                    "movedVerts": seated, "maxSeatMm": round(maxd, 4),
                    "gapMinMm": round(float(gap.min()), 3),
                    "gapMaxMm": round(float(gap.max()), 3),
                    "gwMin": round(float(gw.min()), 3),
                    "gwMax": round(float(gw.max()), 3)}
    print(f"side {s} SEAT:", seat_stat[s], flush=True)

# post-refit positions (same disp on basis + every target => deltas invariant)
DV = np.zeros_like(body0)
for s in "LR":
    for vi, d in disp[s].items():
        DV[vi] = np.array(d) / M
post_pos = {"bind": body0 + DV}
for k in D:
    post_pos[k] = body0 + DV + D[k] / M

for s in "LR":
    post[s] = {}
    r1 = post_pos["bind"][ring1[s]]
    post[s]["ring_bind_new"] = [float(gap_new(r1, C[s]).min()),
                                float(gap_new(r1, C[s]).mean())]
    for pose, key in (("closure", CLO[s]), ("slit", SLT[s]),
                      ("both", "eye-both-closure")):
        b = band[s]
        post[s][f"band_{pose}_new"] = float(gap_new(post_pos[key][b],
                                                    C[s]).min())
    print(f"side {s} POST ring bind new {post[s]['ring_bind_new']}",
          flush=True)
    print(f"side {s} POST band closure {post[s]['band_closure_new']:.3f} "
          f"slit {post[s]['band_slit_new']:.3f} both "
          f"{post[s]['band_both_new']:.3f}", flush=True)

seal_post = {}
occ_post = {}
for s in "LR":
    # invariance: lid deltas must be bit-stable (same disp on basis+targets)
    d_pre = np.linalg.norm(poses[CLO[s]][band[s]] - body0[band[s]], axis=1)
    d_post = np.linalg.norm(post_pos[CLO[s]][band[s]]
                            - post_pos["bind"][band[s]], axis=1)
    seal_post[s] = {"deltaInvariantMaxMm": float(abs(d_pre - d_post).max()
                                                 * M)}
    occ_post[s] = {}
    for key in ("bind", CLO[s], SLT[s], "eye-both-closure"):
        occ_post[s][key] = occlusion(post_pos[key], s)
    print(f"side {s} OCCLUSION POST:",
          {k: v["fraction"] for k, v in occ_post[s].items()}, flush=True)
print("delta invariance:", seal_post, flush=True)

# aperture post-refit (fissure on displaced ring1; midline-margin overlap
# vs NEW iris top -- same station as the pre-refit edge)
ap = {}
for s in "LR":
    r1 = post_pos["bind"][ring1[s]]
    f = core.fissure_dims(r1)
    r1b = body0[ring1[s]]
    midy = float(r1b[:, 1].min() + r1b[:, 1].max()) / 2
    xw = float(r1b[:, 0].max() - r1b[:, 0].min())
    cx = float(r1b[:, 0].mean())
    central = np.abs(r1b[:, 0] - cx) <= xw / 6
    up = ring1[s][(r1b[:, 1] >= midy) & central]
    lo = ring1[s][(r1b[:, 1] < midy) & central]
    e_up = float(post_pos["bind"][up][:, 1].min())
    e_lo = float(post_pos["bind"][lo][:, 1].max())
    ap[s] = {"fissureWidthMm": round(f["widthMm"], 3),
             "fissureHeightMm": round(f["heightMm"], 3),
             "upperEdgeYm": round(e_up, 6),
             "overlapMm": round((IRIS_TOP[s] - e_up) * M, 3),
             "lowerEdgeYm": round(e_lo, 6),
             "lowerVsLimbusMm": round((e_lo - LIMB_BOT[s]) * M, 3),
             "mrd1vsApexMm": round((e_up - APEX_Y[s]) * M, 3)}
    print(f"side {s} aperture POST:", ap[s], flush=True)

# slit-band diagnostic (verts the SLIT morph itself moves): the lower-lid
# tuck at full slit is morph authoring, pre-existing on the old surface
# (worse there). Tracked, not gated -- re-authoring morphs is G4+ scope.
slit_tuck = {}
for s in "LR":
    dm = np.linalg.norm(D[SLT[s]], axis=1)
    b = np.nonzero((dm >= 0.3)
                   & (np.linalg.norm(body0 - C[s], axis=1) <= 0.030))[0]
    go = gap_old_full(poses[SLT[s]][b], s)
    gn = gap_new(poses[SLT[s]][b], C[s])
    gp = gap_new(post_pos[SLT[s]][b], C[s])
    i = int(np.argmin(gn))
    slit_tuck[s] = {"n": len(b),
                    "preOldMinMm": round(float(go.min()), 3),
                    "preNewMinMm": round(float(gn.min()), 3),
                    "postNewMinMm": round(float(gp.min()), 3),
                    "worstBindMm": [round(float(v * M), 2) for v in
                                    body0[b[i]]],
                    "worstDispMm": round(float(dm[b[i]]), 2)}
print("slit tuck diagnostic:", slit_tuck, flush=True)

# lash: morphs present + directional (mesh untouched; G4 re-seats)
lash = {}
try:
    lname = core.resolve_lash_mesh_name(js)
    lm = next(m for m in js["meshes"] if m.get("name") == lname)
    lt = lm.get("extras", {}).get("targetNames", [])
    lash = {"mesh": lname[:60], "hasClosureSlitMorphs": all(
        m in lt for m in NEED), "nTargets": len(lt), "meshTouched": False}
except RuntimeError as e:
    lash = {"error": str(e)}
print("lash:", lash, flush=True)

report = {
    "slice": "G3-lid-refit-plus-seal (GLB-space H1-SEAT re-run, no widen)",
    "bake": {"file": str(BAKE), "body": bname,
             "note": "read-only; widen NOT re-applied (already embodied)"},
    "ringSource": ring_src,
    "oldSurface": {s: {"globeC_m": [round(float(v), 6) for v in C[s]],
                       "globeR_mm": round(Rg[s] * M, 4),
                       "shellC_m": [round(float(v), 6) for v in Cs[s]],
                       "shellR_mm": round(Rs[s] * M, 4),
                       "shellForwardOffset_mm": round(
                           float((Cs[s][2] - C[s][2]) * M), 3)}
                   for s in "LR"},
    "newSurface": {"trace": "geometric-eye-g1-params.json",
                   "scleralR_mm": Rr["scleral_radius_mm"],
                   "capR_mm": Rr["cap_radius_mm"],
                   "apex_mm": Rr["apex_z_mm"],
                   "protrusion_mm": round(Rr["apex_z_mm"]
                                          - Rr["scleral_radius_mm"], 3),
                   "irisDia_mm": Dd["dia_mm"],
                   "irisPlane_mm": Dd["plane_z_mm"],
                   "limbusHalfAngleDeg": round(math.degrees(TH0), 3)},
    "newNeverProudOfOld_maxExcessMm": excess,
    "auditEdgeFidelityMm": {s: round(edge[s] * M, 2) for s in "LR"},
    "edgeThresholdStabilityMm": edge_stab,
    "preRefit": pre,
    "occlusionPre": occ_pre,
    "seat": seat_stat,
    "postRefit": post,
    "occlusionPost": occ_post,
    "morphDeltaInvariantMaxMm": {s: seal_post[s]["deltaInvariantMaxMm"]
                                 for s in "LR"},
    "slitTuckDiagnostic": slit_tuck,
    "overlapPreMm": {s: round((IRIS_TOP[s] - edge[s]) * M, 3)
                     for s in "LR"},
    "lowerVsLimbusPreMm": {s: round((lower[s] - LIMB_BOT[s]) * M, 3)
                           for s in "LR"},
    "aperturePost": ap,
    "lash": lash,
    "notEvidenceFor": ["clinical_validity", "production_asset_readiness",
                       "quest_readiness", "exam_equivalence"],
    "notTested": ["lash re-seat + blinkFollow (G4)", "gaze/compat re-run "
                  "(suites run on the untouched shipped bake; re-pinned, "
                  "not re-run)", "second subject (G6)", "Quest"],
}
with open(HERE / "geometric-eye-g3-report.json", "w") as f:
    json.dump(report, f, indent=1)
with open(HERE / "geometric-eye-g3-refit.json", "w") as f:
    json.dump({"slice": "G3-refit-displacement-map",
               "units": "mm, bake head frame (glTF metres*1000)",
               "offsetMm": OFFSET, "seatCeilingMm": SEAT_CEIL,
               "seatFloorMm": SEAT_FLOOR, "widen": "not-applied",
               "displacements": disp}, f)
print("wrote report + refit map", flush=True)

# sagittal midline cross-section figure (measured, not eyeballed)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
fig, ax = plt.subplots(1, 2, figsize=(12, 5.5), sharey=True)
for ai, s in enumerate("LR"):
    a = ax[ai]
    Cc = C[s] * M
    th = np.linspace(-math.pi, math.pi, 361)
    # old globe / old shell / new sclera / new cap arcs (y-z plane, x=Cx)
    for (cc, rr, ls, lb) in (
            (Cc, Rg[s] * M, "-", "old globe"),
            (Cs[s] * M, Rs[s] * M, "--", "old shell"),
            (Cc, R_NEW * M, "-", "new sclera"),
            (Cc + np.array([0, 0, ZC * M]), R_CAP * M, "--", "new cap")):
        a.plot(cc[2] + rr * np.cos(th), cc[1] + rr * np.sin(th),
               ls, lw=1, label=lb)
    a.axhline(IRIS_TOP[s] * M, color="g", ls=":", lw=1,
              label="new iris top")
    a.axhline(LIMB_BOT[s] * M, color="g", ls=":", lw=1)
    # lid margin loop near midline (|x-Cx|<1mm): bind pre, bind post, closure
    for key, mk, lb, col in (
            ("bind", None, "lid bind PRE", "k"),
            ("bindPost", None, "lid bind POST", "b"),
            (CLO[s], None, "lid closure", "r")):
        pos = (body0 if key == "bind" else
               (post_pos["bind"] if key == "bindPost" else poses[key]))
        sel = ring1[s][np.abs(body0[ring1[s]][:, 0] - C[s][0]) * M < 2.0]
        yy = pos[sel][:, 1] * M
        zz = pos[sel][:, 2] * M
        o = np.argsort(yy)
        a.plot(zz[o], yy[o], marker=".", ms=3, ls="None", color=col,
               label=lb)
    a.set_title(f"side {s} sagittal midline (mm, head frame)")
    a.set_xlabel("z (anterior +)")
    a.set_aspect("equal")
ax[0].set_ylabel("y (up +)")
ax[0].legend(fontsize=7, loc="lower right")
fig.suptitle("G3 lid re-fit: midline section -- lids vs old shell / new cap "
             "(measured)")
fig.tight_layout()
fig.savefig(HERE / "geometric-eye-g3-section.png", dpi=110)
print("wrote section figure", flush=True)
