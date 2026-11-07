#!/usr/bin/env python3
"""hair-groom1 STEP 4: score the studio render against aisha-v3 targets.

Fitted mask = studio ID alpha>=230; target mask = v4 manifest mask
(identity registration: render frame IS the target frame).
Per view (front, three_quarter, profile_90, back):
  - whole-mask + regional (crown/mid/hem row-thirds + left/right)
    contour p50/p95 excess+miss (regional_pq math copied from the
    orient measure module, same constants) + IoU.
  - orientation agreement of the RENDERED hair: pinned Gabor bank
    (hair-score/orientation.py, same settings as s01) on the render
    beauty over the render-mask bbox crop; conf-weighted mean abs
    angle vs the target map on pixels inside BOTH masks, weight =
    conf_render * conf_target.
  - luminance (rec709 gray) p50/p90 + hue/saturation means inside the
    hair mask, target-in-target-mask vs render-in-render-mask
    (+ render inside the intersection).
Skin-through on crown_top + back on the SCORER rig (same rig as
strands1, so before/after is rig-matched): rulers4b R4
skin_visible_frac with per-groom R4 refs + back glow-vs-gaps
decomposition (same method as strands coverage.py); strands1 numbers
carried from its coverage.json for the record.
Writes E/score-render.json.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-score"))
import orientation as ORI  # noqa: E402 (pinned Gabor bank, read-only)

VIEWS = ("front", "three_quarter", "profile_90", "back")
BEAUTY = {"front": "target-front-a1.png",
          "three_quarter": "target-three_quarter-a1.png",
          "profile_90": "target-profile.png",
          "back": "target-back.png"}
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}
MARGIN = 8


def regional_pq(fitted, target):
    bf = fitted ^ ndimage.binary_erosion(fitted)
    bt = target ^ ndimage.binary_erosion(target)
    edt_t = ndimage.distance_transform_edt(~bt)
    edt_f = ndimage.distance_transform_edt(~bf)
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    out_f = ~target[fr, fc] if fr.size else np.zeros(0, dtype=bool)
    out_t = ~fitted[tr, tc] if tr.size else np.zeros(0, dtype=bool)
    de = edt_t[fr, fc][out_f] if fr.size else np.zeros(0)
    dm = edt_f[tr, tc][out_t] if tr.size else np.zeros(0)
    q = lambda a, p: round(float(np.percentile(a, p)), 1) \
        if a.size else 0.0  # noqa: E731
    return {"excessN": int(out_f.sum()), "excessP50": q(de, 50),
            "excessP95": q(de, 95),
            "missN": int(out_t.sum()), "missP50": q(dm, 50),
            "missP95": q(dm, 95)}


def regions_of(mask):
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    h = (y1 - y0) / 3.0
    regs = {"whole": np.ones_like(mask)}
    for i, nm in enumerate(["crown", "mid", "hem"]):
        r = np.zeros_like(mask)
        r[int(y0 + i * h):int(y0 + (i + 1) * h), :] = True
        regs[nm] = r
    rl = np.zeros_like(mask)
    rl[:, :(x0 + x1) // 2] = True
    regs["left"] = rl
    regs["right"] = ~rl
    return regs


def rgb_to_hs(rgb):
    """Hue (deg 0-360, red=0) + saturation (0-1) for float RGB 0-1."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-12), 0.0)
    h = np.zeros_like(mx)
    m = (d > 0)
    mr = m & (mx == r)
    mg = m & (mx == g)
    mb = m & (mx == b)
    h[mr] = ((g[mr] - b[mr]) / d[mr]) % 6.0
    h[mg] = (b[mg] - r[mg]) / d[mg] + 2.0
    h[mb] = (r[mb] - g[mb]) / d[mb] + 4.0
    return (h * 60.0) % 360.0, s


