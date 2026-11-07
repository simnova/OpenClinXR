#!/usr/bin/env python3
"""hair-groom1 STEP 5: sheet + RESULT + GATES_PASS + DONE (single-sourced).

E/sheet.png: rows aisha-v3 target | groom1 studio | groom1 scorer;
cols front, three_quarter, profile_90, back; native 1024 uniformly
downscaled to T. E/RESULT.txt (all numbers, SAW, NOT TESTED),
E/GATES_PASS.txt (card-named gates), E/DONE.txt. Refuses PASS/DONE
unless gates.json passes and all card-named gates hold.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
VIEWS = ("front", "three_quarter", "profile_90", "back")
TGT = {"front": "target-front-a1.png",
       "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png",
       "back": "target-back.png"}
T = 512
LABEL_W = 200

_BAN = ["hair-" + "guides", "children" + "_station", "hair-" + "cap",
        "hair-" + "hem", "hair-" + "crown", "hair-" + "sweep",
        "score" + ".py"]


def main():
    opened = [str(Path(__file__).resolve())]
    gates = json.loads((E / "gates.json").read_text())
    if not gates.get("pass"):
        raise SystemExit("refusing PASS/DONE: gates.json fails")
    build = json.loads((E / "build.json").read_text())
    sr = json.loads((E / "score-render.json").read_text())
    sc = json.loads((E / "score.json").read_text())
    gs = json.loads((E / "grow-stats.json").read_text())
    import numpy as np
    F = np.load(str(E / "field.npz"))
    resid = json.loads(str(F["resid"][0]))
    nvh = json.loads(str(F["nview_hist"][0]))
    o2s = json.loads((E / "orient2d-stats.json").read_text())
    old = json.loads((ROOT / "tools/openclinxr/evidence/hair-orient0"
                      "/score.json").read_text())
    rt_scorer = json.loads((E / "renders" / "render-times.json")
                           .read_text())
    rt_studio = json.loads((E / "renders-studio" / "render-times.json")
                           .read_text())
    for p in ("gates.json", "build.json", "score-render.json",
              "score.json", "grow-stats.json", "field.npz",
              "orient2d-stats.json", "renders/render-times.json",
              "renders-studio/render-times.json"):
        opened.append(str(E / p))

    # Card-named gates.
    og = [("unreachable==0", gs["unreachable"] == 0, gs["unreachable"]),
          ("partCrossings==0",
           gs["partCrossings"]["crossingsOver2mm"] == 0,
           gs["partCrossings"]["crossingsOver2mm"]),
          ("earGate", bool(gs["ear"]["gate"]["pass"]),
           gs["ear"]["gate"]["pass"]),
          ("backGap<=20mm", gs["backGap"]["maxGapMm"] <= 20.0,
           gs["backGap"]["maxGapMm"])]
    for v in VIEWS:
        a, b = sc["orientAgree"][v]["wmean"], old["orientAgree"][v]["wmean"]
        og.append(("agree-%s vs orient0 (%.2f vs %.2f)" % (v, a, b),
                   True, "report"))
    sg = [(k, v["pass"]) for k, v in gates.items() if isinstance(v, dict)
          and "pass" in v and v.get("hard")]
    card_ok = all(ok for _, ok, *_ in og[:4]) and gates["pass"]
    if not card_ok:
        raise SystemExit("refusing PASS/DONE: card gates fail")

    # Sheet.
    rows = [("aisha-v3 target", None, None)]
    rows.append(("groom1 studio", E / "renders-studio", None))
    rows.append(("groom1 scorer", E / "renders", None))
    sheet = Image.new("RGB", (LABEL_W + 4 * T, 3 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src, _) in enumerate(rows):
        for j, v in enumerate(VIEWS):
            if src is None:
                p = SCR / TGT[v]
                opened.append(str(p))
                tim = Image.open(p).convert("RGB")
            else:
                p = src / (v + ".png")
                opened.append(str(p))
                tim = Image.open(p).convert("RGB")
            assert tim.size == (1024, 1024), (v, tim.size)
            sheet.paste(tim.resize((T, T)), (LABEL_W + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E / "sheet.png")
    opened.append(str(E / "sheet.png"))

    L = []
    L.append("RESULT hair-groom1: first full groom on the approved "
             "target (aisha-v3, ear-tucked, Imagine on Aisha)")
    L.append("support: hair-hull5/hull.npz (symmetric six-view hull, "
             "commit 0bdb80200; occ 393153 vox, spacing 2.0 mm)")
    L.append("CODE CHANGES (write root; why): orient/common_o.py: "
             "HAIR_E0 output redirect (run pipeline into hair-groom1 "
             "without overwriting hair-orient0) + HAIR_HULL_NPZ hull "
             "swap (route/common2.py is outside the write root, so the "
             "hull override lives in the orient loader; roots/SDF/body-"
             "depth/pinna/station frame shared, pinna = same-Aisha ears "
             "from hull3 since hull5 ships no pinna; shoulder_z taken "
             "from the override hull); orient/s02_field.py: hull-view "
             "index map (hull5 packs 6 views, positions 0..3 are NOT "
             "the four scoring views); strands/children.py: projection "
             "cap 8 -> 50 rounds (measured: 16-point slow-convergence "
             "pocket at the left sideburn needs 16 rounds; 8 left "
             "SDF<0); strands/render_studio.py: NEW scorer-parallel "
             "renderer under target2's studio rig (card step 3). No "
             "parameter changes otherwise: dilation 4 mm, conf floor "
             "0.30, gap0 0.2, growth/steering, 7/root, clumps "
             "(20 mm/0.40 + 4.5 mm/0.25), radii 0.06->0.02 mm, gap gate "
             "25 mm, Huang + look7 COLOR, Transmission 0.5.")
    L.append("STEP 1 field+guides on hull5: occ 393153 dil->" +
             "532008 vox; constrain front=202532 three_quarter=244336 "
             "profile_90=448144 back=501622 (conf>=0.30); residuals " +
             json.dumps(resid) + " (orient0 on hull3: front "
             "12.91/79.13/23.64, 3q 14.40/78.37/24.99, profile "
             "7.25/54.53/13.79, back 7.28/66.57/16.18 p50/p95/mean); "
             "nviews " + json.dumps(nvh) + "; maps " + json.dumps(
                 {v: {"maskPx": o2s[v]["maskPx"],
                      "confMean": o2s[v]["confMean"]} for v in VIEWS}) +
             " (s01 bit-identical to orient0: same inputs).")
    L.append("STEP 1 growth: Poisson n=%d (L=%d R=%d, spacing %.2f mm; "
             "340 <8mm-pinna + 33 root-cover excluded, counted); stops "
             "%s; lengths p50/p95/max %.0f/%.0f/%.0f mm; proj %d steps "
             "on %d guides (mean %.2f max %.2f mm); priorStepFrac %.4f."
             % (gs["nGuides"], 239, 238, gs["poissonSpacingMm"],
                json.dumps(gs["stops"]), gs["lengths"]["p50"],
                gs["lengths"]["p95"], gs["lengths"]["max"],
                sum(gs["stops"].values()) and gs["projSteps"],
                gs["projGuides"], gs["projMagMean"], gs["projMagMax"],
                gs["priorStepFrac"]))
    L.append("STEP 1 gates (orient0 gates on new guides): unreachable=%d "
             "(gate 0); part %s (gate 0 over 2mm); ear pass=%s near=%s "
             "covering=%d; back-centre gap %s (gate 20 mm); agreement "
             "new vs orient0 vs route2: %s; face guards %d px (gate 0)."
             % (gs["unreachable"], json.dumps(gs["partCrossings"]),
                gs["ear"]["gate"]["pass"],
                [gs["ear"]["xpos"]["nGuidesNear3mm"],
                 gs["ear"]["xneg"]["nGuidesNear3mm"]],
                gs["ear"]["occlusion"]["nGuidesCovering"],
                json.dumps(gs["backGap"]), json.dumps(
                    {v: [sc["orientAgree"][v]["wmean"],
                         old["orientAgree"][v]["wmean"],
                         sc["route2Agree"][v]["wmean"]] for v in VIEWS}),
                sc["orientFaceGuards"]["totalCoveredPx"]))
    L.append("STEP 1 tubes vs masks (guide level, 3 mm tubes, report): "
             + json.dumps({v: sc["orientRegional"][v]["whole"]
                           for v in VIEWS}))
    L.append("STEP 2 strands: roots=%d guides=%d pointsPer=%d children=%d"
             " (7 per root, Voronoi sub-roots seed 11, cellR p50 %.3f "
             "max %.3f mm); blend %s meanW0=%.4f nAlone=%d rootExact=%.4f"
             " mm; gapGate %s; clump coarse 20mm/0.40 (%d cells) fine "
             "4.5mm/0.25 (%d cells); jitter sigma %.2f seed %d [%.4f,"
             "%.4f]; radii root %.3f -> tip %.3f mm; sha256=%s bytes=%d."
             % (build["counts"]["roots"], build["counts"]["guides"],
                build["counts"]["pointsPer"], build["counts"]["children"],
                build["subRoots"]["cellRmmP50"],
                build["subRoots"]["cellRmmMax"], build["blend"]["kernel"],
                build["blend"]["meanWeight0"], build["blend"]["nAlone"],
                build["blend"]["rootExactnessMmMax"],
                json.dumps(build["blend"]["gapGate"]),
                build["clump"]["coarseCells"]["nCells"],
                build["clump"]["fineCells"]["nCells"],
                build["lengthJitter"]["sigma"],
                build["lengthJitter"]["seed"],
                build["lengthJitter"]["scaleMin"],
                build["lengthJitter"]["scaleMax"],
                build["radiiMm"]["root"], build["radiiMm"]["tip"],
                build["sha256"], build["bytes"]))
    L.append("STEP 2 projection (exact SDF, 0.3 mm margin, s>=1, roots "
             "pinned, 50-round cap): %s." % json.dumps(
                 build["projection"], sort_keys=True))
    L.append("STEP 2 gates (strands1 gates): count %d/%d; assignAcross %d"
             " (HARD 0); tipDrift %d overshoot p50 %.2f max %.2f mm "
             "guideTipCross %d (advisory, shape-owned); inside %d "
             "(HARD 0); determinism %s==%s; lane backStrands %d "
             "guideSpacing %.2f mm lag %d peakRatio %.3f (gate <1.5) "
             "shear ours %.2f deg (n=%d) vs control %.2f deg; frames "
             "spin %.6f deg/100mm ortho %.2e." % (
                 gates["count"]["n"], gates["count"]["expect"],
                 gates["partCrossings"]["nAssignAcross"],
                 gates["partCrossings"]["tipDriftAcross"],
                 gates["partCrossings"]["tipOvershootMmP50"],
                 gates["partCrossings"]["tipOvershootMmMax"],
                 gates["partCrossings"]["guideTipCross"],
                 gates["insideBody"]["nSge1Inside"],
                 gates["determinism"]["hashA"][:16],
                 gates["determinism"]["hashB"][:16],
                 gates["lane"]["nBackStrands"],
                 gates["lane"]["guideSpacingMm"], gates["lane"]["lagBins"],
                 gates["lane"]["peakRatio"],
                 gates["lane"]["shear"]["oursTangentRmsDeg"],
                 gates["lane"]["shear"]["nGroups"],
                 gates["lane"]["shear"]["controlTangentRmsDeg"],
                 gates["framesSelfTest"]["spinPer100mmDeg"],
                 gates["framesSelfTest"]["orthoMax"]))
    L.append("STEP 3 renders (Cycles 1024 px / 64 spp / seed 7 / OIDN): "
             "STUDIO rig = target2 verbatim (world 0.5 grey, 12 m "
             "backdrop (0.72,0.72,0.74) at y+2.2, Area key 100 W/2 m "
             "front-left + fill 40 W/2 m front-right + rim 60 W/1.5 m "
             "behind-top, film opaque, pink shirt, topper removed) "
             "times %s total %.1fs; SCORER rig (v3-scorer suns "
             "5.0/1.0/1.5 + world 0.03, continuity) times %s total "
             "%.1fs; material Principled Hair BSDF HUANG COLOR direct "
             "COLOR + look7 COLOR Transmission 0.5." % (
                 json.dumps(rt_studio["seconds"], sort_keys=True),
                 rt_studio["total"],
                 json.dumps(rt_scorer["seconds"], sort_keys=True),
                 rt_scorer["total"]))
    L.append("STEP 4 vs aisha-v3 targets (STUDIO render, ID>=230 vs "
             "mask): contour whole-mask " + json.dumps(
                 {v: sr["contour"][v]["whole"] for v in VIEWS}) +
             "; regional " + json.dumps(
                 {v: {r: {k: sr["contour"][v][r][k]
                          for k in ("excessP50", "excessP95", "missP50",
                                    "missP95")} for r in
                      ("crown", "mid", "hem", "left", "right")}
                  for v in VIEWS}) + "; IoU " + json.dumps(sr["iou"]))
    L.append("STEP 4 orientation agreement rendered hair (Gabor on "
             "render vs target, both-mask px, conf-product weighted): "
             + json.dumps(sr["agree"]))
    L.append("STEP 4 color (target-in-target-mask vs render-in-render-"
             "mask + render-in-intersection; lum rec709 0-255, hue deg "
             "circular mean, sat 0-1): " + json.dumps(sr["color"]))
    L.append("STEP 4 skin-through crown_top+back (SCORER rig, rig-"
             "matched vs strands1, rulers4b-R4): groom1 refs %s views "
             "%s backDecomp %s; strands1 refs %s views %s backDecomp "
             "%s." % (
                 json.dumps(sr["coverageScorerRig"]["refs"]),
                 json.dumps(sr["coverageScorerRig"]["views"]),
                 json.dumps(sr["coverageScorerRig"]["backDecomposition"]),
                 json.dumps(sr["coverageScorerRig"]["strands1"]["refs"]),
                 json.dumps(sr["coverageScorerRig"]["strands1"]["views"]),
                 json.dumps(sr["coverageScorerRig"]["strands1"]
                            ["backDecomposition"])))
    L.append("READ: crown overlap good (green) but front chest curtains "
             "run long (red to row ~950, excessP50 159.8 px) while the "
             "side curtain band sits narrow vs target (blue); back mass "
             "narrower + shorter than target (missP95 80.4, IoU 0.6448); "
             "render hair darker/less saturated than target "
             "(inter lum p50 ~11-14 vs ~26-35, sat ~0.2 vs ~0.3-0.5) "
             "under the look7 COLOR + Transmission-0.5 stack; crown_top "
             "skin-through ~0 (decisive); back 0.2396 vs strands1 "
             "0.2320 with hem alpha 255/243 + warm-gated 0.0011 = "
             "transmission glow, not gaps (same reading as strands1).")
    hits, mentions = ban_grep()
    L.append("ban-grep (7 names, fragments) over strands/*.py + E "
             "json/txt (RESULT/DONE excluded): sibling hits %s; "
             "card-sanctioned input-path mentions %s." % (
                 hits if hits else "none",
                 mentions if mentions else "none"))
    if hits:
        raise SystemExit("ban-grep sibling hits: %s" % hits)
    prev = []
    if (E / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    merged = sorted(set(prev) | set(opened))
    (E / "inputs-opened.txt").write_text("\n".join(merged) + "\n")
    L.append("inputs-opened log (%d paths) in E/inputs-opened.txt; "
             "render inputs in E/blender-opened.txt + "
             "E/blender-opened-studio.txt." % len(merged))
    L.append("SAW")
    L.append("- SCOPE: first full groom on the approved ear-tucked "
             "target: orient field + 477 traced guides on hull5, 99085 "
             "frame-transport children, Cycles renders under the "
             "target2 studio rig (directly comparable) + the v3-scorer "
             "rig (continuity), scored against the aisha-v3 targets. "
             "Silhouette length/width mismatches are guide-shape-owned "
             "(hull hem + maxlen drape, no length fit attempted); color "
             "darkness is material-owned (look7 COLOR + T0.5 stack, no "
             "relight attempted).")
    L.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
             "clinical validity, licensure, or scoring claims; "
             "EEVEE/Quest material response; other bodies/seeds; "
             "animation/combing dynamics; strands/cards bake-off "
             "numbers; relit/held-out R1 rows; guide-shape adequacy "
             "beyond the reported contour/agreement numbers.")
    (E / "RESULT.txt").write_text("\n".join(L) + "\n")

    G = ["GATES_PASS hair-groom1"]
    for name, ok, val in og[:4]:
        G.append("%s: %s (value %s)" % (name, "PASS" if ok else "FAIL",
                                        val))
    for name, ok, val in og[4:]:
        G.append("%s: %s" % (name, val))
    for k, ok in sg:
        G.append("strands-%s: %s" % (k, "PASS" if ok else "FAIL"))
    G.append("guide-tube contour + render contour/IoU/agreement/color: "
             "REPORT-ONLY scores in RESULT.txt (guide tubes fail the "
             "orient0 p50<=12/p95<=24 bar as in orient0; "
             "MODEL_INADEQUATE at guide level, same verdict).")
    (E / "GATES_PASS.txt").write_text("\n".join(G) + "\n")
    (E / "DONE.txt").write_text(
        "DONE hair-groom1: field+guides on hull5 + 99085 strands + "
        "studio/scorer renders + sheet.png + RESULT.txt + "
        "GATES_PASS.txt; card gates pass.\n")
    print("wrote sheet.png RESULT.txt GATES_PASS.txt DONE.txt")


def ban_grep():
    S9 = ROOT / "tools/openclinxr/hair-groom/strands"
    sibling, mentions = [], []
    files = list(S9.glob("*.py"))
    files += list(E.glob("*.json"))
    files += [f for f in E.glob("*.txt")
              if f.name not in ("RESULT.txt", "DONE.txt")]
    build = json.loads((E / "build.json").read_text())
    sanct = (build["inputs"]["guides"], build["inputs"]["roots"],
             build["inputs"]["sdf"],
             "tools/openclinxr/hair-groom/orient/s04_score.py")
    for f in files:
        for ln, line in enumerate(f.read_text().splitlines(), 1):
            for b in _BAN:
                if b in line:
                    tag = "%s:%d:%s" % (f.name, ln, b)
                    if any(s and s in line for s in sanct):
                        mentions.append(tag)
                    else:
                        sibling.append(tag)
    return sibling, mentions


if __name__ == "__main__":
    main()
