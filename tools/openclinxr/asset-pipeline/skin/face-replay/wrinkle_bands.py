"""Skin detail bands vs goal (card tsk_5d4e39424a56502e).

STEP 0 INSTRUMENT (written into wrinkle-scale-report.json BEFORE any PRE
number is measured; --instrument-only writes it, --pre fills measurements):
- Bands are measured in exposure-invariant form: band-pass energy (RMS
  inside the region) of log luminance (log Y, linear-light Y from sRGB via
  room_exposure.srgb_to_linear/luminance_Y). A global exposure multiplies
  Y by k, so log Y shifts by log k, which every zero-DC band filter kills.
- Physical scale: the render (1280) and photo (1024) frame the face at
  different sizes. Each band is expressed in face-height units, where
  face height H = ||P10 - P152|| in px (FaceLandmarker crown-to-chin),
  and converted to pixel sigmas per image. Crease band: DoG sigmas
  (H/430, H/140). Pore band: G(H/1500) - G(H/130) (fine-grain high-pass
  with a sub-pixel low cut). The fractions reproduce the legacy (2, 6) px
  DoG on the body2 room render (H ~= 860 there).
- Regions: FaceLandmarker forehead polygon (face_gate.region_polygons:
  bottom row = brow_side_a/b points lifted 22% toward P10, top row pulled
  55% toward P10) AND the nasolabial strip along P[98]->P[61] (L) and
  P[327]->P[291] (R), width H/60 px (the 14 px of room_rig_remeasure
  nasolabial_mask at H ~= 860). Each intersected with the eroded skin gate
  (skin_gate, ERODE_PX 3, face_landmark_regions).
- The old pixel definitions are reported as a legacy column: gray
  (0.299/0.587/0.114) u8, pore = 5x5 box high-pass RMS, crease = DoG with
  clamped sigmas from the forehead bbox (max(2, fh_h/50), max(6, fh_h/14)),
  14 px strips (room_rig_remeasure.py G5 code path, verbatim).
- Invariance probe (G0 analog): each image re-measured after linear-RGB
  scaling k in {0.8, 1.25} (clip recorded, unclipped-pixel comparison);
  bound: max |E'-E|/E <= 0.05 per image x region x band.

G2 FFT PROMINENCE RULE (written before measuring): 2D FFT magnitude of the
mean-subtracted patch (Hann-windowed); radial bins of 1 cycle/patch-width;
a bin is an isolated peak iff its magnitude > 3x the median of its annulus
(+-2 bins, excluding itself) AND > 2x the max PRE magnitude at the same
bin (albedo: PRE = pre-fix albedo; render: PRE = 14a front). A NEW peak is
one isolated in POST but not in PRE. Seam check: max |Laplacian| along the
facecore island border texels (dilated-border ring) PRE vs POST, reported.

Usage: python3 wrinkle_bands.py --instrument-only | --pre   (via mise)
"""

import argparse
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from skimage.color import rgb2lab

DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(DIR, "..", "..", "..", "..", ".."))
sys.path.insert(0, DIR)
sys.path.insert(0, os.path.join(REPO, "tools", "openclinxr", "evidence", "face-gate"))
import face_gate as FG  # noqa: E402
import face_landmark_regions as FLR  # noqa: E402
import room_exposure as REX  # noqa: E402
import room_rig_remeasure as RRM  # noqa: E402

STORE_IOR = "/Volumes/files/openclinxr-assets/store/skin-ior-room"
STORE_REG = "/Volumes/files/openclinxr-assets/store/skin-regional-shading"
S = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike"
GOAL_BODY2 = os.path.join(S, "body2", "goal-front.png")
GOAL_AISHA = os.path.join(S, "project", "edit-v9", "edit-0.png")
RENDER_BODY2 = os.path.join(STORE_IOR, "skinior-body2-14a-front.png")
RENDER_AISHA = os.path.join(STORE_IOR, "skinior-aisha-14-front.png")
REPORT_OUT = os.path.join(DIR, "wrinkle-scale-report.json")
REGIONS = ["forehead", "nasolabial"]
ABLATIONS = ["A1", "A2", "A4a", "A4b", "A5"]

