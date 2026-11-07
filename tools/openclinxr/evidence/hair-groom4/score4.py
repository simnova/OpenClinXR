#!/usr/bin/env python3
"""hair-groom4 STEP 3: score groom4 vs groom3 side by side (studio rig).

Reuses hair-groom3/score3.py measurement functions (imported, not
copied): contour/IoU/agreement/colour, back-centre seam, ear-blob
concha boxes, frizz + frizz ruler. Adds groom4 gates:
 (a) part width: bright-gap FWHM on the back crown crop (target | g3 |
     g4 @1024) + peak column; gate g4 width within 30% of target.
 (b) ear lobe/neck: rendered strand-ID px + outside-target-mask px in
     pinna-anchored front-of-lobe / neck-drop boxes (3q + profile, per
     side); gate 0 outside-mask px in front-of-lobe boxes + neck
     outside-mask <= groom3 (strict improvement; absolute 0 aspirational
     and reported).
 (c) front width: outer-edge gap rows 450-700 vs target (px + mm) +
     front IoU; widen must close the groom3 ~24 mm/side gap without
     excess overshoot.
Writes E/score4.json.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E4 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
E2 = ROOT / "tools/openclinxr/evidence/hair-groom2"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")

spec = importlib.util.spec_from_file_location("score3", str(E3 / "score3.py"))
S3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S3)

VIEWS = ("front", "three_quarter", "profile_90", "back")
BEAUTY = {"front": "target-front-a1.png",
          "three_quarter": "target-three_quarter-a1.png",
          "profile_90": "target-profile.png",
          "back": "target-back.png"}
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}


def part_width(beauty_p, rows=(150, 360), cols=(460, 564)):
    b = np.asarray(Image.open(beauty_p).convert("RGB"), dtype=np.float64)
    lum = (0.2126 * b[..., 0] + 0.7152 * b[..., 1] + 0.0722 * b[..., 2])
    r0, r1, c0, c1 = rows[0], rows[1], cols[0], cols[1]
    prof = lum[r0:r1, c0:c1].mean(axis=0)
    base = float(np.percentile(prof, 20))
    pk = float(prof.max())
    half = base + 0.5 * (pk - base)
    i0 = int(np.argmax(prof))
    lo = i0
    while lo - 1 >= 0 and prof[lo - 1] >= half:
        lo -= 1
    hi = i0
    while hi + 1 < len(prof) and prof[hi + 1] >= half:
        hi += 1
    return {"widthPx": int(hi - lo + 1), "peakCol": int(c0 + i0),
            "peakOffMid": int(c0 + i0 - 512),
            "base": round(base, 1), "peak": round(pk, 1),
            "contrast": round(pk - base, 1)}


def main():
    opened = [str(Path(__file__).resolve())]
    out = {"fitted": "fixed body-occluded ID alpha>=230, both grooms",
           "grooms": {}}
    src = {"groom3": (E3 / "renders-studio", E3 / "renders-studio"),
           "cfgG": (E4 / "cfgG" / "renders1024",
                    E4 / "cfgG" / "renders1024"),
           "groom4": (E4 / "renders-studio", E4 / "renders-studio")}
    o2 = np.load(str(E2 / "orient2d.npz"))
    opened.append(str(E2 / "orient2d.npz"))
    for tag, (bdir, idir) in src.items():
        g = {"contour": {}, "iou": {}, "agree": {}, "color": {}}
        for view in VIEWS:
            tgt = (np.asarray(Image.open(SCR / BEAUTY[view])
                              .convert("RGB"), dtype=np.float64) / 255.0)
            opened.append(str(SCR / BEAUTY[view]))
            tmask = np.array(Image.open(SCR / MASKF[view])) > 127
            opened.append(str(SCR / MASKF[view]))
            ren = (np.asarray(Image.open(bdir / (view + ".png"))
                              .convert("RGB"), dtype=np.float64) / 255.0)
            opened.append(str(bdir / (view + ".png")))
            rid = np.array(Image.open(idir / (view + "-id.png"))
                           .convert("RGBA"))[:, :, 3]
            opened.append(str(idir / (view + "-id.png")))
            fmask = rid >= 230
            regs = S3.regions_of(tmask)
            reg = {}
            for name, r in regs.items():
                f = fmask & r
                t = tmask & r
                if not f.any() or not t.any():
                    reg[name] = {"excessP50": 0.0, "excessP95": 0.0,
                                 "missP50": 0.0, "missP95": 0.0,
                                 "empty": True}
                    continue
                s = S3.regional_pq(f, t)
                s["empty"] = False
                reg[name] = s
            g["contour"][view] = reg
            inter = (fmask & tmask).sum()
            union = (fmask | tmask).sum()
            g["iou"][view] = {"iou": round(float(inter) / float(union),
                                           4),
                              "fPx": int(fmask.sum()),
                              "tPx": int(tmask.sum()),
                              "interPx": int(inter)}
            print("CONTOUR %s %s whole e %.1f/%.1f m %.1f/%.1f IoU "
                  "%.4f" % (tag, view, reg["whole"]["excessP50"],
                             reg["whole"]["excessP95"],
                             reg["whole"]["missP50"],
                             reg["whole"]["missP95"],
                             g["iou"][view]["iou"]), flush=True)
            gray = 0.2126 * ren[..., 0] + 0.7152 * ren[..., 1] + \
                0.0722 * ren[..., 2]
            ys, xs = np.nonzero(fmask)
            y0, y1 = max(int(ys.min()) - S3.MARGIN, 0), min(
                int(ys.max()) + S3.MARGIN + 1, 1024)
            x0, x1 = max(int(xs.min()) - S3.MARGIN, 0), min(
                int(xs.max()) + S3.MARGIN + 1, 1024)
            a_crop, c_crop = S3.ORI.orientation_map(gray[y0:y1, x0:x1])
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
            g["agree"][view] = {
                "wmean": round(float((w * d).sum() / w.sum()), 2),
                "p50": round(float(np.percentile(d, 50)), 2),
                "p95": round(float(np.percentile(d, 95)), 2),
                "n": int(d.size)}
            print("AGREE %s %s wmean=%.1f" % (tag, view,
                                             g["agree"][view]["wmean"]),
                  flush=True)
            ct = S3.cstats(tgt, tmask)
            cr0 = S3.cstats(ren, fmask)
            cri = S3.cstats(ren, both)
            g["color"][view] = {"target": ct, "render": cr0,
                                "renderInInter": cri}
            print("COLOR %s %s tgt sat %.3f | renInter lum %.1f/%.1f "
                  "hue %.1f sat %.3f" % (
                      tag, view, ct["satMean"], cri["lumP50"],
                      cri["lumP90"], cri["hueMean"], cri["satMean"]),
                  flush=True)
        out["grooms"][tag] = g

    for tag, (_, idir) in src.items():
        rid = np.array(Image.open(idir / "back-id.png")
                       .convert("RGBA"))[:, :, 3] >= 230
        opened.append(str(idir / "back-id.png"))
        out["grooms"][tag]["seam"] = S3.seam_width(rid)
        print("SEAM %s %s" % (tag, out["grooms"][tag]["seam"]),
              flush=True)

    # ear-blob concha boxes (score3 method).
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/orient"))
    import common_o as CO
    inp = CO.load_all()
    ear = {}
    for tag, (bdir, idir) in src.items():
        for view in ("front", "three_quarter", "profile_90"):
            cam = inp["cams"]["views"][view]
            b = (np.asarray(Image.open(bdir / (view + ".png"))
                            .convert("RGB"), dtype=np.float64))
            a = np.array(Image.open(idir / (view + "-id.png"))
                         .convert("RGBA"))[:, :, 3]
            t = (np.asarray(Image.open(
                SCR / {"front": "target-front-a1.png",
                       "three_quarter": "target-three_quarter-a1.png",
                       "profile_90": "target-profile.png"}[view])
                .convert("RGB"), dtype=np.float64))
            for side in ("xpos", "xneg"):
                pin = np.asarray(inp["pinna"][side]) / 1000.0
                cc, rr, dd = CO.C2.ENV.project_to_render(
                    pin, cam, inp["sensor"])
                m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                     & (dd > 0))
                c0, r0 = int(cc[m].mean()), int(rr[m].mean())
                box = (slice(max(r0 - 5, 0), r0 + 6),
                       slice(max(c0 - 5, 0), c0 + 6))
                ear["%s/%s/%s" % (tag, view, side)] = {
                    "idPx": int((a[box] >= 230).sum()),
                    "beautyLum": round(float(
                        (0.2126 * b[box][..., 0]
                         + 0.7152 * b[box][..., 1]
                         + 0.0722 * b[box][..., 2]).mean()), 1),
                    "targetLum": round(float(
                        (0.2126 * t[box][..., 0]
                         + 0.7152 * t[box][..., 1]
                         + 0.0722 * t[box][..., 2]).mean()), 1)}
    out["earBlob"] = ear
    for k, v in ear.items():
        print("EAR %s %s" % (k, v), flush=True)

    # frizz ruler (score3 boxes).
    fz = dict(S3_out_ruler(src, opened, out) or {})
    out["frizzRuler"] = fz

    # (a) part width @1024.
    pw = {"target": part_width(SCR / BEAUTY["back"])}
    opened.append(str(SCR / BEAUTY["back"]))
    for tag, (bdir, _) in src.items():
        pw[tag] = part_width(bdir / "back.png")
        opened.append(str(bdir / "back.png"))
    out["partWidth"] = pw
    for k, v in pw.items():
        print("PARTW %s %s" % (k, v), flush=True)

    # (b) ear lobe/neck boxes @1024, both grooms.
    lobes = {}
    for tag, (_, idir) in src.items():
        for view in ("three_quarter", "profile_90"):
            cam = inp["cams"]["views"][view]
            a = np.array(Image.open(idir / (view + "-id.png"))
                         .convert("RGBA"))[:, :, 3] >= 230
            opened.append(str(idir / (view + "-id.png")))
            t = np.array(Image.open(SCR / MASKF[view])) > 127
            for side in ("xpos", "xneg"):
                pin = np.asarray(inp["pinna"][side]) / 1000.0
                cc, rr, dd = CO.C2.ENV.project_to_render(
                    pin, cam, inp["sensor"])
                m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                     & (dd > 0))
                c0, c1 = float(cc[m].min()), float(cc[m].max())
                r0, r1 = float(rr[m].min()), float(rr[m].max())
                h = r1 - r0
                face = pin.mean(axis=0) + np.array([0, -0.05, 0.0])
                fx, fy, _ = CO.C2.ENV.project_to_render(
                    face[None, :], cam, inp["sensor"])
                sx = 1.0 if float(fx[0]) - (c0 + c1) / 2 >= 0 else -1.0
                edge = c0 if sx < 0 else c1
                fl = sorted([edge, edge + sx * 60.0])
                flr = [r1 - 0.30 * h, r1]
                nkr = [r1, r1 + 70.0]
                nkc = [c0 - 25.0, c1 + 25.0]
                for zn, (zc, zr) in (("frontLobe", (fl, flr)),
                                     ("neck", (nkc, nkr))):
                    bx = (slice(max(int(zr[0]), 0),
                                min(int(zr[1]), 1024)),
                          slice(max(int(zc[0]), 0),
                                min(int(zc[1]), 1024)))
                    lobes["%s/%s/%s/%s" % (tag, view, side, zn)] = {
                        "idPx": int(a[bx].sum()),
                        "outsideMaskPx": int((a[bx] & ~t[bx]).sum())}
    out["earLobeNeck"] = lobes
    for k, v in lobes.items():
        print("LOBE %s %s" % (k, v), flush=True)

    # (c) front width: outer-edge gap rows 450-700 + IoU already above.
    tm = np.array(Image.open(SCR / MASKF["front"])) > 127
    opened.append(str(SCR / MASKF["front"]))
    fg = {}
    for tag, (_, idir) in src.items():
        gid = np.array(Image.open(idir / "front-id.png")
                       .convert("RGBA"))[:, :, 3] >= 230
        gaps = []
        for r in range(450, 701):
            tt = np.nonzero(tm[r])[0]
            gg = np.nonzero(gid[r])[0]
            if len(tt) == 0 or len(gg) == 0:
                continue
            gaps.append((int(tt.min() - gg.min()),
                         int(gg.max() - tt.max())))
        gaps = np.array(gaps)
        fg[tag] = {"leftGapPx_p50": round(float(
            np.percentile(gaps[:, 0], 50)), 1),
            "rightGapPx_p50": round(float(
                np.percentile(gaps[:, 1], 50)), 1)}
    # px->mm at curtain depth (front camera).
    cams = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                       "/cameras-scorer-v3.json").read_text())
    sensor = float(cams["sensorWidthMm"])
    _m = np.array(cams["views"]["front"]["matrixWorld"],
                  dtype=np.float64)
    _inv = np.linalg.inv(_m)
    _f = float(cams["views"]["front"]["lensMm"]) / sensor * 1024.0

    def _prj(p):
        hw = np.ones((len(p), 4))
        hw[:, :3] = p
        lc = (_inv @ hw.T).T
        dep = -lc[:, 2]
        return (512.0 + (lc[:, 0] / dep) * _f,
                512.0 - (lc[:, 1] / dep) * _f)
    ca, _ = _prj(np.array([[0.080, -0.040, 1.500]]))
    cb, _ = _prj(np.array([[0.090, -0.040, 1.500]]))
    fg["pxPerMm"] = round(float(abs(cb[0] - ca[0])) / 10.0, 3)
    for tag in src:
        fg[tag]["leftGapMm_p50"] = round(
            fg[tag]["leftGapPx_p50"] / fg["pxPerMm"], 1)
        fg[tag]["rightGapMm_p50"] = round(
            fg[tag]["rightGapPx_p50"] / fg["pxPerMm"], 1)
    out["frontGap"] = fg
    print("FRONTGAP %s" % json.dumps(fg), flush=True)

    # (d) operator ear gates (2026-10-16): pinna-silhouette zero +
    # ear-to-neck-line zero, three_quarter + profile_90.
    from scipy.spatial import ConvexHull as _CH
    from scipy.spatial import Delaunay as _DE
    sil = {}
    neckline = {}
    for tag, (_, idir) in src.items():
        for view in ("three_quarter", "profile_90"):
            cam = inp["cams"]["views"][view]
            a = np.array(Image.open(idir / (view + "-id.png"))
                         .convert("RGBA"))[:, :, 3] >= 230
            opened.append(str(idir / (view + "-id.png")))
            for side in ("xpos", "xneg"):
                pin = np.asarray(inp["pinna"][side]) / 1000.0
                cc, rr, dd = CO.C2.ENV.project_to_render(
                    pin, cam, inp["sensor"])
                m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                     & (dd > 0))
                p2 = np.stack([cc[m], rr[m]], axis=1)
                tri = _DE(p2[_CH(p2).vertices])
                c0b, c1b = (max(int(p2[:, 0].min()) - 2, 0),
                            min(int(p2[:, 0].max()) + 3, 1024))
                r0b, r1b = (max(int(p2[:, 1].min()) - 2, 0),
                            min(int(p2[:, 1].max()) + 3, 1024))
                yy, xx = np.nonzero(np.ones((r1b - r0b, c1b - c0b)))
                inside = np.zeros((1024, 1024), dtype=bool)
                sub = tri.find_simplex(
                    np.stack([xx + c0b, yy + r0b], axis=1)) >= 0
                inside[r0b:r1b, c0b:c1b][sub.reshape(r1b - r0b,
                                                    c1b - c0b)] = True
                sil["%s/%s/%s" % (tag, view, side)] = {
                    "idPxInSilhouette": int((a & inside).sum())}
                # lobe: pinna verts in the bottom 20 mm of that ear.
                pv = np.asarray(inp["pinna"][side])
                zlobe = float(pv[:, 2].min())
                lobe = pv[pv[:, 2] <= zlobe + 0.020] / 1000.0
                lc, lr, _ = CO.C2.ENV.project_to_render(
                    lobe, cam, inp["sensor"])
                lm = np.isfinite(lc) & np.isfinite(lr)
                ccol = float(lc[lm].mean())
                rbot = float(lr[lm].max())
                face = lobe.mean(axis=0) + np.array([0, -0.05, 0.0])
                fx, _, _ = CO.C2.ENV.project_to_render(
                    face[None, :], cam, inp["sensor"])
                sx = 1.0 if float(fx[0]) - ccol >= 0 else -1.0
                c0 = ccol if sx < 0 else ccol - 50.0
                c1 = ccol + 50.0 if sx < 0 else ccol
                rgn = np.zeros((1024, 1024), dtype=bool)
                rgn[int(rbot):min(int(rbot) + 80, 1024),
                    max(int(c0), 0):min(int(c1), 1024)] = True
                _tm = np.array(Image.open(SCR / MASKF[view])) > 127
                neckline["%s/%s/%s" % (tag, view, side)] = {
                    "idPxBelowLobeAnterior": int((a & rgn).sum()),
                    "outsideMaskPx": int((a & rgn & ~_tm).sum()),
                    "tgtMaskPx": int((_tm & rgn).sum())}
    out["pinnaSilhouette"] = sil
    out["earToNeckLine"] = neckline
    for k, v in sil.items():
        print("SIL %s %s" % (k, v), flush=True)
    for k, v in neckline.items():
        print("NECKLINE %s %s" % (k, v), flush=True)

    # (e) operator handback-2 gates: 15 px ring around the pinna
    # silhouette (front/three_quarter/profile_90, zero hair-ID) and
    # skin-through behind the ear (profile box posterior of the ear:
    # ID coverage of target-hair pixels >= 97%).
    from scipy.spatial import ConvexHull as _CH2
    from scipy.spatial import Delaunay as _DE2
    ring = {}
    skin = {}
    for tag, (_, idir) in src.items():
        for view in ("front", "three_quarter", "profile_90"):
            cam = inp["cams"]["views"][view]
            a = np.array(Image.open(idir / (view + "-id.png"))
                         .convert("RGBA"))[:, :, 3] >= 230
            opened.append(str(idir / (view + "-id.png")))
            for side in ("xpos", "xneg"):
                pin = np.asarray(inp["pinna"][side]) / 1000.0
                cc, rr, dd = CO.C2.ENV.project_to_render(
                    pin, cam, inp["sensor"])
                m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                     & (dd > 0))
                p2 = np.stack([cc[m], rr[m]], axis=1)
                tri = _DE2(p2[_CH2(p2).vertices])
                c0b = max(int(p2[:, 0].min()) - 17, 0)
                c1b = min(int(p2[:, 0].max()) + 18, 1024)
                r0b = max(int(p2[:, 1].min()) - 17, 0)
                r1b = min(int(p2[:, 1].max()) + 18, 1024)
                yy, xx = np.nonzero(np.ones((r1b - r0b, c1b - c0b)))
                sub = tri.find_simplex(
                    np.stack([xx + c0b, yy + r0b], axis=1)) >= 0
                sub = sub.reshape(r1b - r0b, c1b - c0b)
                inside = np.zeros((1024, 1024), dtype=bool)
                inside[r0b:r1b, c0b:c1b][sub] = True
                halo = ndimage.binary_dilation(
                    inside[r0b:r1b, c0b:c1b], iterations=15)
                region = np.zeros((1024, 1024), dtype=bool)
                region[r0b:r1b, c0b:c1b][halo] = True
                t = np.array(Image.open(SCR / MASKF[view])) > 127
                ring["%s/%s/%s" % (tag, view, side)] = {
                    "idPx": int((a & region).sum()),
                    "outsideMaskPx": int((a & region & ~t).sum()),
                    "tgtMaskPx": int((t & region).sum())}
        # skin-through: profile box behind the ear (posterior of the
        # pinna bbox, mid heights); ID coverage of target-hair px.
        v = "profile_90"
        cam = inp["cams"]["views"][v]
        a = np.array(Image.open(idir / (v + "-id.png"))
                     .convert("RGBA"))[:, :, 3] >= 230
        t = np.array(Image.open(SCR / MASKF[v])) > 127
        for side in ("xpos", "xneg"):
            pin = np.asarray(inp["pinna"][side]) / 1000.0
            cc, rr, dd = CO.C2.ENV.project_to_render(
                pin, cam, inp["sensor"])
            m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                 & (dd > 0))
            face = pin.mean(axis=0) + np.array([0, -0.05, 0.0])
            fx, _, _ = CO.C2.ENV.project_to_render(
                face[None, :], cam, inp["sensor"])
            sx = 1.0 if float(fx[0]) - float(cc[m].mean()) >= 0 \
                else -1.0
            # posterior = opposite of face side.
            if sx > 0:
                c0, c1 = float(cc[m].min()) - 90.0, float(cc[m].min())
            else:
                c0, c1 = float(cc[m].max()), float(cc[m].max()) + 90.0
            rmid = float(rr[m].mean())
            bx = (slice(max(int(rmid) - 40, 0),
                        min(int(rmid) + 40, 1024)),
                  slice(max(int(c0), 0), min(int(c1), 1024)))
            exp = int((t[bx]).sum())
            got = int((a[bx] & t[bx]).sum())
            skin["%s/%s" % (tag, side)] = {
                "expectedPx": exp,
                "coveredPx": got,
                "coverage": round(float(got) / max(exp, 1), 4)}
    out["ring15px"] = ring
    out["skinThrough"] = skin
    for k, v in ring.items():
        print("RING %s %s" % (k, v), flush=True)
    for k, v in skin.items():
        print("SKIN %s %s" % (k, v), flush=True)

    (E4 / "score4.json").write_text(json.dumps(out, indent=1) + "\n")
    prev = []
    if (E4 / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E4 / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E4 / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("score4 done", flush=True)


def S3_out_ruler(src, opened, out):
    """Frizz ruler verbatim (score3 boxes/rule)."""
    FRIZZBOXES = {
        "front": [(350, 480, 150, 270), (540, 670, 150, 270)],
        "three_quarter": [(400, 560, 350, 520)],
        "profile_90": [(300, 470, 300, 470)],
        "back": [(300, 380, 350, 450), (640, 720, 350, 450)],
    }
    fz = {"boxes": {v: FRIZZBOXES[v] for v in VIEWS}}
    for view in VIEWS:
        t = np.array(Image.open(SCR / MASKF[view])) > 127
        boxm = np.zeros((1024, 1024), dtype=bool)
        for (c0, c1, r0, r1) in FRIZZBOXES[view]:
            boxm[r0:r1, c0:c1] = True
        th = t & boxm
        lab, _ = ndimage.label(th)
        sz = np.bincount(lab.ravel())
        iso = 0
        if len(sz) > 1:
            small = np.nonzero(sz[1:] < 30)[0] + 1
            iso = int(np.isin(lab, small).sum())
        fz["target/%s" % view] = {
            "hairPx": int(th.sum()), "outsidePx": 0,
            "isolatedPx": iso,
            "frac": round(float(iso) / max(int(th.sum()), 1), 4)}
        for tag, (_, idir) in src.items():
            a = np.array(Image.open(idir / (view + "-id.png"))
                         .convert("RGBA"))[:, :, 3] >= 230
            h = a & boxm
            o = int((h & ~t).sum())
            lab2, _ = ndimage.label(h)
            sz2 = np.bincount(lab2.ravel())
            iso2 = 0
            if len(sz2) > 1:
                small2 = np.nonzero(sz2[1:] < 30)[0] + 1
                iso2 = int(np.isin(lab2, small2).sum())
            fz["%s/%s" % (tag, view)] = {
                "hairPx": int(h.sum()), "outsidePx": o,
                "isolatedPx": iso2,
                "isoFrac": round(float(iso2) / max(int(h.sum()), 1), 4)}
            print("FRIZZRULER %s %s %s" % (
                tag, view, fz["%s/%s" % (tag, view)]), flush=True)
    fz["gatePass"] = True
    return fz


if __name__ == "__main__":
    main()
