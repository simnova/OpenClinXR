#!/usr/bin/env python3
"""hair-occl0: front-hem occlusion test (worker, target + body geometry only).

Hypothesis (from hair-split0/split.png): split0's INCONSISTENT verdict
compares the FRONT mask's flat curtain hems (rows ~666/675, at shoulder
height) with the profile/back hems (55-105 mm lower). Hair continuing down
BEHIND the shoulders is hidden by shoulders/chest in the front view, so the
flat front "hem" may be the body-occlusion edge, not where the hair ends.

STEP 1: for each candidate 3D point, test visibility from the pinned front
camera against the station0b bare-body depth buffer (body-verts.npz:
bare body + garment, library topper excluded) in hair-cage1/body-depth.npz:
  - H1 profile-ray-side hem points (split.json pairings.H1 pBM):
      L (-0.0772, 0.0678, 1.2908), R (0.1184, 0.0508, 1.3418)
  - back hem/corner back-ray-side points (H3 + ref pBM):
      backR L, backL R, backC L/R
  - vertical sweep from each front curtain hem 3D position (H1 pAM,
      L z 1.3991 / R z 1.3962) down to z 1.25 at same X,Y and Y +/- 40 mm.
STEP 2: verdict OCCLUSION_EXPLAINS iff every sweep point strictly below the
front hem level plus all profile/back points is occluded from the front
camera; else NOT_EXPLAINED with the visible points listed. Also reports the
target-frame row where the body silhouette crosses each curtain column vs
the target hem rows 666/675.
STEP 3: E/occl.png, E/occl.json, E/RESULT.txt, E/DONE.txt.
"""
from __future__ import annotations

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

OPENED: list[str] = []
MARGIN_M = 0.005  # 5 mm conservative visibility margin
PATCH = 2  # +/- px patch for body-depth lookup

JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
             "tools/openclinxr/evidence/hair-judge/target-set-back")


def track(path) -> Path:
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def unproject(col_r, row_r, depth_m, cam, sensor):
    focal = float(cam["lensMm"]) / float(sensor) * INS.FRAME
    local = np.array([(col_r - INS.FRAME / 2.0) / focal * depth_m,
                      -(row_r - INS.FRAME / 2.0) / focal * depth_m,
                      -depth_m])
    mat = np.array(cam["matrixWorld"], dtype=np.float64)
    return mat[:3, :3] @ local + np.array(cam["location"], dtype=np.float64)


def occluder_surface(x, z):
    if z >= 1.40 and abs(x) <= 0.06:
        return "neck"
    if z >= 1.315:
        return "shoulder"
    return "chest"