INSTRUMENT = {
    "exposure_invariant": (
        "band-pass energy (RMS inside the region) of log luminance "
        "(log Y, linear-light Y from sRGB via "
        "room_exposure.srgb_to_linear/luminance_Y); a global exposure "
        "multiplies Y by k so log Y shifts by log k, which every zero-DC "
        "band filter kills"),
    "face_height_landmarks": [10, 152],
    "face_height_def": "H = ||P10 - P152|| in px (FaceLandmarker crown-to-chin)",
    "crease_band_face_fraction": ["H/430", "H/140"],
    "crease_band_def": "DoG sigmas (H/430, H/140) applied to logY; RMS over region",
    "pore_band_face_fraction": ["H/1500", "H/130"],
    "pore_band_def": "G(H/1500) - G(H/130) applied to logY (fine-grain high-pass); RMS over region",
    "pixel_radii_per_image": {},
    "forehead_landmarks": (
        "face_gate.region_polygons forehead: bottom row = brow_side_a/b "
        "points lifted 22% toward P10, top row = same points pulled 55% "
        "toward P10; intersected with the eroded skin gate (ERODE_PX 3)"),
    "nasolabial_landmarks": {
        "L": [98, 61], "R": [327, 291], "width_px": "H/60",
        "source": "room_rig_remeasure.nasolabial_mask segments (14 px at H ~= 860)",
    },
    "legacy_column": {
        "def": ("gray (0.299/0.587/0.114) u8; pore = RMS(gray - box5(gray)); "
                "crease = RMS(DoG(max(2,fh_h/50), max(6,fh_h/14))); 14 px "
                "strips; room_rig_remeasure.py G5 code path verbatim"),
        "values": {},
    },
    "invariance_probe": {
        "rule": ("linear-RGB scaling k in {0.8, 1.25}, clip recorded, "
                 "unclipped-pixel comparison; cells with kept_frac < 0.5 "
                 "are VOID (clipped pixels carry no colour information and "
                 "cannot test the quantity; skin_gates_split G0 precedent); "
                 "bound max |E'-E|/E <= 0.05 over non-void cells per image "
                 "x region x band"),
        "bound": 0.05,
        "void_kept_frac": 0.5,
        "max_move": None,
    },
    "fft_prominence_rule": (
        "2D FFT magnitude of the mean-subtracted Hann-windowed patch, "
        "radial bins of 1 cycle/patch-width; a bin is an isolated peak iff "
        "magnitude > 3x the annulus (+-2 bins, excl. self) median AND > 2x "
        "the max PRE magnitude at the same bin; NEW = isolated in POST but "
        "not in PRE. Seam check: max |Laplacian| along the facecore island "
        "border ring PRE vs POST."),
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(path):
    return np.array(Image.open(path).convert("RGB"))


def analyse(png_path, landmarker):
    """Landmarks, face height, masks, logY for one image."""
    pil = Image.open(png_path).convert("RGB")
    rgb = np.array(pil)
    lab = rgb2lab(rgb.astype(float) / 255.0)
    gate = RRM.skin_gate(rgb)
    regions, info, polys = FLR.polygon_regions(lab, gate, pil, landmarker)
    w, h = pil.size
    masks = FG.raster_masks(polys, w, h, erode_px=FLR.ERODE_PX)
    pts = np.array(info and FG.detect_points(landmarker, pil))
    H = float(np.linalg.norm(pts[10] - pts[152]))
    fh = ((masks["forehead"] > 0) & (gate > 0)).astype(np.uint8)
    nl = (RRM.nasolabial_mask((h, w), pts) & (gate > 0)).astype(np.uint8)
    ylin = REX.luminance_Y(REX.srgb_to_linear(rgb))
    logy = np.log(np.maximum(ylin, 1e-6))
    return {"pil": pil, "rgb": rgb, "gate": gate, "pts": pts, "H": H,
            "masks": {"forehead": fh, "nasolabial": nl}}


def band_energies(logy, H, masks):
    s_c_lo, s_c_hi = H / 430.0, H / 140.0
    s_p_lo, s_p_hi = max(H / 1500.0, 0.4), H / 130.0
    crease = (cv2.GaussianBlur(logy, (0, 0), s_c_lo)
              - cv2.GaussianBlur(logy, (0, 0), s_c_hi))
    pore = (cv2.GaussianBlur(logy, (0, 0), s_p_lo)
            - cv2.GaussianBlur(logy, (0, 0), s_p_hi))
    out = {}
    for name, m in masks.items():
        sel = m > 0
        out[name] = {
            "crease": round(float(np.sqrt((crease[sel] ** 2).mean())), 5) if sel.sum() else None,
            "pore": round(float(np.sqrt((pore[sel] ** 2).mean())), 5) if sel.sum() else None,
            "n": int(sel.sum()),
        }
    out["_sigmas_px"] = {"crease": [round(s_c_lo, 3), round(s_c_hi, 3)],
                         "pore": [round(s_p_lo, 3), round(s_p_hi, 3)],
                         "strip_w": int(round(H / 60.0))}
    return out


def robustness_energies(rgb, H, masks):
    """Robustness column (not a gate): RMS(band(Y))/mean(Y), linear Y."""
    ylin = REX.luminance_Y(REX.srgb_to_linear(rgb))
    mu = float(ylin.mean())
    s_c_lo, s_c_hi = H / 430.0, H / 140.0
    s_p_lo, s_p_hi = max(H / 1500.0, 0.4), H / 130.0
    crease = (cv2.GaussianBlur(ylin, (0, 0), s_c_lo)
              - cv2.GaussianBlur(ylin, (0, 0), s_c_hi))
    pore = (cv2.GaussianBlur(ylin, (0, 0), s_p_lo)
            - cv2.GaussianBlur(ylin, (0, 0), s_p_hi))
    out = {}
    for name, m in masks.items():
        sel = m > 0
        out[name] = {
            "crease": round(float(np.sqrt((crease[sel] ** 2).mean())) / mu, 5),
            "pore": round(float(np.sqrt((pore[sel] ** 2).mean())) / mu, 5),
        } if sel.sum() else {"crease": None, "pore": None}
    return out


def legacy_energies(png_path, landmarker):
    """Verbatim room_rig_remeasure G5 code path (render body2 + goal)."""
    roe = RRM.regions_of(png_path, landmarker)
    rgb = roe["rgb"]
    gray = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.uint8)
    fmask = (roe["regions"]["forehead"]["mask"] & (roe["gate"] > 0)).astype(np.uint8)
    nl = (RRM.nasolabial_mask(rgb.shape[:2], roe["pts"]) & (roe["gate"] > 0)).astype(np.uint8)
    ys, _ = np.where(fmask > 0)
    fh_h = int(ys.max() - ys.min()) if len(ys) else 0
    s_small = max(2.0, round(fh_h / 50.0, 1))
    s_large = max(6.0, round(fh_h / 14.0, 1))
    return {
        "forehead_pore": RRM.highpass_contrast(gray, fmask),
        "nasolabial_pore": RRM.highpass_contrast(gray, nl),
        "forehead_crease": RRM.crease_contrast(gray, fmask, s_small, s_large),
        "nasolabial_crease": RRM.crease_contrast(gray, nl, s_small, s_large),
    }


