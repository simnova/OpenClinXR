#!/usr/bin/env python3
"""hair-split0: per-side hem triangulation (target-only, no cage fit).

STEP 1: per-side hem pixels (front L/R via instruments.front_hems_perside;
        back centre + corners; profile posterior-lowest + anterior-lowest).
STEP 2: triangulate with the PINNED scorer-v3 cameras (no fitting):
        H1 front hem = profile posterior hem; H2 front hem = profile
        anterior hem; H3 front hem = same-side back corner.
STEP 3: verdict CONSISTENT iff best-hypothesis gap <= 30 mm both sides.
STEP 4: E/split.png, E/split.json, E/RESULT.txt, E/DONE.txt.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import instruments as INS  # noqa: E402
import envelope as ENV  # noqa: E402

OPENED = []
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
             "tools/openclinxr/evidence/hair-judge/target-set-back")
SHOULDER_Z = 1.405

THRESH_MM = 30.0


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def load_mask(name):
    p = track(JUDGE / name)
    return np.asarray(Image.open(p).convert("L")) > 127


def ray_for(cams, transforms, view, pixel):
    t = transforms[view]
    s = float(t["scale"])
    rc = (pixel[1] - float(t["tx"])) / s
    rr = (pixel[0] - float(t["ty"])) / s
    o, d = INS.pixel_ray(cams["views"][view], rc, rr, INS.sensor_of(cams))
    return np.array(o), np.array(d)


def closest(o1, d1, o2, d2):
    w0 = o1 - o2
    a, b, c = float(d1 @ d1), float(d1 @ d2), float(d2 @ d2)
    d, e = float(d1 @ w0), float(d2 @ w0)
    den = a * c - b * b
    s = (b * e - c * d) / den
    t = (a * e - b * d) / den
    p1, p2 = o1 + s * d1, o2 + t * d2
    return p1, p2, float(np.linalg.norm(p1 - p2))


def band_lowest(mask, c0, c1):
    c0i, c1i = max(int(c0), 0), min(int(c1), mask.shape[1])
    sub = mask[:, c0i:c1i]
    rr, _ = np.nonzero(sub)
    rmax = int(rr.max())
    ats = np.nonzero(sub[rmax])[0] + c0i
    return (float(rmax), round(float(np.median(ats)), 1),
            int(ats.size), [int(ats.min()), int(ats.max())])


def main():
    for n in ("cage.py", "instruments.py"):
        track(ROOT / "tools/openclinxr/hair-groom/cage" / n)
    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    cams = INS.load_cameras(str(track(ROOT / manifest["camerasFile"]["path"])))
    transforms = INS.transforms_of(cams)
    land = json.loads(track(Path(manifest["targets"]["landmarks"][
        "path"])).read_text())
    frame = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"))))
    menton = np.array(frame["point3d/menton"], dtype=np.float64)
    chin_z = round(float(menton[2]), 4)

    mf = load_mask("mask-front-v2.png")
    mp = load_mask("mask-profile-v2.png")
    mb = load_mask("mask-back-v3.png")

    # ---- STEP 1: hem pixels ----
    per = INS.front_hems_perside(mf, centre_col=float(
        land["front"]["face_centre_col"]))
    frontL = (per["L"]["pixel"][0], per["L"]["pixel"][1])
    frontR = (per["R"]["pixel"][0], per["R"]["pixel"][1])

    centre = float(land["back"]["hair_centre_col"])
    backC = band_lowest(mb, centre - 90, centre + 90)
    backL = band_lowest(mb, centre - 210, centre - 90)   # image-left corner
    backR = band_lowest(mb, centre + 90, centre + 210)   # image-right corner

    sensor = INS.sensor_of(cams)
    cam_p = cams["views"]["profile_90"]
    tp = transforms["profile_90"]
    s = float(tp["scale"])

    def to_target_col(pt):
        c, _, _ = ENV.project_to_render(pt[None, :], cam_p, sensor)
        return float(s * c[0] + tp["tx"])

    menton_col = to_target_col(menton)
    crown = np.array(frame["point3d/crown"], dtype=np.float64)
    post_col = to_target_col(crown + np.array([0.0, 0.130, -0.170]))
    profPost = band_lowest(mp, post_col - 40, post_col + 120)
    profAnt = band_lowest(mp, menton_col - 120, menton_col + 40)

    hems = {
        "frontL": {"pixel": [frontL[0], frontL[1]], **{
            k: per["L"][k] for k in ("nHalfPx", "nHemRowPx", "hemRowSpan")}},
        "frontR": {"pixel": [frontR[0], frontR[1]], **{
            k: per["R"][k] for k in ("nHalfPx", "nHemRowPx", "hemRowSpan")}},
        "backCentre": {"pixel": [backC[0], backC[1]], "nPx": backC[2],
                       "span": backC[3]},
        "backCornerL": {"pixel": [backL[0], backL[1]], "nPx": backL[2],
                       "span": backL[3]},
        "backCornerR": {"pixel": [backR[0], backR[1]], "nPx": backR[2],
                       "span": backR[3]},
        "profilePosterior": {"pixel": [profPost[0], profPost[1]],
                             "nPx": profPost[2], "span": profPost[3]},
        "profileAnterior": {"pixel": [profAnt[0], profAnt[1]],
                            "nPx": profAnt[2], "span": profAnt[3]},
    }

    # ---- STEP 2: triangulate (pinned cameras, no fit) ----
    pts = {"frontL": ("front", frontL), "frontR": ("front", frontR),
           "profPost": ("profile_90", (profPost[0], profPost[1])),
           "profAnt": ("profile_90", (profAnt[0], profAnt[1])),
           "backC": ("back", (backC[0], backC[1])),
           "backL": ("back", (backL[0], backL[1])),
           "backR": ("back", (backR[0], backR[1]))}
    rays = {k: ray_for(cams, transforms, v, p) for k, (v, p) in pts.items()}
    # H3 same-side mapping: back camera mirrors X (cam-X = -world-X), so
    # front-image-L (world -X) pairs with back-image-R and vice versa.
    pairs = {
        "H1": [("frontL", "profPost"), ("frontR", "profPost")],
        "H2": [("frontL", "profAnt"), ("frontR", "profAnt")],
        "H3": [("frontL", "backR"), ("frontR", "backL")],
        "H3x_excluded": [("frontL", "backL"), ("frontR", "backR")],
        "ref": [("frontL", "backC"), ("frontR", "backC")],
    }
    pairing_out = {}
    for h, plist in pairs.items():
        pairing_out[h] = []
        for a, b in plist:
            p1, p2, g = closest(rays[a][0], rays[a][1],
                               rays[b][0], rays[b][1])
            mid = (p1 + p2) / 2
            pairing_out[h].append({
                "a": a, "b": b, "gapMm": round(g * 1000.0, 1),
                "midM": [round(float(v), 4) for v in mid],
                "pAM": [round(float(v), 4) for v in p1],
                "pBM": [round(float(v), 4) for v in p2],
            })

    # ---- STEP 3: verdict + heights ----
    h1 = {r["a"]: r for r in pairing_out["H1"]}
    verdict = ("CONSISTENT" if max(h1["frontL"]["gapMm"],
                                  h1["frontR"]["gapMm"]) <= THRESH_MM
               else "INCONSISTENT")
    heights = {}
    for side in ("frontL", "frontR"):
        r = h1[side]
        z = r["midM"][2]
        heights[side] = {
            "midZM": z, "vsShoulderMm": round((z - SHOULDER_Z) * 1000.0, 1),
            "vsChinMm": round((z - chin_z) * 1000.0, 1),
            "pFrontZM": r["pAM"][2], "pProfZM": r["pBM"][2],
        }

    # station self-test (synthetic two-curtain mask)
    synth = np.zeros((INS.FRAME, INS.FRAME), dtype=bool)
    synth[100:667, 300:361] = True
    synth[100:676, 664:725] = True
    st = INS.front_hems_perside(synth, centre_col=513.0)
    selftest = {"pass": bool(st["L"]["pixel"] == [666.0, 330.0]
                             and st["R"]["pixel"] == [675.0, 694.0]),
                "L": st["L"]["pixel"], "R": st["R"]["pixel"]}

    # mass context: best ray-ray gap between each front hem ray and ANY
    # ray through the posterior-mass / back-mask interiors (coarse scan).
    # A small value here with large H1/H3 tip gaps = the masses overlap
    # but the views disagree on where the hair ENDS.
    mass_context = {}
    for side in ("frontL", "frontR"):
        of, df = rays[side]
        best = {}
        for key, vm, r0, r1, c0, c1 in (
                ("posteriorMass", "profile_90", 700, 876, 600, 946),
                ("backMass", "back", 700, 824, 300, 750)):
            bg = None
            m = mp if vm == "profile_90" else mb
            for r in range(r0, r1, 3):
                cols = np.nonzero(m[r, c0:c1])[0] + c0
                for c in cols[::4]:
                    oo, dd = ray_for(cams, transforms, vm, (float(r),
                                                            float(c)))
                    _, _, g = closest(of, df, oo, dd)
                    if bg is None or g < bg[0]:
                        bg = (g, r, int(c))
            best[key] = {"gapMm": round(bg[0] * 1000.0, 1),
                         "pixel": [bg[1], bg[2]]}
        mass_context[side] = best

    payload = {
        "hems": hems,
        "bands": {"mentonCol": round(menton_col, 1),
                  "postHeadCol": round(post_col, 1),
                  "backCentreCol": centre,
                  "frontCentreCol": land["front"]["face_centre_col"]},
        "rays": {k: {"originM": [round(float(v), 4) for v in rays[k][0]],
                     "dir": [round(float(v), 5) for v in rays[k][1]]}
                 for k in rays},
        "pairings": pairing_out,
        "hypotheses": {
            "H1": "front curtain hem = profile posterior-lowest hem",
            "H2": "front curtain hem = profile anterior-lowest hem "
                  "(short wisp tip)",
            "H3": "front curtain hem = same-side back corner "
                  "(X-mirrored: frontL-backR, frontR-backL)",
            "H3x_excluded": "same-image-side back corner: geometrically "
                            "impossible (opposite world X), control only",
        },
        "thresholdMm": THRESH_MM, "verdict": verdict,
        "massContext": mass_context,
        "heightsH1": heights, "shoulderZM": SHOULDER_Z, "chinZM": chin_z,
        "stationSelftest": selftest,
        "inputs": OPENED,
    }
    (E / "split.json").write_text(json.dumps(payload, indent=2,
                                             sort_keys=True) + "\n")

    # ---- STEP 4: figure ----
    fig, ax = plt.subplots(2, 2, figsize=(13, 12))
    for a, m, title, marks in (
            (ax[0, 0], mf, "front: L/R curtain hems (per-side)",
             {"L": (frontL[1], frontL[0], "cyan"),
              "R": (frontR[1], frontR[0], "magenta")}),
            (ax[0, 1], mb, "back: centre + corners",
             {"C": (backC[1], backC[0], "yellow"),
              "L": (backL[1], backL[0], "cyan"),
              "R": (backR[1], backR[0], "magenta")}),
            (ax[1, 0], mp, "profile: posterior + anterior lowest",
             {"P": (profPost[1], profPost[0], "yellow"),
              "A": (profAnt[1], profAnt[0], "lime")})):
        a.imshow(m, cmap="gray", origin="upper")
        for k, (c, r, col) in marks.items():
            a.plot(c, r, marker="x", ms=12, mew=2, color=col)
            a.text(c + 8, r - 8, k, color=col, fontsize=11,
                   weight="bold")
        a.set_title(title, fontsize=11)
        a.set_xlim(150, 900)
    a = ax[1, 1]
    cols = {"H1": ("cyan", "-", 0.0), "H3": ("orange", "--", 0.035)}
    for h in ("H1", "H3"):
        for r in pairing_out[h]:
            o1, d1 = rays[r["a"]]
            o2, d2 = rays[r["b"]]
            for (o, d) in ((o1, d1), (o2, d2)):
                t = np.linspace(-0.1, 0.9, 2)
                p = o[None, :] + t[:, None] * d[None, :]
                a.plot(p[:, 0], p[:, 1], color=cols[h][0],
                       ls=cols[h][1], lw=1)
            mid = np.array(r["midM"])
            a.plot(mid[0], mid[1], "o", color=cols[h][0], ms=7)
            a.text(mid[0], mid[1] + cols[h][2], " %s %s %smm"
                   % (h, r["a"], r["gapMm"]), fontsize=8,
                   color=cols[h][0])
    a.plot([crown[0]], [crown[1]], "w+", ms=12, mew=2)
    a.set_xlabel("world X (m, lateral)")
    a.set_ylabel("world Y (m, depth; front cam y=-0.70)")
    a.set_title("top-down: H1 (solid) + H3 same-side (dashed) rays "
                "and midpoints", fontsize=11)
    a.set_aspect("equal")
    a.set_facecolor("black")
    fig.suptitle("hair-split0: per-side hem triangulation "
                 "— verdict %s (H1 gaps L %s / R %s mm, thresh %s)" % (
                     verdict, h1["frontL"]["gapMm"],
                     h1["frontR"]["gapMm"], THRESH_MM))
    fig.tight_layout()
    fig.savefig(E / "split.png", dpi=110)
    print("WROTE split.json + split.png verdict=%s" % verdict, flush=True)
    print("H1 L %.1f R %.1f | H2 L %s R %s | H3 L %s R %s mm" % (
        h1["frontL"]["gapMm"], h1["frontR"]["gapMm"],
        pairing_out["H2"][0]["gapMm"], pairing_out["H2"][1]["gapMm"],
        pairing_out["H3"][0]["gapMm"], pairing_out["H3"][1]["gapMm"]),
        flush=True)


if __name__ == "__main__":
    main()
