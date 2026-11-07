#!/usr/bin/env python3
"""STEP 5: export guides.npz, Blender figures, RESULT.txt, DONE.txt.

guides.npz follows the route2 schema (curves_head 41-pt head-mm,
crown, tube_r 3.0, status, ok_idx, roots_file, y_ear_mm, verdict) so
the pinned guides/render_guides.py renders it unchanged. Figures:
E/guides.png (Workbench thin tubes on Aisha, four views) +
E/guides-vs-target.png (render beside aisha-v3 target tiles).
RESULT.txt carries all numbers vs route2, SAW, NOT TESTED, and the
verdict (ADEQUATE iff unreachable 0 AND crossings 0 AND ear gate
AND orientation agreement better than route2 in every view AND
regional whole-mask p95 <= 24 / p50 <= 12 in every view).
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402
import measure as ME  # noqa: E402

VIEWS4 = CO.VIEWS4


def main():
    t0 = time.time()
    CO.track(S10 / "s05_export.py")
    inp = CO.load_all()
    G = np.load(str(CO.E0 / "grown.npz"))
    stats = json.loads((CO.E0 / "grow-stats.json").read_text())
    score = json.loads((CO.E0 / "score.json").read_text())
    F = np.load(str(CO.E0 / "field.npz"))
    n = len(G["roots_mm"])
    _rx = np.array(G["roots_mm"])[:, 0]
    _nL, _nR = int((_rx < 0).sum()), int((_rx >= 0).sum())

    fail = []
    if stats["unreachable"] != 0:
        fail.append("unreachable=%d" % stats["unreachable"])
    if stats["partCrossings"]["crossingsOver2mm"] != 0:
        fail.append("partCrossings=%d"
                    % stats["partCrossings"]["crossingsOver2mm"])
    eg = stats["ear"]
    if not eg["gate"]["pass"]:
        fail.append("ear near3 xpos/xneg=%d/%d covering=%d" % (
            eg["xpos"]["nGuidesNear3mm"],
            eg["xneg"]["nGuidesNear3mm"],
            eg["occlusion"]["nGuidesCovering"]))
    for view in VIEWS4:
        a, b = score["orientAgree"][view]["wmean"], \
            score["route2Agree"][view]["wmean"]
        if not (a < b):
            fail.append("agree %s %.1f>=%.1f" % (view, a, b))
    for view in VIEWS4:
        w = score["orientRegional"][view]["whole"]
        for m, lim in (("excessP50", 12.0), ("excessP95", 24.0),
                       ("missP50", 12.0), ("missP95", 24.0)):
            if w[m] > lim:
                fail.append("%s %s=%.1f" % (view, m, w[m]))
    if score["orientFaceGuards"]["totalCoveredPx"] != 0:
        fail.append("faceGuards=%d"
                    % score["orientFaceGuards"]["totalCoveredPx"])
    verdict = "ADEQUATE" if not fail else "MODEL_INADEQUATE"

    # guides.npz (route2 schema).
    crown = np.asarray(inp["crown"], dtype=np.float64)
    curves = [np.array(G["curves_mm"][j]) for j in range(n)]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    ch = np.zeros((n, 41, 3))
    ok_idx = []
    status = []
    for j, c in enumerate(curves):
        if len(c) < 2:
            status.append("unreachable")
            continue
        ch[j] = CO.world_to_head(ME.resample_arc41(c / 1000.0, 41),
                                 crown)
        ok_idx.append(j)
        status.append("grown")
    ok_idx = np.array(ok_idx, dtype=np.int64)
    np.savez_compressed(
        str(CO.E0 / "guides.npz"), curves_head=ch, crown=crown,
        param_names=np.array(["tube_r"]),
        param_values=np.array([3.0]),
        spec_sha=np.array(["orient0"]),
        status=np.array(status),
        ok_idx=ok_idx,
        roots_file=np.array(["hair-scalp1/roots.npz Poisson "
                             "streamline-grown on orient field"]),
        y_ear_mm=np.array([float(np.asarray(
            G["y_ear_mm"]).ravel()[0])]),
        verdict=np.array([verdict]))
    print("WROTE guides.npz guides=%d ok=%d" % (n, len(ok_idx)),
          flush=True)

    # Blender render (pinned script, read-only).
    blender = "/Applications/Blender.app/Contents/MacOS/Blender"
    CO.track(CO.ROOT / "tools/openclinxr/hair-groom/guides"
             / "render_guides.py")
    CO.track(CO.ROOT / "apps/ui-xr/public/generated-humanoids/"
             "mpfb-peds-parent-aisha.glb")
    CO.track(CO.ROOT / "tools/openclinxr/hair-groom/manifests/"
             "cameras-scorer-v3.json")
    r = subprocess.run(
        [blender, "--background", "--python",
         str(CO.ROOT / "tools/openclinxr/hair-groom/guides"
             / "render_guides.py"),
         "--", "--guides-npz", str(CO.E0 / "guides.npz"), "--outdir",
         str(CO.E0),
         "--glb", str(CO.ROOT / "apps/ui-xr/public/generated-humanoids/"
                      "mpfb-peds-parent-aisha.glb"),
         "--cameras", str(CO.ROOT / "tools/openclinxr/hair-groom"
                          "/manifests/cameras-scorer-v3.json"),
         "--opened", str(CO.E0 / "blender-opened.txt"), "--stem",
         "guides"],
        capture_output=True, text=True, timeout=1800)
    print(r.stdout[-2000:], flush=True)
    print(r.stderr[-1000:], flush=True)
    if r.returncode != 0:
        raise RuntimeError("blender render failed rc=%d" % r.returncode)
    assert (CO.E0 / "guides.png").exists()
    for view in VIEWS4:
        assert (CO.E0 / ("guides-%s.png" % view)).exists(), view

    # vs-target composite.
    from PIL import Image, ImageDraw
    cols = []
    for view in VIEWS4:
        tp = CO.SCRATCH / CO.BEAUTY_TILE[view]
        CO.track(tp)
        ren = Image.open(CO.E0 / ("guides-%s.png" % view)).convert(
            "RGB")
        tgt = Image.open(tp).convert("RGB").resize((512, 512))
        col = Image.new("RGB", (512, 512 * 2 + 56), (16, 16, 16))
        col.paste(ren, (0, 28))
        col.paste(tgt, (0, 512 + 56))
        d = ImageDraw.Draw(col)
        d.text((8, 7), "orient0 " + view, fill=(255, 255, 255))
        d.text((8, 512 + 35), "aisha-v3 target " + view,
               fill=(255, 255, 255))
        cols.append(col)
    fig = Image.new("RGB", (512 * 4, 512 * 2 + 56), (0, 0, 0))
    for i, col in enumerate(cols):
        fig.paste(col, (512 * i, 0))
    fig.save(CO.E0 / "guides-vs-target.png")
    print("WROTE guides-vs-target.png", flush=True)

    # RESULT.txt.
    resid = json.loads(str(F["resid"][0]))
    nvh = json.loads(str(F["nview_hist"][0]))
    o2s = json.loads((CO.E0 / "orient2d-stats.json").read_text())
    L = []
    L.append("hair-orient0: multi-view orientation field + traced "
             "guides (aisha-v3) -- RESULT")
    L.append("=" * 78)
    L.append("WRITE ROOTS: S10 = tools/openclinxr/hair-groom/orient "
             "(common_o, measure, s01_orient2d, s02_field, s03_grow, "
             "s04_score, s05_export, diag); E = tools/openclinxr/"
             "evidence/hair-orient0. hull/route/strands/cage/scalp "
             "and hair-score/orientation.py read-only (Gabor bank "
             "imported). No third-party code (numpy/scipy/PIL/cv2 "
             "via orientation.py). No *.blend.")
    L.append("INPUTS: hull3/hull.npz + scalp1 roots/scalp + cage1 "
             "exact-SDF + cage1 body-depth (front/profile/back) + "
             "hull3-workspace body-depth-3q + station-frame + hull3 "
             "ear_pinna.npz + v4 manifest (identity registration) + "
             "aisha-v3 beauties + Aisha GLB + route2 paths/guides "
             "npz (reference only). Full runtime list: "
             "E/inputs-opened.txt.")
    L.append("METHOD (Paris 2004 / Wei 2005 pattern, implemented, no "
             "third-party code): (1) per-pixel 2D orientation + "
             "confidence inside hair masks from the pinned Gabor "
             "bank (k15/lambda4.0/sigma3.0/gamma0.5, single scale; "
             "confidence=(peak-mean)/(peak+eps)); strand tangent = "
             "filter angle + 90 deg (synthetic-grating calibrated). "
             "Maps: " + json.dumps(
                 {v: {"maskPx": o2s[v]["maskPx"],
                      "confMean": o2s[v]["confMean"],
                      "confMin": o2s[v]["confMin"]} for v in VIEWS4}))
    L.append("FLOW READ (E/orient2d.png): colour=orientation, "
             "brightness=confidence. Crown flow diverges from the "
             "centre part (green left / blue right in front+back); "
             "curtains + back mass run down (red = vertical).")
    L.append("FIELD (E/field.npz): hull occupancy dilated 4 mm "
             "(2 vox; N=641014); per voxel/view (visible-inside-"
             "mask, conf>=0.30 floor) plane through camera centre "
             "containing the 2D strand line; t = smallest "
             "eigenvector of sum w n n^T (w=confidence); "
             "eigen-gap g=(l1-l0)/trace; beta=min(nviews,2)/2*"
             "clip(g/0.2,0,1) toward prior (part-away scalp tangent "
             "-> gravity, 15-45 mm cosine, gates1 release numbers); "
             "sign away-from-part-then-down; one 3x3x3 sign-aligned "
             "box smooth. Constraining views: " + json.dumps(nvh)
             + ". Reprojection residuals (3D dir vs 2D map, "
             "p50/p95/mean per view): " + json.dumps(resid))
    L.append(("GROWTH: Poisson scalp1 subset (crown-first, spacing "
              "%.2f mm) n=%d (L=%d R=%d; 340 roots <8 mm of pinna + "
              "33 root-covering-pinna roots excluded from pool, "
              "counted); RK2 midpoint 1 mm; field trilinear "
              "(travel-aligned) else owning-root prior; post-entry "
              "domain = eroded interior (hull-dist>=3 mm AND "
              "exact-SDF>=2 mm, route erosion rule); leader = head "
              "veto only until first eroded entry (60 mm noentry "
              "grace); walls (part plane 2 mm tol, ear 8 mm keep-out, "
              "face-air corridor anterior half, silhouette "
              "visible-outside 5 px slop + mirrored 3q/profile for "
              "L/R symmetry); slide-or-stop + silhouette-redirect "
              "down; stops " + json.dumps(stats["stops"])
              + "; hem exit / generous maxlen cap "
              "(root-drop+100, <=600). Retry pass on face stops "
              "(route2 retry precedent). Smooth: Gaussian sigma=2.0 "
              "mm (light spline), root re-anchored. Projected steps: "
              "%d on %d guides (mean %.2f max %.2f mm); steered "
              "steps counted in log; prior-fallback frac %.4f; "
              "lengths p50/p95/max %.0f/%.0f/%.0f mm.") % (
                  stats["poissonSpacingMm"], stats["nGuides"],
                  _nL, _nR, stats["projSteps"], stats["projGuides"],
                  stats["projMagMean"], stats["projMagMax"],
                  stats["priorStepFrac"], stats["lengths"]["p50"],
                  stats["lengths"]["p95"], stats["lengths"]["max"]))
    L.append("GATES: unreachable=%d (0 expected); part %s; ear %s; "
             "back-centre gap %s (gate 20 mm); turns (report only) "
             "%s; containment-min %.3f (%d guides <0.95); face "
             "guards %d px (gate 0)." % (
                 stats["unreachable"],
                 json.dumps(stats["partCrossings"]),
                 json.dumps({"pass": eg["gate"]["pass"],
                             "near": [eg["xpos"]["nGuidesNear3mm"],
                                      eg["xneg"]["nGuidesNear3mm"]],
                             "covering": eg["occlusion"][
                                 "nGuidesCovering"]}),
                 json.dumps(stats["backGap"]), json.dumps(
                     stats["turn"]), stats["containMin"],
                 stats["containBelow95"],
                 score["orientFaceGuards"]["totalCoveredPx"]))
    L.append("TUBES vs aisha-v3 masks, 3 mm tubes, whole-mask "
             "(excess p50/p95, miss p50/p95; gate p50<=12 p95<=24): "
             + json.dumps({v: score["orientRegional"][v]["whole"]
                           for v in VIEWS4}) + " vs route2: "
             + json.dumps({v: score["route2Regional"][v]["whole"]
                           for v in VIEWS4}))
    L.append("ORIENTATION AGREEMENT (primary; conf-weighted mean "
             "abs angle, 3 mm tangent baseline scale-matched to "
             "Gabor support; orient vs route2): " + json.dumps(
                 {v: [score["orientAgree"][v]["wmean"],
                      score["route2Agree"][v]["wmean"]]
                  for v in VIEWS4}))
    L.append("SAW: E/guides.png (Workbench thin tubes on Aisha, 4 "
             "views) + E/guides-vs-target.png (render beside "
             "aisha-v3 tiles); E/guides.npz (%d curves_head 41-pt "
             "head-mm, tube_r 3.0)." % len(ok_idx))
    L.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
             "clinical validity, licensure, or scoring claims; "
             "strands/material/lighting (guide tubes only); guide "
             "interpolation density (comb gaps); max-turn "
             "acceptance (report-only; 441/477 guides exceed the "
             "route 15 deg bar, as do 100/309 relaxed route2 "
             "guides).")
    L.append("VERDICT: %s" % verdict)
    if fail:
        L.append("FAILURES: " + "; ".join(fail))
    (CO.E0 / "RESULT.txt").write_text("\n".join(L) + "\n")
    (CO.E0 / "DONE.txt").write_text(
        "hair-orient0 done: verdict %s\n" % verdict)
    print("\n".join(L), flush=True)
    CO.write_inputs_log([S10 / "s05_export.py", CO.E0 / "guides.npz"])
    print("STEP5 done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
