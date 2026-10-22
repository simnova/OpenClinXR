#!/usr/bin/env python3
"""G3 gate: lid re-fit on the G1 anterior profile + blink seal, re-derived.

Cheapest pass refused: lids moved but the seal measured against the OLD
shell; a narrowed gap that still floats; position held while size drifted.
Every check re-derives from the raw bake GLB + refit map + G1 params --
never trusts the build report. Exit 0 = GREEN.
Reads: aisha-lidconform.glb (store, read-only), geometric-eye-g1-params.json,
  geometric-eye-g3-refit.json, geometric-eye-g3-report.json.
Writes: geometric-eye-g3-sheet.png (closure/slit seal crops + section).
"""
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
fails, infos = [], []
def check(name, cond, detail):
    print(("PASS" if cond else "FAIL"), name, "-", detail, flush=True)
    if not cond:
        fails.append(name)

sys.path.insert(0, str(Path(
    "tools/openclinxr/asset-pipeline/realism-head/lid-conform").resolve()))
import lid_conform_core as core  # noqa: E402

M = 1000.0
STORE = Path("/Volumes/files/openclinxr-assets/store/lid-conform")
BAKE = STORE / "aisha-lidconform.glb"

rep = json.loads((HERE / "geometric-eye-g3-report.json").read_text())
ref = json.loads((HERE / "geometric-eye-g3-refit.json").read_text())
P = json.loads((HERE / "geometric-eye-g1-params.json").read_text())
Rr, Dd = P["resolved"], P["iris_disc"]
R_NEW = Rr["scleral_radius_mm"] / M
R_CAP = Rr["cap_radius_mm"] / M
ZC = (Rr["apex_z_mm"] - Rr["cap_radius_mm"]) / M
IRIS_R = Dd["dia_mm"] / 2 / M

# ---- bake integrity (untouched by this slice) ----
sha = hashlib.sha256(BAKE.read_bytes()).hexdigest()
check("bake_untouched",
      sha == rep.get("bake_sha256") == ref.get("bake_sha256"),
      f"sha {sha[:12]} vs report {str(rep.get('bake_sha256'))[:12]}")

# ---- independent re-derivation from the raw GLB ----
js, blob = core.load_glb(str(BAKE))
worlds = core.node_worlds(js)
bn = core.resolve_body_mesh_name(js)
body0, bidx = core.skin_mesh(js, blob, worlds, bn)
tris = bidx.reshape(-1, 3)
mesh = next(m for m in js["meshes"] if m.get("name") == bn)
tnames = mesh.get("extras", {}).get("targetNames", [])

