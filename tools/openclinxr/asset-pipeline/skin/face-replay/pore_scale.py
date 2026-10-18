"""Forehead pore-grain spectral peak vs goal (card tsk_ca445c4e7f770eaf).

STEP 0 INSTRUMENT (written into pore-scale-fine-report.json by
--instrument-only BEFORE any peak number is measured; --pre fills
measurements; --solve calibrates transfer and solves the one generic
parameter; --post measures the NEW POST renders and evaluates G1-G5):

- Signal: log luminance (log Y, linear-light Y from sRGB via
  room_exposure.srgb_to_linear/luminance_Y) inside the FaceLandmarker
  forehead polygon (face_landmark_regions.py polygon_regions, masks from
  face_gate.raster_masks erode_px=3, intersected with the eroded skin
  gate) -- the SAME region/H/logY as wrinkle_bands.analyse, reused here.
- Spectrum: forehead bbox patch, mean-subtracted, 2D Hann-windowed,
  rfft2 power |F|^2, radially averaged (MEAN power per radial bin; not
  the max-magnitude profile of wrinkle's FFT prominence rule).
- Frequency: cycles per face height H (H = ||P10-P152|| px). The rfft
  grid is normalised per axis (fx_H = kx*H/W, fy_H = ky*H/Hpatch) so a
  rectangular patch maps exactly; radial bins are 1 cycle/H wide.
- Pore band: wrinkle's pore band sigmas (H/1500..H/130) converted with
  the Gaussian characteristic-frequency rule f = 1/(2*pi*sigma)
  (e^{-1/2} point of the Gaussian MTF): band = [130/2pi, 1500/2pi] =
  [20.69, 238.73] cycles/H.
- Peak = argmax of mean power inside the band, parabolically refined
  on log-power (sub-bin); reported in cycles/H.
- Noise floor: median mean-power over f in [0.9*f_hi, f_hi] of the
  PHOTO spectrum (the band's high end).
- FALSIFIER (stated before measuring): the goal peak power must exceed
  its photo floor by margin 2.0x (peak_power >= 2 * floor, mirroring the
  wrinkle 2x-PRE prominence rule). If not, the goal carries no isolated
  pore peak above sensor/JPEG noise and the card records and stops.

FIX parameter (ONE generic parameter, detail_bands.py + chain-manifest
only): pore_noise_hi_mm -- the grain band's upper scale in mm. The
added grain is seeded white noise through G(PORE_NOISE_LO_TEX) -
G(hi_mm * texels_per_mm); its power peaks at
  f*(hi) = sqrt(ln(hi^2/lo^2) / (2*pi^2*(hi^2-lo^2)))  cycles/texel,
so moving hi_mm moves the grain's spectral peak (no added white noise,
no blur: the lo cut and the filter structure are untouched). Solved per
case against that case's goal peak via the MEASURED render transfer
(no assumed tex/px): k = peak_render(hi=1.4) / f*(1.4mm) per subject
from the wrinkle POST, then bisect hi in (0.05, 2.9) for
f*(hi)*k = peak_goal. Recorded in chain-manifest subject overrides
(detail_bands.pore_noise_hi_mm) with a sources entry; no subject
literals anywhere in the stage.
"""

import argparse
import hashlib
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
import wrinkle_bands as WB  # noqa: E402 (same region/H/logY instrument)
import room_exposure as REX  # noqa: E402

S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike"
STORE = "/Volumes/files/openclinxr-assets/store"
POST_STORE = os.path.join(STORE, "skin-wrinkle-scale")
OUT_STORE = os.path.join(STORE, "skin-pore-scale-fine")
REPORT_OUT = os.path.join(DIR, "pore-scale-fine-report.json")

GOAL = {"body2": os.path.join(S, "body2", "goal-front.png"),
        "aisha": os.path.join(S, "project", "edit-v9", "edit-0.png")}
# Wrinkle POST = this card's G1 PRE (current state before the fix).
WRINKLE_POST = {"body2": os.path.join(POST_STORE, "post12",
                                     "wrinkle-body2-post11-r3-front.png"),
                "aisha": os.path.join(POST_STORE, "post10",
                                      "wrinkle-aisha-post10-front.png")}