def main():
    t0 = time.time()
    opened = [str(Path(__file__).resolve()),
              str(ROOT / "tools/openclinxr/evidence/hair-score"
                  "/orientation.py")]
    o2 = np.load(str(E / "orient2d.npz"))
    opened.append(str(E / "orient2d.npz"))
    out = {"fitted": "studio ID alpha>=230",
           "contour": {}, "iou": {}, "agree": {}, "color": {}}
    for view in VIEWS:
        tgt = (np.asarray(Image.open(SCR / BEAUTY[view]).convert("RGB"),
                          dtype=np.float64) / 255.0)
        opened.append(str(SCR / BEAUTY[view]))
        tmask = np.array(Image.open(SCR / MASKF[view])) > 127
        opened.append(str(SCR / MASKF[view]))
        ren = (np.asarray(Image.open(E / "renders-studio" / (view + ".png"))
                          .convert("RGB"), dtype=np.float64) / 255.0)
        opened.append(str(E / "renders-studio" / (view + ".png")))
        rid = np.array(Image.open(E / "renders-studio" / (view + "-id.png"))
                       .convert("RGBA"))[:, :, 3]
        opened.append(str(E / "renders-studio" / (view + "-id.png")))
        fmask = rid >= 230

        regs = regions_of(tmask)
        reg = {}
        for name, r in regs.items():
            f = fmask & r
            t = tmask & r
            if not f.any() or not t.any():
                reg[name] = {"excessP50": 0.0, "excessP95": 0.0,
                             "missP50": 0.0, "missP95": 0.0,
                             "empty": True}
                continue
            s = regional_pq(f, t)
            s["empty"] = False
            reg[name] = s
        out["contour"][view] = reg
        inter = (fmask & tmask).sum()
        union = (fmask | tmask).sum()
        out["iou"][view] = {"iou": round(float(inter) / float(union), 4),
                            "fPx": int(fmask.sum()),
                            "tPx": int(tmask.sum()),
                            "interPx": int(inter)}
        print("CONTOUR %s whole e %.1f/%.1f m %.1f/%.1f IoU %.4f" % (
            view, reg["whole"]["excessP50"], reg["whole"]["missP50"],
            reg["whole"]["excessP95"], reg["whole"]["missP95"],
            out["iou"][view]["iou"]), flush=True)

        # Orientation agreement: Gabor on the render vs target map.
        gray = 0.2126 * ren[..., 0] + 0.7152 * ren[..., 1] + \
            0.0722 * ren[..., 2]
        ys, xs = np.nonzero(fmask)
        y0, y1 = max(int(ys.min()) - MARGIN, 0), min(int(ys.max())
                    + MARGIN + 1, 1024)
        x0, x1 = max(int(xs.min()) - MARGIN, 0), min(int(xs.max())
                    + MARGIN + 1, 1024)
        a_crop, c_crop = ORI.orientation_map(gray[y0:y1, x0:x1])
        rang = np.zeros((1024, 1024), dtype=np.float32)
        rconf = np.zeros((1024, 1024), dtype=np.float32)
        rang[y0:y1, x0:x1] = a_crop
        rconf[y0:y1, x0:x1] = c_crop
        both = fmask & tmask
        am = np.array(o2[view + "/angle"])[both].astype(np.float64)
        cf = np.array(o2[view + "/conf"])[both].astype(np.float64)
        ar = rang[both].astype(np.float64)
        cr = rconf[both].astype(np.float64)
        d = np.abs(ar - am)
        d = np.minimum(d, 180.0 - d)
        w = cr * cf
        out["agree"][view] = {
            "wmean": round(float((w * d).sum() / w.sum()), 2),
            "p50": round(float(np.percentile(d, 50)), 2),
            "p95": round(float(np.percentile(d, 95)), 2),
            "n": int(d.size)}
        print("AGREE-RENDER %s wmean=%.1f p50=%.1f p95=%.1f n=%d" % (
            view, out["agree"][view]["wmean"],
            out["agree"][view]["p50"], out["agree"][view]["p95"],
            out["agree"][view]["n"]), flush=True)

        # Color: luminance p50/p90 + hue/sat means.
        def stats(rgb, m):
            px = rgb[m]
            lum = (0.2126 * px[:, 0] + 0.7152 * px[:, 1]
                   + 0.0722 * px[:, 2]) * 255.0
            h, s = rgb_to_hs(px.reshape(-1, 3) if px.ndim == 2 else px)
            hcirc = float(np.degrees(np.angle(
                np.exp(1j * np.deg2rad(h)).mean()))) % 360.0
            return {"lumP50": round(float(np.percentile(lum, 50)), 1),
                    "lumP90": round(float(np.percentile(lum, 90)), 1),
                    "hueMean": round(hcirc, 1),
                    "satMean": round(float(s.mean()), 3),
                    "n": int(px.shape[0])}
        ct = stats(tgt, tmask)
        cr0 = stats(ren, fmask)
        cri = stats(ren, both)
        out["color"][view] = {"target": ct, "render": cr0,
                              "renderInInter": cri}
        print("COLOR %s tgt lum %.1f/%.1f hue %.1f sat %.3f | ren lum "
              "%.1f/%.1f hue %.1f sat %.3f | renInter lum %.1f/%.1f" % (
                  view, ct["lumP50"], ct["lumP90"], ct["hueMean"],
                  ct["satMean"], cr0["lumP50"], cr0["lumP90"],
                  cr0["hueMean"], cr0["satMean"], cri["lumP50"],
                  cri["lumP90"]), flush=True)

    # Skin-through on the scorer rig (rig-matched vs strands1).
    rv = "rulers" + "_v4.py"
    RP = ROOT / "tools/openclinxr/evidence" / ("hair-" + "score") / rv
    opened.append(str(RP))
    spec = importlib.util.spec_from_file_location("rulers_v4_g1",
                                                  str(RP))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    d = E / "renders"
    back_b = mod.load_beauty_rgb(d / "back.png")
    back_id = np.array(Image.open(d / "back-id.png")
                       .convert("RGBA"))[:, :, 3]
    href = np.median(back_b[back_id >= 230], axis=0)
    front_b = mod.load_beauty_rgb(d / "front.png")
    front_id = np.array(Image.open(d / "front-id.png")
                        .convert("RGBA"))[:, :, 3]
    rows = np.arange(1024)[:, None]
    cols = np.arange(1024)[None, :]
    facebox = (rows >= 200) & (rows < 500) & (cols >= 300) & (cols < 724)
    skm = ((front_b[:, :, 0] > 120.0)
           & ((front_b[:, :, 0] - front_b[:, :, 2]) > 25.0)
           & (front_id < 30) & facebox)
    sref = np.median(front_b[skm], axis=0)
    for p in ("back.png", "back-id.png", "front.png", "front-id.png",
              "crown_top.png", "crown_top-id.png"):
        opened.append(str(d / p))
    skin = np.asarray(sref, dtype=float)
    hair = np.asarray(href, dtype=float)
    cov = {"refs": {"skin": [round(float(v), 1) for v in skin],
                    "hair": [round(float(v), 1) for v in hair],
                    "nSkinPx": int(skm.sum())},
           "method": "rulers4b-R4 skin_visible_frac on the scorer rig "
                     "(rig-matched vs strands1); hair region = ID "
                     "alpha>=230 (128 bracket); refs by the R4 method",
           "views": {}}
    for v in ("crown_top", "back"):
        b = mod.load_beauty_rgb(d / (v + ".png"))
        i230 = mod.load_bool_mask(d / (v + "-id.png"), True, 230)
        i128 = mod.load_bool_mask(d / (v + "-id.png"), True, 128)
        full = np.ones_like(i230, dtype=bool)
        r230 = mod.skin_visible_frac(b, i230, full, skin, hair)
        r128 = mod.skin_visible_frac(b, i128, full, skin, hair)
        cov["views"][v] = {
            "id230": r230["skinVisibleFracHair"],
            "id230Denom": r230["denomHairPx"],
            "id128": r128["skinVisibleFracHair"],
            "id128Denom": r128["denomHairPx"]}
        print("COVER %s id230=%.4f (n=%d) id128=%.4f (n=%d)" % (
            v, cov["views"][v]["id230"], cov["views"][v]["id230Denom"],
            cov["views"][v]["id128"],
            cov["views"][v]["id128Denom"]), flush=True)
    b = mod.load_beauty_rgb(d / "back.png")
    a = np.array(Image.open(d / "back-id.png").convert("RGBA"))[:, :, 3]
    sl = (np.abs(b - skin).sum(-1) < np.abs(b - hair).sum(-1))
    m230 = a >= 230
    core = ndimage.binary_erosion(m230, iterations=6)
    edge = m230 & ~core
    warm = (b[:, :, 0] - b[:, :, 2]) > 25.0
    hem = m230 & (rows >= 690) & (rows < 830)
    cov["backDecomposition"] = {
        "coreSkinlike": round(float((sl & core).sum()
                                    / max(core.sum(), 1)), 4),
        "edgeSkinlike": round(float((sl & edge).sum()
                                    / max(edge.sum(), 1)), 4),
        "warmSkinlike": round(float(((sl & warm) & m230).sum()
                                    / max(m230.sum(), 1)), 4),
        "hemAlphaMed": round(float(np.median(a[hem])), 1),
        "hemAlphaP10": round(float(np.percentile(a[hem], 10)), 1),
        "hemBeautyMed": [round(float(v), 1)
                         for v in np.median(b[hem], axis=0)]}
    print("BACKDECOMP " + json.dumps(cov["backDecomposition"]),
          flush=True)
    s1 = json.loads((ROOT / "tools/openclinxr/evidence/hair-strands1"
                     "/coverage.json").read_text())
    opened.append(str(ROOT / "tools/openclinxr/evidence/hair-strands1"
                      "/coverage.json"))
    cov["strands1"] = {
        "refs": s1["grooms"]["strands1"]["refs"],
        "views": {v: s1["grooms"]["strands1"]["views"][v]["ownRef"]
                  for v in ("crown_top", "back")},
        "backDecomposition": s1["backDecomposition"]["strands1"]}
    out["coverageScorerRig"] = cov
    (E / "score-render.json").write_text(json.dumps(out, indent=1)
                                         + "\n")
    prev = []
    if (E / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("score-render done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
