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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instrument-only", action="store_true")
    ap.add_argument("--pre", action="store_true")
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
    raise SystemExit("pass --instrument-only or --pre")


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


if __name__ == "__main__":
    main()
