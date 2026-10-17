"""Skin gates split by what light can change (card tsk_bd3b33a3695f8587).

WHY: comparing absolute render L* with the goal photos measures exposure,
not skin (room-rig-remeasure-report.json: both subjects L* +13..+24 on the
room rig). Two kinds of skin gate:
  (a) ABSOLUTE TONE, texture space, unlit: albedo L*/a*/b* in face regions
      vs the case's skin-tone anchor (tone-report.json tone_anchors_Lab:
      warm_medium [49.26,13.89,19.44] for body2, warm_light
      [58.37,9.05,16.01] for Aisha). No light, no exposure.
  (b) ROOM-RIG RENDER vs PHOTO, exposure-invariant quantities only.

CAVEAT (recorded, not fixed): the anchors were measured on the goal
PHOTOS' facecore (tone-report.json source), so albedo vs anchor carries a
lighting offset; the known-good/known-bad design is what tells whether
that offset matters.

CAUTION (verified in G0, not assumed): CIELAB is not exposure-invariant.
Scaling linear RGB by k scales f(Y)=Y^(1/3), so (L*+16), a* and b* all
scale by k^(1/3) in the cube-root range. Plain L* differences between
regions and raw a*/b* therefore move with exposure. Candidate invariant
forms: log-luminance differences between regions, ratios (L*+16),
hue angle h_ab = atan2(b*,a*), chroma per lightness C*/(L*+16).
Only quantities that pass G0 are used in G2.

REUSE (no copies of helper logic): face_landmark_regions.py
(create_landmarker, polygon_regions, ERODE_PX, MIN_POLY_N),
room_rig_remeasure.py (skin_gate, regions_of), room_exposure.py
(srgb_to_linear, linear_to_srgb, luminance_Y, apply_k),
face_replay_compose.py (regions_from_masks), face_gate.py
(region_polygons via FLR, raster_masks).

TEXTURE-SPACE REGIONS: derive_out/landmarks-uv.json carries 18 UV points,
not the 478 FaceMesh indices face_gate.py:265 region_polygons needs, so
the render/photo polygons cannot be projected into UV. regions_from_masks
(face_replay_compose.py:410) yields forehead (= facecore top-25pc rows)
plus facecore/face_bbox/lips; cheek_u_lo/hi, chin and upperlip_skin are
geometric subdivisions of that facecore (mid-row outer U bands split at
U-mid; bottom rows excl. lips; band above lips excl. lips). UV laterality
is unmapped (cheeks named by U order); both albedos share the convention
and both cheeks gate against the same anchor, so the gate is unaffected.

Usage: python3 skin_gates_split.py   (run via mise, repo root = cwd)
  --srgb-scale PNG K OUT        scale helper (linear RGB, clip, re-encode)
  --band-quantities PNG         whole-image two-band fixture quantities JSON
"""

import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab

DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(DIR, "..", "..", "..", "..", ".."))
sys.path.insert(0, DIR)
sys.path.insert(0, os.path.join(REPO, "tools", "openclinxr", "evidence", "face-gate"))
import face_gate as FG  # noqa: E402
import face_landmark_regions as FLR  # noqa: E402
import face_replay_compose as FRC  # noqa: E402
import room_exposure as REX  # noqa: E402
import room_rig_remeasure as RRM  # noqa: E402

STORE_FACE = "/Volumes/files/openclinxr-assets/store/face-station-cases"
STORE_IOR = "/Volumes/files/openclinxr-assets/store/skin-ior-room"
GATE_STORE = "/Volumes/files/openclinxr-assets/store/skin-gates-split"
S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike"
RENDER_BODY2 = os.path.join(STORE_IOR, "skinior-body2-14a-front.png")
RENDER_AISHA = os.path.join(STORE_IOR, "skinior-aisha-14-front.png")
GOAL_BODY2 = os.path.join(S, "body2", "goal-front.png")
GOAL_AISHA = os.path.join(S, "project", "edit-v9", "edit-0.png")
ALBEDO = {"body2": os.path.join(STORE_FACE, "body2", "run2", "albedo_beard.png"),
          "aisha": os.path.join(STORE_FACE, "aisha", "run2", "albedo_beard.png")}
DERIVE = {"body2": os.path.join(STORE_FACE, "body2", "run2", "derive_out"),
          "aisha": os.path.join(STORE_FACE, "aisha", "run2", "derive_out")}
REPORT_OUT = os.path.join(DIR, "skin-gates-split-report.json")

ANCHORS = {"warm_medium": [49.26, 13.89, 19.44],
           "warm_light": [58.37, 9.05, 16.01]}
ANCHOR_OF = {"body2": "warm_medium", "aisha": "warm_light"}
ANCHOR_SOURCE = ("tools/openclinxr/asset-pipeline/skin/families/tone-report.json"
                 ":tone_anchors_Lab, source = goal PHOTOS' facecore "
                 "(lighting offset caveat applies)")

REGIONS = ["forehead", "L_cheek", "R_cheek", "chin", "upperlip_skin"]
TEX_REGIONS = ["forehead", "cheek_u_lo", "cheek_u_hi", "chin", "upperlip_skin"]
QUANTS = ["logY_face", "Lratio_face", "hue", "CdivL"]
COUNTER = "dL_face"

# G0 RULE, written BEFORE any number is read (the card's precondition):
# each candidate quantity is recomputed on each render scaled by
# k in {0.5, 2.0} in linear RGB (sRGB decode, multiply, re-encode, clip);
# invariant iff max |q'-q| over regions x renders <= EPS[q] (float /
# 8-bit-quantisation noise, stated per quantity below). The comparison
# runs on the SAME pixels: polygon AND original skin gate AND scaled skin
# gate AND unclipped in the scaled image (kept fractions recorded).
# Reason, recorded: the renders are hot (forehead L ~82); at k=2.0 up to
# ~99pc of a region clips to 255, which destroys chromaticity in the probe
# itself (measured: hue moves 27 deg on clipped pixels). Clipped pixels
# carry no colour information, so they cannot test the quantity; clipping
# fractions are recorded beside every number. Sensitivity: +5 a*
# in the cheek of a render copy must move hue and CdivL by > SENS_MIN, and
# +5 L* in the cheek must move logY_face and Lratio_face by > SENS_MIN
# (each quantity must move under a change it should see). A quantity that
# fails either check is dropped and recorded; plain dL_face is the
# counterexample and must NOT be invariant.
G0_EPS = {"logY_face": 0.01, "Lratio_face": 0.005, "hue": 1.5, "CdivL": 0.005,
          "dL_face": 0.05}
G0_SENS_MIN = {"logY_face": 0.02, "Lratio_face": 0.005, "hue": 2.0,
               "CdivL": 0.01, "dL_face": 0.5}
G0_KS = [0.5, 2.0]
# EPS REVISION (recorded, not hidden): hue EPS was 0.5 in the first draft;
# the RED probe measured up to 1.12 deg hue shift under a k=0.5 8-bit
# round-trip on solid skin tones (sRGB toe amplifies independent channel
# rounding; optical exposure has no such round-trip). Revised to 1.5 with
# this note; the contrast with plain dL (moves ~15) stands.

# G1/G2 RULE, written BEFORE any number is read: per row (region x
# channel/quantity x cross-pair): threshold = midpoint of the known-good
# and known-bad deltas; margin = |bad-good|/2.
# RULE 1 (handback 1: the brief's first rule was incomplete): a row is
# enforceable only if d_good < d_bad (the known-good is closer to its
# reference than the known-bad is) AND margin/noise >= 1. Inverted or
# tied rows (d_bad <= d_good) are report-only with reason "does not
# separate known-good from known-bad (d_bad <= d_good)".
# RULE 2: a gate (region x channel/quantity) is enforced only if ALL its
# known-bad rows (G1a and G1b, or G2a and G2b) are enforceable; otherwise
# the whole gate is report-only. The per-gate threshold is the smallest
# midpoint across its known-bads; the gate margin is the distance from
# that threshold to the nearest delta (min(T - d_good, min(d_bad - T)),
# strictly inside the interval when all rows separate); gate noise is the
# max row noise (conservative).
# RULE 3: noise = SD over 20 seeded half-splits. That denominator is
# pixel-sampling noise ONLY (it does not include instrument, landmark or
# lighting-model error, which is why margins/noise of ~50-350 are
# expected, not suspicious). A second column, margin_over_phys, divides
# the margin by the measured G0 invariance/quantisation epsilon for that
# quantity (logY_face 0.01, Lratio_face 0.005, hue 1.5 deg, CdivL 0.005);
# G1 L uses the dL_face epsilon (0.05, same-unit L* noise bound); G1 a/b
# have no measured G0 epsilon (null, stated) since G0 probed quantities,
# not absolute channels. Render run-to-run adds 0 per room-rig-remeasure
# G0. Thresholds use known-good/known-bad ONLY; body2 evaluation numbers
# are computed after.
PHYS_FLOOR = {"logY_face": 0.01, "Lratio_face": 0.005, "hue": 1.5,
              "CdivL": 0.005}