def kasa(pts):
    a = np.concatenate([2.0 * pts, np.ones((len(pts), 1))], axis=1)
    b = (pts ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    c = sol[:3]
    return c, float(math.sqrt(max(sol[3] + c @ c, 0.0)))

def rsv(o, d, cc, rr):
    oc = o - cc
    b = (oc * d).sum(axis=1)
    c = (oc * oc).sum(axis=1) - rr ** 2
    disc = b * b - c
    t = np.full(len(o), np.inf)
    m = disc >= 0
    t[m] = -b[m] + np.sqrt(disc[m])
    t[t <= 0] = np.inf
    return t

def gap_new(p, Cc):
    dv = p - Cc
    ln = np.linalg.norm(dv, axis=1)
    d = dv / np.maximum(ln, 1e-12)[:, None]
    o = np.broadcast_to(Cc, p.shape)
    t = np.maximum(rsv(o, d, Cc, R_NEW),
                   rsv(o, d, Cc + np.array([0, 0, ZC]), R_CAP))
    return (ln - t) * M

cn = core.resolve_cornea_mesh_names(js)
cor = {}
for n in cn:
    pts, _ = core.skin_mesh(js, blob, worlds, n)
    cor[n] = pts
cl = max(cn, key=lambda m: cor[m][:, 0].mean())
cr = min(cn, key=lambda m: cor[m][:, 0].mean())
gn = core.resolve_globe_mesh_name(js)
gp, _ = core.skin_mesh(js, blob, worlds, gn)
C, Rg, Cs, Rs = {}, {}, {}, {}
for s, cx in (("L", cor[cl][:, 0].mean()), ("R", cor[cr][:, 0].mean())):
    side = gp[np.linalg.norm(
        gp - cor[cl].mean(axis=0), axis=1) < np.linalg.norm(
        gp - cor[cr].mean(axis=0), axis=1)] if s == "L" else gp[
        np.linalg.norm(gp - cor[cl].mean(axis=0), axis=1) >= np.linalg.norm(
        gp - cor[cr].mean(axis=0), axis=1)]
    C[s], Rg[s] = kasa(side)
    cc = cor[cl] if s == "L" else cor[cr]
    Cs[s], Rs[s] = kasa(cc)
for s in "LR":
    check(f"globe_R_{s}", abs(Rg[s] * M - 11.904) <= 0.01,
          f"{Rg[s]*M:.4f} reproduces G0 11.904")
    check(f"shell_offset_{s}",
          abs((Cs[s][2] - C[s][2]) * M - 0.95) <= 0.05,
          f"{(Cs[s][2]-C[s][2])*M:.3f} reproduces G0 pole-bias +0.95")

ring1 = {s: core.derive_eye_rings(body0, tris, C[s])["ring1"] for s in "LR"}
for s in "LR":
    check(f"ring_{s}", len(ring1[s]) == 56,
          f"{len(ring1[s])} verts (conform baseRing1=56)")

CLO = {"L": "eye-left-closure", "R": "eye-right-closure"}
SLT = {"L": "eye-left-slit", "R": "eye-right-slit"}
poses = {"bind": body0}
for m in [CLO["L"], SLT["L"], CLO["R"], SLT["R"], "eye-both-closure"]:
    kw = {m: 1.0} if m != "eye-both-closure" else {
        "eye-left-closure": 1.0, "eye-right-closure": 1.0}
    poses[m], _ = core.skin_mesh(js, blob, worlds, bn, morph_weights=kw)

# refit displacement applied by the GATE (independent application)
DV = np.zeros_like(body0)
for s in "LR":
    for k, v in ref["displacements"][s].items():
        DV[int(k)] = np.array(v) / M
nref = sum(len(v) for v in ref["displacements"].values())
check("refit_count", nref == 48, f"{nref} displaced verts (24+24)")
post = {k: (body0 + DV if k == "bind" else None) for k in ["bind"]}
for k in poses:
    if k != "bind":
        post[k] = body0 + DV + (poses[k] - body0)

def gap_old(p, s):
    dv = p - C[s]
    ln = np.linalg.norm(dv, axis=1)
    d = dv / np.maximum(ln, 1e-12)[:, None]
    o = np.broadcast_to(C[s], p.shape)
    t = np.maximum(rsv(o, d, C[s], Rg[s]), rsv(o, d, Cs[s], Rs[s]))
    return (ln - t) * M

# the SEAL band (matches the seal script exactly): verts the ipsilateral
# CLOSURE morph moves >= 0.3mm within 30mm of the globe centre -- the lid
# margin + mobile lid that forms the seal line. Evaluated at every pose.
sealband = {}
for s in "LR":
    dm = np.linalg.norm((poses[CLO[s]] - body0) * M, axis=1)
    sealband[s] = np.nonzero(
        (dm >= 0.3) & (np.linalg.norm(body0 - C[s], axis=1) <= 0.030))[0]

# ---- agreement with the report (tight: same inputs, own code path) ----
TOL = 1e-6
for s in "LR":
    r1 = body0[ring1[s]]
    g = gap_new(r1, C[s])
    check(f"agree_ringbind_{s}",
          abs(g.min() - rep["preRefit"][s]["ring_bind_new"][0]) < 1e-3
          and abs(g.mean() - rep["preRefit"][s]["ring_bind_new"][1]) < 1e-3,
          f"gate {g.min():.3f}/{g.mean():.3f} vs report "
          f"{rep['preRefit'][s]['ring_bind_new']}")
    for key in (CLO[s], SLT[s], "eye-both-closure"):
        b = sealband[s]
        gpre = gap_new(poses[key][b], C[s]).min()
        repkey = {"eye-left-closure": "closure", "eye-right-closure":
                  "closure", "eye-left-slit": "slit", "eye-right-slit":
                  "slit", "eye-both-closure": "both"}[key]
        check(f"agree_band_{s}_{repkey}", abs(
            gpre - rep["preRefit"][s][f"band_{repkey}_new"]) < 1e-3,
            f"gate {gpre:.3f} vs report "
            f"{rep['preRefit'][s][f'band_{repkey}_new']:.3f}")
        gpost = gap_new(post[key][b], C[s]).min()
        check(f"agree_post_{s}_{repkey}", abs(
            gpost - rep["postRefit"][s][f"band_{repkey}_new"]) < 1e-3,
            f"gate {gpost:.3f} vs report "
            f"{rep['postRefit'][s][f'band_{repkey}_new']:.3f}")

# ---- scope gates ----
for s in "LR":
    b = sealband[s]
    for key, lab in ((CLO[s], "closure"), (SLT[s], "slit"),
                     ("eye-both-closure", "both")):
        g = gap_new(post[key][b], C[s]).min()
        check(f"seal_no_poke_{s}_{lab}", g >= -0.05,
              f"post min gap {g:.3f}mm (50u tolerance; baseline old "
              f"{rep['preRefit'][s][f'band_{lab}_old']:.3f})")
        check(f"seal_better_than_old_{s}_{lab}",
              g > rep["preRefit"][s][f"band_{lab}_old"] + 0.3,
              f"{g:.3f} vs old {rep['preRefit'][s][f'band_{lab}_old']:.3f}")
    r1 = post["bind"][ring1[s]]
    check(f"seal_no_float_{s}",
          gap_new(r1, C[s]).mean() <= rep["preRefit"][s][
              "ring_bind_new"][1] + 0.05,
          "seat moved lids toward the surface, not away")
    # full near-eye set: nothing got worse vs the old-profile baseline
    # (covers morph-overshoot verts outside the seal band, e.g. the lower
    # lid tuck at slit: pre-existing authoring, old -1.76 -> new -1.33).
    full = np.nonzero(np.linalg.norm(body0 - C[s], axis=1) <= 0.025)[0]
    for key, lab in ((CLO[s], "closure"), (SLT[s], "slit"),
                     ("eye-both-closure", "both")):
        gnew = gap_new(post[key][full], C[s]).min()
        gold = gap_old(poses[key][full], s).min()
        check(f"seal_no_regression_full_{s}_{lab}", gnew >= gold - 0.05,
              f"post {gnew:.3f} vs old-baseline {gold:.3f}")

# occlusion re-derivation (own code path): closure must fully cover
def occlusion(pos, Cc):
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
    a_ring = math.sqrt(max(R_NEW ** 2 - 10.417e-3 ** 2, 0))
    t_eye = np.full(len(O), np.inf)
    capm = rho <= a_ring
    t_eye[capm] = rsv(O[capm], dd[capm], Cc + np.array([0, 0, ZC]), R_CAP)
    scm = (~capm) & (rho <= R_NEW)
    t_eye[scm] = rsv(O[scm], dd[scm], Cc, R_NEW)
    hitm = np.isfinite(t_eye)
    near = np.linalg.norm(pos - Cc, axis=1) <= 0.025
    tm = near[tris].all(axis=1)
    t_lid = core.ray_cast_mesh(O[hitm], dd[hitm], pos[tris[tm]])
    return float(((t_lid < t_eye[hitm]).mean()))

for s in "LR":
    for key, lab in ((CLO[s], "closure"), ("eye-both-closure", "both")):
        f = occlusion(post[key], C[s])
        check(f"seal_occlusion_{s}_{lab}", f == 1.0, f"fraction {f}")

# aperture (own fissure + own midline-margin edge)
for s in "LR":
    r1 = post["bind"][ring1[s]]
    f = core.fissure_dims(r1)
    check(f"aperture_width_{s}", abs(f["widthMm"] - 27.009) <= 0.3
          and 26.5 <= f["widthMm"] <= 27.5,
          f"{f['widthMm']:.3f} vs baseline 27.009 (position+size)")
    check(f"aperture_height_{s}", 10.0 <= f["heightMm"] <= 11.0,
          f"{f['heightMm']:.3f} (audit fix gate <= 11.0; baseline 11.067)")
    check(f"aperture_report_width_{s}",
          abs(f["widthMm"] - rep["aperturePost"][s]["fissureWidthMm"]) < 1e-3,
          "gate agrees with report")
    r1b = body0[ring1[s]]
    midy = float(r1b[:, 1].min() + r1b[:, 1].max()) / 2
    xw = float(r1b[:, 0].max() - r1b[:, 0].min())
    cx = float(r1b[:, 0].mean())
    up = ring1[s][(r1b[:, 1] >= midy) & (np.abs(r1b[:, 0] - cx) <= xw / 6)]
    ov = (C[s][1] + IRIS_R - post["bind"][up][:, 1].min()) * M
    check(f"overlap_report_{s}",
          abs(ov - rep["aperturePost"][s]["overlapMm"]) < 1e-3,
          f"gate {ov:.3f} agrees with report")

# morph-delta invariance (same disp on basis+targets)
for m in [CLO["L"], SLT["L"], CLO["R"], SLT["R"]]:
    d = float(abs(np.linalg.norm(post[m] - post["bind"], axis=1)
                  - np.linalg.norm(poses[m] - body0, axis=1)).max() * M)
    check(f"morph_invariant_{m}", d == 0.0, f"max delta drift {d}")

# t_new <= t_old (seal can only tighten; show-through cannot increase)
rng = np.random.default_rng(7)
for s in "LR":
    u = rng.normal(size=(2048, 3))
    u /= np.linalg.norm(u, axis=1)[:, None]
    o = np.broadcast_to(C[s], u.shape)
    tn = np.maximum(rsv(o, u, C[s], R_NEW),
                    rsv(o, u, C[s] + np.array([0, 0, ZC]), R_CAP))
    to = np.maximum(rsv(o, u, C[s], Rg[s]), rsv(o, u, Cs[s], Rs[s]))
    check(f"surface_never_proud_{s}", float(((tn - to) * M).max()) <= 0.01,
          f"max excess {float(((tn-to)*M).max()):.4f}mm")

# ---- audit rank-1: TRACKED, not scope-binding (see record for reasoning) ----
for s in "LR":
    ov = rep["aperturePost"][s]["overlapMm"]
    audit_station = round((C[s][1] + IRIS_R) * M - 1550.30, 3)
    print(f"INFO overlap_{s}: midline-margin station {ov:.3f}mm "
          f"(pre {rep['overlapPreMm'][s]:.3f}); audit-edge station "
          f"{audit_station:.3f} (edge 1550.30 + true iris top). "
          f"Rank-1 [1,2] NOT closed by re-seat alone -- carried forward.")
    infos.append(f"overlap_{s}")

# ---- sheet: seal renders (if present) + section ----
from PIL import Image  # noqa: E402
cells = []
for f in ["geometric-eye-g3-seal-L-closure.png",
          "geometric-eye-g3-seal-L-slit.png",
          "geometric-eye-g3-seal-R-closure.png"]:
    p = HERE / f
    cells.append(Image.open(p).convert("RGB") if p.exists() else None)
sec = Image.open(HERE / "geometric-eye-g3-section.png").convert("RGB")
W = 1024
strip = []
for c in cells:
    if c is None:
        strip.append(Image.new("RGB", (W // 3, W // 3), (40, 40, 40)))
    else:
        strip.append(c.resize((W // 3, W // 3)))
top = Image.new("RGB", (W, W // 3), (20, 20, 20))
top.paste(strip[0], (0, 0))
top.paste(strip[1], (W // 3, 0))
top.paste(strip[2], (2 * W // 3, 0))
sec2 = sec.resize((W, int(sec.height * W / sec.width)))
sheet = Image.new("RGB", (W, W // 3 + sec2.height), (20, 20, 20))
sheet.paste(top, (0, 0))
sheet.paste(sec2, (0, W // 3))
sheet.save(HERE / "geometric-eye-g3-sheet.png")

print("GATE", "GREEN" if not fails else f"RED ({fails})")
sys.exit(1 if fails else 0)
