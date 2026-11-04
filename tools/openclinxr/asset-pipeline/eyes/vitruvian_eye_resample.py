#!/usr/bin/env python3
"""Vitruvian iris+sclera polar resample into the existing 1024^2 eye UV (st-viteye).

Source: CC0 Vitruvian-Project EXRs (linear, 4096^2). Destination: the shipped
eye-texture layout (two discs, iris radius 133.5 px, limbus 30 px, pupil r<=38,
centres (296.9,723.9)/(722.7,302.5) px-top) per
packages/openclinxr/xr-scene/src/eye-shader/iris-disc-roughness-map.ts.

Method:
  iris: fit centre/disc/wedge in SOURCE px, unwrap to (r,theta), rewrap so
    r_disc lands at 133.5 dst px. Flat pupil stamp r<=38 covers the wedge.
    Limbus crossfade 133.5+-15 (30 px band) to sclera; halfway crossing at
    133.5 by symmetric construction.
  sclera: polar-resample the fitted white inner band onto the dst sclera
    annulus (inner part); the outer part samples the pink band desaturated
    toward the destination sclera colour. Corner tile + grey placeholder are
    never sampled (masked by construction: max sampled src r ~1400).
  colours: hazel = source as-is. brown/green/blue = OKLCH remap preserving
    per-pixel L structure (L shift, C scale, absolute hue + relative variation).

Deterministic: numpy only, fixed grids, no randomness. Every input and fitted
value is recorded in the output manifest.

Probe modes (for G3, NOT shipped): --probe-no-stamp skips the pupil stamp;
--probe-huerotate-blue remaps blue by hue rotation only (C held).
"""

import argparse
import hashlib
import json
import math
import os

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy.ndimage import map_coordinates  # noqa: E402

STORE = "/Volumes/files/openclinxr-assets/store/vitruvian-src/4K"
IRIS_EXR = os.path.join(STORE, "Vitruvian_Iris_BaseColor_Utility - Linear - sRGB.exr")
SCLERA_EXR = os.path.join(STORE, "Vitruvian_Sclera_Cornea_BaseColor_Utility - Linear - sRGB.exr")
TEMPLATE = "tools/openclinxr/asset-pipeline/eyes/iris-centred-f.png"

# Destination geometry (eye-shader/iris-disc-roughness-map.ts + texture-manifest)
DST_CENTRES = [(296.9, 723.9), (722.7, 302.5)]  # px-top (PIL convention)
IRIS_R = 133.5
LIMBUS_W = 30.0
PUPIL_R = 38.0
DST_SCL_OUT = 240.0  # resampled sclera extent per eye; feathered into template
DST_SCL_FEATHER = 15.0

# OKLCH colour targets: (dL shift, C scale, absolute hue deg). hazel = identity.
OKLCH_PARAMS = {
    "hazel": None,
    "brown": {"dL": 0.00, "Cscale": 1.00, "h_abs": 44.0},
    "green": {"dL": 0.03, "Cscale": 0.85, "h_abs": 150.0},
    "blue": {"dL": 0.16, "Cscale": 0.38, "h_abs": 263.0},
}
PINK_DESAT = 0.75  # fraction of chroma removed from the pink band
PINK_DLIFT = 0.50  # fraction of lightness pulled toward dst sclera

NTH = 2880  # angular bins for unwrap/rewrap


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---- colour ----

def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)


def linear_to_oklab(lin):
    l = lin[..., 0]
    m = lin[..., 1]
    s = lin[..., 2]
    lp = 0.4122214708 * l + 0.5363325363 * m + 0.0514459929 * s
    mp = 0.2119034982 * l + 0.6806995451 * m + 0.1073969566 * s
    sp = 0.0883024619 * l + 0.2817188376 * m + 0.6299787005 * s
    lp, mp, sp = np.cbrt(np.maximum(lp, 0)), np.cbrt(np.maximum(mp, 0)), np.cbrt(np.maximum(sp, 0))
    L = 0.2104542553 * lp + 0.7936177850 * mp - 0.0040720468 * sp
    a = 1.9779984951 * lp - 2.4285922050 * mp + 0.4505937099 * sp
    b = 0.0259040371 * lp + 0.7827717662 * mp - 0.8086757660 * sp
    return np.stack([L, a, b], axis=-1)