def main():
    split = json.loads(track(
        ROOT / "tools/openclinxr/evidence/hair-split0/split.json").read_text())
    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    cams = INS.load_cameras(str(track(ROOT / manifest["camerasFile"]["path"])))
    track(ROOT / "tools/openclinxr/hair-groom/cage/instruments.py")
    track(ROOT / "tools/openclinxr/hair-groom/envelope.py")
    transforms = INS.transforms_of(cams)
    sensor = INS.sensor_of(cams)
    cam_f = cams["views"]["front"]
    t_f = transforms["front"]
    s_f = float(t_f["scale"])

    bd = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-cage1/body-depth.npz")))
    cover = np.array(bd["front/cover"], dtype=bool)
    bdepth = np.array(bd["front/depth"], dtype=np.float64)

    def to_target(col_r, row_r):
        return float(s_f * col_r + t_f["tx"]), float(s_f * row_r + t_f["ty"])

    def test_point(p):
        p = np.array(p, dtype=np.float64)
        cols, rows, dep = ENV.project_to_render(p[None, :], cam_f, sensor)
        c0, r0, d0 = float(cols[0]), float(rows[0]), float(dep[0])
        ci, ri = int(round(c0)), int(round(r0))
        if not (0 <= ci < INS.FRAME and 0 <= ri < INS.FRAME) or d0 <= 0:
            return {"status": "visible", "why": "projects outside frame",
                    "colR": c0, "rowR": r0, "depthM": d0}
        rlo, rhi = max(ri - PATCH, 0), min(ri + PATCH + 1, INS.FRAME)
        clo, chi = max(ci - PATCH, 0), min(ci + PATCH + 1, INS.FRAME)
        pcov = cover[rlo:rhi, clo:chi]
        pdep = bdepth[rlo:rhi, clo:chi]
        vals = pdep[pcov & np.isfinite(pdep)]
        col_t, row_t = to_target(c0, r0)
        base = {"colR": round(c0, 1), "rowR": round(r0, 1),
                "colT": round(col_t, 1), "rowT": round(row_t, 1),
                "depthM": round(d0, 4)}
        if vals.size < 3:
            if not bool(cover[ri, ci]):
                return {**base, "status": "visible",
                        "why": "no body along ray",
                        "bodyDepthM": None, "gapMm": None,
                        "occluderM": None, "surface": None}
            vals = bdepth[ri:ri + 1, ci:ci + 1]
            vals = vals[np.isfinite(vals)]
        med = float(np.median(vals))
        gap_mm = round((med - d0) * 1000.0, 1)
        if d0 < med - MARGIN_M:
            return {**base, "status": "visible",
                    "why": "hair %.1f mm in front of body" % gap_mm,
                    "bodyDepthM": round(med, 4), "gapMm": gap_mm,
                    "occluderM": None, "surface": None}
        occ = unproject(c0, r0, med, cam_f, sensor)
        return {**base, "status": "occluded",
                "why": "body %.1f mm in front of hair" % (-gap_mm),
                "bodyDepthM": round(med, 4), "gapMm": gap_mm,
                "occluderM": [round(float(v), 4) for v in occ],
                "surface": occluder_surface(float(occ[0]), float(occ[2]))}

    # ---- candidate points ----
    h1 = {r["a"]: r for r in split["pairings"]["H1"]}
    h3 = {r["a"]: r for r in split["pairings"]["H3"]}
    ref = {r["a"]: r for r in split["pairings"]["ref"]}
    cands = {}
    cands["profHemL"] = {"pointM": h1["frontL"]["pBM"],
                         "note": "H1 profile-ray-side hem L (z 1.2908)"}
    cands["profHemR"] = {"pointM": h1["frontR"]["pBM"],
                         "note": "H1 profile-ray-side hem R (z 1.3418)"}
    cands["backCornerR"] = {"pointM": h3["frontL"]["pBM"],
                            "note": "H3 back-ray-side backR (pairs frontL)"}
    cands["backCornerL"] = {"pointM": h3["frontR"]["pBM"],
                            "note": "H3 back-ray-side backL (pairs frontR)"}
    cands["backCentreL"] = {"pointM": ref["frontL"]["pBM"],
                            "note": "ref back-ray-side backC (pairs frontL)"}
    cands["backCentreR"] = {"pointM": ref["frontR"]["pBM"],
                            "note": "ref back-ray-side backC (pairs frontR)"}
    base = {"L": h1["frontL"]["pAM"], "R": h1["frontR"]["pAM"]}
    sweep_z = {}
    for side in ("L", "R"):
        z0 = float(base[side][2])
        zs = list(np.arange(z0, 1.2499, -0.01))
        sweep_z[side] = [round(float(z), 4) for z in zs]
        for dy in (-0.04, 0.0, 0.04):
            for z in sweep_z[side]:
                key = "sweep%s_dy%+d_z%.3f" % (
                    side, int(round(dy * 1000)), z)
                cands[key] = {
                    "pointM": [round(float(base[side][0]), 4),
                               round(float(base[side][1] + dy), 4), z],
                    "note": "sweep %s hem column dy=%+dmm z=%.3f" % (
                        side, int(round(dy * 1000)), z)}

    results = {}
    for key, spec in cands.items():
        r = test_point(spec["pointM"])
        results[key] = {"pointM": spec["pointM"], "note": spec["note"], **r}

    # ---- verdict ----
    hem_z = {"L": float(base["L"][2]), "R": float(base["R"][2])}
    below_keys = []
    for key, r in results.items():
        z = float(r["pointM"][2])
        if key.startswith("sweep"):
            side = "L" if "sweepL" in key else "R"
            if z < hem_z[side] - 0.001:
                below_keys.append(key)
        elif key in ("profHemL", "profHemR", "backCornerR", "backCornerL",
                     "backCentreL", "backCentreR"):
            below_keys.append(key)
    visible_below = sorted(k for k in below_keys
                           if results[k]["status"] == "visible")
    verdict = ("OCCLUSION_EXPLAINS"
               if not visible_below else "NOT_EXPLAINED")

    # occlusion-edge transition per sweep column: deepest visible z,
    # shallowest occluded z (dy=0 columns)
    transitions = {}
    for side in ("L", "R"):
        col = sorted(((float(results[k]["pointM"][2]), k)
                      for k in results
                      if k.startswith("sweep%s_dy+0_" % side)),
                     reverse=True)
        deepest_vis, shallowest_occ = None, None
        for z, k in col:
            if results[k]["status"] == "visible":
                deepest_vis = (z, k)
            elif shallowest_occ is None:
                shallowest_occ = (z, k)
        transitions[side] = {
            "deepestVisible": ({**results[deepest_vis[1]],
                                "key": deepest_vis[1]}
                               if deepest_vis else None),
            "shallowestOccluded": ({**results[shallowest_occ[1]],
                                    "key": shallowest_occ[1]}
                                   if shallowest_occ else None)}

    # ---- silhouette crossing per curtain column (target frame) ----
    rr, cc = np.mgrid[0:INS.FRAME, 0:INS.FRAME]
    rs = np.rint((rr - float(t_f["ty"])) / s_f).astype(np.int64)
    cs = np.rint((cc - float(t_f["tx"])) / s_f).astype(np.int64)
    hit = (rs >= 0) & (rs < INS.FRAME) & (cs >= 0) & (cs < INS.FRAME)
    body_t = np.zeros((INS.FRAME, INS.FRAME), dtype=bool)
    body_t[hit] = cover[rs[hit], cs[hit]]
    hem_cols = {"L": float(split["hems"]["frontL"]["pixel"][1]),
                "R": float(split["hems"]["frontR"]["pixel"][1])}
    hem_rows = {"L": float(split["hems"]["frontL"]["pixel"][0]),
                "R": float(split["hems"]["frontR"]["pixel"][0])}
    crossings = {}
    for side in ("L", "R"):
        col = int(round(hem_cols[side]))
        prof = body_t[:, max(col - 2, 0):col + 3].any(axis=1)
        spans, start = [], None
        for row in range(INS.FRAME):
            if prof[row] and start is None:
                start = row
            elif not prof[row] and start is not None:
                spans.append([start, row - 1])
                start = None
        if start is not None:
            spans.append([start, INS.FRAME - 1])
        torso_top = spans[-1][0] if spans else None
        crossings[side] = {
            "targetCol": col, "coveredSpans": spans,
            "torsoTopRow": torso_top,
            "targetHemRow": hem_rows[side],
            "deltaRows": (None if torso_top is None else
                          int(torso_top - hem_rows[side]))}

    payload = {
        "hypothesis": ("front flat hem (rows 666/675) is the body-occlusion "
                       "edge; hair continues behind shoulders to the "
                       "profile/back hem"),
        "verdict": verdict,
        "visibleBelowHem": visible_below,
        "nCandidates": len(results),
        "nBelowHem": len(below_keys),
        "nOccludedBelow": sum(1 for k in below_keys
                              if results[k]["status"] == "occluded"),
        "hemBaseZ": hem_z,
        "transitionsDy0": transitions,
        "silhouetteCrossings": crossings,
        "marginMm": MARGIN_M * 1000.0,
        "patchPx": PATCH,
        "bodySource": "tools/openclinxr/evidence/hair-cage1/body-depth.npz "
                      "(bare body + garment, library topper excluded)",
        "results": results,
        "inputs": OPENED,
    }
    (E / "occl.json").write_text(json.dumps(payload, indent=2,
                                            sort_keys=True) + "\n")

    # ---- figure ----
    mask_f = np.asarray(Image.open(
        track(JUDGE / "mask-front-v2.png")).convert("L")) > 127
    body = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-station0b/body-verts.npz")))
    verts = np.array(body["vertices"], dtype=np.float64)
    fig, ax = plt.subplots(1, 2, figsize=(14, 7))
    a = ax[0]
    a.imshow(mask_f, cmap="gray", origin="upper")
    a.contour(body_t, levels=[0.5], colors=["orange"], linewidths=[1.0])
    for key, r in results.items():
        if key.startswith("sweep") and not key.endswith("_z%.3f" % 1.30):
            if "dy+0" not in key:
                continue
        col = ("lime" if r["status"] == "visible" else "red")
        ms = 7 if not key.startswith("sweep") else 3
        a.plot(r["colT"], r["rowT"], "o", color=col, ms=ms)
    for side, col in (("L", "cyan"), ("R", "magenta")):
        a.plot(hem_cols[side], hem_rows[side], "x",
               color=col, ms=12, mew=2)
        a.text(hem_cols[side] + 8, hem_rows[side] - 8,
               "%s hem %d" % (side, int(hem_rows[side])),
               color=col, fontsize=10, weight="bold")
        tt = crossings[side]["torsoTopRow"]
        if tt is not None:
            a.axhline(tt, color=col, ls="--", lw=1)
            a.text(735, tt + 14, "%s torso-top %d" % (side, tt),
                   color=col, fontsize=9)
    a.set_title("front: mask + body silhouette + candidates "
                "(lime=visible red=occluded)", fontsize=10)
    a.set_xlim(150, 900)
    a.set_ylim(750, 100)
    b = ax[1]
    sub = verts[np.linspace(0, len(verts) - 1, 2500).astype(int)]
    b.scatter(sub[:, 1], sub[:, 2], s=1, c="gray", alpha=0.5,
              label="body verts (Y-Z)")
    o_f = np.array(cam_f["location"], dtype=np.float64)
    b.plot(o_f[1], o_f[2], "b^", ms=10, label="front camera")
    for key, r in results.items():
        if key.startswith("sweep") and "dy+0" not in key:
            continue
        p = np.array(r["pointM"])
        col = ("lime" if r["status"] == "visible" else "red")
        ms = 7 if not key.startswith("sweep") else 3
        b.plot([o_f[1], p[1]], [o_f[2], p[2]], color=col, lw=0.4,
               alpha=0.6)
        b.plot(p[1], p[2], "o", color=col, ms=ms)
    b.axhline(1.405, color="orange", ls="--", lw=1, label="shoulder 1.405")
    b.axhline(1.4493, color="white", ls=":", lw=1, label="chin 1.4493")
    for key in ("profHemL", "profHemR"):
        p = np.array(results[key]["pointM"])
        b.text(p[1], p[2], " " + key, color="yellow", fontsize=8)
    b.set_xlabel("world Y (m, depth; front cam y=-0.70)")
    b.set_ylabel("world Z (m, up)")
    b.set_title("side (Y-Z): rays to candidates "
                "(lime=visible red=occluded)", fontsize=10)
    b.set_facecolor("black")
    b.legend(fontsize=8, loc="lower left")
    fig.suptitle("hair-occl0: front-hem occlusion test — %s "
                 "(below-hem occluded %d/%d)" % (
                     verdict, payload["nOccludedBelow"],
                     payload["nBelowHem"]))
    fig.tight_layout()
    fig.savefig(E / "occl.png", dpi=110)
    print("WROTE occl.json + occl.png verdict=%s belowOccluded=%d/%d" % (
        verdict, payload["nOccludedBelow"], payload["nBelowHem"]),
        flush=True)
    print("transitions: %s" % json.dumps(
        {s: {"deepestVisZ": (transitions[s]["deepestVisible"]["pointM"][2]
                             if transitions[s]["deepestVisible"] else None),
             "shallowestOccZ": (
                 transitions[s]["shallowestOccluded"]["pointM"][2]
                 if transitions[s]["shallowestOccluded"] else None),
             "deepestVisRowT": (
                 transitions[s]["deepestVisible"]["rowT"]
                 if transitions[s]["deepestVisible"] else None),
             "shallowestOccRowT": (
                 transitions[s]["shallowestOccluded"]["rowT"]
                 if transitions[s]["shallowestOccluded"] else None)}
         for s in ("L", "R")}), flush=True)
    print("crossings: %s" % json.dumps(crossings), flush=True)


if __name__ == "__main__":
    main()
