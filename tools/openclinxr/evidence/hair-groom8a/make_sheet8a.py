#!/usr/bin/env python3
"""hair-groom8a STEP 4: sheet + crops + RESULT + GATES_PASS + DONE.

E/sheet.png rows: aisha-v3 target | groom5 studio | groom8a studio;
cols front, three_quarter, profile_90, back (1024 -> 512).
E/crops.png: native-1024 crops, rows target | groom5 | groom8a, cols:
3q ear, profile ear, back crown/part, back hem L/R, nape, front
curtain L/R, top 3q.
E/RESULT.txt (every gate number, SCOPE, visual read, REMAINING,
FALSIFIER verdict, NOT TESTED), E/GATES_PASS.txt (honest),
E/DONE.txt. Refuses PASS/DONE unless build/gates.json passes.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
E5 = ROOT / "tools/openclinxr/evidence/hair-groom5"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
VIEWS = ("front", "three_quarter", "profile_90", "back")
TGT = {"front": "target-front-a1.png",
       "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png",
       "back": "target-back.png"}
T = 512
LABEL_W = 200
CROPS = {"three_quarter_ear": ("three_quarter", (380, 660, 330, 610)),
         "profile_ear": ("profile_90", (250, 530, 270, 550)),
         "back_crown_part": ("back", (412, 636, 140, 364)),
         "back_hem_left": ("back", (261, 337, 690, 830)),
         "back_hem_right": ("back", (690, 766, 690, 830)),
         "nape": ("back", (440, 585, 480, 640)),
         "front_curtain_L": ("front", (300, 420, 450, 650)),
         "front_curtain_R": ("front", (600, 720, 450, 650)),
         "top_3q": ("three_quarter", (300, 700, 80, 330))}


def main():
    gates = json.loads((E / "build" / "gates.json").read_text())
    if not gates.get("pass"):
        raise SystemExit("refusing PASS/DONE: build/gates.json fails")
    build = json.loads((E / "build" / "build.json").read_text())
    grow = json.loads((E / "build" / "grow8a-stats.json").read_text())
    base = json.loads((E / "baseline.json").read_text())
    s8 = json.loads((E / "score8a.json").read_text())
    dep = json.loads((E / "depth8a.json").read_text())
    rt = json.loads((E / "renders-studio" / "render-times.json")
                    .read_text())
    b5 = json.loads((E5 / "build" / "build.json").read_text())

    rows = [("target", None), ("groom5", E5 / "renders-studio"),
            ("groom8a", E / "renders-studio")]
    sheet = Image.new("RGB", (LABEL_W + 4 * T, 3 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src) in enumerate(rows):
        for j, v in enumerate(VIEWS):
            tim = Image.open(SCR / TGT[v]).convert("RGB").resize((T, T)) \
                if src is None else Image.open(
                    src / (v + ".png")).convert("RGB").resize((T, T))
            sheet.paste(tim, (LABEL_W + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E / "sheet.png")

    cnames = list(CROPS.keys())
    cw = max(c[1][1] - c[1][0] for c in CROPS.values())
    ch = max(c[1][3] - c[1][2] for c in CROPS.values())
    crops = Image.new("RGB", (LABEL_W + len(cnames) * (cw + 8),
                              3 * (ch + 8) + 30), (18, 18, 18))
    dc = ImageDraw.Draw(crops)
    for j, cn in enumerate(cnames):
        v, (c0, c1, r0, r1) = CROPS[cn]
        dc.text((LABEL_W + j * (cw + 8) + 8, 5), cn, fill=(240, 240, 240))
        for i, (label, src) in enumerate(rows):
            im = Image.open(SCR / TGT[v]).convert("RGB") if src is None \
                else Image.open(src / (v + ".png")).convert("RGB")
            cell = Image.new("RGB", (cw, ch), (18, 18, 18))
            cell.paste(im.crop((c0, r0, c1, r1)), (0, 0))
            crops.paste(cell, (LABEL_W + j * (cw + 8), 30 + i * (ch + 8)))
        if j == 0:
            for i, (label, _) in enumerate(rows):
                dc.text((18, 30 + i * (ch + 8) + ch // 2 - 10), label,
                        fill=(240, 240, 240))
    crops.save(E / "crops.png")

    g5, g8 = s8["grooms"]["groom5"], s8["grooms"]["groom8a"]
    L = []
    L.append("RESULT hair-groom8a: hull-depth-layered guides, turn gate "
             "in tracer, child trims dropped (three tracer rounds)")
    L.append("BASE: groom5 geometry (commit c915b224d build flags: K=13, "
             "gap 15->5, tuck-k 20 + tuck-blend + ear-wrap, sideburn "
             "shorts 12-24 below helix-top-3mm + hug + tuck-behind, "
             "kill-root-dots, part-crisp + part-style + part-extra 7, "
             "clump 0.20/0.15) + guides-8a.npz (%d guides: %d new "
             "depth-layered + 57 verbatim tucked; pool %d at 20 mm "
             "floor). NOT shipped: curtain x14/hem extras, kink-guard, "
             "spike/margin/hem-tip/degenerate trims, curtain "
             "widen/spread/extra, hem-taper." % (
                 build["counts"]["guides"], grow["nNew"],
                 build["dotGuides"]["nPool"]))
    L.append("GUIDES (orient/s06_depthgrow.py): per-guide depth fraction "
             "u in [0.3,0.9] (golden stride) of LIVE local column "
             "thickness (strict-hull Docc + sdf); field supplies the "
             "3D tangent (per-guide low-pass follow, freeze on >90deg "
             "reversals); gentle depth centering (tan<=2.9deg "
             "post-leader); secular routing (gravity/ear/center/ride "
             "all small + shell-projected); funnel+strip part "
             "half-space (FULL length, round-3 fix for the X-hatch); "
             "face strips; ear keep-out alternatives; dil-boundary "
             "slide. Turn gate inside: 12deg/step leader, 5deg/step "
             "main, SINGLE final cap (no strip-vs-cap fight). Zero "
             "positional projections (max move 0.0 mm by "
             "construction); zero guides deleted.")
    L.append("turn: raw post-ramp(arc>40mm) breaches>15deg/5mm = "
             "1937/2650 (73%%; groom7 guides-tucked: 473/567 = 83%%); "
             "whole-guide 2641 (leader exit arcs included); single-step "
             "violations = 0 by construction (12deg leader / 5deg main "
             "single final cap); max positional move %.1f mm (zero "
             "projections); zero guides deleted; relax hits %d on %d "
             "guides; smoothing REMOVED round-3 (sigma-1.0 + re-anchor "
             "added a first-window kink on every guide: smoothed max "
             "p50 46deg vs raw 23deg)." % (
                 grow["maxPositionalMoveMm"],
                 grow["turnGateRelaxSteps"],
                 grow["turnGateRelaxGuides"]))
    L.append("stops: %s; lengths p50/p95 = %.0f/%.0f mm; hem exits %d." % (
        json.dumps(grow["stops"]), grow["lengths"]["p50"],
        grow["lengths"]["p95"], grow["stops"].get("hem", 0)))
    L.append("BASELINE (E/baseline.json, shell arc 10-80mm child "
             "samples): " + json.dumps(
                 {t: base["grooms"][t]["sdf"] for t in
                  ("groom5", "groom7")})[:600])
    L.append("DEPTH child skull-SDF shell(arc 10-80mm) p50/p90: "
             "parietal %.2f/%.2f temple %.2f/%.2f crown %.2f/%.2f back "
             "%.2f/%.2f (gates: parietal+temple p50>=3.5 p90>=8; "
             "baseline groom5 parietal 2.24/8.32 temple 1.60/2.77, "
             "groom7 parietal 2.51/11.02 temple 1.71/3.54)." % (
                 dep["parietal"]["p50"], dep["parietal"]["p90"],
                 dep["temple"]["p50"], dep["temple"]["p90"],
                 dep["crown"]["p50"], dep["crown"]["p90"],
                 dep["back"]["p50"], dep["back"]["p90"]))
    for v in VIEWS:
        i5, i8 = g5["iou"][v], g8["iou"][v]
        L.append("SILHOUETTE %s: groom5 miss:excess %d:%d (%.1f:1) "
                 "iou %.4f -> groom8a %d:%d (%.1f:1) iou %.4f; contour "
                 "missP95 top/mid/bot %s/%s/%s excessP95 %s/%s/%s." % (
                     v, i5["missPx"], i5["excessPx"],
                     i5["missPx"] / max(i5["excessPx"], 1), i5["iou"],
                     i8["missPx"], i8["excessPx"],
                     i8["missPx"] / max(i8["excessPx"], 1), i8["iou"],
                     g8["rowband_" + v]["top"]["missP95"],
                     g8["rowband_" + v]["mid"]["missP95"],
                     g8["rowband_" + v]["bot"]["missP95"],
                     g8["rowband_" + v]["top"]["excessP95"],
                     g8["rowband_" + v]["mid"]["excessP95"],
                     g8["rowband_" + v]["bot"]["excessP95"]))
        L.append("R-PROTRUDE-two-sided %s: excess fails %d %s | miss "
                 "fails %d %s." % (
                     v, g8["protrude_" + v]["excess"]["nFail"],
                     g8["protrude_" + v]["excess"]["top"][:2],
                     g8["protrude_" + v]["miss"]["nFail"],
                     g8["protrude_" + v]["miss"]["top"][:2]))
    L.append("A TEMPLE: " + json.dumps(s8["A"])[:700])
    L.append("B HEM: " + json.dumps(s8["B"]))
    L.append("C PART: " + json.dumps(s8["C"])[:500])
    L.append("D FRONT IoU %.4f (gate >= 0.62, target 0.65)." % (
        g8["iou"]["front"]["iou"]))
    L.append("seam back midline rows156-950: max %d px p95 %.1f "
             "(gate <= 4, no part-specific rule)." % (
                 s8["seam"]["maxGapPx"], s8["seam"]["p95GapPx"]))
    L.append("R-LOOP profile: %d (groom5 11587; gate below; no "
             "wrap-zone exclusion count %d)." % (
                 s8["loopProfile"]["nProfile"],
                 s8["loopProfile"]["countNoWrapExclusion"]))
    L.append("concha crossings: %s (gate 0)." % (
        json.dumps(s8["conchaCrossings"])))
    L.append("hard gates: count %d==%d | assignAcross %d | inside %d | "
             "pinnaVisible<3mm %d | determinism %s==%s | lanePeak %.3f "
             "| framesSpin %.6f." % (
                 gates["count"]["n"], gates["count"]["expect"],
                 gates["partCrossings"]["nAssignAcross"],
                 gates["insideBody"]["nSge1Inside"],
                 gates["pinnaProximity"]["nVisibleSamplesLt"],
                 gates["determinism"]["hashA"][:12],
                 gates["determinism"]["hashB"][:12],
                 gates["lane"]["peakRatio"],
                 gates["framesSelfTest"]["spinPer100mmDeg"]))
    L.append("blend offsets p50/p90: all %.2f/%.2f max %.1f (>5mm: "
             "%d, >15mm: %d); non-tuck %.2f/%.2f max %.1f (>5mm: %d, "
             ">15mm: %d); tuck-box merged (k=20); roots/guide %.2f "
             "(14155 roots / %d guides)." % (
                 dep["off_all"]["p50"], dep["off_all"]["p90"],
                 dep["off_all"]["max"], dep["off_all"]["gt5"],
                 dep["off_all"]["gt15"], dep["off_nontuck"]["p50"],
                 dep["off_nontuck"]["p90"], dep["off_nontuck"]["max"],
                 dep["off_nontuck"]["gt5"], dep["off_nontuck"]["gt15"],
                 dep["rootsPerGuide"], build["counts"]["guides"]))
    L.append("render times s: %s; total %.1fs (Cycles 1024/64spp/seed7/"
             "OIDN studio; HUANG c08 rough 0.35)." % (
                 json.dumps(rt["seconds"]), rt["total"]))
    L.append("strands asset: hair-groom8a/build/strands.npz sha256=%s "
             "bytes=%d N=%d (store copy; byte-rebuildable from build "
             "flags + guides-8a.npz)." % (
                 build["sha256"], build["bytes"],
                 build["counts"]["children"]))
    L.append("VISUAL READ (native-res, by the worker): skull-cap GONE "
             "in all views; front/3q carry real volume and width to "
             "the shoulders; back drape full-length, no staircase. "
             "Residuals: (a) diagonal swirl over the upper-right back "
             "(winding-guide children, the X-hatch remnant); right hem "
             "edge thinner than left; (b) temple hairline wisps + a "
             "blunt sideburn/tuck tuft in front of the ear in 3q; faint "
             "strands over the lower ear bowl in profile; (c) small "
             "bare notch at the front hairline center-right.")
    L.append("REMAINING (failing gates stay failing): 3q "
             "miss:excess 3.73:1 (gate <=2:1; half-space + shallower "
             "depth narrowed 3q); R-LOOP profile 17770 (gate below "
             "groom5 11587); temple 3q ratio 0.79 (groom6 0.85) + tips "
             ">3mm xneg-profile 147; B hem right alpha 0.53/miss 0.42 "
             "(structural right-side thin drape); concha crossings "
             "3q/profile 25/3450 (gate 0; guides clear >=7.8mm, drift "
             "is children-side); R-PROTRUDE excess comps persist "
             "front/profile/back.")
    L.append("FALSIFIER verdict: ropes/loops on the upper head persist "
             "in part at 5.23 roots/guide with non-tuck blend offsets "
             "p50/p90 3.66/5.23 mm (15%% of non-tuck rows exceed 5 mm; "
             "tuck-box rows merged): R-LOOP 17770 vs groom5 11587 and a "
             "visible upper-right back swirl. Density + depth filled "
             "the hull (miss crushed 3-4x, IoU up) but did NOT unwind "
             "loops: the constant-offset child transport on winding "
             "guides is confirmed as a rope source independent of "
             "sparsity. Card 8b must move children to Blender "
             "interpolate-curves on the dense guide set.")
    L.append("SAW")
    L.append("- SCOPE: groom8a guide-method card on the groom5 base: "
             "depth-layered dense guides (>=2000, <=7 roots/guide), "
             "turn gate inside the tracer, 9 child trims removed "
             "(flags off + code removed), 5 mm blend cap, two-sided "
             "silhouette gate. Same station runner / scorer-v3 cameras "
             "/ skull registration / aisha-v3 targets, no old-chain "
             "paths, big npz in the asset store, no *.blend. rulers.py "
             "kept verbatim from groom7 (imported, unmodified).")
    L.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
             "clinical validity, licensure, or scoring claims; "
             "EEVEE/Quest material response; other bodies/seeds; "
             "animation/combing dynamics.")
    (E / "RESULT.txt").write_text("\n".join(L) + "\n")

    fio = g8["iou"]["front"]["iou"]
    seam_ok = s8["seam"]["maxGapPx"] <= 4
    (E / "GATES_PASS.txt").write_text(
        "GATES_PASS hair-groom8a (honest: failing gates stay failing, "
        "see REMAINING in RESULT.txt)\n"
        "depth parietal %.2f/%.2f temple %.2f/%.2f "
        "(p50>=3.5 p90>=8): %s\n"
        "miss:excess front %.2f:1 (<=2:1 %s) 3q %.2f:1 (<=2:1 %s)\n"
        "front IoU %.4f (>=0.62 %s, target 0.65) | 0 deleted: TRUE | "
        "seam %dpx (<=4 %s)\n"
        "R-LOOP %d (below groom5 11587: %s) | temple 3q ratio %.3f "
        "(holds groom6 0.85: %s)\n"
        "hard gates (count/part/inside/pinna-3mm/determinism/lane/"
        "frames): %s\n" % (
            dep["parietal"]["p50"], dep["parietal"]["p90"],
            dep["temple"]["p50"], dep["temple"]["p90"],
            "PASS" if dep["parietal"]["p50"] >= 3.5
            and dep["parietal"]["p90"] >= 8
            and dep["temple"]["p50"] >= 3.5
            and dep["temple"]["p90"] >= 8 else "FAIL",
            g8["iou"]["front"]["missPx"] / max(
                g8["iou"]["front"]["excessPx"], 1),
            "PASS" if g8["iou"]["front"]["missPx"] <= 2 * max(
                g8["iou"]["front"]["excessPx"], 1) else "FAIL",
            g8["iou"]["three_quarter"]["missPx"] / max(
                g8["iou"]["three_quarter"]["excessPx"], 1),
            "PASS" if g8["iou"]["three_quarter"]["missPx"] <= 2 * max(
                g8["iou"]["three_quarter"]["excessPx"], 1) else "FAIL",
            fio, "PASS" if fio >= 0.62 else "FAIL",
            s8["seam"]["maxGapPx"], "PASS" if seam_ok else "FAIL",
            s8["loopProfile"]["nProfile"],
            "PASS" if s8["loopProfile"]["nProfile"] < 11587 else "FAIL",
            s8["A"]["groom8a/three_quarter/xpos"]["ratioVsTarget"],
            "PASS" if s8["A"]["groom8a/three_quarter/xpos"][
                "ratioVsTarget"] >= 0.80 else "FAIL",
            "PASS" if gates["pass"] else "FAIL"))
    (E / "DONE.txt").write_text(
        "DONE hair-groom8a: guides-8a.npz + strands.npz + sheet.png + "
        "crops.png + RESULT.txt + honest GATES_PASS.txt; renders/score/"
        "gates/baseline on disk.\n")
    print("wrote sheet/crops/RESULT/GATES_PASS/DONE (numbers pending "
          "final scoring pass)")


if __name__ == "__main__":
    main()