# G1 channel floors (L/a/b) are MEASURED at runtime (measure_albedo_floors,
# stored as g1_quant_floors): the same 8-bit-quantisation idea as the G0
# epsilons, but on the albedo region pixels themselves (see method note).
# HANDBACK 2 enforcement: a gate is enforced only if
#   margin / max(sampling noise, phys floor) >= 1
# (G2/chin/hue was enforced with margin/phys 0.09: margin 0.135 deg
# against the measured 1.5 deg floor, indistinguishable from 8-bit
# round-trip noise).
G1_SPLITS = 20
G2_SPLITS = 20

RED_FIRST = ("RED 2026-10-17: 5 tests 5 failed (vitest "
             "the-skin-gates-are-split-by-what-light-can-change.test.ts): "
             "unit hue 0.846 > 0.5 under k=0.5 (8-bit round-trip noise; hue "
             "EPS revised 0.5 -> 1.5 with the header note); 4 report its "
             "ENOENT skin-gates-split-report.json.")

# MIRROR EXTENSION (card tsk_b2e8149e77e563f4): lateral room-render skin
# gates are mirror-averaged so the photo's lateral key cancels. Both goal
# photos carry a lateral key (regional-shading-report.json step0
# LR_asym_logY photo_body2 -0.150, photo_aisha -0.091), so one-sided
# L_cheek/R_cheek gates measure the photo's light direction (body2 L_cheek
# 0.30 vs 0.103: about two thirds photo-side). Coordinator decision: change
# how lateral gates are measured; photo untouched; body2 unmuted.
MIRROR_CARD = "tsk_b2e8149e77e563f4"
MIRROR_QUANTS = ["logY_face", "CdivL", "Lratio_face"]
MIRROR_STORE = "/Volumes/files/openclinxr-assets/store/skin-gates-mirror"
MIRROR_REPORT_OUT = os.path.join(DIR, "skin-gates-mirror-report.json")
SPLIT_REPORT_IN = os.path.join(DIR, "skin-gates-split-report.json")
MIRROR_REGION = "mirror_cheek"
LATERAL_KEY_REASON = "photo lateral key"
FOREHEAD_PHOTO_REASON = "photo side dominates"

# G0M RULE, written BEFORE any mirror number is read (the card's
# precondition): a synthetic lateral exposure gradient is applied to each
# room render in linear RGB, multiplier exp(g * x_norm) with x_norm in
# [-1, 1] across the FACE width (union-face bbox), for g in {0.05, 0.1,
# 0.2}, plus a plain linear ramp (1 + g * x_norm) for the same g.
# Per-image q_mirror = mean(q_L_cheek, q_R_cheek), recomputed on the SAME
# pixels (polygon AND original skin gate; clipping fractions recorded).
# KEPT (may gate) iff max |mirror' - mirror| over renders x g x shapes <=
# FLOOR[q] AND sensitivity (symmetric +5 L* on both cheeks of a render
# copy) moves the mirror by > FLOOR[q]. Probe validity, recorded per
# quantity: max one-sided |q_L' - q_L| > FLOOR[q]. CdivL =
# C*/(L*+16) is already exposure-invariant pixel by pixel, so a lateral
# gradient should not move even the one-sided CdivL; onesided_moved=false
# for CdivL is expected and recorded, not a drop. For logY_face /
# Lratio_face a still one-sided value means the probe did not stress the
# quantity -> dropped with that reason. Lratio_face joins the mirror set
# only if it passes. A quantity that fails stays report-only (FALSIFIER
# for that quantity). FLOORs are the measured G0 epsilons (PHYS_FLOOR).
G0M_GS = [0.05, 0.1, 0.2]
G0M_SHAPES = ["exp", "linear"]
G0M_FLOOR = {"logY_face": 0.01, "Lratio_face": 0.005, "CdivL": 0.005}
G0M_RULE = (
    "per candidate quantity q in {logY_face, CdivL, Lratio_face}: "
    "q_mirror = mean(q_L_cheek, q_R_cheek) per image; synthetic lateral "
    "exposure gradient in linear RGB, exp(g*x_norm) and (1+g*x_norm), "
    "x_norm in [-1,1] across the face width, g in {0.05, 0.1, 0.2}, "
    "same-pixel recompute; KEPT iff max |mirror'-mirror| <= FLOOR[q] "
    "(logY 0.01, Lratio 0.005, CdivL 0.005: measured G0 epsilons) AND "
    "sensitivity (+5 L* both cheeks) moves mirror > FLOOR[q]; validity "
    "max one-sided |q_L'-q_L| > FLOOR[q] recorded per quantity "
    "(CdivL expected still even one-sided: pixel-wise exposure "
    "invariance); fail -> report-only; Lratio joins only if it passes.")

MIRROR_RED_FIRST = ("RED 2026-10-17: 3 tests 3 failed (vitest "
                    "the-lateral-skin-gates-cancel-the-photo-key.test.ts): "
                    "--apply-lateral/--lr-quantities unrecognised + ENOENT "
                    "skin-gates-mirror-report.json.")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(path):
    return np.array(Image.open(path).convert("RGB"))


def load_mask(run_dir, name):
    return (np.array(Image.open(
        os.path.join(run_dir, name)).convert("L")).astype(float) / 255.0)


def texture_regions(run_dir):
    """Five texture-space bool regions (see module docstring for why)."""
    masks = {}
    for role, fname in (("facecore", "mask-facecore.png"),
                        ("scalp", "mask-scalp.png"),
                        ("brows-L", "mask-brows-L.png"),
                        ("brows-R", "mask-brows-R.png"),
                        ("ears-L", "mask-ears-L.png"),
                        ("ears-R", "mask-ears-R.png"),
                        ("neck", "mask-neck.png"),
                        ("lips", "mask-lips.png"),
                        ("eyes-L", "mask-eyes-L.png"),
                        ("eyes-R", "mask-eyes-R.png")):
        masks[role] = load_mask(run_dir, fname)
    regs = FRC.regions_from_masks(masks)
    fc = regs["facecore"]
    lips = regs["lips"]
    fx0, fy0, fx1, fy1 = [int(v) for v in regs["face_bbox"]]
    fhh = max(1, fy1 - fy0)
    fww = max(1, fx1 - fx0)
    h, w = fc.shape
    yy = np.arange(h)[:, None]
    xx = np.arange(w)[None, :]
    umid = fx0 + fww / 2.0
    mid = fc & (yy >= fy0 + int(0.25 * fhh)) & (yy < fy0 + int(0.70 * fhh))
    out = {
        "forehead": regs["forehead"],
        "cheek_u_lo": mid & (xx < umid) & (xx >= fx0 + int(0.05 * fww)),
        "cheek_u_hi": mid & (xx >= umid) & (xx <= fx1 - int(0.05 * fww)),
        "chin": fc & (yy >= fy0 + int(0.70 * fhh)) & (~lips),
        "upperlip_skin": fc & (~lips),
    }
    # upperlip_skin: facecore band above the lips mask, <= 8pc of fhh tall.
    lys, _ = np.where(lips)
    if len(lys):
        ltop = int(lys.min())
        band = int(0.08 * fhh)
        out["upperlip_skin"] = (fc & (~lips) & (yy < ltop)
                                & (yy >= ltop - band))
    return out


def lab_of(rgb):
    return rgb2lab(rgb.astype(float) / 255.0)


def ylin_of(rgb):
    return REX.luminance_Y(REX.srgb_to_linear(rgb))


def photo_regions(png_path, landmarker):
    """Render/photo polygon regions (RRM.regions_of) + polygon masks."""
    roe = RRM.regions_of(png_path, landmarker)
    pil = Image.open(png_path).convert("RGB")
    rgb = np.array(pil)
    lab = lab_of(rgb)
    gate = RRM.skin_gate(rgb)
    _regions, info, polys = FLR.polygon_regions(lab, gate, pil, landmarker)
    w, h = pil.size
    masks = FG.raster_masks(polys, w, h, erode_px=FLR.ERODE_PX)
    smap = {mp: side for side, mp in info["cheek_mapping"].items()}
    polymasks = {}
    for name in REGIONS:
        key = smap.get(name, name) if "cheek" in name else name
        polymasks[name] = (masks[key] > 0)
    return {"roe": roe, "rgb": rgb, "lab": lab, "gate": gate,
            "polymasks": polymasks, "pil": pil}