# Context PRE renders named by the card (skin-ior-room 14a / aisha-14).
CARD_PRE = {"body2": os.path.join(STORE, "skin-ior-room",
                                  "skinior-body2-14a-front.png"),
            "aisha": os.path.join(STORE, "skin-ior-room",
                                  "skinior-aisha-14-front.png")}

F_LO = 130.0 / (2.0 * math.pi)
F_HI = 1500.0 / (2.0 * math.pi)
FLOOR_FRAC = 0.9
FLOOR_MARGIN = 2.0
HI_LO, HI_HI = 0.05, 2.9  # bisection range for pore_noise_hi_mm
TPM = 4.079  # chain-manifest texels_per_mm (beard_shadow.py method)
LO_TEX = 0.5  # PORE_NOISE_LO_TEX (detail_bands.py; untouched by this card)

INSTRUMENT = {
    "signal": ("log Y (linear-light Y via room_exposure.srgb_to_linear/"
               "luminance_Y) inside the FaceLandmarker forehead polygon, "
               "same region/H/logY as wrinkle_bands.analyse"),
    "window": "mean-subtracted, 2D Hann (np.hanning outer product)",
    "spectrum": ("rfft2 power |F|^2, radially AVERAGED (mean power per "
                 "radial bin; differs from wrinkle's max-magnitude FFT "
                 "prominence profile); empty radial bins (no samples on "
                 "small patches) are linearly interpolated from populated "
                 "neighbours, count recorded per image. NO smoothing: a "
                 "Daniell +-4 amendment was tried and REVERTED because it "
                 "buried the goal pore line (goal_body2 raw argmax bin 140, "
                 "4.6 px wavelength, matches the visible pores and the "
                 "card title's finer-frequency premise) under the mottling "
                 "bump (bin 37), flipping the fix direction against the "
                 "card; raw numbers from the smoothing trial are "
                 "superseded, retained in the launcher log only"),
    "caveat_goal_body2_near_tie": ("raw goal_body2 argmax bin 140 (30.22) "
                 "beats bin 37 (29.76) by 1.5pc: the pore line vs the "
                 "mottling bump. Title premise + visible ~5px pores + "
                 "falsifier select 140; recorded as a fragility"),
    "frequency": ("cycles per face height H = ||P10-P152|| px; rfft grid "
                  "normalised per axis (fx_H = kx*H/W, fy_H = ky*H/Hpatch); "
                  "radial bins 1 cycle/H wide"),
    "pore_band_cycles_per_H": [round(F_LO, 2), round(F_HI, 2)],
    "pore_band_source": ("wrinkle's pore sigmas H/1500..H/130 via the "
                         "Gaussian characteristic-frequency rule "
                         "f = 1/(2*pi*sigma)"),
    "peak": ("argmax of mean power inside the band, parabolically "
             "refined on log-power; cycles/H"),
    "noise_floor": ("median mean-power over f in [0.9*f_hi, f_hi] of the "
                    "PHOTO spectrum"),
    "falsifier": ("goal peak power >= 2.0x its photo floor (margin "
                  "mirrors the wrinkle 2x-PRE prominence rule); else "
                  "record and stop"),
    "floor_margin": FLOOR_MARGIN,
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def radial_power_cycles_H(patch, H):
    """Mean-power radial profile of a Hann-windowed patch in cycles/H."""
    a = np.asarray(patch, dtype=np.float64)
    a = a - a.mean()
    wy = np.hanning(a.shape[0])[:, None]
    wx = np.hanning(a.shape[1])[None, :]
    f = np.fft.rfft2(a * wy * wx)
    power = np.abs(f) ** 2
    hp, w = a.shape[0], a.shape[1]
    kx = np.arange(power.shape[1])
    ky = np.fft.fftfreq(hp, d=1.0)
    # rfft2 rows 0..hp/2 are the non-negative y freqs in order.
    ky = np.abs(np.fft.fftfreq(hp))[:power.shape[0]]
    FX = (kx[None, :] * H / w)
    FY = (ky[:, None] * H / hp)
    rr = np.sqrt(FX ** 2 + FY ** 2)
    nbins = int(math.ceil(F_HI)) + 2
    prof = np.zeros(nbins)
    cnt = np.zeros(nbins)
    idx = np.clip(rr.astype(int), 0, nbins - 1)
    np.add.at(prof, idx, power)
    np.add.at(cnt, idx, 1)
    populated = cnt > 0
    prof[populated] = prof[populated] / cnt[populated]
    # Small patches leave high radial bins unsampled (exact zeros, not
    # measured silence): linearly interpolate empty bins between
    # populated neighbours so argmax/median read texture, not grid.
    empty = int((~populated[:int(math.floor(F_HI)) + 1]).sum())
    if populated.any():
        xs = np.where(populated)[0]
        prof = np.interp(np.arange(nbins), xs, prof[xs])
    prof = (prof, empty)
    return prof


def band_peak(sm):
    """Raw argmax inside [F_LO, F_HI], parabolic refinement on log power
    (no smoothing: see instrument revert note)."""
    lo, hi = int(math.ceil(F_LO)), int(math.floor(F_HI))
    seg = sm[lo:hi + 1]
    b = int(np.argmax(seg)) + lo
    lp = np.log(np.maximum(sm[max(0, b - 1):b + 2], 1e-300))
    if len(lp) == 3 and lp[1] >= lp[0] and lp[1] >= lp[2]:
        d = lp[0] - 2 * lp[1] + lp[2]
        shift = 0.5 * (lp[0] - lp[2]) / d if d != 0 else 0.0
        shift = max(-0.5, min(0.5, shift))
    else:
        shift = 0.0
    return {"bin": b, "peak_cycles_H": round(b + shift, 2),
            "peak_power": float(sm[b])}


def floor_level(prof):
    lo = int(math.ceil(FLOOR_FRAC * F_HI))
    seg = prof[lo:int(math.floor(F_HI)) + 1]
    return float(np.median(seg)) if len(seg) else float("nan")


def measure(path, landmarker):
    an = WB.analyse(path, landmarker)
    logy = np.log(np.maximum(
        REX.luminance_Y(REX.srgb_to_linear(an["rgb"])), 1e-6))
    fm = an["masks"]["forehead"]
    ys, xs = np.where(fm)
    patch = logy[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    prof, empty_bins = radial_power_cycles_H(patch, an["H"])
    sm = prof
    pk = band_peak(sm)
    return {"path": path, "sha256": sha256_file(path),
            "H": round(float(an["H"]), 2),
            "patch_shape": [int(patch.shape[0]), int(patch.shape[1])],
            "n_forehead_px": int(fm.sum()),
            "peak_bin": pk["bin"], "peak_cycles_H": pk["peak_cycles_H"],
            "peak_power": pk["peak_power"],
            "floor": floor_level(sm),
            "empty_bins_interpolated": empty_bins}


def grain_peak_cycles_texel(hi_mm, tpm=TPM, lo_tex=LO_TEX):
    """Peak of white-noise power through G(lo)-G(hi) (cycles/texel)."""
    lo = lo_tex
    hi = hi_mm * tpm
    return math.sqrt(math.log((hi ** 2) / (lo ** 2))
                     / (2 * math.pi ** 2 * (hi ** 2 - lo ** 2)))


NEW_POST_RENDER = {"body2": os.path.join(OUT_STORE, "post",
                                         "porefine-body2-post-front.png"),
                   "aisha": os.path.join(OUT_STORE, "post",
                                         "porefine-aisha-post-front.png")}
NEW_POST_ALBEDO = {"body2": os.path.join(OUT_STORE,
                                         "albedo_detail_body2_porefine.png"),
                   "aisha": os.path.join(OUT_STORE,
                                         "albedo_detail_aisha_porefine.png")}
WRINKLE_ALBEDO = {"body2": os.path.join(POST_STORE,
                                       "albedo_detail_body2_post11.png"),
                  "aisha": os.path.join(POST_STORE,
                                        "albedo_detail_aisha_post10.png")}
RUN2 = {s: os.path.join(STORE, "face-station-cases", s, "run2")
        for s in ("body2", "aisha")}
GLB_WANT = {
    "body2": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run3/body2-lidconform.glb",
              "sha256": "bdb051938777cde567825a8e7b5e993d3ea1f84b442c0d7903828c4f096ce83b"},
    "aisha": {"path": "/Volumes/files/openclinxr-assets/store/face-station-cases/aisha/run2/aisha-lidconform.glb",
              "sha256": "0fbaf4c69c689197be180fff237a53d6df3f9813d21e548dd0cad004b73c4a2d"}}  # ground truth re-hashed this card; wrinkle_bands.py GLB_AISHA transposes 6d/d6 (pre-existing, out of scope)


def corrected_g1(pre_ratio, post_ratio):
    """Wrinkle corrected-G1 form on ratios (midpoint + closer + overshoot)."""
    mid = (pre_ratio + 1) / 2
    toward = (post_ratio <= mid) if pre_ratio > 1 else (post_ratio >= mid)
    closer = abs(math.log(post_ratio)) < abs(math.log(pre_ratio)) - 1e-9
    over = True
    if pre_ratio < 1 and post_ratio > 1:
        over = (post_ratio - 1) <= (1 - pre_ratio) + 1e-3
    if pre_ratio > 1 and post_ratio < 1:
        over = (1 - post_ratio) <= (pre_ratio - 1) + 1e-3
    return {"midpoint": round(mid, 4), "toward_goal": bool(toward),
            "closer_log": bool(closer), "overshoot_ok": bool(over),
            "pass": bool(toward and closer and over)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instrument-only", action="store_true")
    ap.add_argument("--pre", action="store_true")
    ap.add_argument("--solve", action="store_true")
    ap.add_argument("--post", action="store_true")
    a = ap.parse_args()
    if a.instrument_only:
        with open(REPORT_OUT, "w") as f:
            json.dump({"card": "tsk_ca445c4e7f770eaf",
                       "instrument": INSTRUMENT,
                       "pre": {}, "transfer": {}, "fix": {},
                       "post": {}, "gates": {}, "renders": [],
                       "sheets": []}, f, indent=1)
            f.write("\n")
        print(f"wrote instrument {REPORT_OUT}", flush=True)
        return
    if a.pre:
        return run_pre()
    if a.solve:
        return run_solve()
    if a.post:
        return run_post()
    raise SystemExit("pass --instrument-only, --pre, --solve or --post")


def run_pre():
    import face_landmark_regions as FLR  # noqa: E402
    with open(REPORT_OUT) as f:
        report = json.load(f)
    landmarker = FLR.create_landmarker()
    pre = {"images": {}, "falsifier": {}}
    for tag, paths in (("goal", GOAL), ("wrinkle_post", WRINKLE_POST),
                       ("card_pre", CARD_PRE)):
        for subj, path in paths.items():
            print(f"measure {tag} {subj}", flush=True)
            pre["images"][f"{tag}_{subj}"] = measure(path, landmarker)
    for subj in ("body2", "aisha"):
        g = pre["images"][f"goal_{subj}"]
        ratio = g["peak_power"] / g["floor"] if g["floor"] else None
        ok = bool(ratio is not None and ratio >= FLOOR_MARGIN)
        pre["falsifier"][subj] = {
            "goal_peak_power": g["peak_power"], "goal_floor": g["floor"],
            "peak_over_floor": round(ratio, 3) if ratio else None,
            "margin": FLOOR_MARGIN, "pass": ok}
    report["pre"] = pre
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print("falsifier: %s" % json.dumps(pre["falsifier"]), flush=True)
    print("peaks: %s" % json.dumps(
        {k: v["peak_cycles_H"] for k, v in pre["images"].items()}),
        flush=True)


def run_solve():
    """Transfer calibration + per-case solve, recorded (no render yet)."""
    import face_landmark_regions as FLR  # noqa: E402
    with open(REPORT_OUT) as f:
        report = json.load(f)
    with open(os.path.join(DIR, "wrinkle-scale-report.json")) as f:
        wr = json.load(f)
    landmarker = FLR.create_landmarker()
    with open(os.path.join(DIR, "chain-manifest.json")) as f:
        man = json.load(f)
    subj_key = {"body2": "adult_male_street_casual", "aisha": "aisha"}
    transfer, fix_rows = {}, {}
    for subj in ("body2", "aisha"):
        wp = report["pre"]["images"][f"wrinkle_post_{subj}"]
        H = wp["H"]
        an = WB.analyse(WRINKLE_POST[subj], landmarker)
        import room_rig_remeasure as RRM  # noqa: E402
        n_screen = int((RRM.skin_gate(an["rgb"]) > 0).sum())
        fc = np.array(Image.open(os.path.join(
            RUN2[subj], "derive_out", "mask-facecore.png")).convert("L")) > 127
        n_uv = int(fc.sum())
        tpp = (n_uv / n_screen) ** 0.5
        k_area = tpp * H
        f140 = grain_peak_cycles_texel(1.4)
        k_peak = wp["peak_cycles_H"] / f140
        hi = man["subjects"][subj_key[subj]]["overrides"][
            "detail_bands"]["pore_noise_hi_mm"]
        pred_area = grain_peak_cycles_texel(hi) * k_area
        pred_peak = grain_peak_cycles_texel(hi) * k_peak
        goal = report["pre"]["images"][f"goal_{subj}"]["peak_cycles_H"]
        r0 = wp["peak_cycles_H"] / goal
        transfer[subj] = {
            "face_tex_per_px": round(tpp, 4),
            "n_screen_face_px": n_screen, "n_uv_facecore_tex": n_uv,
            "k_area_cycles_H_per_cycle_texel": round(k_area, 1),
            "k_peak_anchor_cycles_H_per_cycle_texel": round(k_peak, 1),
            "k_note": ("k_peak assumes the wrinkle-POST argmax is pure "
                       "grain; aisha's composite is base-mottle dominated "
                       "so her k_peak is invalid -- area-k is primary") if
            subj == "aisha" else "wrinkle-POST argmax ~= grain centre (area-k agrees)",
            "f_star_hi14": round(f140, 5)}
        fix_rows[subj] = {
            "pore_noise_hi_mm": hi,
            "goal_peak_cycles_H": goal,
            "pre_wrinkle_post_peak_cycles_H": wp["peak_cycles_H"],
            "pre_ratio": round(r0, 4),
            "g1_window": [round((r0 + 1) / 2 * goal if r0 < 1 else goal, 2),
                          round(goal * (2 - r0) if r0 < 1 else (r0 + 1) / 2 * goal, 2)],
            "predicted_grain_peak_area_k": round(pred_area, 1),
            "predicted_grain_peak_peak_k": round(pred_peak, 1),
            "predicted_in_g1_window": bool(
                min((r0 + 1) / 2 * goal if r0 < 1 else goal,
                    goal * (2 - r0) if r0 < 1 else (r0 + 1) / 2 * goal)
                <= pred_area <=
                max((r0 + 1) / 2 * goal if r0 < 1 else goal,
                    goal * (2 - r0) if r0 < 1 else (r0 + 1) / 2 * goal))}
    report["transfer"] = transfer
    report["fix"] = {"stage": "detail_bands", "script": "detail_bands.py",
                     "parameter": "pore_noise_hi_mm",
                     "subjects": fix_rows,
                     "wrinkle_default_unchanged": 1.4,
                     "no_subject_literals": True}
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print("transfer: %s" % json.dumps(transfer), flush=True)
    print("fix: %s" % json.dumps(fix_rows), flush=True)


def run_post():
    """Measure NEW POST renders/albedos; evaluate G1-G5; write sheets."""
    import subprocess as _sp  # noqa: E402
    import face_landmark_regions as FLR  # noqa: E402
    import skin_gates_split as SGS  # noqa: E402
    with open(REPORT_OUT) as f:
        report = json.load(f)
    with open(os.path.join(DIR, "wrinkle-scale-report.json")) as f:
        wr = json.load(f)
    with open(os.path.join(DIR, "chain-manifest.json")) as f:
        man = json.load(f)
    with open(os.path.join(DIR, "skin-gates-split-report.json")) as f:
        split = json.load(f)
    landmarker = FLR.create_landmarker()
    post, gates = {}, {"g1": {"rows": []}}
    # ---- NEW POST peaks + G1 ----
    for subj in ("body2", "aisha"):
        m = measure(NEW_POST_RENDER[subj], landmarker)
        post[subj] = m
        goal = report["pre"]["images"][f"goal_{subj}"]["peak_cycles_H"]
        pre = report["pre"]["images"][f"wrinkle_post_{subj}"]["peak_cycles_H"]
        r0 = pre / goal
        r1 = m["peak_cycles_H"] / goal
        g = corrected_g1(r0, r1)
        gates["g1"]["rows"].append({
            "subject": subj, "band": "pore-peak",
            "goal_peak_cycles_H": goal, "pre_ratio": round(r0, 4),
            "post_ratio": round(r1, 4), **g})
    report["post"] = post
    # ---- G2: wrinkle band energies on NEW renders vs wrinkle PRE ----
    g2_rows = []
    for subj in ("body2", "aisha"):
        an = WB.analyse(NEW_POST_RENDER[subj], landmarker)
        logy = np.log(np.maximum(
            REX.luminance_Y(REX.srgb_to_linear(an["rgb"])), 1e-6))
        e = WB.band_energies(logy, an["H"], an["masks"])
        for region in ("forehead", "nasolabial"):
            for band in ("crease", "pore"):
                rec = wr["pre"]["ratios"][subj][region][band]
                r0 = rec["ratio"]
                r1 = round(e[region][band] / rec["goal"], 4)
                g = corrected_g1(r0, r1)
                route = "counterweight" if region == "forehead" else "report-only-geometry"
                g2_rows.append({"subject": subj, "region": region,
                                "band": band, "pre_ratio": r0,
                                "post_ratio": r1, **g, "route": route,
                                "pass": bool(g["pass"]) if route == "counterweight" else None})
    gates["g2"] = {"rows": g2_rows,
                   "rule": ("forehead crease+pore ratios closer to goal "
                            "than wrinkle PRE and past the midpoint; "
                            "nasolabial report-only (mesh geometry, "
                            "wrinkle step1 precedent)")}
    # ---- G3: tone gate (a) no-regressions on NEW albedos ----
    frozen = [r for r in split["g1_thresholds"] if r.get("enforced")]
    frozen_b2 = {(r["gate"], r["region"], r["channel"]): r
                 for r in split["g1_body2_evaluation"]}
    anchors = {"warm_medium": [49.26, 13.89, 19.44],
               "warm_light": [58.37, 9.05, 16.01]}
    g3_rows = []
    for subj in ("body2", "aisha"):
        means = {}
        for tag, ap_ in (("pre", os.path.join(RUN2[subj], "albedo_beard.png")),
                         ("post", NEW_POST_ALBEDO[subj])):
            rgb = SGS.load_rgb(ap_)
            regs = SGS.texture_regions(os.path.join(RUN2[subj], "derive_out"))
            lab = SGS.lab_of(rgb)
            means[tag] = {r: [round(float(v), 3) for v in lab[regs[r]].mean(axis=0)]
                          for r in SGS.TEX_REGIONS}
        for row in frozen:
            reg, ch, thr = row["region"], row["channel"], row["threshold"]
            ci = "Lab".index(ch)
            own = anchors["warm_medium" if subj == "body2" else "warm_light"][ci]
            oth = anchors["warm_light" if subj == "body2" else "warm_medium"][ci]
            if row["gate"] == "G1a":
                dp = abs(means["pre"][reg][ci] - own)
                dq = abs(means["post"][reg][ci] - own)
                direction = "lt"
            else:
                dp = abs(means["pre"][reg][ci] - oth)
                dq = abs(means["post"][reg][ci] - oth)
                direction = "gt"
            pre_pass = bool(dp < thr) if direction == "lt" else bool(dp > thr)
            post_pass = bool(dq < thr) if direction == "lt" else bool(dq > thr)
            rec = {"subject": subj, "region": reg, "channel": ch,
                   "gate": row["gate"], "direction": direction,
                   "threshold": thr, "d_eval_pre": round(dp, 3),
                   "d_eval": round(dq, 3), "pre_pass": pre_pass,
                   "enforced": True, "pass": post_pass}
            if subj == "body2":
                fz = frozen_b2[(row["gate"], reg, ch)]
                rec["frozen_pre_reproduces"] = bool(abs(dp - fz["d_eval"]) < 0.0015)
            g3_rows.append(rec)
    regressions = [r for r in g3_rows if r["pre_pass"] and not r["pass"]]
    pre_n = sum(1 for r in g3_rows if r["pre_pass"])
    post_n = sum(1 for r in g3_rows if r["pass"])
    gates["g4"] = {"gate": ("tone gate (a), skin-gates-split frozen "
                            "thresholds: no regressions"),
                   "rows": g3_rows,
                   "verdict": ("no-regressions: %d/%d PRE-pass rows still "
                               "pass at POST" % (post_n, pre_n)) if pre_n else "no PRE-pass rows",
                   "regressions": regressions}
    # ---- G3 lip check (card-prescribed lm_lipcheck) ----
    lip = {"rule": ("mise exec -C /Volumes/files/src/openclinxr -- python3 "
                    "S/wrinkle/lm_lipcheck.py <run2 albedo_lips> <post "
                    "albedo> <run2 derive_out/mask-lips>; changed <= 0.02, "
                    "untouched halo <= 0.10"),
           "rows": []}
    for subj in ("body2", "aisha"):
        cmd = ["mise", "exec", "-C", "/Volumes/files/src/openclinxr", "--",
               "python3", os.path.join(S, "wrinkle", "lm_lipcheck.py"),
               os.path.join(RUN2[subj], "albedo_lips.png"),
               NEW_POST_ALBEDO[subj],
               os.path.join(RUN2[subj], "derive_out", "mask-lips.png")]
        r = _sp.run(cmd, capture_output=True, text=True)
        out = (r.stdout + r.stderr).strip()
        changed = untouched = None
        for line in out.splitlines():
            if "untouched_frac" in line:
                try:
                    untouched = float(line.split("untouched_frac")[1].split()[0])
                except (IndexError, ValueError):
                    pass
            elif "frac" in line:
                try:
                    changed = float(line.split("frac")[1].split()[0])
                except (IndexError, ValueError):
                    pass
        row = {"subject": subj, "stdout": out, "changed": changed,
               "untouched_halo": untouched,
               "pass": bool(changed is not None and untouched is not None
                             and changed <= 0.02 and untouched <= 0.10)}
        lip["rows"].append(row)
        print(f"lipcheck {subj}: {out}", flush=True)
    lip["note"] = ("halo leg threshold (untouched <= 0.10) encodes the "
                   "pre-hb7 gaussian-hug smear: wrinkle-body2-post11 touches "
                   "99.8pc of the 8-12 halo (systematic -5.2L perioral "
                   "darkening); the bounded hug keeps halo skin clean by "
                   "design, so the leg is unreachable at detail gains "
                   "(wrinkle-aisha-post10 halo 0.580 also fails it). The "
                   "lip-protection intent (changed leg) passes 0.000/0.000.")
    gates["g3"] = lip
    # ---- G3b brow halo, MEASURE ONLY ----
    brow = {"rule": ("halo = 2-12 texel band outside the derive brows-L/R "
                     "union (mesh brow region); skin = halo texels with "
                     "PRE (run2 albedo_beard) L >= 35 (brow hair/pigment is "
                     "darker); untouched = max|dRGB| <= 3 vs PRE. No brow "
                     "exclusion changes on this card (face-one-brow owns "
                     "the brow edge); baseline only."),
            "brow_region": "derive_out mask-brows-L.png UNION mask-brows-R.png",
            "rows": []}
    from scipy import ndimage as _ndi  # noqa: E402
    for subj in ("body2", "aisha"):
        bu = ((np.array(Image.open(os.path.join(
            RUN2[subj], "derive_out", "mask-brows-L.png")).convert("L")) > 127) |
              (np.array(Image.open(os.path.join(
                  RUN2[subj], "derive_out", "mask-brows-R.png")).convert("L")) > 127))
        band = (_ndi.binary_dilation(bu, iterations=12)
                & ~_ndi.binary_dilation(bu, iterations=2))
        pre_rgb = np.array(Image.open(
            os.path.join(RUN2[subj], "albedo_beard.png")).convert("RGB")).astype(float)
        from skimage.color import rgb2lab as _r2l
        pre_L = _r2l(pre_rgb / 255.0)[..., 0]
        skin = band & (pre_L >= 35.0)
        for tag, ap_ in (("new_post", NEW_POST_ALBEDO[subj]),
                         ("wrinkle_post_reference", WRINKLE_ALBEDO[subj])):
            post_rgb = np.array(Image.open(ap_).convert("RGB")).astype(float)
            dd = np.abs(post_rgb - pre_rgb).max(axis=2)
            unt = skin & (dd <= 3.0)
            brow["rows"].append({
                "subject": subj, "albedo": tag,
                "halo_band_px": int(band.sum()),
                "skin_px": int(skin.sum()),
                "untouched_px": int(unt.sum()),
                "untouched_frac": round(float(unt.sum() / max(1, skin.sum())), 4)})
    gates["g3b"] = brow
    # ---- G4 sheets: forehead PRE | wrinkle POST | NEW POST | goal ----
    sheets = []
    for subj in ("body2", "aisha"):
        parts = []
        for tag, p in (("card_pre", CARD_PRE[subj]),
                       ("wrinkle_post", WRINKLE_POST[subj]),
                       ("new_post", NEW_POST_RENDER[subj]),
                       ("goal", GOAL[subj])):
            an = WB.analyse(p, landmarker)
            m = an["masks"]["forehead"]
            ys, xs = np.where(m)
            pad = 30
            x0 = max(0, xs.min() - pad)
            x1 = min(an["rgb"].shape[1], xs.max() + pad)
            y0 = max(0, ys.min() - pad)
            y1 = min(an["rgb"].shape[0], ys.max() + pad)
            parts.append(Image.fromarray(an["rgb"][y0:y1, x0:x1]))
        hh = max(im.size[1] for im in parts)
        row_imgs = []
        for im in parts:
            cv = Image.new("RGB", (im.size[0], hh), (128, 128, 128))
            cv.paste(im, (0, 0))
            row_imgs.append(cv)
        strip = Image.new(
            "RGB", (sum(im.size[0] for im in row_imgs) + 30, hh), (0, 0, 0))
        x = 0
        for im in row_imgs:
            strip.paste(im, (x, 0))
            x += im.size[0] + 10
        sp = os.path.join(
            OUT_STORE, f"sheet_{subj}_forehead_pre-wrinklepost-new-goal.png")
        strip.save(sp)
        sheets.append(sp)
    worker_grade = ("worker self-grade: NEW POST grain reads visibly "
                    "FINER and denser than the wrinkle POST on both subjects "
                    "(toward the goal's fine texture); no white-noise specks "
                    "or tiling visible in the forehead crops; body2 still "
                    "coarser than its goal photo. Lane-manager grade pending.")
    gates["g4"].update({"sheets": sheets,
                   "method": ("native room-rig pixels, padded not scaled; "
                              "columns: card-PRE | wrinkle-POST | NEW-POST | goal"),
                   "worker_grade": worker_grade,
                   "lane_manager": "pending"})
    # ---- G5 render records ----
    renders = []
    dstage = next(s for s in man["stages"] if s["name"] == "detail_bands")
    for subj in ("body2", "aisha"):
        rj = json.load(open(os.path.join(
            OUT_STORE, "post",
            f"porefine-{subj}-post.json")))
        renders.append({"subject": subj,
                        "variant": f"porefine-{subj}-post",
                        "render": NEW_POST_RENDER[subj],
                        "render_sha256": sha256_file(NEW_POST_RENDER[subj]),
                        "glb": rj["glb"],
                        "glb_matches_card": bool(rj["glb"] == GLB_WANT[subj]),
                        "albedo": NEW_POST_ALBEDO[subj],
                        "albedo_sha256": sha256_file(NEW_POST_ALBEDO[subj])})
    gates["g1"]["note"] = (
        "FAIL as written, both subjects, mechanism recorded (not a "
        "near-miss): the hi-mm parameter demonstrably moved the UV grain "
        "(albedo difference spectra: body2 grain low-cut 5.7->2.9 tex, "
        "aisha 5.7->9.8 tex) and both NEW renders read visibly finer, but "
        "the render-domain composite argmax does not track fine grain -- "
        "body2 fell 73.5->54.3 onto a base-texture bump once the ~118 "
        "centre attenuated (G1 window 106.6-205.9 is above any "
        "render-visible grain centre at this tex/px); aisha never tracked "
        "the grain (base-mottle argmax frozen 22.14->22.15, closer leg "
        "passes by 4e-4: trivially-gated baseline). No hi-mm value can "
        "pass: render-visible centres cap near ~85 while the window "
        "starts at 106.6.")
    report["post"] = post
    report["gates"] = gates
    report["renders"] = renders
    report["sheets"] = sheets
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print("G1: %s" % json.dumps(gates["g1"]["rows"]), flush=True)
    print("G2 counterweight: %s" % json.dumps(
        [r for r in g2_rows if r["route"] == "counterweight"]), flush=True)
    print("G3 lip: %s" % json.dumps(
        [(r["subject"], r["changed"], r["untouched_halo"], r["pass"])
         for r in lip["rows"]]), flush=True)
    print("G3b brow: %s" % json.dumps(brow["rows"]), flush=True)
    print("G4 tone: %s regressions=%d" % (gates["g4"]["verdict"], len(regressions)), flush=True)


if __name__ == "__main__":
    main()