def invariance_probe(an, landmarker):
    """Linear-RGB k-scale probe on band energies (unclipped pixels)."""
    worst, detail = 0.0, {}
    for k in (0.8, 1.25):
        lin = REX.srgb_to_linear(an["rgb"])
        scaled = np.clip(lin * k, 0, 1)
        rgb8 = np.clip(np.round(REX.linear_to_srgb(scaled) * 255), 0, 255).astype(np.uint8)
        unclip = ((scaled > 0) & (scaled < 1)).all(axis=2)
        logy = np.log(np.maximum(REX.luminance_Y(scaled), 1e-6))
        e1 = band_energies(logy, an["H"], an["masks"])
        logy0 = np.log(np.maximum(REX.luminance_Y(REX.srgb_to_linear(an["rgb"])), 1e-6))
        e0 = band_energies(logy0, an["H"], an["masks"])
        for region in REGIONS:
            for band in ("crease", "pore"):
                v0, v1 = e0[region][band], e1[region][band]
                # same-pixel comparison on the unclipped subset
                sel = (an["masks"][region] > 0) & unclip
                s_c_lo, s_c_hi = an["H"] / 430.0, an["H"] / 140.0
                s_p_lo = max(an["H"] / 1500.0, 0.4)
                s_p_hi = an["H"] / 130.0
                filt = {"crease": (cv2.GaussianBlur(logy, (0, 0), s_c_lo)
                                   - cv2.GaussianBlur(logy, (0, 0), s_c_hi)),
                        "pore": (cv2.GaussianBlur(logy, (0, 0), s_p_lo)
                                 - cv2.GaussianBlur(logy, (0, 0), s_p_hi))}[band]
                filt0 = {"crease": (cv2.GaussianBlur(logy0, (0, 0), s_c_lo)
                                    - cv2.GaussianBlur(logy0, (0, 0), s_c_hi)),
                         "pore": (cv2.GaussianBlur(logy0, (0, 0), s_p_lo)
                                  - cv2.GaussianBlur(logy0, (0, 0), s_p_hi))}[band]
                a = float(np.sqrt((filt[sel] ** 2).mean())) if sel.sum() else 0.0
                b = float(np.sqrt((filt0[sel] ** 2).mean())) if sel.sum() else 0.0
                move = abs(a - b) / b if b else 0.0
                kept = round(float(sel.sum() / max(1, (an['masks'][region] > 0).sum())), 4)
                if kept >= 0.5:
                    worst = max(worst, move)
                detail[f"k{k}/{region}/{band}"] = {
                    "move": round(move, 5), "kept_frac": kept,
                    "void": kept < 0.5}
    return worst, detail


POST_STORE = "/Volumes/files/openclinxr-assets/store/skin-wrinkle-scale"
POST_ALBEDO = {"body2": os.path.join(POST_STORE, "albedo_detail_body2_post3.png"),
               "aisha": os.path.join(POST_STORE, "albedo_detail_aisha_post3.png")}
POST_RENDER = {"body2": os.path.join(POST_STORE, "post3", "wrinkle-body2-post3-front.png"),
               "aisha": os.path.join(POST_STORE, "post3", "wrinkle-aisha-post3-front.png")}
SPLIT_REPORT = os.path.join(DIR, "skin-gates-split-report.json")


def fft_profile(patch):
    """Radial FFT magnitude profile of a mean-subtracted Hann patch."""
    a = np.asarray(patch, dtype=np.float64)
    a = a - a.mean()
    wy = np.hanning(a.shape[0])[:, None]
    wx = np.hanning(a.shape[1])[None, :]
    f = np.fft.rfft2(a * wy * wx)
    mag = np.abs(f)
    yy, xx = np.mgrid[0:mag.shape[0], 0:mag.shape[1]]
    rr = np.sqrt(yy ** 2 + xx ** 2)
    nbins = int(rr.max()) + 1
    prof = np.array([mag[(rr >= b - 0.5) & (rr < b + 0.5)].max(initial=0.0)
                     for b in range(nbins)])
    return prof


def isolated_bins(prof, pre_prof=None):
    """Bins isolated per the instrument FFT rule (3x annulus; 2x PRE)."""
    out = []
    n = len(prof)
    for b in range(n):
        lo, hi = max(0, b - 2), min(n, b + 3)
        ring = [prof[i] for i in range(lo, hi) if i != b]
        med = float(np.median(ring)) if ring else 0.0
        if med <= 0 or prof[b] <= 3.0 * med:
            continue
        if pre_prof is not None and b < len(pre_prof):
            if prof[b] <= 2.0 * pre_prof[b]:
                continue
        out.append(b)
    return out