def quantities_from_means(means, face):
    """Exposure-candidate quantities from per-region {Lab, Y} means."""
    out = {}
    for r, m in means.items():
        L, a, b = m["Lab"]
        if L is None or m["Y"] is None or face["Y"] is None:
            out[r] = {q: None for q in
                      ("dL_face", "logY_face", "Lratio_face", "hue", "CdivL")}
            continue
        C = float(np.hypot(a, b))
        out[r] = {
            "dL_face": round(L - face["Lab"][0], 4),
            "logY_face": round(float(np.log(m["Y"] / face["Y"])), 5),
            "Lratio_face": round((L + 16.0) / (face["Lab"][0] + 16.0), 5),
            "hue": round(float(np.degrees(np.arctan2(b, a))), 3),
            "CdivL": round(C / (L + 16.0), 5),
        }
    return out


def render_quantities(rgb, polymasks):
    """Region Lab/Y means + quantities for a render/photo RGB array."""
    lab = lab_of(rgb)
    ylin = ylin_of(rgb)
    gate = (RRM.skin_gate(rgb) > 0)
    means, ns = {}, {}
    for r in REGIONS:
        sel = polymasks[r] & gate
        n = int(sel.sum())
        ns[r] = n
        means[r] = {"Lab": [float(v) for v in lab[sel].mean(axis=0)]
                    if n >= FLR.MIN_POLY_N else [None, None, None],
                    "Y": float(ylin[sel].mean()) if n else None}
    fsel = np.zeros(gate.shape, bool)
    for r in REGIONS:
        fsel |= polymasks[r] & gate
    face = {"Lab": [float(v) for v in lab[fsel].mean(axis=0)],
            "Y": float(ylin[fsel].mean())}
    return means, face, quantities_from_means(means, face), ns


