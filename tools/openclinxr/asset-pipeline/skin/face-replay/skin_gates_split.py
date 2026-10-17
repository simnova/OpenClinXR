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
# and known-bad deltas; margin = |bad - good| / 2; noise = SD over 20
# seeded random half-splits of the region pixels of the delta recomputed
# per draw (anchor fixed for G1; render+photo draws paired for G2; render
# run-to-run adds 0 per room-rig-remeasure-report.json G0); enforced iff
# margin / noise >= 1, else report-only. Body2 verdicts are computed only
# after all thresholds (code order: thresholds dict first, evaluation
# second; report sections g1_thresholds/g2_thresholds precede evaluation).
G1_SPLITS = 20
G2_SPLITS = 20

RED_FIRST = ("RED 2026-10-17: 5 tests 5 failed (vitest "
             "the-skin-gates-are-split-by-what-light-can-change.test.ts): "
             "unit hue 0.846 > 0.5 under k=0.5 (8-bit round-trip noise; hue "
             "EPS revised 0.5 -> 1.5 with the header note); 4 report its "
             "ENOENT skin-gates-split-report.json.")


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


def g1_thresholds(alb):
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
                enforced = bool(noise > 0 and margin / noise >= 1)
                rows.append({"gate": tag.split("/")[0], "kind": "(a)",
                             "region": r, "channel": ch,
                             "known_good": "aisha-albedo-vs-warm_light",
                             "known_bad": tag.split("/")[1],
                             "d_good": round(d_good, 3), "d_bad": round(d_bad, 3),
                             "threshold": round(thr, 3),
                             "margin": round(margin, 3), "noise": noise,
                             "margin_over_noise": round(margin / noise, 2) if noise else None,
                             "enforced": enforced})
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
                                 "enforced": False,
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
                enforced = bool(noise > 0 and margin / noise >= 1)
                rows.append({"gate": tag, "kind": "(b)",
                             "region": r, "quantity": q,
                             "known_good": "aisha-render-vs-aisha-photo",
                             "known_bad": sub.split("/", 1)[1],
                             "d_good": d_good, "d_bad": d_bad,
                             "threshold": round(thr, 5),
                             "margin": round(margin, 5), "noise": noise,
                             "margin_over_noise": (round(margin / noise, 2)
                                                   if noise else None),
                             "enforced": enforced})
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


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--srgb-scale", nargs=3, default=None,
                    metavar=("PNG", "K", "OUT"))
    ap.add_argument("--band-quantities", default=None, metavar="PNG")
    ap.add_argument("--render-quantities", default=None, metavar="PNG")
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
    g1_rows = g1_evaluate(g1_thresholds(alb), alb)
    pr, quants, deltas, per_image = pair_quantities(landmarker)
    g2_rows = g2_evaluate(g2_thresholds(deltas, pr, kept), deltas)

    g3 = []
    for row in g1_rows + g2_rows:
        g3.append({"gate": row["gate"], "kind": row["kind"],
                   "region": row["region"],
                   "channel_or_quantity": row.get("channel", row.get("quantity")),
                   "known_good": row["known_good"], "known_bad": row["known_bad"],
                   "threshold": row["threshold"],
                   "margin_over_noise": row["margin_over_noise"],
                   "enforced": row["enforced"],
                   "body2_pair": row["body2_pair"], "d_eval": row["d_eval"],
                   "body2_pass": row["body2_pass"]})
    enf = [g for g in g3 if g["enforced"]]
    falsifier = ("no gate separates known-good from known-bad with "
                 "margin/noise >= 1: module report-only"
                 if not enf else
                 f"{len(enf)}/{len(g3)} rows enforced; "
                 f"body2 enforced passes: "
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
                      "known-bad delta); margin = |bad-good|/2; noise = SD "
                      "over 20 seeded half-splits (G1: albedo region mean "
                      "per channel; G2: paired quantity-delta draws; render "
                      "run-to-run adds 0 per room-rig-remeasure G0); "
                      "enforced iff margin/noise >= 1 else report-only. "
                      "Thresholds use known-good/known-bad ONLY; body2 "
                      "evaluation numbers are computed after."),
        },
        "g0": g0,
        "g1_thresholds": [{k: v for k, v in r.items() if k != "body2_pass"
                           and k != "d_eval" and k != "body2_pair"}
                          for r in g1_rows],
        "g1_body2_evaluation": [{k: r[k] for k in ("gate", "region", "channel",
                                                  "body2_pair", "d_eval",
                                                  "threshold", "body2_pass",
                                                  "enforced")} for r in g1_rows],
        "g2_thresholds": [{k: v for k, v in r.items() if k != "body2_pass"
                           and k != "d_eval" and k != "body2_pair"}
                          for r in g2_rows],
        "g2_body2_evaluation": [{k: r[k] for k in ("gate", "region", "quantity",
                                                  "body2_pair", "d_eval",
                                                  "threshold", "body2_pass",
                                                  "enforced")} for r in g2_rows],
        "g1_albedo_means": {s: {"means": alb[s]["means"], "n": alb[s]["n"]}
                            for s in alb},
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


if __name__ == "__main__":
    main()