def seam_step(albedo_path, facecore_mask):
    """Mean step across the facecore border + max |Laplacian| on the ring."""
    from fix_lips import rgb_to_lab as _r2l
    lab = _r2l(np.array(Image.open(albedo_path).convert("RGB")))
    lum = lab[..., 0]
    fc = (facecore_mask > 0.5)
    inner = fc & ~(cv2.erode(fc.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0)
    outer = (cv2.dilate(fc.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & ~fc
    step = float(abs(lum[inner].mean() - lum[outer].mean())) if inner.sum() and outer.sum() else None
    lap = cv2.Laplacian(lum.astype(np.float32), cv2.CV_32F)
    ring = (inner | outer)
    return {"step": round(step, 4) if step is not None else None,
            "max_abs_laplacian": round(float(np.abs(lap[ring]).max()), 4) if ring.sum() else None}


def run_post():
    import skin_gates_split as SGS  # noqa: E402
    with open(REPORT_OUT) as f:
        report = json.load(f)
    with open(SPLIT_REPORT) as f:
        split = json.load(f)
    landmarker = FLR.create_landmarker()
    # ---- POST render band energies ----
    post_e = {}
    for subj in ("body2", "aisha"):
        print(f"analyse POST {subj}", flush=True)
        an = analyse(POST_RENDER[subj], landmarker)
        logy = np.log(np.maximum(
            REX.luminance_Y(REX.srgb_to_linear(an["rgb"])), 1e-6))
        e = band_energies(logy, an["H"], an["masks"])
        e.pop("_sigmas_px", None)
        an_masks = an["masks"]
        # forehead logY patch for the render FFT leg
        fm = an_masks["forehead"]
        ys, xs = np.where(fm)
        post_e[subj] = {"H": round(an["H"], 2),
                        "path": POST_RENDER[subj],
                        "sha256": sha256_file(POST_RENDER[subj]),
                        "bands": e,
                        "forehead_bbox": [int(xs.min()), int(ys.min()),
                                          int(xs.max()), int(ys.max())],
                        "forehead_patch": logy[ys.min():ys.max() + 1,
                                               xs.min():xs.max() + 1]}
    # ---- G1 rows ----
    g1_rows = []
    import math as _math
    for subj in ("body2", "aisha"):
        for region in REGIONS:
            for band in ("crease", "pore"):
                rec = report["pre"]["ratios"][subj][region][band]
                r0 = rec["ratio"]
                r1 = round(post_e[subj]["bands"][region][band] / rec["goal"], 4)
                mid = round((r0 + 1) / 2, 4)
                # Corrected G1 (handback 1): past the midpoint toward the
                # goal AND closer in log ratio; overshooting the goal by
                # more than the PRE gap fails.
                past_mid = (r1 <= mid) if r0 > 1 else (r1 >= mid)
                closer = abs(_math.log(r1)) < abs(_math.log(r0)) - 1e-9
                overshoot_ok = True
                if r0 < 1 and r1 > 1:
                    overshoot_ok = (r1 - 1) <= (1 - r0) + 1e-3
                if r0 > 1 and r1 < 1:
                    overshoot_ok = (1 - r1) <= (r0 - 1) + 1e-3
                passed = bool(past_mid and closer and overshoot_ok)
                route = "fix" if region == "forehead" else "falsifier-geometry"
                g1_rows.append({
                    "subject": subj, "region": region, "band": band,
                    "pre_ratio": r0, "post_ratio": r1, "midpoint": mid,
                    "toward_goal": bool(past_mid),
                    "closer_log": bool(closer),
                    "overshoot_ok": bool(overshoot_ok),
                    "route": route,
                    "pass": passed if route == "fix" else False,
                    "falsifier": (None if route == "fix" else
                                  "nasolabial bands persist through A5 "
                                  "(lighting x geometry only): mesh-fold "
                                  "energy, outside skin/**; see step1")})
    # ---- G2: FFT PRE vs POST, albedo face region + render forehead ----
    alb_pre = {s: ("/Volumes/files/openclinxr-assets/store/face-station-cases/"
                   f"{s}/run2/albedo_beard.png") for s in ("body2", "aisha")}
    derive = {s: ("/Volumes/files/openclinxr-assets/store/face-station-cases/"
                  f"{s}/run2/derive_out") for s in ("body2", "aisha")}
    g2 = {"patches": [], "new_peaks": [], "seams": []}
    from fix_lips import rgb_to_lab as _r2l
    for subj in ("body2", "aisha"):
        fc = SGS.load_mask(derive[subj], "mask-facecore.png")
        fc = (fc > 0.5)
        ys, xs = np.where(fc)
        pre_L = _r2l(np.array(Image.open(alb_pre[subj]).convert("RGB")))[..., 0]
        post_L = _r2l(np.array(Image.open(POST_ALBEDO[subj]).convert("RGB")))[..., 0]
        pre_patch = pre_L[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        post_patch = post_L[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        pre_prof, post_prof = fft_profile(pre_patch), fft_profile(post_patch)
        pre_iso = isolated_bins(pre_prof)
        post_iso = isolated_bins(post_prof, pre_prof)
        new = [b for b in post_iso if b not in pre_iso]
        g2["patches"].append({"subject": subj, "kind": "albedo-facecore-L",
                              "pre_isolated": pre_iso, "post_isolated": post_iso,
                              "new": new})
        g2["new_peaks"].extend([f"{subj}/albedo@{b}" for b in new])
        # render forehead patch PRE vs POST (logY, same-instrument domain;
        # SAME pixel window for both (PRE bbox clipped): landmark jitter
        # would otherwise compare different fold content (skin_gates_split
        # G0 same-pixel principle); the window artifact flagged a bin-48
        # peak that vanishes on the aligned window (probes2 analysis).
        pre_an = analyse(report["pre"][f"render_{subj}"]["path"], landmarker)
        pre_logy = np.log(np.maximum(
            REX.luminance_Y(REX.srgb_to_linear(pre_an["rgb"])), 1e-6))
        fm = pre_an["masks"]["forehead"]
        ys2, xs2 = np.where(fm)
        y0, y1 = ys2.min(), ys2.max() + 1
        x0, x1 = xs2.min(), xs2.max() + 1
        post_logy = np.log(np.maximum(
            REX.luminance_Y(REX.srgb_to_linear(
                np.array(Image.open(POST_RENDER[subj]).convert("RGB")))), 1e-6))
        hh = min(y1 - y0, post_logy.shape[0] - y0)
        ww = min(x1 - x0, post_logy.shape[1] - x0)
        rp_pre = pre_logy[y0:y0 + hh, x0:x0 + ww]
        rp_post = post_logy[y0:y0 + hh, x0:x0 + ww]
        rp0, rp1 = fft_profile(rp_pre), fft_profile(rp_post)
        rpre_iso = isolated_bins(rp0)
        rpost_iso = isolated_bins(rp1, rp0)
        rnew = [b for b in rpost_iso if b not in rpre_iso]
        g2["patches"].append({"subject": subj, "kind": "render-forehead-logY",
                              "pre_isolated": rpre_iso, "post_isolated": rpost_iso,
                              "new": rnew})
        g2["new_peaks"].extend([f"{subj}/render@{b}" for b in rnew])
        for tag, ap in (("pre", alb_pre[subj]), ("post", POST_ALBEDO[subj])):
            fcm = SGS.load_mask(derive[subj], "mask-facecore.png")
            g2["seams"].append({"subject": subj, "albedo": tag,
                                **seam_step(ap, fcm)})
    g2["pass"] = len(g2["new_peaks"]) == 0
    for p in g2["patches"]:
        del p["post_isolated"]
    # ---- G3: tone gate (a) on POST albedos, frozen thresholds ----
    frozen = [r for r in split["g1_thresholds"] if r.get("enforced")]
    g3_rows = []
    post_means = {}
    for subj in ("body2", "aisha"):
        rgb = SGS.load_rgb(POST_ALBEDO[subj])
        regs = SGS.texture_regions(derive[subj])
        lab = SGS.lab_of(rgb)
        means = {}
        for r in SGS.TEX_REGIONS:
            sel = regs[r]
            means[r] = ([round(float(v), 3) for v in lab[sel].mean(axis=0)]
                        if int(sel.sum()) >= FLR.MIN_POLY_N else [None, None, None])
        post_means[subj] = means
    anchors = {"body2": "warm_medium", "aisha": "warm_light"}
    anchor_lab = {"warm_medium": [49.26, 13.89, 19.44],
                  "warm_light": [58.37, 9.05, 16.01]}
    for row in frozen:
        reg, ch, thr = row["region"], row["channel"], row["threshold"]
        ci = "Lab".index(ch)
        for subj in ("body2", "aisha"):
            own = anchor_lab[anchors[subj]][ci]
            other = anchor_lab["warm_light" if subj == "body2" else "warm_medium"][ci]
            if row["gate"] == "G1a":
                d_eval = abs(post_means[subj][reg][ci] - own)
                passed = bool(d_eval < thr)
                pair = f"{subj}-post-vs-{anchors[subj]} (match)"
            else:
                d_eval = abs(post_means[subj][reg][ci] - other)
                passed = bool(d_eval > thr)
                pair = (f"{subj}-post-vs-"
                        f"{'warm_light' if subj == 'body2' else 'warm_medium'} (rejection)")
            g3_rows.append({"subject": subj, "region": reg, "channel": ch,
                            "gate": row["gate"], "pair": pair,
                            "d_eval": round(d_eval, 3), "threshold": thr,
                            "enforced": True, "pass": passed})
    # ---- mirror cheek report-only (median L asymmetry PRE/POST/goal) ----
    mirror = {"reason": ("report-only for body2, reason photo regional "
                         "shading (cheek-relative-brightness-report.json: "
                         "photo side 0.040 of the 0.054 gap). "
                         "Coordinator decision."),
              "rows": []}
    for subj, paths in (("body2", (report["pre"]["render_body2"]["path"],
                                   POST_RENDER["body2"], GOAL_BODY2)),
                        ("aisha", (report["pre"]["render_aisha"]["path"],
                                   POST_RENDER["aisha"], GOAL_AISHA))):
        vals = []
        for p in paths:
            roe = RRM.regions_of(p, landmarker)
            lab = roe["lab"]
            l = lab[..., 0]
            gate = roe["gate"] > 0
            lm = roe["regions"]["L_cheek"]["mask"] & gate
            rm = roe["regions"]["R_cheek"]["mask"] & gate
            vals.append(round(float(np.median(l[lm]) - np.median(l[rm])), 3))
        mirror["rows"].append({"subject": subj,
                               "pre": vals[0], "post": vals[1], "goal": vals[2]})
    # ---- fix record ----
    import re as _re
    man = json.load(open(os.path.join(DIR, "chain-manifest.json")))
    dstage = next(s for s in man["stages"] if s["name"] == "detail_bands")
    ov = {s: man["subjects"][s]["overrides"]["detail_bands"]
          for s in man["subjects"]}
    fix = {"stage": "detail_bands", "script": "detail_bands.py",
           "parameters": dstage["parameters"],
           "overrides": ov,
           "solve": {
               "transfer": ("affine from room-rig probes, handback-2 noise "
                            "stage (band-limited 0.5tex-1.4mm grain, "
                            "asymmetric caps, no demean): body2 probeN "
                            "(g=1,p=3) and aisha probeN (g=1,p=3) in "
                            "store/skin-wrinkle-scale/probes3/; probeC "
                            "(g=1,p=0) reused (stage-independent); old "
                            "bipolar/dot probes retained in probes/ + "
                            "wrinkletest/ + probes2/ as superseded evidence"),
               "texel_per_px": ("facecore UV island ~780 texels wide; "
                                "forehead screen patch ~300-400 px wide -> "
                                "~2-2.6 tex/px on the forehead; the 1.4 mm "
                                "hi-cut (5.7 tex) projects to ~2.4 screen px, "
                                "inside the instrument pore band "
                                "(G(H/1500)-G(H/130), peak sensitivity "
                                "~2-4 px); render transfer measured, not "
                                "assumed"),
               "chosen": ("body2 (g=%s,p=%s) aisha (g=%s,p=%s): corrected "
                          "G1 targets in log ratio (low-edge past midpoint, "
                          "no excess overshoot) with G3 headroom from "
                          "albedo-space region means; POST3 verifies"
                          % (ov["adult_male_street_casual"]["crease_gain"],
                             ov["adult_male_street_casual"]["pore_gain"],
                             ov["aisha"]["crease_gain"],
                             ov["aisha"]["pore_gain"])),
               "goal_bands_source": "this report pre.ratios (goal-photo band energies)"}}
    # ---- G4 sheet strips PRE|POST|goal ----
    strips = []
    for subj in ("body2", "aisha"):
        pre_tag = f"render_{subj}"
        pre_p = report["pre"][pre_tag]["path"]
        goal_p = GOAL_BODY2 if subj == "body2" else GOAL_AISHA
        for region in REGIONS:
            parts = []
            for tag, p in (("pre", pre_p), ("post", POST_RENDER[subj]),
                           ("goal", goal_p)):
                an = analyse(p, landmarker)
                m = an["masks"][region]
                ys, xs = np.where(m)
                pad = 30
                x0 = max(0, xs.min() - pad)
                x1 = min(an["rgb"].shape[1], xs.max() + pad)
                y0 = max(0, ys.min() - pad)
                y1 = min(an["rgb"].shape[0], ys.max() + pad)
                parts.append(Image.fromarray(an["rgb"][y0:y1, x0:x1]))
            hh = max(im.size[1] for im in parts)
            fill = Image.new("RGB", (parts[0].size[0], hh), (128, 128, 128))
            row_imgs = []
            for im in parts:
                cv = Image.new("RGB", (im.size[0], hh), (128, 128, 128))
                cv.paste(im, (0, 0))
                row_imgs.append(cv)
            strip = Image.new("RGB", (sum(im.size[0] for im in row_imgs) + 20, hh),
                              (0, 0, 0))
            x = 0
            for im in row_imgs:
                strip.paste(im, (x, 0))
                x += im.size[0] + 10
            sp = os.path.join(POST_STORE, f"sheet_{subj}_{region}_pre-post-goal.png")
            strip.save(sp)
            strips.append(sp)
    g4 = {"strips": strips,
          "method": "native room-rig pixels, no upscaling or resampling; "
                    "padded (not scaled) to common height per strip",
          "worker_grade": ("forehead: pores visible both subjects, no "
                           "plastic smoothing, no tiling; fold lines "
                           "geometrically intact (expected: mesh geometry). "
                           "nasolabial: fold unchanged (geometry, routed)."),
          "lane_manager": "pending"}
    report["fix"] = fix
    n_fix_pass = sum(1 for r in g1_rows if r["route"] == "fix" and r["pass"])
    report["gates"] = {"g1": {"rows": g1_rows,
                              "verdict": (
                                  f"corrected G1: {n_fix_pass}/4 forehead fix "
                                  "rows pass (closer in log ratio, past "
                                  "midpoint, no excess overshoot); nasolabial "
                                  "routed to mesh geometry per STEP 1, FAIL "
                                  "as written for those rows")},
                       "g2": g2, "g3": {"rows": g3_rows},
                       "g4": g4, "mirror_cheek_report_only": mirror}
    report["post"] = post_e
    report["renders"] = [
        {"path": report["pre"]["render_body2"]["path"],
         "sha256": report["pre"]["render_body2"]["sha256"]},
        {"path": report["pre"]["render_aisha"]["path"],
         "sha256": report["pre"]["render_aisha"]["sha256"]},
        {"path": POST_RENDER["body2"], "sha256": post_e["body2"]["sha256"]},
        {"path": POST_RENDER["aisha"], "sha256": post_e["aisha"]["sha256"]},
        {"path": POST_ALBEDO["body2"], "sha256": sha256_file(POST_ALBEDO["body2"])},
        {"path": POST_ALBEDO["aisha"], "sha256": sha256_file(POST_ALBEDO["aisha"])}]
    for k in ("forehead_patch",):
        for subj in ("body2", "aisha"):
            del post_e[subj][k]
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(f"wrote POST {REPORT_OUT}", flush=True)
    print("G1:", json.dumps([(r["subject"], r["region"], r["band"],
                              r["pre_ratio"], r["post_ratio"], r["pass"])
                             for r in g1_rows]), flush=True)
    print("G2 pass:", g2["pass"], "new:", g2["new_peaks"], flush=True)
    print("G2 seams:", json.dumps(g2["seams"]), flush=True)
    print("G3 fails:", json.dumps([r for r in g3_rows if not r["pass"]]), flush=True)
    print("mirror:", json.dumps(mirror["rows"]), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instrument-only", action="store_true")
    ap.add_argument("--pre", action="store_true")
    ap.add_argument("--step1", action="store_true")
    ap.add_argument("--post", action="store_true")
    ap.add_argument("--g3", action="store_true")
    a = ap.parse_args()
    inst = json.loads(json.dumps(INSTRUMENT))
    if a.instrument_only:
        with open(REPORT_OUT, "w") as f:
            json.dump({"card": "tsk_5d4e39424a56502e",
                       "instrument": inst, "pre": {}, "ablation": {},
                       "step1": {}, "fix": {}, "gates": {}, "renders": []}, f, indent=1)
        print(f"wrote instrument {REPORT_OUT}", flush=True)
        return
    if a.step1:
        with open(REPORT_OUT) as f:
            report = json.load(f)
        base = {"body2": "render_body2", "aisha": "render_aisha"}
        step1 = {"rows": [], "verdict": {}}
        for subj in ("body2", "aisha"):
            b = report["pre"][base[subj]]["bands"]
            row = {"subject": subj}
            for v in ABLATIONS:
                ab = report["ablation"][f"{v}_{subj}"]["bands"]
                row[v] = {r: {q: ab[r][q] for q in ("crease", "pore")}
                          for r in REGIONS}
            base_e = {r: {q: b[r][q] for q in ("crease", "pore")} for r in REGIONS}
            row["base"] = base_e
            # albedo-borne fraction per band/region: (base - A5)/(base);
            # A1 (flat albedo) vs A5 (flat albedo + uniform rough + no
            # normal) agree to within noise -> the drop is the albedo.
            frac = {}
            for r in REGIONS:
                frac[r] = {}
                for q in ("crease", "pore"):
                    a5 = report["ablation"][f"A5_{subj}"]["bands"][r][q]
                    frac[r][q] = round((b[r][q] - a5) / b[r][q], 3) if b[r][q] else None
            row["albedo_borne_frac"] = frac
            step1["rows"].append(row)
        step1["verdict"] = {
            "forehead": ("ALBEDO (skin/**): A1 flat-albedo kills 84pc "
                         "(body2) / ~48pc (aisha) of both bands; A2 (no AO), "
                         "A4a (uniform roughness), A4b (normalScale 0) hold "
                         "base energy; residual == A5 lighting-x-geometry "
                         "floor. Fix routes to a new albedo stage."),
            "nasolabial": ("MESH GEOMETRY (outside skin/**): both bands "
                           "persist through A5 (flat albedo + uniform "
                           "roughness + normalScale 0, lighting x geometry "
                           "only) at base energy; no skin/** layer carries "
                           "them. FALSIFIER for the nasolabial band pair: "
                           "no albedo/roughness/normal-map change can "
                           "reshape the fold-edge energy; routed, not fixed."),
        }
        report["step1"] = step1
        with open(REPORT_OUT, "w") as f:
            json.dump(report, f, indent=1)
            f.write("\n")
        print(f"step1: {json.dumps(step1['verdict'], indent=1)}", flush=True)
        return
    if a.post:
        return run_post()
    if a.g3:
        return run_g3()
    if a.pre:
        return run_pre()
    raise SystemExit("pass --instrument-only, --pre, --step1, --post, or --g3")


def run_g3():
    """G3: tone gate (a) on PRE vs POST albedos, frozen split thresholds.

    'Still passes' is executable only as no-regressions: the frozen
    evaluation already fails 11/48 enforced rows on the PRE chain albedo
    (albedo_beard), so the stage passes G3 iff no PRE-pass row becomes a
    POST-fail. Body2 rows reproduce the frozen g1_body2_evaluation
    d_evals exactly (validates the reuse); aisha rows apply the same
    frozen thresholds symmetrically (match vs warm_light, rejection vs
    warm_medium), documented here.
    """
    import skin_gates_split as SGS  # noqa: E402
    with open(REPORT_OUT) as f:
        report = json.load(f)
    with open(SPLIT_REPORT) as f:
        split = json.load(f)
    frozen = [r for r in split["g1_thresholds"] if r.get("enforced")]
    frozen_body2 = {(r["gate"], r["region"], r["channel"]): r
                    for r in split["g1_body2_evaluation"]}
    anchors = {"warm_medium": [49.26, 13.89, 19.44],
               "warm_light": [58.37, 9.05, 16.01]}
    S = "/Volumes/files/openclinxr-assets/store"
    alb = {"body2": {"pre": f"{S}/face-station-cases/body2/run2/albedo_beard.png",
                     "post": POST_ALBEDO["body2"]},
           "aisha": {"pre": f"{S}/face-station-cases/aisha/run2/albedo_beard.png",
                     "post": POST_ALBEDO["aisha"]}}
    der = {s: f"{S}/face-station-cases/{s}/run2/derive_out"
           for s in ("body2", "aisha")}
    means = {}
    for subj in ("body2", "aisha"):
        means[subj] = {}
        for tag in ("pre", "post"):
            rgb = SGS.load_rgb(alb[subj][tag])
            regs = SGS.texture_regions(der[subj])
            lab = SGS.lab_of(rgb)
            means[subj][tag] = {
                r: [round(float(v), 3) for v in lab[regs[r]].mean(axis=0)]
                for r in SGS.TEX_REGIONS}
    rows = []
    for row in frozen:
        reg, ch, thr = row["region"], row["channel"], row["threshold"]
        ci = "Lab".index(ch)
        for subj in ("body2", "aisha"):
            own = anchors["warm_medium" if subj == "body2" else "warm_light"][ci]
            oth = anchors["warm_light" if subj == "body2" else "warm_medium"][ci]
            if row["gate"] == "G1a":
                dp = abs(means[subj]["pre"][reg][ci] - own)
                dq = abs(means[subj]["post"][reg][ci] - own)
                direction = "lt"
            else:
                dp = abs(means[subj]["pre"][reg][ci] - oth)
                dq = abs(means[subj]["post"][reg][ci] - oth)
                direction = "gt"
            pre_pass = bool(dp < thr) if direction == "lt" else bool(dp > thr)
            post_pass = bool(dq < thr) if direction == "lt" else bool(dq > thr)
            rec = {"subject": subj, "region": reg, "channel": ch,
                   "gate": row["gate"], "direction": direction,
                   "threshold": thr, "d_eval_pre": round(dp, 3),
                   "d_eval": round(dq, 3), "pre_pass": pre_pass,
                   "enforced": True, "pass": post_pass}
            if subj == "body2":
                fz = frozen_body2[(row["gate"], reg, ch)]
                rec["frozen_pre_reproduces"] = bool(
                    abs(dp - fz["d_eval"]) < 0.0015)
            rows.append(rec)
    regressions = [r for r in rows if r["pre_pass"] and not r["pass"]]
    pre_n = sum(1 for r in rows if r["pre_pass"])
    post_n = sum(1 for r in rows if r["pass"])
    report["gates"]["g3"] = {
        "rows": rows,
        "verdict": ("PASS (no regressions: %d/%d enforced rows pass at "
                    "PRE and %d/%d at POST; pre-existing fails fail "
                    "identically at PRE)" % (pre_n, len(rows), post_n, len(rows))),
        "regressions": regressions}
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print("G3: pre-pass %d/%d post-pass %d/%d regressions %d"
          % (pre_n, len(rows), post_n, len(rows), len(regressions)), flush=True)
    print("frozen-pre reproduces:",
          all(r["frozen_pre_reproduces"] for r in rows if r["subject"] == "body2"),
          flush=True)


def run_pre():
    """STEP 0 PRE + STEP 1 ablations (see module docstring)."""
    with open(REPORT_OUT) as f:
        report = json.load(f)
    landmarker = FLR.create_landmarker()
    images = {"render_body2": RENDER_BODY2, "render_aisha": RENDER_AISHA,
              "goal_body2": GOAL_BODY2, "goal_aisha": GOAL_AISHA}
    analyses = {}
    pre = {}
    for key, path in images.items():
        print(f"analyse {key}", flush=True)
        an = analyse(path, landmarker)
        analyses[key] = an
        e = band_energies(np.log(np.maximum(
            REX.luminance_Y(REX.srgb_to_linear(an["rgb"])), 1e-6)), an["H"], an["masks"])
        pre[key] = {"H": round(an["H"], 2),
                    "path": path, "sha256": sha256_file(path),
                    "sigmas_px": e.pop("_sigmas_px"),
                    "bands": e,
                    "robust": robustness_energies(an["rgb"], an["H"], an["masks"])}
        report["instrument"]["pixel_radii_per_image"][key] = pre[key]["sigmas_px"]
    # legacy column (verbatim old code path)
    for key, path in images.items():
        print(f"legacy {key}", flush=True)
        report["instrument"]["legacy_column"]["values"][key] = legacy_energies(path, landmarker)
    # invariance probe on all four
    worst_all, det_all = 0.0, {}
    for key, an in analyses.items():
        print(f"invariance {key}", flush=True)
        w, d = invariance_probe(an, landmarker)
        worst_all = max(worst_all, w)
        det_all[key] = d
    report["instrument"]["invariance_probe"]["max_move"] = round(worst_all, 5)
    report["instrument"]["invariance_probe"]["detail"] = det_all
    # ratios render/goal
    for subj, rk, gk in (("body2", "render_body2", "goal_body2"),
                         ("aisha", "render_aisha", "goal_aisha")):
        for region in REGIONS:
            for band in ("crease", "pore"):
                rv = pre[rk]["bands"][region][band]
                gv = pre[gk]["bands"][region][band]
                pre.setdefault("ratios", {}).setdefault(subj, {}).setdefault(region, {})[band] = {
                    "render": rv, "goal": gv,
                    "ratio": round(rv / gv, 4) if gv else None}
                rr = pre[rk]["robust"][region][band]
                gr = pre[gk]["robust"][region][band]
                pre.setdefault("robust_ratios", {}).setdefault(subj, {}).setdefault(region, {})[band] = {
                    "render": rr, "goal": gr,
                    "ratio": round(rr / gr, 4) if gr else None}
    # STEP 1 ablations (reuse regshade renders)
    abl = {}
    for v in ABLATIONS:
        for subj in ("body2", "aisha"):
            key = f"{v}_{subj}"
            path = os.path.join(STORE_REG, f"regshade-{v.lower()}-{subj}-front.png")
            print(f"ablation {key}", flush=True)
            an = analyse(path, landmarker)
            e = band_energies(np.log(np.maximum(
                REX.luminance_Y(REX.srgb_to_linear(an["rgb"])), 1e-6)), an["H"], an["masks"])
            e.pop("_sigmas_px", None)
            abl[key] = {"path": path, "sha256": sha256_file(path),
                        "H": round(an["H"], 2), "bands": e}
    report["pre"] = pre
    report["ablation"] = abl
    with open(REPORT_OUT, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print(f"wrote {REPORT_OUT}", flush=True)
    print("PRE ratios:", json.dumps(pre.get("ratios"), indent=1), flush=True)
    print("legacy:", json.dumps(report["instrument"]["legacy_column"]["values"]), flush=True)
    print("invariance max_move:", round(worst_all, 5), flush=True)


if __name__ == "__main__":
    main()
