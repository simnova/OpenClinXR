#!/usr/bin/env python3
"""G5 gate: re-prove the room-0.5 + quad@(1,8,6) recipe on the TRUE r7.8 cap.

Independent re-derivation from the committed render PNGs (never trusts the
render script's claims): dot presence/shape/position, limbal ring on the true
cap vs the smooth-shell control, veil/sat, fresnel rim response, and +/-25deg
gaze parallax shift. Writes geometric-eye-g5-report.json + -sheet.png.
Verdict lines printed; exit 0 iff all enforced arms pass.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import label as nd_label

HERE = Path(__file__).parent
PX_PER_MM = 1024 / 30.0  # ortho-30 framing, shared by every cell
IRIS_R_MM = 5.4035
IRIS_R_PX = IRIS_R_MM * PX_PER_MM  # 184.4
ANALYTIC_SHIFT_MM = 9.949 * math.sin(math.radians(25.0))  # 4.204


def load(cell):
    return np.asarray(Image.open(HERE / f"geometric-eye-g5-{cell}.png").convert("RGB"), dtype=np.float64)


def srgb_to_lstar(a):
    u = a / 255.0
    lin = np.where(u <= 0.04045, u / 12.92, ((u + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805],
                  [0.2126, 0.7152, 0.0722],
                  [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T
    w = np.array([0.95047, 1.0, 1.08883])
    f = xyz / w
    f = np.where(f > 0.008856, f ** (1 / 3), 7.787 * f + 16 / 116)
    return 116 * f[..., 1] - 16


def rgb_to_sat(a):
    mx = a.max(-1)
    mn = a.min(-1)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)


def dark_core_centroid(lum, cx_hint=512.0):
    # iris disc = darkest large region near the gaze-shifted centre. NB:
    # film_transparent renders the background BLACK, so (a) search inside a
    # wide box centred on the hint (covers +/-25deg shift + full disc) and
    # (b) exclude lum<=0.3 background before the dark quantile. A fixed
    # frame-centre box clips the shifted disc and biases the shift SHORT
    # (measured 26-32% short on the first pass) — hence the hint.
    yy, xx = np.mgrid[0:1024, 0:1024]
    box = (np.hypot(xx - cx_hint, yy - 512) < 2.5 * IRIS_R_PX) & (lum > 0.3)
    dark = (lum < np.quantile(lum[box], 0.20)) & box
    ys, xs = np.nonzero(dark)
    return float(xs.mean()), float(ys.mean())


def radial_profile(lum, cx, cy, rmax, nbins=60):
    yy, xx = np.mgrid[0:1024, 0:1024]
    r = np.hypot(xx - cx, yy - cy)
    prof = []
    for b in range(nbins):
        lo, hi = rmax * b / nbins, rmax * (b + 1) / nbins
        m = (r >= lo) & (r < hi)
        prof.append(float(lum[m].mean()) if m.sum() else float("nan"))
    edges = [(rmax * b / nbins + rmax * (b + 1) / nbins) / 2 for b in range(nbins)]
    return edges, prof


out = {"analytic_shift_mm": round(ANALYTIC_SHIFT_MM, 3), "cells": {}}
checks = []

def hot_clusters(dL, mask):
    """Connected ΔL*>=25 clusters inside mask, largest first."""
    hot = (dL >= 25) & mask
    lab, n = nd_label(hot)
    out = []
    yy, xx = np.mgrid[0:1024, 0:1024]
    for i in range(1, n + 1):
        m = lab == i
        npx = int(m.sum())
        x0, x1, y0, y1 = int(xx[m].min()), int(xx[m].max()), int(yy[m].min()), int(yy[m].max())
        w, h = x1 - x0 + 1, y1 - y0 + 1
        out.append({"px": npx, "centroid_px": [round(float(xx[m].mean()), 1), round(float(yy[m].mean()), 1)],
                    "bbox": [x0, y0, w, h], "round_ratio": round(max(w, h) / min(w, h), 2)})
    return sorted(out, key=lambda c: -c["px"])


room05 = load("cap-room05")
roomonly = load("cap-roomonly")
shell = load("shell-room05")
shell_roomonly = load("shell-roomonly")
L_front, L_roomonly = srgb_to_lstar(room05), srgb_to_lstar(roomonly)
L_shell, L_shell_roomonly = srgb_to_lstar(shell), srgb_to_lstar(shell_roomonly)

cx, cy = dark_core_centroid(L_roomonly)
out["disc_centroid_px"] = [round(cx, 1), round(cy, 1)]
checks.append(("disc centred", abs(cx - 512) < 12 and abs(cy - 512) < 12))

# ---- dot: own-baseline lift, largest connected cluster = the dot core ----
yy, xx = np.mgrid[0:1024, 0:1024]
iris_m = np.hypot(xx - cx, yy - cy) < IRIS_R_PX
cap_clusters = hot_clusters(L_front - L_roomonly, iris_m)
shell_clusters = hot_clusters(L_shell - L_shell_roomonly, iris_m)
dot = cap_clusters[0] if cap_clusters else {"px": 0}
dot["dist_from_disc_centre_radii"] = round(math.hypot(dot["centroid_px"][0] - cx, dot["centroid_px"][1] - cy) / IRIS_R_PX, 2) if dot["px"] else None
out["cells"]["cap-room05"] = {"dot": dot, "n_clusters": len(cap_clusters)}
shell_dot = shell_clusters[0] if shell_clusters else {"px": 0}
out["cells"]["shell-room05"] = {"dot": shell_dot, "n_clusters": len(shell_clusters)}
# whole-frame quad energy (own baselines): tighter curvature must not spray
# MORE light across the frame than the smooth shell.
cap_total = int(((L_front - L_roomonly) >= 25).sum())
shell_total = int(((L_shell - L_shell_roomonly) >= 25).sum())
out["frame_hot"] = {"true_cap": cap_total, "smooth_shell": shell_total,
                    "note": "same quad energy; curvature redistributes (concentrated vs spread), totals ~equal by construction"}
checks.append(("true-cap dot core present >=20px (carried coreMinCluster)", dot["px"] >= 20))
checks.append(("true-cap dot core round (ratio<=1.5 carried)", dot["px"] > 0 and dot["round_ratio"] <= 1.5))
checks.append(("dot core in-disc (<=1 radius)", dot["px"] > 0 and dot["dist_from_disc_centre_radii"] <= 1.0))
checks.append(("curvature morphology delta: smooth-shell core is a smear (ratio>2), true cap a dot",
               shell_dot["px"] > 0 and shell_dot.get("round_ratio", 0) is not None
               and (shell_dot.get("round_ratio") or 0) > 2.0))

# ---- limbal ring: azimuthal arc profile at the rim, both geometries ----
# The quad-side limbal arc lives at the TOP of the rim (dot side), not on the
# horizontal meridian (which shows only the albedo step — a meridian "width"
# gate passed here on the sclera ramp, i.e. green about nothing; removed).
# Sample brightness around the rim circle: arc peak above the ring median +
# arc angular FWHM. Width is RECORDED on both (re-measure, don't assume); the
# enforced arm is arc presence on the true cap. Curvature response is carried
# by the dot-core morphology pair above, not double-counted here.
def azimuthal_arc(L, cx, cy):
    yy, xx = np.mgrid[0:1024, 0:1024]
    r = np.hypot(xx - cx, yy - cy)
    band = (r >= IRIS_R_PX - 2) & (r <= IRIS_R_PX + 2)
    angs = np.degrees(np.arctan2(-(yy - cy), xx - cx))  # 0=+x, 90=up
    vals = []
    for deg in range(360):
        m = band & (np.abs((angs - deg + 180) % 360 - 180) < 0.6)
        vals.append(float(L[m].mean()) if m.sum() else float("nan"))
    vals = np.array(vals)
    pk = int(np.nanargmax(vals))
    med = float(np.nanmedian(vals))
    half = med + (vals[pk] - med) / 2
    lo = pk
    while vals[(lo - 1) % 360] >= half and (pk - lo) % 360 < 180:
        lo = (lo - 1) % 360
    hi = pk
    while vals[(hi + 1) % 360] >= half and (hi - pk) % 360 < 180:
        hi = (hi + 1) % 360
    return {"peak_L": round(float(vals[pk]), 1), "peak_deg": pk,
            "median_L": round(med, 1),
            "fwhm_deg": (hi - pk) % 360 + (pk - lo) % 360 + 1}


for name, L in (("cap", L_front), ("shell", L_shell)):
    edges, prof = radial_profile(L, cx, cy, 1.6 * IRIS_R_PX)
    ring = [v for e, v in zip(edges, prof) if abs(e - IRIS_R_PX) <= 8]
    interior = [v for e, v in zip(edges, prof) if e < 0.5 * IRIS_R_PX]
    arc = azimuthal_arc(L, cx, cy)
    out["cells"][f"{name}-room05"] = out["cells"].get(f"{name}-room05", {})
    out["cells"][f"{name}-room05"]["ring"] = {
        "peak_L": round(max(ring), 1), "interior_L": round(float(np.mean(interior)), 1),
        "arc": arc}
cap_ring = out["cells"]["cap-room05"]["ring"]
shell_ring = out["cells"]["shell-room05"]["ring"]
out["wants"] = {"ring_peak_L_true_cap": cap_ring["peak_L"],
                "ring_arc_true_cap": cap_ring["arc"],
                "ring_arc_smooth_shell": shell_ring["arc"],
                "ring_note": "new EEVEE-harness wants; the three.js 28.9/28.1 is NOT inherited"}
checks.append(("limbal ring resolves above interior on true cap", cap_ring["peak_L"] > cap_ring["interior_L"] + 5))
checks.append(("limbal arc present on true cap (peak above ring median +5)",
               cap_ring["arc"]["peak_L"] > cap_ring["arc"]["median_L"] + 5))

# ---- veil / sat on the disc interior ----
yy2, xx2 = np.mgrid[0:1024, 0:1024]
core = np.hypot(xx2 - cx, yy2 - cy) < 0.8 * IRIS_R_PX
veil_floor = float(L_roomonly[core].mean())
veil_full = float(L_front[core].mean())
sat = float(rgb_to_sat(room05)[core].mean())
out["cells"]["cap-room05"]["veil_sat"] = {
    "roomonly_floor_L": round(veil_floor, 1),
    "room05_interior_L": round(veil_full, 1),
    "quad_smear_lift_L": round(veil_full - veil_floor, 1),
    "disc_meansat": round(sat, 4),
    "meansat_note": "0.61 lands just above the three.js [0.30,0.60] band; band NOT enforced (EEVEE vs ACES tone mapping differs) — recorded as the new-harness want for the G6 three.js re-tune"}
checks.append(("room adds light over the quad-off floor (cells not mislabeled)", veil_full > veil_floor + 1.0))

# ---- fresnel: NOT measurable in this harness (recorded, not fudged) ----
# The shipped-GLB cap material is alpha-blend white (no fresnel term), and
# EEVEE transmission against transparent film cannot resolve a grazing
# gradient (cap-alone cells read quad-specular only: rim/centre ~1.0 both
# geometries). Real fresnel response lives in the three.js MeshPhysicalMaterial
# (IOR 1.376, eye-finish fresnel report) and is re-tuned at the G6 re-bake.
# The curvature response IS measured here as highlight morphology
# (dot core + frame spray + ring FWHM, above).
fr_c = fr_s = None
out["fresnel_compare"] = {"true_cap": fr_c, "smooth_shell": fr_s,
                          "note": "transmission-fresnel not resolvable in EEVEE/transparent-film; morphology comparison carries the curvature response"}

# ---- parallax: +/-25deg yaw shift vs analytic 4.205mm ----
# Room-only twins (no quad dot to contaminate the dark-core centroid), with
# the search box following the gaze (see dark_core_centroid note).
shifts = {}
base_cx, _ = dark_core_centroid(L_roomonly)
for tag in ("p25", "m25"):
    a = load(f"cap-yaw-{tag}-roomonly")
    hint = 512.0 + (ANALYTIC_SHIFT_MM * PX_PER_MM if tag == "p25" else -ANALYTIC_SHIFT_MM * PX_PER_MM)
    ccx, _ = dark_core_centroid(srgb_to_lstar(a), cx_hint=hint)
    dx_px = ccx - base_cx
    dx_mm = dx_px / PX_PER_MM
    err = abs(abs(dx_mm) - ANALYTIC_SHIFT_MM) / ANALYTIC_SHIFT_MM
    shifts[tag] = {"dx_px": round(dx_px, 1), "dx_mm": round(dx_mm, 3),
                   "rel_err_vs_analytic": round(err, 3)}
    checks.append((f"gaze {tag}: |shift| within 15% of analytic {ANALYTIC_SHIFT_MM:.3f}mm",
                   err <= 0.15))
out["parallax"] = shifts

# ---- sheet ----
cells = [("cap-room05", "true r7.8 cap"), ("shell-room05", "smooth-shell control"),
         ("cap-yaw-p25", "+25deg"), ("cap-yaw-m25", "-25deg")]
ims = [Image.open(HERE / f"geometric-eye-g5-{c}.png").convert("RGB").resize((512, 512)) for c, _ in cells]
sheet = Image.new("RGB", (1024, 1024), (20, 20, 20))
for i, im in enumerate(ims):
    sheet.paste(im, (512 * (i % 2), 512 * (i // 2)))
sheet.save(HERE / "geometric-eye-g5-sheet.png")

out["checks"] = [{"name": n, "pass": bool(p)} for n, p in checks]
out["verdict"] = "GREEN" if all(p for _, p in checks) else "RED"
out["not_tested"] = {
    "socket_showthrough_at_yaw": "no socket/lid aperture in this GLB; edgeAtYaw stays OPEN under eye-globe-fit (compat falsifier, recorded)",
    "skin_zero": "no skin in this GLB; three.js scoped-env skin-zero re-tune belongs to the station re-bake (G6)",
    "cornea_env_intensity_retune": "EEVEE wants recorded here; product-rig constants untouched (different harness)"}
(HERE / "geometric-eye-g5-report.json").write_text(json.dumps(out, indent=1))
for n, p in checks:
    print(("PASS " if p else "FAIL ") + n)
print("verdict:", out["verdict"])
sys.exit(0 if out["verdict"] == "GREEN" else 1)
