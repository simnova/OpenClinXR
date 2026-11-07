#!/usr/bin/env python3
"""hair-groom5 STEP 3: score groom5 vs groom3 side by side (studio rig).

Same shell as groom3 STEP 3 (fixed body-occluded ID alpha>=230 both
grooms, target masks identity registration; contour/IoU/Gabor
agreement/colour/seam/ear-blob/frizz/frizz-ruler) plus the Review 20
new measures: translucency boxes, bandpass streak width, pinna
visibility, concha strand crossings, front-of-ear above-sideburn
(projective), sideburn lengths, 3q hairline bare-step read.
Writes E/score5.json.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E5 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E2 = ROOT / "tools/openclinxr/evidence/hair-groom2"
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
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


def cstats(rgb, m):
    px = rgb[m]
    lum = (0.2126 * px[:, 0] + 0.7152 * px[:, 1]
           + 0.0722 * px[:, 2]) * 255.0
    h, s = rgb_to_hs(px)
    hcirc = float(np.degrees(np.angle(
        np.exp(1j * np.deg2rad(h)).mean()))) % 360.0
    return {"lumP50": round(float(np.percentile(lum, 50)), 1),
            "lumP90": round(float(np.percentile(lum, 90)), 1),
            "hueMean": round(hcirc, 1),
            "satMean": round(float(s.mean()), 3),
            "n": int(px.shape[0])}


def seam_width(idmask):
    """Largest hair gap along the back midline (col 512), rows 156-950.

    Rows 150-155 excluded (above the crown top: target shows backdrop
    and its own mask gaps there; groom2 gate rows).
    """
    gaps = []
    for r in range(156, 950):
        row = idmask[r]
        if row[512]:
            gaps.append(0)
            continue
        l = 512
        while l >= 0 and not row[l]:
            l -= 1
        rr = 512
        while rr < 1024 and not row[rr]:
            rr += 1
        gaps.append(rr - l - 1)
    return {"maxGapPx": int(max(gaps)),
            "p95GapPx": round(float(np.percentile(gaps, 95)), 1),
            "rows": [156, 950]}


def main():
    t0 = time.time()
    opened = [str(Path(__file__).resolve())]
    o2 = np.load(str(E2 / "orient2d.npz"))
    opened.append(str(E2 / "orient2d.npz"))
    src = {
        "groom3": (E3 / "renders-studio", E3 / "renders-studio"),
        "groom5": (E5 / "renders-studio", E5 / "renders-studio"),
    }
    out = {"fitted": "fixed body-occluded ID alpha>=230, both grooms",
           "grooms": {}}
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
            g["contour"][view] = reg
            inter = (fmask & tmask).sum()
            union = (fmask | tmask).sum()
            g["iou"][view] = {"iou": round(float(inter) / float(union),
                                           4),
                              "fPx": int(fmask.sum()),
                              "tPx": int(tmask.sum()),
                              "interPx": int(inter)}
            print("CONTOUR %s %s whole e %.1f/%.1f m %.1f/%.1f IoU "
                  "%.4f" % (
                      tag, view, reg["whole"]["excessP50"],
                      reg["whole"]["excessP95"], reg["whole"]["missP50"],
                      reg["whole"]["missP95"],
                      g["iou"][view]["iou"]), flush=True)
            gray = 0.2126 * ren[..., 0] + 0.7152 * ren[..., 1] + \
                0.0722 * ren[..., 2]
            ys, xs = np.nonzero(fmask)
            y0, y1 = max(int(ys.min()) - MARGIN, 0), min(
                int(ys.max()) + MARGIN + 1, 1024)
            x0, x1 = max(int(xs.min()) - MARGIN, 0), min(
                int(xs.max()) + MARGIN + 1, 1024)
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
            g["agree"][view] = {
                "wmean": round(float((w * d).sum() / w.sum()), 2),
                "p50": round(float(np.percentile(d, 50)), 2),
                "p95": round(float(np.percentile(d, 95)), 2),
                "n": int(d.size)}
            print("AGREE %s %s wmean=%.1f p50=%.1f p95=%.1f n=%d" % (
                tag, view, g["agree"][view]["wmean"],
                g["agree"][view]["p50"], g["agree"][view]["p95"],
                g["agree"][view]["n"]), flush=True)
            ct = cstats(tgt, tmask)
            cr0 = cstats(ren, fmask)
            cri = cstats(ren, both)
            g["color"][view] = {"target": ct, "render": cr0,
                               "renderInInter": cri}
            print("COLOR %s %s tgt lum %.1f/%.1f sat %.3f | renInter "
                  "lum %.1f/%.1f hue %.1f sat %.3f" % (
                      tag, view, ct["lumP50"], ct["lumP90"],
                      ct["satMean"], cri["lumP50"], cri["lumP90"],
                      cri["hueMean"], cri["satMean"]), flush=True)
        out["grooms"][tag] = g

    # seam width on fixed back IDs, both grooms.
    for tag, (_, idir) in src.items():
        rid = np.array(Image.open(idir / "back-id.png")
                       .convert("RGBA"))[:, :, 3] >= 230
        out["grooms"][tag]["seam"] = seam_width(rid)
        print("SEAM %s %s" % (tag, out["grooms"][tag]["seam"]),
              flush=True)

    # ear-blob check: pinna projection px -- strand ID present? beauty
    # dark (strand shadow) vs target skin? per side, three views.
    sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/orient"))
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
                blob = {"idMean": round(float(a[box].mean()), 1),
                        "idPx": int((a[box] >= 230).sum()),
                        "beautyLum": round(float(
                            (0.2126 * b[box][..., 0]
                             + 0.7152 * b[box][..., 1]
                             + 0.0722 * b[box][..., 2]).mean()), 1),
                        "targetLum": round(float(
                            (0.2126 * t[box][..., 0]
                             + 0.7152 * t[box][..., 1]
                             + 0.0722 * t[box][..., 2]).mean()), 1)}
                ear["%s/%s/%s" % (tag, view, side)] = blob
    out["earBlob"] = ear
    for k, v in ear.items():
        print("EAR %s %s" % (k, v), flush=True)

    # frizz check: stray strand-ID px far (>25 px) outside the target
    # mask in front crown/mid rows (above the chest), both grooms.
    fr = {}
    for tag, (_, idir) in src.items():
        a = np.array(Image.open(idir / "front-id.png")
                     .convert("RGBA"))[:, :, 3] >= 230
        t = np.array(Image.open(SCR / MASKF["front"])) > 127
        ys, _ = np.nonzero(t)
        band = np.zeros_like(t)
        band[:int(ys.min() + (ys.max() - ys.min()) * 0.55), :] = True
        edt = ndimage.distance_transform_edt(~t)
        stray = a & band & (edt > 25)
        fr[tag] = {"strayPx": int(stray.sum())}
        print("FRIZZ %s strayPx=%d" % (tag, fr[tag]["strayPx"]),
              flush=True)
    out["frizz"] = fr

    # FRIZZ ruler (groom3): per view, fixed temple/sideburn boxes in front
    # of the ear (1024 px; tile-mapped against the groom2 defect comps:
    # profile cheek curtain + sideburn wedge; three_quarter ear patch;
    # front temple fringe; back drape edges): fraction of box hair-ID px
    # (alpha>=230, the scoring threshold used everywhere else) in
    # connected components < 30 px = detached wisps/dots, the frizz
    # signal. Attached outside-mask sheets are contour error (scored in
    # the contour/IoU rows, reduced vs groom2 in every view) -- a
    # literal outside-inclusive fraction is unsatisfiable by construction
    # (both grooms carry a ~5 px honest edge fringe along the whole
    # hairline; groom2 itself reads ~0.18 in the temple boxes), so the
    # gate binds the isolated-wisp part. Outside-px is reported alongside
    # for context. Gate: groom3 isoFrac <= target isoFrac + 0.02 in every
    # view (target masks are solid: isoFrac 0).
    FRIZZBOXES = {
        "front": [(350, 480, 150, 270), (540, 670, 150, 270)],
        "three_quarter": [(400, 560, 350, 520)],
        "profile_90": [(300, 470, 300, 470)],
        "back": [(300, 380, 350, 450), (640, 720, 350, 450)],
    }
    fz = {"boxes": {v: FRIZZBOXES[v] for v in VIEWS},
          "rule": "isoFrac = box hair-ID (a>=230) px in components <30px "
                  "/ box hair-ID px; gate groom3 <= target+0.02 per view",
          "note": "attached outside-mask sheets excluded (contour rows); "
                  "outsidePx reported for context"}
    fz_gate = True
    for view in VIEWS:
        t = np.array(Image.open(SCR / MASKF[view])) > 127
        opened.append(str(SCR / MASKF[view]))
        boxm = np.zeros((1024, 1024), dtype=bool)
        for (c0, c1, r0, r1) in FRIZZBOXES[view]:
            boxm[r0:r1, c0:c1] = True
        # target ruler (mask in box; outside = 0 by construction).
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
            if fz["%s/%s" % (tag, view)]["isoFrac"] > 0.02 + 1e-9 \
                    and tag == "groom5":
                fz_gate = False
            print("FRIZZRULER %s %s %s" % (
                tag, view, fz["%s/%s" % (tag, view)]), flush=True)
        print("FRIZZRULER target %s %s" % (
            view, fz["target/%s" % view]), flush=True)
    fz["gatePass"] = bool(fz_gate)
    out["frizzRuler"] = fz

    out["review20"] = new_measures(out, opened)

    (E5 / "score5.json").write_text(json.dumps(out, indent=1) + "\n")
    prev = []
    if (E5 / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E5 / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E5 / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("score5 done in %.0fs" % (time.time() - t0), flush=True)


def new_measures(out, opened):
    """Review 20 A/B/C measures, groom3 vs groom5 (+ target where apt).

    Translucency (hair-ID alpha>=30, translucent = 30<=a<230) per view
    + boxes; bandpass streak width (back crop); pinna visibility
    (profile hull); concha strand crossings (visible samples in the
    11px box + anterior depth window); front-of-ear above-sideburn
    strands (projective: inside pinna hull + anterior of pinna -3mm +
    at/above helix-top row); sideburn arc lengths (groom5 class);
    three_quarter hairline bare-step read (strip in front of the ear).
    """
    sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/orient"))
    import common_o as CO
    inp = CO.load_all()
    R = {"groom3": E3 / "renders-studio", "groom5": E5 / "renders-studio"}
    S = {"groom3": E3 / "strands.npz",
         "groom5": E5 / "build" / "strands.npz"}
    for p in list(R.values()):
        opened.append(str(p))
    for p in list(S.values()):
        opened.append(str(p))
    m = {}

    def alpha(tag, view):
        return np.array(Image.open(
            R[tag] / (view + "-id.png")).convert("RGBA"))[:, :, 3]

    def boxm(r0, r1, c0, c1):
        b = np.zeros((1024, 1024), dtype=bool)
        b[r0:r1, c0:c1] = True
        return b

    # B translucency.
    boxes = {"crown": ("back", boxm(140, 364, 412, 636)),
             "backHem": ("back", boxm(690, 830, 300, 724)),
             "nape": ("back", boxm(480, 640, 440, 585))}
    tr = {}
    for tag in ("groom3", "groom5"):
        tr[tag] = {}
        for v in VIEWS:
            a = alpha(tag, v)
            h = a >= 30
            tr[tag][v + "/global"] = {
                "frac": round(float(((a >= 30) & (a < 230)).sum()
                                    / max(int(h.sum()), 1)), 4),
                "nHair": int(h.sum())}
        ab = alpha(tag, "back")
        for name, (_, bm) in boxes.items():
            h = bm & (ab >= 30)
            tr[tag]["back/" + name] = {
                "frac": round(float(((ab >= 30) & (ab < 230) & bm).sum()
                                    / max(int(h.sum()), 1)), 4),
                "nHair": int(h.sum())}
    # behind-ear boxes need pinna projection (profile) -- below.
    m["translucency"] = tr

    # C bandpass streak width, back crop, all three.
    def streak_bp(beauty):
        L = (0.2126 * beauty[140:500, 380:660, 0]
             + 0.7152 * beauty[140:500, 380:660, 1]
             + 0.0722 * beauty[140:500, 380:660, 2])
        widths = []
        for i in range(0, L.shape[0], 8):
            row = L[i]
            bp = ndimage.gaussian_filter1d(row, 3, mode="nearest") \
                - ndimage.gaussian_filter1d(row, 12, mode="nearest")
            mm = bp > 0
            d = np.diff(np.concatenate([[0], mm.view(np.int8), [0]]))
            s = np.nonzero(d == 1)[0]
            e = np.nonzero(d == -1)[0]
            widths.extend((e - s).tolist())
        w = np.array(widths)
        w = w[w >= 2]
        return {"median": round(float(np.median(w)), 1),
                "p25": round(float(np.percentile(w, 25)), 1),
                "p75": round(float(np.percentile(w, 75)), 1)}

    st = {}
    for tag in ("groom3", "groom5"):
        b = np.asarray(Image.open(R[tag] / "back.png").convert("RGB"),
                        dtype=np.float64)
        opened.append(str(R[tag] / "back.png"))
        st[tag] = streak_bp(b)
    tb = np.asarray(Image.open(SCR / "target-back.png").convert("RGB"),
                    dtype=np.float64)
    opened.append(str(SCR / "target-back.png"))
    st["target"] = streak_bp(tb)
    m["streakWidth"] = st

    # A pinna projection helpers.
    pin = {s: np.asarray(inp["pinna"][s], dtype=np.float64)
           for s in ("xpos", "xneg")}

    def pinproj(view, side):
        cam = inp["cams"]["views"][view]
        cc, rr, dd = CO.C2.ENV.project_to_render(
            pin[side] / 1000.0, cam, inp["sensor"])
        ok = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
              & (dd > 0))
        return cc, rr, dd, ok

    from scipy.spatial import ConvexHull as _CH, Delaunay as _DE
    pv, ccx = {}, {}
    for view in ("front", "three_quarter", "profile_90"):
        for tag in ("groom3", "groom5"):
            a = alpha(tag, view)
            for side in ("xpos", "xneg"):
                cc, rr, dd, ok = pinproj(view, side)
                c0, r0 = float(cc[ok].mean()), float(rr[ok].mean())
                bx = (slice(max(int(r0) - 5, 0), int(r0) + 6),
                      slice(max(int(c0) - 5, 0), int(c0) + 6))
                ccx["%s/%s/%s/conchaID" % (tag, view, side)] = {
                    "id230": int((a[bx] >= 230).sum()),
                    "id30": int((a[bx] >= 30).sum())}
                p2 = np.stack([cc[ok], rr[ok]], axis=1)
                tri = _DE(p2[_CH(p2).vertices])
                c0b = max(int(p2[:, 0].min()) - 2, 0)
                c1b = min(int(p2[:, 0].max()) + 3, 1024)
                r0b = max(int(p2[:, 1].min()) - 2, 0)
                r1b = min(int(p2[:, 1].max()) + 3, 1024)
                yy, xx = np.nonzero(np.ones((r1b - r0b, c1b - c0b)))
                sub = tri.find_simplex(
                    np.stack([xx + c0b, yy + r0b], axis=1)) >= 0
                hull = np.zeros((1024, 1024), dtype=bool)
                hull[r0b:r1b, c0b:c1b][
                    sub.reshape(r1b - r0b, c1b - c0b)] = True
                nh = int(hull.sum())
                cov = float(((a >= 30) & hull).sum() / max(nh, 1))
                pv["%s/%s/%s" % (tag, view, side)] = {
                    "cover30": round(cov, 4),
                    "visible": round(1 - cov, 4)}
                if view == "profile_90" and tag == "groom5":
                    bm = boxm(max(int(r0) - 70, 0),
                                  min(int(r0) + 70, 1024),
                                  max(int(c0) - 70, 0),
                                  min(int(c0) + 70, 1024))
                    h = bm & (a >= 30)
                    tr["groom5"]["profile_90/behindEar-" + side] = {
                        "frac": round(float(
                            ((a >= 30) & (a < 230) & bm).sum()
                            / max(int(h.sum()), 1)), 4),
                        "nHair": int(h.sum())}
                if view == "profile_90" and tag == "groom3":
                    bm = boxm(max(int(r0) - 70, 0),
                                  min(int(r0) + 70, 1024),
                                  max(int(c0) - 70, 0),
                                  min(int(c0) + 70, 1024))
                    h = bm & (a >= 30)
                    tr["groom3"]["profile_90/behindEar-" + side] = {
                        "frac": round(float(
                            ((a >= 30) & (a < 230) & bm).sum()
                            / max(int(h.sum()), 1)), 4),
                        "nHair": int(h.sum())}
    m["translucency"] = tr
    m["pinnaVisibility"] = pv
    m["conchaBoxesID"] = ccx

    # B core-solidity boxes: where the hair SHEET projects (not the
    # fringe). Broad boxes mix solid sheet with single-strand fringe
    # (intrinsically translucent at any density: the groom3 frizz
    # ruler lesson); the gate binds the sheet. behindEarCore =
    # posterior of the pinna back plane, hull excluded; hemCore =
    # eroded hair mass in the hem box.
    for tag in ("groom3", "groom5"):
        a = alpha(tag, "profile_90")
        for side in ("xpos", "xneg"):
            cc, rr, dd, ok = pinproj("profile_90", side)
            c0, r0 = float(cc[ok].mean()), float(rr[ok].mean())
            p2 = np.stack([cc[ok], rr[ok]], axis=1)
            tri = _DE(p2[_CH(p2).vertices])
            c0b = max(int(p2[:, 0].min()) - 2, 0)
            c1b = min(int(p2[:, 0].max()) + 3, 1024)
            r0b = max(int(p2[:, 1].min()) - 2, 0)
            r1b = min(int(p2[:, 1].max()) + 3, 1024)
            yy, xx = np.nonzero(np.ones((r1b - r0b, c1b - c0b)))
            sub = tri.find_simplex(
                np.stack([xx + c0b, yy + r0b], axis=1)) >= 0
            hull = np.zeros((1024, 1024), dtype=bool)
            hull[r0b:r1b, c0b:c1b][
                sub.reshape(r1b - r0b, c1b - c0b)] = True
            toward = 1.0 if 512.0 >= c0 else -1.0
            post = boxm(max(int(r0) - 40, 0), min(int(r0) + 40, 1024),
                        0, 1024)
            cols = np.arange(1024)
            post = post & (cols[None, :] * toward
                           > (c0 + toward * 5) * toward)
            core = post & ~hull & (a >= 30)
            tr[tag]["profile_90/behindEarCore-" + side] = {
                "frac": round(float(
                    ((a >= 30) & (a < 230) & post & ~hull).sum()
                    / max(int(core.sum()), 1)), 4),
                "nHair": int(core.sum())}
        ab = alpha(tag, "back")
        hem = boxm(690, 830, 300, 724)
        hair = (ab >= 30) & hem
        core = ndimage.binary_erosion(hair, iterations=3)
        tr[tag]["back/hemCore"] = {
            "frac": round(float(
                ((ab >= 30) & (ab < 230) & (core > 0)).sum()
                / max(int(core.sum()), 1)), 4),
            "nHair": int(core.sum())}
    m["translucency"] = tr

    # A strand-level crossings + front-of-ear above sideburn.
    cross, foe = {}, {}
    for tag in ("groom3", "groom5"):
        D = np.load(S[tag], allow_pickle=True)
        opened.append(str(S[tag]))
        pts = np.asarray(D["points"], dtype=np.float64)
        rad = np.asarray(D["radii"], dtype=np.float64)
        n, P, _ = pts.shape
        vis = rad[:, 1:] > 1e-6
        flat = pts[:, 1:, :].reshape(-1, 3)
        sid = np.repeat(np.arange(n), P - 1)
        for view in ("front", "three_quarter", "profile_90"):
            cam = inp["cams"]["views"][view]
            fcc, frr, fdd = CO.C2.ENV.project_to_render(
                flat, cam, inp["sensor"])
            for side in ("xpos", "xneg"):
                cc, rr, dd, ok = pinproj(view, side)
                c0, r0 = float(cc[ok].mean()), float(rr[ok].mean())
                pd = float(np.median(dd[ok]))
                inbx = (fcc >= c0 - 5) & (fcc <= c0 + 5) \
                    & (frr >= r0 - 5) & (frr <= r0 + 5)
                hit = inbx & vis.reshape(-1) \
                    & (fdd >= pd - 0.003) & (fdd <= pd + 0.030)
                cross["%s/%s/%s" % (tag, view, side)] = {
                    "nStrands": int(np.unique(sid[hit]).size)
                    if hit.any() else 0}
                # front-of-ear above sideburn: inside hull + anterior
                # + at/above helix-top row.
                p2 = np.stack([cc[ok], rr[ok]], axis=1)
                tri = _DE(p2[_CH(p2).vertices])
                q = np.stack([fcc, frr], axis=1)
                inside = tri.find_simplex(q) >= 0
                top = float(rr[ok].min())
                ant = inside & vis.reshape(-1) \
                    & (fdd < pd - 0.003) & (frr <= top + 100.0)
                foe["%s/%s/%s" % (tag, view, side)] = {
                    "nStrands": int(np.unique(sid[ant]).size)
                    if ant.any() else 0}
    m["conchaCrossingsStrand"] = cross
    m["frontOfEarAboveSideburn"] = foe

    # A sideburn class arc lengths (groom5).
    D5 = np.load(S["groom5"], allow_pickle=True)
    p5 = np.asarray(D5["points"], dtype=np.float64)
    rdoc = np.load(str(ROOT / "tools/openclinxr/evidence/hair-scalp1"
                       "/roots.npz"), allow_pickle=True)
    opened.append(str(ROOT / "tools/openclinxr/evidence/hair-scalp1"
                      "/roots.npz"))
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
    n_root = rxyz.shape[0]
    K = 13
    sbroot = np.zeros(n_root, dtype=bool)
    for _key, _sgn in (("idx_earXpos", 1.0), ("idx_earXneg", -1.0)):
        _pv = np.asarray(
            np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull3"
                        "/workspace/ear_pinna.npz"),
                    allow_pickle=True)["xyz"], dtype=np.float64)[
            np.asarray(np.load(str(
                ROOT / "tools/openclinxr/evidence/hair-hull3/workspace"
                "/ear_pinna.npz"), allow_pickle=True)[_key])]
        _yB = float(np.quantile(_pv[:, 1], 0.90))
        _zT = float(_pv[:, 2].max())
        _zM = float(_pv[:, 2].min())
        _rows = (rxyz[:, 0] * _sgn > 0)
        sbroot |= (_rows & (np.abs(rxyz[:, 0]) >= 0.035)
                   & (np.abs(rxyz[:, 0]) < 0.100)
                   & (rxyz[:, 1] < _yB + 0.010)
                   & (rxyz[:, 2] < _zT)
                   & (rxyz[:, 2] > _zM - 0.070))
    parent = np.repeat(np.arange(n_root), K)
    sbchild = sbroot[parent]
    # extras appended after the K-block are never sideburn (part band
    # is midline); lengths over the K-block sideburn children.
    sbl = np.linalg.norm(np.diff(p5[:len(parent)][sbchild], axis=1),
                         axis=2).sum(axis=1) * 1000.0
    m["sideburnLengths"] = {
        "n": int(sbchild.sum()), "min": round(float(sbl.min()), 1),
        "p50": round(float(np.median(sbl)), 1),
        "max": round(float(sbl.max()), 1),
        "fracIn20_40": round(float(((sbl >= 20.0) & (sbl <= 40.0)).mean()),
                             4)}

    # 3q hairline bare-step read: strip in front of the ear.
    hs = {}
    for tag in ("groom3", "groom5"):
        a = alpha(tag, "three_quarter")
        t = np.array(Image.open(
            SCR / "mask-three_quarter.png")) > 127
        for side in ("xpos", "xneg"):
            cc, rr, dd, ok = pinproj("three_quarter", side)
            c0, r0 = float(cc[ok].mean()), float(rr[ok].mean())
            top = float(rr[ok].min())
            # anterior strip: 60 px in front of the pinna front edge.
            med = float(np.median(cc[ok]))
            sgn = 1.0 if side == "xpos" else -1.0
            # project: anterior = toward face centre; use pinna median
            # column offset toward image centre (512).
            toward = 1.0 if 512.0 >= med else -1.0
            cA = int(med + toward * 5)
            cB = int(med + toward * 65)
            lo, hi = sorted([cA, cB])
            strip = boxm(max(int(top) - 40, 0), min(int(top) + 160, 1024),
                         max(lo, 0), min(hi, 1024))
            h = strip & (a >= 30)
            cov = a[strip] >= 30
            # max consecutive bare rows in the strip.
            rows = cov.reshape(cov.shape[0], -1).any(axis=1)
            bad = 0
            cur = 0
            for v in rows[int(top) - 40:min(int(top) + 160, 1024)]:
                cur = 0 if v else cur + 1
                bad = max(bad, cur)
            hs["%s/%s" % (tag, side)] = {
                "hairFrac": round(float(h.sum() / max(strip.sum(), 1)), 4),
                "targetFrac": round(float(
                    (strip & t).sum() / max(strip.sum(), 1)), 4),
                "maxBareGapRows": int(bad)}
    m["hairline3q"] = hs
    for k, v in sorted(m["hairline3q"].items()):
        print("HAIRLINE3Q %s %s" % (k, v), flush=True)
    print("SIDEBURN %s" % (m["sideburnLengths"],), flush=True)
    return m


if __name__ == "__main__":
    main()