def split_half_sds(lab, sel, n_draws, seed):
    """SD over seeded half-splits of the region Lab mean (per channel)."""
    idx = np.flatnonzero(sel)
    rng = np.random.default_rng(seed)
    flat = lab.reshape(-1, 3)
    draws = np.empty((n_draws, 3))
    for d in range(n_draws):
        half = rng.permutation(idx)[:len(idx) // 2]
        draws[d] = flat[half].mean(axis=0)
    return [round(float(v), 5) for v in draws.std(axis=0)]


def quants_on_sel(rgb, sel_dict, face_sel):
    """Lab/Y means + quantities on caller-supplied boolean selections."""
    lab = lab_of(rgb)
    ylin = ylin_of(rgb)
    means = {}
    for r, sel in sel_dict.items():
        n = int(sel.sum())
        means[r] = {"Lab": ([float(v) for v in lab[sel].mean(axis=0)]
                            if n >= FLR.MIN_POLY_N else [None, None, None]),
                    "Y": (float(ylin[sel].mean()) if n else None),
                    "n": n}
    face = {"Lab": [float(v) for v in lab[face_sel].mean(axis=0)],
            "Y": float(ylin[face_sel].mean())}
    return means, face, quantities_from_means(means, face)


def g0_probe(landmarker):
    """G0 invariance + sensitivity probes. Returns (g0 dict, kept list)."""
    g0 = {"rule": G0_EPS and (
        "per candidate quantity: max |q'-q| over regions x renders under "
        "k-scaling in {0.5, 2.0} (linear RGB, clip) <= EPS[q]; SAME-pixel "
        "comparison (polygon AND original gate AND scaled gate AND "
        "unclipped; kept fractions recorded; clipped pixels carry no "
        "colour and cannot test the quantity); sensitivity: "
        "+5 a* cheek copy moves hue/CdivL > SENS_MIN, +5 L* cheek copy moves "
        "logY_face/Lratio_face > SENS_MIN; drop failures; dL_face must NOT "
        "be invariant (counterexample)."),
        "threshold_source": "card tsk_bd3b33a3695f8587 (G0); EPS/SENS_MIN "
                            "in module header (float/quantisation noise).",
        "eps": dict(G0_EPS), "sens_min": dict(G0_SENS_MIN), "ks": list(G0_KS)}
    per_q_change, per_q_sens = {}, {}
    clipping = {}
    kept_frac = {}
    subjects = {"body2": RENDER_BODY2, "aisha": RENDER_AISHA}
    for subj, png in subjects.items():
        pr = photo_regions(png, landmarker)
        gate0 = (pr["gate"] > 0)
        _means, _face, q0, _ns = render_quantities(pr["rgb"], pr["polymasks"])
        clipping[subj] = {}
        kept_frac[subj] = {}
        for k in G0_KS:
            lin = REX.srgb_to_linear(pr["rgb"]) * k
            unclipped = ((lin >= 0.0) & (lin <= 1.0)).all(axis=2)
            clip_frac = round(float((~unclipped).mean()), 6)
            clipping[subj][str(k)] = clip_frac
            scaled = (REX.linear_to_srgb(lin) * 255.0).round().astype(np.uint8)
            gate_s = (RRM.skin_gate(scaled) > 0)
            sel = {r: pr["polymasks"][r] & gate0 & gate_s & unclipped
                   for r in REGIONS}
            fsel = np.zeros(gate0.shape, bool)
            for r in REGIONS:
                fsel |= sel[r]
            kept_frac[subj][str(k)] = {
                r: round(int(sel[r].sum()) / max(1, int(
                    (pr["polymasks"][r] & gate0).sum())), 4) for r in REGIONS}
            m0, f0, qq0 = quants_on_sel(pr["rgb"], sel, fsel)
            m1, f1, qqk = quants_on_sel(scaled, sel, fsel)
            for r in REGIONS:
                for q in list(QUANTS) + [COUNTER]:
                    if qqk[r][q] is None or qq0[r][q] is None:
                        g0.setdefault("skipped_none", []).append(
                            f"{subj}/k={k}/{r}/{q}")
                        continue
                    per_q_change.setdefault(q, []).append(abs(qqk[r][q] - qq0[r][q]))
        # sensitivity: +5 a* cheek copy (chroma), +5 L* cheek copy (light).
        cheek = np.zeros(pr["gate"].shape, bool)
        for cn in ("L_cheek", "R_cheek"):
            cheek |= pr["polymasks"][cn] & (pr["gate"] > 0)
        for pert, ch in (("aplus5", 1), ("Lplus5", 0)):
            labp = pr["lab"].copy()
            labp[cheek, ch] += 5.0
            rgbp = (np.clip(lab2rgb(labp), 0.0, 1.0) * 255.0).round().astype(np.uint8)
            _m, _f, qp, _n = render_quantities(rgbp, pr["polymasks"])
            for r in ("L_cheek", "R_cheek"):
                for q in list(QUANTS) + [COUNTER]:
                    if qp[r][q] is None or q0[r][q] is None:
                        continue
                    per_q_sens.setdefault((q, pert), []).append(abs(qp[r][q] - q0[r][q]))
        # persist probe images for audit (gate store only).
        os.makedirs(GATE_STORE, exist_ok=True)
        for tag, arr in (("k0.5", (REX.linear_to_srgb(
                REX.srgb_to_linear(pr["rgb"]) * 0.5) * 255.0).round().astype(np.uint8)),
                         ("k2.0", (REX.linear_to_srgb(
                REX.srgb_to_linear(pr["rgb"]) * 2.0) * 255.0).round().astype(np.uint8))):
            Image.fromarray(arr).save(os.path.join(
                GATE_STORE, f"g0-{subj}-{tag}.png"))
    g0["max_change"] = {q: round(float(np.max(v)), 5)
                        for q, v in per_q_change.items()}
    g0["sens_move"] = {f"{q}/{p}": round(float(np.max(v)), 5)
                       for (q, p), v in per_q_sens.items()}
    g0["clipping_frac"] = clipping
    g0["kept_frac_unclipped"] = kept_frac
    kept, dropped = [], []
    for q in QUANTS:
        inv_ok = g0["max_change"][q] <= G0_EPS[q]
        sens_key = "aplus5" if q in ("hue", "CdivL") else "Lplus5"
        sens_ok = g0["sens_move"][f"{q}/{sens_key}"] > G0_SENS_MIN[q]
        (kept if (inv_ok and sens_ok) else dropped).append(q)
        g0[q] = {"invariant": bool(inv_ok), "sensitive": bool(sens_ok)}
    dl_moves = g0["max_change"][COUNTER] > G0_EPS[COUNTER]
    g0[COUNTER] = {"counterexample_moves": bool(dl_moves),
                   "note": "plain inter-region L* difference must move with "
                           "exposure; it is never a G2 quantity."}
    g0["kept"] = kept
    g0["dropped"] = dropped
    return g0, kept


def albedo_region_labs():
    """Texture-space Lab means per subject + region (unlit albedo)."""
    out = {}
    for subj in ("body2", "aisha"):
        rgb = load_rgb(ALBEDO[subj])
        lab = lab_of(rgb).astype(np.float32)
        regs = texture_regions(DERIVE[subj])
        means, ns, vecs = {}, {}, {}
        for r in TEX_REGIONS:
            sel = regs[r]
            n = int(sel.sum())
            ns[r] = n
            vecs[r] = lab[sel].reshape(-1, 3) if n else np.zeros((0, 3), np.float32)
            means[r] = [round(float(v), 3) for v in
                        vecs[r].mean(axis=0)] if n else None
        out[subj] = {"means": means, "n": ns, "vecs": vecs, "lab": lab,
                     "regs": regs}
    return out


def finish_row(base, d_good, d_bad, thr, margin, noise, floor):
    """RULE 1: enforceable iff d_good < d_bad AND margin/noise >= 1."""
    separates = bool(d_bad > d_good)
    m_over_n = round(margin / noise, 2) if noise else None
    m_over_phys = round(margin / floor, 2) if floor else None
    enforceable = bool(separates and noise and margin / noise >= 1)
    if enforceable:
        reason = None
    elif not separates:
        reason = ("does not separate known-good from known-bad "
                  "(d_bad <= d_good)")
    else:
        reason = "margin/noise < 1"
    base.update({"d_good": d_good, "d_bad": d_bad,
                 "threshold": thr, "margin": margin, "noise": noise,
                 "margin_over_noise": m_over_n,
                 "margin_over_phys": m_over_phys,
                 "phys_floor": floor,
                 "separates": separates,
                 "row_enforceable": enforceable,
                 "enforced": enforceable,
                 "unenforced_reason": reason})
    return base


def measure_albedo_floors(alb):
    """8-bit quantisation floor per Lab channel on albedo region pixels.

    METHOD (stated): for every texture region of both albedos, take the
    exact uint8 sRGB region pixels, compute float64 Lab, recompute with
    +1 LSB added to R, G and B separately (clipped at 255), and record
    the max abs per-channel Lab move over pixels x steps x regions x
    subjects. The floor per channel is that max, rounded UP to 3 decimals
    (conservative): the smallest Lab difference that cannot be 1-LSB
    rounding. Same idea as the G0 epsilons, measured on the albedo
    pixels themselves instead of borrowed from the render probe.
    """
    worst = {"L": 0.0, "a": 0.0, "b": 0.0}
    detail = {}
    for subj in ("body2", "aisha"):
        rgb = load_rgb(ALBEDO[subj])
        detail[subj] = {}
        for r in TEX_REGIONS:
            sel = alb[subj]["regs"][r]
            px = rgb[sel].reshape(-1, 3).astype(float)
            if len(px) == 0:
                continue
            base = rgb2lab(px.reshape(1, -1, 3) / 255.0).reshape(-1, 3)
            mx = [0.0, 0.0, 0.0]
            for c in range(3):
                step = px.copy()
                step[:, c] = np.minimum(255.0, step[:, c] + 1.0)
                lab1 = rgb2lab(step.reshape(1, -1, 3) / 255.0).reshape(-1, 3)
                mx = np.maximum(mx, np.abs(lab1 - base).max(axis=0)).tolist()
            detail[subj][r] = {"n": len(px),
                               "max_abs_dLab_1LSB": [round(float(v), 4) for v in mx]}
            for ci, ch in enumerate("Lab"):
                worst[ch] = max(worst[ch], mx[ci])
    import math
    floors = {ch: math.ceil(v * 1000.0) / 1000.0 for ch, v in worst.items()}
    return floors, detail


def build_gates(rows, floor_of):
    """RULE 2 + HANDBACK 2 floor rule.

    Per-gate threshold = smallest midpoint across its known-bads.
    Body2 gate verdict = match-direction AND rejection-direction
    sub-verdicts against the gate threshold.
    floor_of maps channel/quantity -> measured phys floor (None allowed:
    gate then stays report-only).
    Enforcement: T ok AND all rows enforceable AND floor measured AND
    margin / max(noise, floor) >= 1.
    """
    groups = {}
    for r in rows:
        cq = r.get("channel", r.get("quantity"))
        groups.setdefault((r["kind"], r["region"], cq), []).append(r)
    gates = []
    for (kind, region, cq), rs in sorted(groups.items()):
        floor = floor_of(cq)
        thrs = [x["threshold"] for x in rs if x["threshold"] is not None]
        T = min(thrs) if len(thrs) == len(rs) else None
        d_good = rs[0]["d_good"]
        d_bads = [x["d_bad"] for x in rs]
        if T is not None and all(isinstance(v, (int, float)) for v in [d_good] + d_bads):
            gmargin = min([T - d_good] + [b - T for b in d_bads])
            noises = [x["noise"] for x in rs if x["noise"]]
            gnoise = max(noises) if noises else None
        else:
            gmargin, gnoise = None, None
        denom = max([g for g in (gnoise, floor) if g is not None],
                    default=None)
        m_over_denom = (round(gmargin / denom, 2)
                        if (gmargin is not None and denom) else None)
        rows_ok = all(x["row_enforceable"] for x in rs)
        floor_ok = m_over_denom is not None and m_over_denom >= 1
        enforced = bool(T is not None and rows_ok and floor_ok)
        if T is None:
            reason = "no gate: region below MIN_POLY_N"
        elif not rows_ok:
            reason = ("whole gate report-only: not all known-bad rows "
                      "enforceable")
        elif floor is None:
            reason = "whole gate report-only: no measured floor"
        elif not floor_ok:
            reason = ("whole gate report-only: margin/max(noise, floor) < 1 "
                      "(below quantisation floor)")
        else:
            reason = None
        match_r = next(x for x in rs if x["gate"].endswith("a"))
        rej_r = next(x for x in rs if x["gate"].endswith("b"))
        if T is None or match_r["d_eval"] is None or rej_r["d_eval"] is None:
            m_pass, r_pass, overall = None, None, None
        else:
            m_pass = bool(match_r["d_eval"] < T)
            r_pass = bool(rej_r["d_eval"] > T)
            overall = bool(m_pass and r_pass)
        gates.append({
            "gate": f"{match_r['gate'][:-1]}",
            "gate_id": f"{match_r['gate'][:-1]}/{region}/{cq}",
            "kind": kind, "region": region,
            "channel_or_quantity": cq,
            "known_good": rs[0]["known_good"],
            "known_bads": [x["known_bad"] for x in rs],
            "d_good": d_good, "d_bads": d_bads,
            "row_thresholds": thrs,
            "row_enforceable": [x["row_enforceable"] for x in rs],
            "threshold": round(T, 5) if T is not None else None,
            "margin": round(gmargin, 5) if gmargin is not None else None,
            "noise": gnoise,
            "margin_over_noise": (round(gmargin / gnoise, 2) if gnoise else None),
            "margin_over_phys": (round(gmargin / floor, 2)
                                 if (gmargin is not None and floor) else None),
            "margin_over_denom": m_over_denom,
            "denom_max_noise_floor": denom,
            "phys_floor": floor,
            "enforced": enforced, "unenforced_reason": reason,
            "body2_match": {"pair": match_r["body2_pair"],
                            "d_eval": match_r["d_eval"], "pass": m_pass},
            "body2_reject": {"pair": rej_r["body2_pair"],
                             "d_eval": rej_r["d_eval"], "pass": r_pass},
            "body2_pass": overall})
    return gates


def g1_thresholds(alb, floors):
    """G1 thresholds from known-good/known-bad ONLY (before evaluation)."""
    rows = []
    for r in TEX_REGIONS:
        ga = alb["aisha"]["means"][r]
        gb = alb["body2"]["means"][r]
        for ci, ch in enumerate("Lab"):
            d_good = abs(ga[ci] - ANCHORS["warm_light"][ci])
            for tag, d_bad in (
                    ("G1a/aisha-vs-warm_medium", abs(ga[ci] - ANCHORS["warm_medium"][ci])),
                    ("G1b/body2-vs-warm_light", abs(gb[ci] - ANCHORS["warm_light"][ci]))):
                thr = (d_good + d_bad) / 2.0
                margin = abs(d_bad - d_good) / 2.0
                vec = alb["aisha"]["vecs"][r] if tag.startswith("G1a") else alb["body2"]["vecs"][r]
                idx = np.arange(len(vec))
                rng = np.random.default_rng(1000 + hash((r, ch)) % 2**31)
                draws = np.empty(G1_SPLITS)
                for d_i in range(G1_SPLITS):
                    half = rng.permutation(idx)[:len(idx) // 2]
                    draws[d_i] = vec[half][:, ci].mean()
                noise = round(float(draws.std()), 5)
                rows.append(finish_row(
                    {"gate": tag.split("/")[0], "kind": "(a)",
                     "region": r, "channel": ch,
                     "known_good": "aisha-albedo-vs-warm_light",
                     "known_bad": tag.split("/")[1]},
                    round(d_good, 3), round(d_bad, 3),
                    round(thr, 3), round(margin, 3), noise, floors[ch]))
    return rows


def g1_evaluate(rows, alb):
    """Body2 vs warm_medium, computed AFTER thresholds (code order)."""
    for row in rows:
        r, ci = row["region"], "Lab".index(row["channel"])
        if row["gate"] == "G1a":
            d_eval = abs(alb["body2"]["means"][r][ci] - ANCHORS["warm_medium"][ci])
            row["body2_pair"] = "body2-albedo-vs-warm_medium"
            row["d_eval"] = round(d_eval, 3)
            row["body2_pass"] = bool(d_eval < row["threshold"])
        else:
            d_eval = abs(alb["body2"]["means"][r][ci] - ANCHORS["warm_light"][ci])
            row["body2_pair"] = "body2-albedo-vs-warm_light (rejection)"
            row["d_eval"] = round(d_eval, 3)
            row["body2_pass"] = bool(d_eval > row["threshold"])
    return rows


def pair_quantities(landmarker):
    """Render/photo quantities for own + cross pairs (cached detections)."""
    imgs = {"render_body2": RENDER_BODY2, "render_aisha": RENDER_AISHA,
            "photo_body2": GOAL_BODY2, "photo_aisha": GOAL_AISHA}
    pr = {k: photo_regions(v, landmarker) for k, v in imgs.items()}
    quants = {}
    per_image = {}
    for k, v in pr.items():
        m, f, q, n = render_quantities(v["rgb"], v["polymasks"])
        quants[k] = q
        per_image[k] = {"Lab": {r: m[r]["Lab"] for r in REGIONS},
                        "n": n, "quantities": q}
    pairs = {"good/aisha-render-vs-aisha-photo": ("render_aisha", "photo_aisha"),
             "badA/aisha-render-vs-body2-photo": ("render_aisha", "photo_body2"),
             "badB/body2-render-vs-aisha-photo": ("render_body2", "photo_aisha"),
             "eval/body2-render-vs-body2-photo": ("render_body2", "photo_body2")}
    deltas = {}
    for tag, (a, b) in pairs.items():
        deltas[tag] = {r: {q: (None if quants[a][r][q] is None or quants[b][r][q] is None
                               else round(abs(quants[a][r][q] - quants[b][r][q]), 5))
                           for q in QUANTS} for r in REGIONS}
    return pr, quants, deltas, per_image


def g2_thresholds(deltas, pr, kept):
    """G2 thresholds from known-good/known-bad ONLY (before evaluation)."""
    rows = []
    for r in REGIONS:
        for q in kept:
            d_good = deltas["good/aisha-render-vs-aisha-photo"][r][q]
            for tag, sub in (("G2a", "badA/aisha-render-vs-body2-photo"),
                             ("G2b", "badB/body2-render-vs-aisha-photo")):
                d_bad = deltas[sub][r][q]
                if d_good is None or d_bad is None:
                    rows.append({"gate": tag, "kind": "(b)",
                                 "region": r, "quantity": q,
                                 "known_good": "aisha-render-vs-aisha-photo",
                                 "known_bad": sub.split("/", 1)[1],
                                 "d_good": d_good, "d_bad": d_bad,
                                 "threshold": None, "margin": None,
                                 "noise": None, "margin_over_noise": None,
                                 "margin_over_phys": None,
                                 "phys_floor": PHYS_FLOOR.get(q),
                                 "separates": None,
                                 "row_enforceable": False,
                                 "enforced": False,
                                 "unenforced_reason": "no gate: region below MIN_POLY_N",
                                 "note": "region below MIN_POLY_N: no gate"})
                    continue
                thr = (d_good + d_bad) / 2.0
                margin = abs(d_bad - d_good) / 2.0
                a_key, b_key = (("render_aisha", "photo_body2")
                                if sub.startswith("badA")
                                else ("render_body2", "photo_aisha"))
                # noise: SD over paired seeded half-splits of the delta
                # (quantity_noise); render run-to-run adds 0 per
                # room-rig-remeasure-report.json G0.
                noise = quantity_noise(pr[a_key], pr[b_key], r, q)
                rows.append(finish_row(
                    {"gate": tag, "kind": "(b)",
                     "region": r, "quantity": q,
                     "known_good": "aisha-render-vs-aisha-photo",
                     "known_bad": sub.split("/", 1)[1]},
                    d_good, d_bad, round(thr, 5), round(margin, 5),
                    noise, PHYS_FLOOR[q]))
    return rows


def quantity_noise(va, vb, region, q, n_draws=G2_SPLITS, seed=777):
    """SD of a quantity delta under paired seeded half-splits.

    Region means are redrawn per draw; face means are fixed (their
    n is ~5x the region n, spread negligible beside the region term).
    """
    draws = np.empty(n_draws)
    for d_i in range(n_draws):
        vals = []
        for v, s in ((va, seed + d_i), (vb, seed + 100000 + d_i)):
            sel = (v["polymasks"][region] & (v["gate"] > 0))
            idx = np.flatnonzero(sel)
            rng = np.random.default_rng(s)
            half = rng.permutation(idx)[:len(idx) // 2]
            flat_lab = v["lab"].reshape(-1, 3)
            flat_y = ylin_of(v["rgb"]).reshape(-1)
            Lab = flat_lab[half].mean(axis=0)
            Y = float(flat_y[half].mean())
            fsel = np.zeros(v["gate"].shape, bool)
            for rr in REGIONS:
                fsel |= v["polymasks"][rr] & (v["gate"] > 0)
            fLab = v["lab"][fsel].mean(axis=0)
            fY = float(ylin_of(v["rgb"])[fsel].mean())
            L, a, b = [float(x) for x in Lab]
            C = float(np.hypot(a, b))
            qq = {"logY_face": float(np.log(Y / fY)),
                  "Lratio_face": (L + 16.0) / (float(fLab[0]) + 16.0),
                  "hue": float(np.degrees(np.arctan2(b, a))),
                  "CdivL": C / (L + 16.0)}[q]
            vals.append(qq)
        draws[d_i] = abs(vals[0] - vals[1])
    return round(float(draws.std()), 5)


def g2_evaluate(rows, deltas):
    """Body2 pairs, computed AFTER thresholds (code order)."""
    for row in rows:
        if row["threshold"] is None:
            row["body2_pair"] = None
            row["d_eval"] = None
            row["body2_pass"] = None
            continue
        if row["gate"] == "G2a":
            d_eval = deltas["eval/body2-render-vs-body2-photo"][row["region"]][row["quantity"]]
            row["body2_pair"] = "body2-render-vs-body2-photo"
            row["d_eval"] = d_eval
            row["body2_pass"] = bool(d_eval < row["threshold"])
        else:
            d_eval = deltas["badB/body2-render-vs-aisha-photo"][row["region"]][row["quantity"]]
            row["body2_pair"] = "body2-render-vs-aisha-photo (rejection)"
            row["d_eval"] = d_eval
            row["body2_pass"] = bool(d_eval > row["threshold"])
    return rows


def lateral_rgb(rgb, x_norm, g, shape):
    """Apply a lateral exposure gradient in linear RGB, re-encode sRGB."""
    lin = REX.srgb_to_linear(rgb)
    mult = np.exp(g * x_norm) if shape == "exp" else (1.0 + g * x_norm)
    return (REX.linear_to_srgb(lin * mult[..., None]) * 255.0).round().astype(np.uint8)


def face_x_norm(gate_shape, fsel):
    """x_norm in [-1, 1] across the union-face bbox (mirror-probe geometry)."""
    ys, xs = np.where(fsel)
    x0, x1 = int(xs.min()), int(xs.max())
    w = max(1, x1 - x0)
    cx = (x0 + x1) / 2.0
    return 2.0 * (np.arange(gate_shape[1])[None, :].repeat(
        gate_shape[0], axis=0) - cx) / w


def mirror_of(qdict):
    """q_mirror = mean(q_L, q_R) per quantity (None-aware)."""
    out = {}
    for q in MIRROR_QUANTS:
        l = qdict["L_cheek"][q]
        r = qdict["R_cheek"][q]
        out[q] = None if l is None or r is None else (l + r) / 2.0
    return out


def mirror_g0_probe(pr):
    """G0M lateral-gradient probe (rule in G0M_RULE, written pre-run).

    Same-pixel recompute: original polygon AND original skin gate selections
    applied to the gradient image. Returns (g0m dict, kept list).
    """
    per_q_mirror, per_q_one, per_q_sens = {}, {}, {}
    clip = {}
    os.makedirs(MIRROR_STORE, exist_ok=True)
    for subj, v in pr.items():
        gate0 = (v["gate"] > 0)
        sel = {r: v["polymasks"][r] & gate0 for r in REGIONS}
        fsel = np.zeros(gate0.shape, bool)
        for r in REGIONS:
            fsel |= sel[r]
        xn = face_x_norm(gate0.shape, fsel)
        _m0, _f0, qq0 = quants_on_sel(v["rgb"], sel, fsel)
        mir0 = mirror_of(qq0)
        for g in G0M_GS:
            for shape in G0M_SHAPES:
                grad = lateral_rgb(v["rgb"], xn, g, shape)
                Image.fromarray(grad).save(os.path.join(
                    MIRROR_STORE, f"gm-{subj}-{shape}-g{g}.png"))
                unclipped = ((REX.srgb_to_linear(v["rgb"]) *
                              (np.exp(g * xn) if shape == "exp"
                               else (1.0 + g * xn))[..., None] <= 1.0)).all(axis=2)
                clip.setdefault(subj, {})[f"{shape}-g{g}"] = round(
                    float((~unclipped).mean()), 6)
                _m1, _f1, qqk = quants_on_sel(grad, sel, fsel)
                mirk = mirror_of(qqk)
                for q in MIRROR_QUANTS:
                    if mirk[q] is not None and mir0[q] is not None:
                        per_q_mirror.setdefault(q, []).append(abs(mirk[q] - mir0[q]))
                    if qqk["L_cheek"][q] is not None and qq0["L_cheek"][q] is not None:
                        per_q_one.setdefault((q, shape), []).append(
                            abs(qqk["L_cheek"][q] - qq0["L_cheek"][q]))
        # sensitivity: symmetric +5 L* on BOTH cheeks of a render copy.
        cheek = np.zeros(gate0.shape, bool)
        for cn in ("L_cheek", "R_cheek"):
            cheek |= v["polymasks"][cn] & gate0
        labp = v["lab"].copy()
        labp[cheek, 0] += 5.0
        rgbp = (np.clip(lab2rgb(labp), 0.0, 1.0) * 255.0).round().astype(np.uint8)
        _m, _f, qp, _n = render_quantities(rgbp, v["polymasks"])
        mirp = mirror_of(qp)
        for q in MIRROR_QUANTS:
            if mirp[q] is not None and mir0[q] is not None:
                per_q_sens.setdefault(q, []).append(abs(mirp[q] - mir0[q]))
    g0m = {"rule": G0M_RULE,
           "threshold_source": "card tsk_b2e8149e77e563f4 (G0M); floors are "
                               "the measured G0 epsilons (PHYS_FLOOR).",
           "floors": dict(G0M_FLOOR), "gs": list(G0M_GS),
           "shapes": list(G0M_SHAPES),
           "clipping_frac": clip, "per_quantity": {}}
    kept = []
    for q in MIRROR_QUANTS:
        mm = round(float(np.max(per_q_mirror[q])), 6)
        om = {s: round(float(np.max(per_q_one[(q, s)])), 6) for s in G0M_SHAPES}
        sm = round(float(np.max(per_q_sens[q])), 6)
        mirror_ok = mm <= G0M_FLOOR[q]
        sens_ok = sm > G0M_FLOOR[q]
        onesided = max(om.values()) > G0M_FLOOR[q]
        if mirror_ok and sens_ok and (onesided or q == "CdivL"):
            kept.append(q)
            note = ("expected: exposure-invariant pixel by pixel, one-sided "
                    "stillness recorded" if not onesided else None)
        else:
            note = ("probe gradient did not stress the one-sided value "
                    "(probe invalid for this quantity)"
                    if not onesided and q != "CdivL"
                    else "mirror moved beyond floor or insensitive: "
                         "report-only (FALSIFIER for this quantity)")
        g0m["per_quantity"][q] = {
            "mirror_max_move": mm, "onesided_max_move": max(om.values()),
            "onesided_exp_max": om["exp"], "onesided_linear_max": om["linear"],
            "onesided_moved": bool(onesided), "sens_move": sm,
            "floor": G0M_FLOOR[q], "kept": bool(q in kept), "note": note}
    g0m["kept"] = kept
    g0m["dropped"] = [q for q in MIRROR_QUANTS if q not in kept]
    return g0m, kept


def mirror_quantity_noise(va, vb, q, n_draws=G2_SPLITS, seed=7777):
    """SD of a mirror-delta under paired seeded half-splits of each cheek.

    Face means fixed (n ~5x region n, spread negligible beside region term),
    same convention as quantity_noise.
    """
    draws = np.empty(n_draws)
    for d_i in range(n_draws):
        vals = []
        for v, s in ((va, seed + d_i), (vb, seed + 100000 + d_i)):
            means = {}
            for ci, cn in enumerate(("L_cheek", "R_cheek")):
                sel = (v["polymasks"][cn] & (v["gate"] > 0))
                idx = np.flatnonzero(sel)
                rng = np.random.default_rng(s + ci)
                half = rng.permutation(idx)[:len(idx) // 2]
                flat_lab = v["lab"].reshape(-1, 3)
                flat_y = ylin_of(v["rgb"]).reshape(-1)
                Lab = flat_lab[half].mean(axis=0)
                Y = float(flat_y[half].mean())
                means[cn] = {"Lab": [float(x) for x in Lab], "Y": Y}
            fsel = np.zeros(v["gate"].shape, bool)
            for rr in REGIONS:
                fsel |= v["polymasks"][rr] & (v["gate"] > 0)
            face = {"Lab": [float(x) for x in v["lab"][fsel].mean(axis=0)],
                    "Y": float(ylin_of(v["rgb"])[fsel].mean())}
            qq = quantities_from_means(means, face)
            vals.append((qq["L_cheek"][q] + qq["R_cheek"][q]) / 2.0)
        draws[d_i] = abs(vals[0] - vals[1])
    return round(float(draws.std()), 5)


def g2m_thresholds(mirror_deltas, pr, kept):
    """Mirror-gate thresholds from known-good/known-bad ONLY (pre-eval)."""
    rows = []
    for q in kept:
        d_good = mirror_deltas["good/aisha-render-vs-aisha-photo"][q]
        for tag, sub in (("G2Ma", "badA/aisha-render-vs-body2-photo"),
                         ("G2Mb", "badB/body2-render-vs-aisha-photo")):
            d_bad = mirror_deltas[sub][q]
            a_key, b_key = (("render_aisha", "photo_body2")
                            if sub.startswith("badA")
                            else ("render_body2", "photo_aisha"))
            noise = mirror_quantity_noise(pr[a_key], pr[b_key], q)
            thr = (d_good + d_bad) / 2.0
            margin = abs(d_bad - d_good) / 2.0
            rows.append(finish_row(
                {"gate": tag, "kind": "(b)",
                 "region": MIRROR_REGION, "quantity": q,
                 "known_good": "aisha-render-vs-aisha-photo",
                 "known_bad": sub.split("/", 1)[1]},
                round(d_good, 5), round(d_bad, 5),
                round(thr, 5), round(margin, 5), noise, PHYS_FLOOR[q]))
    return rows


def g2m_evaluate(rows, mirror_deltas):
    """Body2 mirror pairs, computed AFTER thresholds (code order)."""
    for row in rows:
        if row["gate"] == "G2Ma":
            d_eval = mirror_deltas["eval/body2-render-vs-body2-photo"][row["quantity"]]
            row["body2_pair"] = "body2-render-vs-body2-photo"
            row["d_eval"] = d_eval
            row["body2_pass"] = bool(d_eval < row["threshold"])
        else:
            d_eval = mirror_deltas["badB/body2-render-vs-aisha-photo"][row["quantity"]]
            row["body2_pair"] = "body2-render-vs-aisha-photo (rejection)"
            row["d_eval"] = d_eval
            row["body2_pass"] = bool(d_eval > row["threshold"])
    return rows


def apply_mirror_overrides(gates, g0m):
    """Coordinator overrides (demote-only; HANDBACK 1: probe-derived).

    The "photo lateral key" demotion applies ONLY to quantities the G0M
    probe shows a lateral key moves: {q in MIRROR_QUANTS with
    onesided_moved} -- derived from the probe result, not a hand list.
    CdivL is exposure-invariant per pixel (onesided_moved=false), so a
    lateral key cannot move it: CdivL cheek gates go back under the normal
    enforcement rule untouched. Hue was never a mirror candidate and has
    no lateral probe: its one-sided gates keep their rule reason as-is.
    Forehead G2 gates: enforced under the unchanged rule stay enforced
    (said which); the rest are report-only "photo side dominates". G1
    (texture space, no photo) and upper lip / chin / mirror gates untouched.
    """
    lateral_moved = {q for q in MIRROR_QUANTS
                     if g0m["per_quantity"][q]["onesided_moved"]}
    forehead = []
    for g in gates:
        g["enforced_by_rule"] = g["enforced"]
        if g["kind"] == "(b)" and g["region"] in ("L_cheek", "R_cheek"):
            q = g["channel_or_quantity"]
            if q in lateral_moved:
                prev = g["unenforced_reason"]
                g["enforced"] = False
                g["unenforced_reason"] = (LATERAL_KEY_REASON +
                                          (f" ({prev})" if prev else ""))
        elif g["kind"] == "(b)" and g["region"] == "forehead":
            if g["enforced"]:
                g["coordinator_note"] = ("stays enforced: known-good/known-bad "
                                         "test enforces under the unchanged rule")
                forehead.append({"gate_id": g["gate_id"], "enforced": True,
                                 "note": g["coordinator_note"]})
            else:
                prev = g["unenforced_reason"]
                g["unenforced_reason"] = (FOREHEAD_PHOTO_REASON +
                                          (f"; {prev}" if prev else ""))
                forehead.append({"gate_id": g["gate_id"], "enforced": False,
                                 "note": FOREHEAD_PHOTO_REASON})
    return forehead


def mirror_status_diff(gates):
    """Every gate whose enforced status changed vs the landed split g3."""
    with open(SPLIT_REPORT_IN) as f:
        split = json.load(f)
    prev = {g["gate_id"]: g["enforced"] for g in split["g3"]}
    changed, added = [], []
    for g in gates:
        if g["gate_id"] not in prev:
            added.append(g["gate_id"])
        elif prev[g["gate_id"]] != g["enforced"]:
            changed.append({
                "gate_id": g["gate_id"],
                "was_enforced": prev[g["gate_id"]],
                "now_enforced": g["enforced"],
                "why": (f"enforced -> report-only: {g['unenforced_reason']}"
                        if prev[g["gate_id"]] and not g["enforced"]
                        else f"report-only -> enforced: {g['unenforced_reason']}")})
    return changed, added, split


def aisha_eval(gates):
    """Aisha match (known-good pair) + rejection (badA pair) per gate."""
    out = {}
    for g in gates:
        T = g["threshold"]
        if T is None:
            out[g["gate_id"]] = {"match_pass": None, "reject_pass": None,
                                 "pass": None}
            continue
        m = bool(g["d_good"] < T)
        r = bool(g["d_bads"][0] is not None and g["d_bads"][0] > T)
        out[g["gate_id"]] = {"match_pair": g["known_good"],
                             "reject_pair": g["known_bads"][0],
                             "match_pass": m, "reject_pass": r,
                             "pass": bool(m and r)}
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--srgb-scale", nargs=3, default=None,
                    metavar=("PNG", "K", "OUT"))
    ap.add_argument("--band-quantities", default=None, metavar="PNG")
    ap.add_argument("--render-quantities", default=None, metavar="PNG")
    ap.add_argument("--apply-lateral", nargs=4, default=None,
                    metavar=("PNG", "G", "SHAPE", "OUT"))
    ap.add_argument("--lr-quantities", default=None, metavar="PNG")
    ap.add_argument("--mirror", action="store_true",
                    help="full pipeline + mirror-averaged lateral gates -> "
                         "skin-gates-mirror-report.json (split report untouched)")
    args = ap.parse_args()
    if args.srgb_scale:
        png, k, out = args.srgb_scale
        rgb = load_rgb(png)
        scaled = (REX.linear_to_srgb(REX.srgb_to_linear(rgb) * float(k))
                  * 255.0).round().astype(np.uint8)
        Image.fromarray(scaled).save(out)
        print(json.dumps({"out": out, "sha256": sha256_file(out)}))
        return
    if args.band_quantities:
        rgb = load_rgb(args.band_quantities)
        h = rgb.shape[0]
        top = {"Lab": [float(v) for v in lab_of(rgb[:h // 2]).reshape(-1, 3).mean(axis=0)],
               "Y": float(ylin_of(rgb[:h // 2]).mean())}
        bot = {"Lab": [float(v) for v in lab_of(rgb[h // 2:]).reshape(-1, 3).mean(axis=0)],
               "Y": float(ylin_of(rgb[h // 2:]).mean())}
        face = {"Lab": [(a + b) / 2 for a, b in zip(top["Lab"], bot["Lab"])],
                "Y": (top["Y"] + bot["Y"]) / 2}
        print(json.dumps(quantities_from_means({"top": top, "bottom": bot}, face)))
        return
    if args.apply_lateral:
        png, g, shape, out = args.apply_lateral
        assert shape in G0M_SHAPES, f"shape must be one of {G0M_SHAPES}"
        rgb = load_rgb(png)
        w = rgb.shape[1]
        xn = 2.0 * (np.arange(w)[None, :].repeat(rgb.shape[0], axis=0)
                    - (w - 1) / 2.0) / max(1, w - 1)
        Image.fromarray(lateral_rgb(rgb, xn, float(g), shape)).save(out)
        print(json.dumps({"out": out, "sha256": sha256_file(out)}))
        return
    if args.lr_quantities:
        rgb = load_rgb(args.lr_quantities)
        w = rgb.shape[1]
        halves = {"left": rgb[:, :w // 2], "right": rgb[:, w // 2:]}
        parts = {}
        for side, arr in halves.items():
            parts[side] = {
                "Lab": [float(v) for v in
                        lab_of(arr).reshape(-1, 3).mean(axis=0)],
                "Y": float(ylin_of(arr).mean())}
        face = {"Lab": [float(v) for v in
                        lab_of(rgb).reshape(-1, 3).mean(axis=0)],
                "Y": float(ylin_of(rgb).mean())}
        print(json.dumps(quantities_from_means(parts, face)))
        return
    if args.render_quantities:
        landmarker = FLR.create_landmarker()
        v = photo_regions(args.render_quantities, landmarker)
        m, f, q, n = render_quantities(v["rgb"], v["polymasks"])
        print(json.dumps({"Lab": {r: m[r]["Lab"] for r in REGIONS},
                          "n": n, "quantities": q,
                          "cheek_mapping": v["roe"]["info"]["cheek_mapping"]}))
        return

    landmarker = FLR.create_landmarker()
    g0, kept = g0_probe(landmarker)
    alb = albedo_region_labs()
    g1_floors, g1_floor_detail = measure_albedo_floors(alb)
    g1_rows = g1_evaluate(g1_thresholds(alb, g1_floors), alb)
    pr, quants, deltas, per_image = pair_quantities(landmarker)
    g2_rows = g2_evaluate(g2_thresholds(deltas, pr, kept), deltas)

    g3 = (build_gates([r for r in g1_rows],
                      lambda cq: g1_floors.get(cq)) +
          build_gates([r for r in g2_rows],
                      lambda cq: PHYS_FLOOR.get(cq)))
    enf = [g for g in g3 if g["enforced"]]
    enf_rows = [r for r in g1_rows + g2_rows if r["row_enforceable"]]
    falsifier = ("no gate separates known-good from known-bad: module "
                 "report-only"
                 if not enf else
                 f"{len(enf)}/{len(g3)} gates enforced "
                 f"({len(enf_rows)}/{len(g1_rows + g2_rows)} rows); "
                 f"body2 enforced-gate passes: "
                 f"{sum(1 for g in enf if g['body2_pass'])}/{len(enf)}")

    report = {
        "card": "tsk_bd3b33a3695f8587",
        "caveat_anchors": ANCHOR_SOURCE,
        "region_choices": (
            "render/photo: FaceLandmarker polygons x eroded-skin gate "
            "(face_landmark_regions.py:76-126 polygon_regions; forehead, "
            "L/R cheek via cheek_mapping, chin, upperlip_skin), same as "
            "room_rig_remeasure.py:66-88 regions_of. texture: derive "
            "landmarks-uv.json carries 18 points, not the 478 FaceMesh "
            "indices face_gate.py:265 region_polygons needs, so no UV "
            "projection of the same polygons; face_replay_compose.py:410 "
            "regions_from_masks on derive masks (forehead = facecore "
            "top-25pc rows) + geometric subdivisions of its facecore "
            "(cheek_u_lo/hi mid-row outer U bands; chin bottom rows excl. "
            "lips; upperlip_skin band above lips excl. lips). UV laterality "
            "unmapped; both albedos share the convention."),
        "threshold_rules": {
            "G0": g0["rule"],
            "G1_G2": ("per row: threshold = midpoint(known-good delta, "
                      "known-bad delta); margin = |bad-good|/2. RULE 1: row "
                      "enforceable iff d_good < d_bad AND margin/noise >= 1; "
                      "else report-only (inverted/tied rows: does not "
                      "separate known-good from known-bad). RULE 2: gate "
                      "(region x channel/quantity) enforced iff ALL its "
                      "known-bad rows enforceable; gate threshold = smallest "
                      "midpoint; gate margin = distance from it to the "
                      "nearest delta; gate noise = max row noise. HANDBACK "
                      "2: gate enforced only if margin/max(noise, floor) "
                      ">= 1 (floor = measured G0 epsilon for G2 quantities, "
                      "measured albedo 1-LSB floor for G1 channels); no "
                      "enforced gate may have a null floor. RULE 3: "
                      "noise is pixel-sampling SD ONLY (margins/noise "
                      "~50-350 expected); margin_over_phys divides by the "
                      "measured G0 epsilon (hue 1.5 deg etc.; G1 channels "
                      "use the measured albedo floors, never null on an "
                      "enforced gate). Render "
                      "run-to-run adds 0 per room-rig-remeasure G0. "
                      "Thresholds use known-good/known-bad ONLY; body2 "
                      "evaluation numbers are computed after."),
        },
        "g0": g0,
        "g1_thresholds": [{k: v for k, v in r.items() if k != "body2_pass"
                           and k != "d_eval" and k != "body2_pair"}
                          for r in g1_rows],
        "g1_body2_evaluation": [{k: r[k] for k in ("gate", "region", "channel",
                                                  "body2_pair", "d_eval",
                                                  "threshold",
                                                  "row_enforceable")} for r in g1_rows],
        "g2_thresholds": [{k: v for k, v in r.items() if k != "body2_pass"
                           and k != "d_eval" and k != "body2_pair"}
                          for r in g2_rows],
        "g2_body2_evaluation": [{k: r[k] for k in ("gate", "region", "quantity",
                                                  "body2_pair", "d_eval",
                                                  "threshold",
                                                  "row_enforceable")} for r in g2_rows],
        "g1_albedo_means": {s: {"means": alb[s]["means"], "n": alb[s]["n"]}
                            for s in alb},
        "g1_quant_floors": {"floors": g1_floors, "detail": g1_floor_detail,
                            "method": ("max abs per-channel Lab move under "
                                       "+1 LSB per channel, over region "
                                       "pixels x texture regions x both "
                                       "albedos, rounded up to 3 decimals")},
        "g2_pair_deltas": deltas,
        "g2_per_image": per_image,
        "g3": g3,
        "falsifier": falsifier,
        "anchors": {"values": ANCHORS, "anchor_of": ANCHOR_OF,
                    "source": ANCHOR_SOURCE},
        "inputs": {},
        "red_first": RED_FIRST,
        "landmarker": {"model_path": FLR.model_path(),
                       "model_sha256": FLR.model_sha(FLR.model_path())},
    }
    for key, p in (("render_body2", RENDER_BODY2), ("render_aisha", RENDER_AISHA),
                   ("goal_body2", GOAL_BODY2), ("goal_aisha", GOAL_AISHA),
                   ("albedo_body2", ALBEDO["body2"]), ("albedo_aisha", ALBEDO["aisha"])):
        report["inputs"][key] = {"path": p, "sha256": sha256_file(p)}
    for subj in ("body2", "aisha"):
        for m in ("mask-facecore.png", "mask-lips.png"):
            k = f"derive_{subj}_{m.replace('.png', '')}"
            report["inputs"][k] = {
                "path": os.path.join(DERIVE[subj], m),
                "sha256": sha256_file(os.path.join(DERIVE[subj], m))}
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(f"wrote {REPORT_OUT}")
    print("G0 kept:", kept, "dropped:", g0["dropped"])
    print("G0 max_change:", json.dumps(g0["max_change"]))
    print("G0 sens:", json.dumps(g0["sens_move"]))
    print("falsifier:", falsifier)
    if args.mirror:
        write_mirror_report(g0, kept, alb, g1_floors, g1_floor_detail,
                            g1_rows, pr, quants, deltas, per_image, g2_rows)


def write_mirror_report(g0, kept, alb, g1_floors, g1_floor_detail,
                        g1_rows, pr, quants, deltas, per_image, g2_rows):
    """Mirror extension: G0M probe, mirror gates, overrides, new report.

    Thresholds use known-good/known-bad ONLY; body2/Aisha evaluation after.
    The landed split report is read (status diff) but never rewritten.
    """
    g0m, mkept = mirror_g0_probe(
        {"body2": pr["render_body2"], "aisha": pr["render_aisha"]})
    # per-image mirror quantities for every render/photo pair image.
    g2m_per_image = {}
    for key in ("render_body2", "render_aisha", "photo_body2", "photo_aisha"):
        g2m_per_image[key] = {"mirror": mirror_of(quants[key])}
    mirror_deltas = {}
    for tag in ("good/aisha-render-vs-aisha-photo",
                "badA/aisha-render-vs-body2-photo",
                "badB/body2-render-vs-aisha-photo",
                "eval/body2-render-vs-body2-photo"):
        a, b = {"good/aisha-render-vs-aisha-photo": ("render_aisha", "photo_aisha"),
                "badA/aisha-render-vs-body2-photo": ("render_aisha", "photo_body2"),
                "badB/body2-render-vs-aisha-photo": ("render_body2", "photo_aisha"),
                "eval/body2-render-vs-body2-photo": ("render_body2", "photo_body2")}[tag]
        mirror_deltas[tag] = {
            q: (None if g2m_per_image[a]["mirror"][q] is None
                or g2m_per_image[b]["mirror"][q] is None
                else round(abs(g2m_per_image[a]["mirror"][q] -
                               g2m_per_image[b]["mirror"][q]), 5))
            for q in mkept}
    g2m_rows = g2m_evaluate(
        g2m_thresholds(mirror_deltas, pr, mkept), mirror_deltas)
    gates = (build_gates([r for r in g1_rows],
                         lambda cq: g1_floors.get(cq)) +
             build_gates([r for r in g2_rows],
                         lambda cq: PHYS_FLOOR.get(cq)) +
             build_gates([r for r in g2m_rows],
                         lambda cq: PHYS_FLOOR.get(cq)))
    forehead_verdict = apply_mirror_overrides(gates, g0m)
    changed, added, split = mirror_status_diff(gates)
    aisha = aisha_eval(gates)
    enf = [g for g in gates if g["enforced"]]
    enf_b2 = sum(1 for g in enf if g["body2_pass"])
    enf_aisha = sum(1 for g in enf if aisha[g["gate_id"]]["pass"])
    falsifier = (f"{len(enf)}/{len(gates)} gates enforced "
                 f"({len(mkept)} mirror quantities kept: {mkept}; "
                 f"dropped: {g0m['dropped']}); "
                 f"body2 enforced-gate passes: {enf_b2}/{len(enf)}; "
                 f"aisha enforced-gate passes: {enf_aisha}/{len(enf)}")
    report = {
        "card": MIRROR_CARD,
        "caveat_anchors": ANCHOR_SOURCE,
        "enforcement_rule": ("unchanged: known-good closer than every "
                             "known-bad, and margin / max(sampling noise, "
                             "8-bit floor) >= 1. Coordinator overrides are "
                             "demote-only: the photo-lateral-key demotion "
                             "applies only to quantities the G0M probe shows "
                             "a lateral key moves (onesided_moved; derived "
                             "from the probe, not a hand list -- CdivL is "
                             "exposure-invariant per pixel and stays under "
                             "the normal rule). Thresholds from "
                             "known-good/known-bad only, never from body2."),
        "g0m": g0m,
        "g2m_rows": g2m_rows,
        "g2m_pair_deltas": mirror_deltas,
        "g2m_per_image": g2m_per_image,
        "gates": gates,
        "aisha_eval": aisha,
        "body2_summary": {
            "enforced_pass": enf_b2, "enforced_total": len(enf)},
        "aisha_summary": {
            "enforced_pass": enf_aisha, "enforced_total": len(enf)},
        "status_changes": changed,
        "added_gates": added,
        "forehead_verdict": forehead_verdict,
        "split_report_sha256": sha256_file(SPLIT_REPORT_IN),
        "falsifier": falsifier,
        "red_first": MIRROR_RED_FIRST,
        "landmarker": {"model_path": FLR.model_path(),
                       "model_sha256": FLR.model_sha(FLR.model_path())},
    }
    with open(MIRROR_REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(f"wrote {MIRROR_REPORT_OUT}")
    print("G0M kept:", mkept, "dropped:", g0m["dropped"])
    print("G0M per_quantity:", json.dumps(g0m["per_quantity"]))
    print("status_changes:", json.dumps(changed))
    print("added:", json.dumps(added))
    print("falsifier:", falsifier)


if __name__ == "__main__":
    main()