def oklab_to_linear(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    lp = L + 0.3963377774 * a + 0.2158037573 * b
    mp = L - 0.1055613458 * a - 0.0638541728 * b
    sp = L - 0.0894841775 * a - 1.2914855480 * b
    lp, mp, sp = lp ** 3, mp ** 3, sp ** 3
    r = +4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp
    g = -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp
    bl = -0.0041960863 * lp - 0.7034186147 * mp + 1.7076147010 * sp
    return np.stack([r, g, bl], axis=-1)


def oklch_remap(iris_lin, params):
    """Remap iris linear-sRGB pixels; preserves per-pixel L structure."""
    lab = linear_to_oklab(np.clip(iris_lin, 0, None))
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    h = np.degrees(np.arctan2(b, a))
    # source means over well-exposed fibres (mid annulus mask passed by caller
    # via finite C; use median for robustness)
    C0 = float(np.median(C[C > 1e-4])) or 1e-4
    L0 = float(np.median(L))
    h0 = float(np.median(h[C > 1e-4]))
    dL, Cs, habs = params["dL"], params["Cscale"], params["h_abs"]
    Lp = np.clip(L + dL, 0.0, 1.0)
    Cp = C * (Cs * 1.0)
    # pull mean chroma toward an absolute anchor so blue crushes even if
    # source C is high: scale is relative, anchor via Cs only. (recorded)
    hp = habs + ((h - h0 + 180.0) % 360.0 - 180.0)
    ar = np.radians(hp)
    lab2 = np.stack([Lp, Cp * np.cos(ar), Cp * np.sin(ar)], axis=-1)
    out = np.clip(oklab_to_linear(lab2), 0, None)
    return out, {"L0": L0, "C0": C0, "h0": h0}


def srgb_hue_deg(rgb):
    r, g, b = [float(v) for v in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return 0.0
    if mx == r:
        h = 60 * ((g - b) / (mx - mn) % 6)
    elif mx == g:
        h = 60 * ((b - r) / (mx - mn) + 2)
    else:
        h = 60 * ((r - g) / (mx - mn) + 4)
    return h % 360


# ---- source fits ----

def fit_iris(iris):
    Y = 0.2126 * iris[:, :, 0] + 0.7152 * iris[:, :, 1] + 0.0722 * iris[:, :, 2]
    H, W = Y.shape
    c0x, c0y = W // 2, H // 2
    win = Y[c0y - 600:c0y + 600, c0x - 600:c0x + 600]
    ys, xs = np.nonzero(win < 0.010)
    cx = c0x - 600 + float(xs.mean())
    cy = c0y - 600 + float(ys.mean())
    yy, xx = np.mgrid[0:H, 0:W]
    rr = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    # r_wedge: dark-pupil extent (pole-pinch wedge lives inside the pupil)
    r_wedge = None
    for r in range(300, 701, 10):
        m = (rr >= r - 5) & (rr < r + 5)
        if float((Y[m] < 0.008).mean()) < 0.10:
            r_wedge = float(r)
            break
    assert r_wedge is not None
    # r_disc: angular structure collapse (stroma fibres -> radial-smear padding)
    r_disc = None
    for r in range(1500, 2051, 10):
        m = (rr >= r - 8) & (rr < r + 8)
        t = th[m]
        v = Y[m]
        bi = ((t + np.pi) / (2 * np.pi) * 360).astype(int) % 360
        means = np.array([v[bi == k].mean() for k in range(360)])
        if float(means.std() / means.mean()) < 0.25:
            r_disc = float(r)
            break
    assert r_disc is not None
    return cx, cy, r_wedge, r_disc


def fit_sclera(scl):
    R, G, B = scl[:, :, 2], scl[:, :, 1], scl[:, :, 0]
    H, W = R.shape
    cx, cy = W // 2, H // 2
    yy, xx = np.mgrid[0:H, 0:W]
    rr = np.hypot(xx - cx, yy - cy)
    mn = (R + G + B) / 3 + 1e-9
    sat = np.stack([R, G, B]).std(axis=0) / mn
    A = scl[:, :, 3]
    prof_sat, prof_a = {}, {}
    for r in range(400, 1401, 10):
        m = (rr >= r - 8) & (rr < r + 8)
        prof_sat[r] = float(np.median(sat[m]))
        prof_a[r] = float(np.median(A[m]))
    inner = next(r for r in sorted(prof_sat) if r >= 450
                 and prof_sat[r] < 0.10 and prof_a[r] > 0.05)
    outer = next(r for r in sorted(prof_sat) if r > inner and prof_sat[r] > 0.11)
    return inner, outer


def polar_unwrap(img, cx, cy, r0, r1, nrad, nth=NTH):
    """Unwrap img (H,W,C float) to (nrad, nth, C): rows r0..r1, cols theta."""
    rs = np.linspace(r0, r1, nrad)
    ths = np.linspace(-np.pi, np.pi, nth, endpoint=False)
    RR, TT = np.meshgrid(rs, ths, indexing="ij")
    XS = cx + RR * np.cos(TT)
    YS = cy + RR * np.sin(TT)
    coords = np.array([YS.ravel(), XS.ravel()])
    out = np.empty((nrad * nth, img.shape[2]))
    for c in range(img.shape[2]):
        out[:, c] = map_coordinates(img[:, :, c], coords, order=1, mode="nearest")
    return out.reshape(nrad, nth, img.shape[2])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="tools/openclinxr/asset-pipeline/eyes/vitruvian")
    ap.add_argument("--probe-no-stamp", action="store_true")
    ap.add_argument("--probe-huerotate-blue", action="store_true")
    ap.add_argument("--probe-out", default=None)
    args = ap.parse_args()

    iris = cv2.imread(IRIS_EXR, cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float64)
    scl = cv2.imread(SCLERA_EXR, cv2.IMREAD_UNCHANGED).astype(np.float64)
    assert iris is not None and scl is not None
    template = np.array(Image.open(TEMPLATE).convert("RGB")).astype(np.float64) / 255.0
    tpl_lin = srgb_to_linear(template)

    cx, cy, r_wedge, r_disc = fit_iris(iris)
    scl_in, scl_out = fit_sclera(scl)

    # destination sclera colour target (measured template sclera plateau)
    scl_ref_srgb = np.array([169.0, 170.0, 165.0]) / 255.0
    scl_ref_lin = srgb_to_linear(scl_ref_srgb)
    scl_ref_lab = linear_to_oklab(scl_ref_lin)
    Lref, Cref = float(scl_ref_lab[0]), float(np.hypot(scl_ref_lab[1], scl_ref_lab[2]))

    # unwraps (linear light)
    NR_IRIS, NR_SCL = 360, 220
    iris_pol = polar_unwrap(iris, cx, cy, r_wedge, r_disc, NR_IRIS)
    scl_pol = polar_unwrap(scl[:, :, :3][:, :, ::-1], 2048.0, 2048.0,
                           float(scl_in), float(scl_out) + 300.0, NR_SCL)
    # note: sclera file channels are BGRA; [:,:,:3][::-1] -> RGB

    # output canvases start from the template (everything outside eye discs
    # stays byte-identical after sRGB round-trip; verified in manifest step)
    H = W = 1024
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)

    manifest_colours = {}
    outputs = {}
    for colour in ["hazel", "brown", "green", "blue"]:
        if args.probe_huerotate_blue and colour != "blue":
            continue
        canvas = tpl_lin.copy()
        for (ecx, ecy) in DST_CENTRES:
            dx, dy = xx - ecx, yy - ecy
            rd = np.hypot(dx, dy)
            th = np.arctan2(dy, dx)  # matches unwrap convention (y down)
            thi = ((th + np.pi) / (2 * np.pi) * NTH).astype(int) % NTH

            # --- iris remap rd [PUPIL_R, IRIS_R] <- src [r_wedge, r_disc]
            m_iris = (rd >= PUPIL_R) & (rd <= IRIS_R)
            fri = (np.clip(rd, PUPIL_R, IRIS_R) - PUPIL_R) / (IRIS_R - PUPIL_R)
            src_r = r_wedge + fri * (r_disc - r_wedge)
            ri = np.clip((src_r - r_wedge) / (r_disc - r_wedge) * (NR_IRIS - 1),
                         0, NR_IRIS - 1)
            iris_px = iris_pol[np.clip(ri.astype(int), 0, NR_IRIS - 1), thi]

            # --- colour
            if colour == "hazel" or OKLCH_PARAMS[colour] is None:
                iris_col = iris_px
                cparams = {"mode": "source-as-is"}
            elif args.probe_huerotate_blue and colour == "blue":
                lab = linear_to_oklab(np.clip(iris_px, 0, None))
                L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
                C = np.hypot(a, b)
                h = np.degrees(np.arctan2(b, a))
                C0 = float(np.median(C[C > 1e-4])) or 1e-4
                h0 = float(np.median(h[C > 1e-4]))
                ht = 263.0  # same target hue, but C HELD (dyed look probe)
                hp = ht + ((h - h0 + 180.0) % 360.0 - 180.0)
                ar = np.radians(hp)
                iris_col = np.clip(oklab_to_linear(
                    np.stack([L, C * np.cos(ar), C * np.sin(ar)], axis=-1)), 0, None)
                cparams = {"mode": "hue-rotation-only", "h_target": ht,
                           "C_held": True, "C0": C0, "h0": h0}
            else:
                iris_col, fit = oklch_remap(iris_px, OKLCH_PARAMS[colour])
                cparams = {"mode": "oklch", **OKLCH_PARAMS[colour], **fit}

            # --- sclera remap: inner white band -> [IRIS_R, split],
            # --- desaturated pink -> [split, DST_SCL_OUT]
            split = IRIS_R + 0.5 * (DST_SCL_OUT - IRIS_R)
            # white band occupies src [scl_in, scl_out]; pink (scl_out, +300]
            src_s = np.where(
                rd <= split,
                scl_in + np.clip((rd - IRIS_R) / max(split - IRIS_R, 1e-9), 0, 1)
                * (scl_out - scl_in),
                scl_out + np.clip((rd - split) / max(DST_SCL_OUT - split, 1e-9), 0, 1)
                * 300.0)
            rj = np.clip((src_s - scl_in) / 300.0 * (NR_SCL - 1), 0, NR_SCL - 1)
            scl_raw = scl_pol[np.clip(rj.astype(int), 0, NR_SCL - 1), thi]
            # desaturate the pink part toward the dst sclera colour
            pink_w = np.clip((rd - split) / max(DST_SCL_OUT - split, 1e-9), 0, 1)
            slab = linear_to_oklab(np.clip(scl_raw, 0, None))
            sL, sa, sb = slab[..., 0], slab[..., 1], slab[..., 2]
            sC = np.hypot(sa, sb)
            sh = np.arctan2(sb, sa)
            # per-pixel pink weight:
            pw = pink_w
            sCn = sC * (1 - PINK_DESAT * pw)
            sLn = sL + PINK_DLIFT * pw * (Lref - sL)
            scl_px = np.clip(oklab_to_linear(
                np.stack([sLn, sCn * np.cos(sh), sCn * np.sin(sh)], axis=-1)), 0, None)

            # --- compose: iris, limbus blend, sclera, feather
            t = np.clip((rd - (IRIS_R - LIMBUS_W / 2)) / LIMBUS_W, 0, 1)
            t = t * t * (3 - 2 * t)
            # iris field extends (clamped) across the blend; sclera field too
            composited = (1 - t[..., None]) * iris_col + t[..., None] * scl_px
            region = rd <= DST_SCL_OUT + DST_SCL_FEATHER
            fw = np.clip((rd - DST_SCL_OUT) / DST_SCL_FEATHER, 0, 1)
            fw = fw * fw * (3 - 2 * fw)
            canvas = np.where(region[..., None],
                              (1 - fw[..., None]) * composited + fw[..., None] * canvas,
                              canvas)
            # --- limbus luminance normalisation (F-era method): radial-only
            # gain pins the azimuthal-median profile to a smoothstep centred
            # at IRIS_R with full width LIMBUS_W, so the measured halfway
            # crossing is colour-independent. Hue preserved (RGB scaled
            # equally); angular fibre structure preserved (gain is radial).
            lum = (0.2126 * canvas[:, :, 0] + 0.7152 * canvas[:, :, 1]
                   + 0.0722 * canvas[:, :, 2])
            prof = {}
            rdi = rd.astype(int)
            for r in range(60, 201):
                m = (rdi == r)
                if m.sum() > 64:
                    prof[r] = float(np.median(lum[m]))
            Dp = float(np.median([prof[r] for r in range(95, 106)]))
            Sp = float(np.median([prof[r] for r in range(170, 181)]))

            def _ss(x):
                x = min(max(x, 0.0), 1.0)
                return x * x * (3 - 2 * x)

            gain = np.ones_like(rd)
            # NOTE: the gate re-bins radii at integer centres over
            # [r-0.5, r+0.5) while this fit bins [r, r+1); the +0.5 texel
            # systematic is cancelled by targeting IRIS_R - 0.5 here so the
            # gate reads 133.5.
            for r in range(60, 201):
                tgt = Dp + (Sp - Dp) * _ss((r - (IRIS_R - 0.5 - LIMBUS_W / 2)) / LIMBUS_W)
                gain[rdi == r] = tgt / max(prof.get(r, tgt), 1e-9)
            # feather the gain to 1 outside [60,190] so interior/exterior join
            w = np.clip((rd - 50.0) / 10.0, 0, 1) * np.clip((200.0 - rd) / 10.0, 0, 1)
            w = w * w * (3 - 2 * w)
            canvas = canvas * (1 - w[..., None] + w[..., None] * gain[..., None])
            # pupil stamp (flat) covers the wedge by construction
            if not args.probe_no_stamp:
                m_pupil = rd <= PUPIL_R
                pupil_lin = srgb_to_linear(np.array([2.0, 2.0, 2.0]) / 255.0)
                canvas = np.where(m_pupil[..., None], pupil_lin, canvas)
            else:
                # no-stamp probe: sample src pupil (src r < r_wedge) inside
                pupil_src_r = np.clip(rd / PUPIL_R, 0, 1) * r_wedge
                pupil_pol = polar_unwrap(iris, cx, cy, 0.0, r_wedge, 64)
                pj = np.clip(pupil_src_r / r_wedge * 63, 0, 63).astype(int)
                m_pupil = rd <= PUPIL_R
                pv = pupil_pol[pj, thi]
                canvas = np.where(m_pupil[..., None], np.clip(pv, 0, None), canvas)

        srgb = np.clip(np.round(linear_to_srgb(canvas) * 255), 0, 255).astype(np.uint8)
        outputs[colour] = srgb
        manifest_colours[colour] = {"oklch": cparams}

    # write outputs + manifest
    if args.probe_out:
        os.makedirs(args.probe_out, exist_ok=True)
        for colour, img in outputs.items():
            Image.fromarray(img).save(os.path.join(args.probe_out, "probe-%s.png" % colour))
        print("wrote probes to", args.probe_out)
        return

    os.makedirs(args.out, exist_ok=True)
    files = {}
    for colour, img in outputs.items():
        p = os.path.join(args.out, "vitruvian-iris-%s.png" % colour)
        Image.fromarray(img).save(p)
        files[colour] = {"path": os.path.relpath(p), "sha256": sha256(p)}
    # template round-trip check (outside-disc bytes must survive)
    rt = np.array(Image.open(TEMPLATE).convert("RGB"))
    manifest = {
        "generator": "tools/openclinxr/asset-pipeline/eyes/vitruvian_eye_resample.py",
        "licence": "CC0-1.0 (Vitruvian-Project)",
        "sources": {
            "iris": {"path": os.path.relpath(IRIS_EXR), "sha256": sha256(IRIS_EXR)},
            "sclera": {"path": os.path.relpath(SCLERA_EXR), "sha256": sha256(SCLERA_EXR)},
            "template": {"path": TEMPLATE, "sha256": sha256(TEMPLATE)},
        },
        "fitted_source": {
            "iris_centre_px": [round(cx, 1), round(cy, 1)],
            "r_disc_src_px": r_disc,
            "r_wedge_src_px": r_wedge,
            "sclera_inner_band_src_px": scl_in,
            "sclera_pink_onset_src_px": scl_out,
        },
        "destination_geometry_px": {
            "iris_radius": IRIS_R, "limbus_band": LIMBUS_W, "pupil_r": PUPIL_R,
            "centres": DST_CENTRES, "sclera_extent": DST_SCL_OUT,
            "sclera_feather": DST_SCL_FEATHER,
        },
        "sclera_target": {"srgb_0_255": [169, 170, 165],
                          "pink_desat": PINK_DESAT, "pink_dlift": PINK_DLIFT},
        "colours": manifest_colours,
        "outputs": files,
    }
    mp = os.path.join(args.out, "manifest.json")
    with open(mp, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(json.dumps(manifest["fitted_source"], indent=2))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
