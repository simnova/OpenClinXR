#!/usr/bin/env python3
"""hair-groom7 STEP 4: sheet + crops + RESULT + GATES_PASS + DONE.

E/sheet.png rows: aisha-v3 target | groom6 studio | groom7 studio;
cols front, three_quarter, profile_90, back (1024 -> 512).
E/crops.png: native-1024 crops (no resize), rows target | groom6 |
groom7, cols: three_quarter ear, profile_90 ear, back crown/part,
back hem left, back hem right, nape, front curtain L/R at shoulder,
top of head 3q.
E/RESULT.txt (every gate's number, scope, visual read, REMAINING,
NOT TESTED), E/GATES_PASS.txt (honest: failing gates stay failing),
E/DONE.txt.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E7 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
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
    opened = [str(Path(__file__).resolve())]
    gates = json.loads((E7 / "gates.json").read_text())
    build = json.loads((E7 / "build.json").read_text())
    s7 = json.loads((E7 / "score7.json").read_text())
    sx = json.loads((E7 / "score7x.json").read_text())
    rulers = json.loads((E7 / "rulers.json").read_text())
    rt = json.loads((E7 / "renders-studio" / "render-times.json")
                    .read_text())
    for p in ("gates.json", "build.json", "score7.json", "score7x.json",
              "rulers.json", "baseline.json",
              "renders-studio/render-times.json"):
        opened.append(str(E7 / p))

    rows = [("target", None), ("groom6", E6 / "renders-studio"),
            ("groom7", E7 / "renders-studio")]
    sheet = Image.new("RGB", (LABEL_W + 4 * T, 3 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src) in enumerate(rows):
        for j, v in enumerate(VIEWS):
            if src is None:
                opened.append(str(SCR / TGT[v]))
                tim = Image.open(SCR / TGT[v]).convert("RGB") \
                    .resize((T, T))
            else:
                opened.append(str(src / (v + ".png")))
                tim = Image.open(src / (v + ".png")).convert("RGB") \
                    .resize((T, T))
            sheet.paste(tim, (LABEL_W + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E7 / "sheet.png")
    opened.append(str(E7 / "sheet.png"))

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
    crops.save(E7 / "crops.png")
    opened.append(str(E7 / "crops.png"))

    g6c = s7["grooms"]["groom6"]
    g7c = s7["grooms"]["groom7"]
    r20 = s7["review20"]
    A = sx["A"]
    B = sx["B"]
    C = sx["C"]
    D = sx["D"]
    carry = sx["carry"]
    R = rulers["rulers"]

    L = []
    L.append("RESULT hair-groom7: silhouette rulers, taper curtains "
             "and hem, flap/loop removal (groom6 base, two rounds)")
    L.append("BASE: groom6 geometry/material + guides-tucked.npz; "
             "N=306001 at FIXED radius 0.04 mm root=tip; clump pulls "
             "0.20/0.15 (hem-edge children relaxed x0.3). Round 1: "
             "kink-guard (drop 71/76 switchback guides, 5 tucked "
             "kept), hem taper (157109 children: length U[0.85,1.00] "
             "+ tip x0.25), hem-edge-extra 22->16, spread 13->9 mm, "
             "hem-tip-trim OFF. Round 2: extra back to 22, spike-trim "
             "ON (front rows<260 + 3q rows<320 outside-target, "
             "n=496856 samples), hem-tip-trim ON with 12 px margin "
             "(n=39), taper seam-guard (vacuous: taper classes live "
             "at |x|>=55 mm).")
    L.append("RULERS (probe-tested, probes PASS every run; "
             "target/groom5/groom6/groom7 in E/rulers.json):")
    L.append("R-PROTRUDE (excess comps area>150px & >8px out, 3px "
             "opening): groom6 front 1155px@24.8 + 1067px@14.3 -> "
             "groom7 652px@10.4 + 288px@10.6 (flap deflated ~50%%, "
             "gate still FAIL); 3q 1170+350 -> 768px single FAIL "
             "(fray tips cut by spike-trim); profile 4 FAILs persist "
             "(structural drape, also failing groom5); back wings "
             "5085+4314 -> 2605+1649 (spread 13->9 + margin trim, "
             "still FAIL).")
    L.append("R-HEMSTEP (hemline/curtain-edge runs+steps vs target): "
             "back 0.5685 FAIL -> 0.2562 PASS (trim-to-line removed, "
             "taper fringe; steps 35 vs target 27, gate max(1.5x,"
             "t+3)=40.5: PASS); front 0.5951 -> 0.5240 still FAIL "
             "(left curtain edge 0.19->0.00 fixed, right curtain "
             "0.73->0.69 persists: the diagonal sweep).")
    L.append("R-GROOVE v2 (dome rows 150-330 fibre-to-block ratio "
             "R=E(2-6px)/E(15-40px), gate R<=target+0.05; v1 energy "
             "kept as regression guard): 3q target 0.4777 "
             "(gate 0.5277), groom5 0.5051 PASS, groom6 0.5500 FAIL, "
             "groom7 0.4960 PASS (spike-trim removed fray energy). "
             "Profile: all pass (loop ruler covers the profile "
             "band). Documented sweep: band energy, valley "
             "fractions, gradient tails, spectral ratios, "
             "orientation coherence ALL read groom6 <= target "
             "(target paint dominates); the blocks are sparse "
             "raised ropes, gated via R-LOOP.")
    L.append("R-LOOP profile (turn-event strands visible in profile "
             "above the ear line outside the wrap zone, gate 0; "
             "overlay E/loop-overlay.png): groom5 11587, groom6 "
             "29879 FAIL (overlay lights the dark band across the "
             "top), groom7 8876 FAIL (crown loops gone; residual = "
             "ear-band needle detours at the wrap-zone edge, "
             "pre-existing keep-out/SDF/march mechanism). All-view "
             "visible turns: 61985 -> 18847.")
    L.append("A TEMPLE (holds): box ratios profile 0.966/0.968, 3q "
             "0.858 (groom6 0.96x); tips>3mm profile xpos 32 "
             "(was 49), xneg 0 (was 26); transFrac <=0.043. Lobe "
             "boxes hair-ID px 3q 10/0 profile 89/114 (groom6 "
             "8/0/79/106, gate 0 still unmet, no real change).")
    L.append("B HEM side boxes (outer 15%% hem width, lower third): "
             "left alpha %.4f (gate 0.05: NO) miss %.4f (gate 0.10: "
             "NO); right alpha %.4f (NO) miss %.4f (NO) -- worse "
             "than groom6 (0.065/0.16, 0.30/0.45): spread 13->9 "
             "narrowed the sheet (miss up) and tip-thin raised "
             "fringe translucency. Broad hemCore holds 0.0137."
             % (B["left"]["alphaLt09"], B["left"]["maskMiss"],
                B["right"]["alphaLt09"], B["right"]["maskMiss"]))
    L.append("C PART: cross40=0 (gate 0: PASS); back part gapStd "
             "%.2f px over %d rows (groom6 1.24 over 5; target 0.47) "
             "-- REGRESSED: kink-guard dropped 6 midline-top guides "
             "(6,7,64,492,519,563; 786 groom6 children rode them) "
             "and fallbacks swung off-midline, denuding rows "
             "156-220; front part unchanged (3.35 vs 3.95)."
             % (C["back"]["groom7"]["gapStdPx"],
                C["back"]["groom7"]["nGapRows"]))
    L.append("D FRONT IoU %.4f -> %.4f (gate >= 0.55: PASS, margin "
             "0.009)."
             % (D["iouFront"]["groom6"], D["iouFront"]["groom7"]))
    for v in VIEWS:
        L.append("IoU %s: groom6 %.4f -> groom7 %.4f%s"
                 % (v, g6c["iou"][v]["iou"], g7c["iou"][v]["iou"],
                    " (up)" if g7c["iou"][v]["iou"]
                    >= g6c["iou"][v]["iou"] else " (DOWN)"))
    L.append("seam back midline rows156-950: groom6 max 0 px -> "
             "groom7 max %d px p95 %.1f (gate <=4: FAIL -- part-top "
             "trench rows 156-220, same kink-guard cause as C)."
             % (g7c["seam"]["maxGapPx"], g7c["seam"]["p95GapPx"]))
    L.append("frizz ruler isoFrac groom7: %s (gate <=0.02/view: %s)"
             % (", ".join(
                 "%s %.4f" % (v, s7["frizzRuler"]["groom7/%s" % v]
                              ["isoFrac"]) for v in VIEWS),
                 s7["frizzRuler"]["gatePass"]))
    L.append("ear: pinna visible profile %.3f/%.3f (gate >=0.80: "
             "PASS); concha strand crossings 0 (gate 0: PASS); "
             "front-of-ear projective 3q/profile xneg %d/%d "
             "(groom6: 99/278 per RESULT; advisory)"
             % (r20["pinnaVisibility"]["groom7/profile_90/xpos"]
                ["visible"],
                r20["pinnaVisibility"]["groom7/profile_90/xneg"]
                ["visible"],
                r20["frontOfEarAboveSideburn"]
                ["groom7/three_quarter/xneg"]["nStrands"],
                r20["frontOfEarAboveSideburn"]
                ["groom7/profile_90/xneg"]["nStrands"]))
    L.append("streak width back crop: groom7 median %.1f (p75 %.1f) "
             "vs target 7.0 (gate <=2x: %s)"
             % (r20["streakWidth"]["groom7"]["median"],
                r20["streakWidth"]["groom7"]["p75"],
                carry["streakOk"]))
    L.append("translucency cores: back/crown %.4f (gate <=0.05: %s "
             "-- REGRESSED with the trench), back/hemCore %.4f "
             "PASS, nape %.4f PASS, behindEarCore %.4f/%.4f PASS."
             % (r20["translucency"]["groom7"]["back/crown"]["frac"],
                r20["translucency"]["groom7"]["back/crown"]["frac"]
                <= 0.05,
                r20["translucency"]["groom7"]["back/hemCore"]["frac"],
                r20["translucency"]["groom7"]["back/nape"]["frac"],
                r20["translucency"]["groom7"]
                ["profile_90/behindEarCore-xpos"]["frac"],
                r20["translucency"]["groom7"]
                ["profile_90/behindEarCore-xneg"]["frac"]))
    L.append("colour render-in-inter sat: %s"
             % ", ".join(
                 "%s g6 %.3f/g7 %.3f/tgt %.3f"
                 % (v, g6c["color"][v]["renderInInter"]["satMean"],
                    g7c["color"][v]["renderInInter"]["satMean"],
                    g7c["color"][v]["target"]["satMean"])
                 for v in VIEWS))
    secs = rt["seconds"]
    L.append("render times s: %s; total %.1fs (Cycles 1024/64spp/"
             "seed7/OIDN studio; material HUANG c08 rough 0.35)"
             % (json.dumps(secs, sort_keys=True), rt["total"]))
    L.append("strands asset: hair-groom7/build/strands.npz sha256=%s "
             "bytes=%d N=%d (asset store copy + strands-r1.npz "
             "round-1 backup; byte-rebuildable from build.json "
             "flags)"
             % (build["sha256"], build["bytes"],
                build["counts"]["children"]))
    L.append("VISUAL READ (native-res crops, by the worker): crown "
             "rope-loops and the profile band are GONE (smooth "
             "sheet, overlay confirms band strands removed); front "
             "flap deflated but a spike remnant persists top-right; "
             "back staircase gone, edges softer with rope-separation "
             "gaps remaining right; left curtain edge smooth, right "
             "slab persists; part-top trench rows 156-220 bald "
             "(REGRESSION, see REMAINING). Temple/ear/nape hold.")
    L.append("REMAINING (failing gates stay failing):")
    L.append("- Seam/part-top trench (NEW regression): back midline "
             "max gap 62 px p95 12.3 rows 156-220 + part gapStd "
             "9.12 + crown translucency 0.184 (gates <=4px, "
             "straightness, <=0.05). Root cause: kink-guard dropped "
             "6 midline-top guides (6,7,64,492,519,563; 786 groom6 "
             "children); fallbacks swung off-midline. Prescribed "
             "fix (next card): exempt part-band guides "
             "(|guide-root x - part_x| < 12 mm) from the kink-guard "
             "drop (part coverage is gated separately), or "
             "re-seat fallbacks ride-alone nearest; keep 65 "
             "non-part kinked guides dropped.")
    L.append("- R-LOOP profile 8876 (gate 0): residual ear-band "
             "needle detours at the wrap-zone edge (keep-out radial "
             "shoves + SDF projection + wrap feather partials; "
             "pre-existing mechanism, buried behind the ear sheet). "
             "Needs wrap/shove redesign, not blend rules.")
    L.append("- R-PROTRUDE: front 652+288 px, back wings 2605+1649 "
             "px, 3q 768 px, profile structural excess (gate: no "
             "comp >150 px past 8 px). Flap feeders are crown "
             "near-root arcs (offsets <8 mm, loft normal): volume, "
             "not rogues; needs take-off flattening or targeted "
             "density work.")
    L.append("- R-HEMSTEP front 0.524 (gate target+0.05): right "
             "curtain diagonal sweep keeps a blunt outer edge "
             "(0.69); left fixed (0.00). Needs right-edge guide "
             "reshape.")
    L.append("- B hem side boxes worse (left 0.145/0.33, right "
             "0.63/0.65): spread narrowing pulled edges inside the "
             "boxes (miss) + tip-thin raised fringe translucency. "
             "Re-widen with margin-trim kept, or accept.")
    L.append("- Lobe boxes 10/0/89/114 (gate 0); A-tips profile "
             "xpos 32 (gate 0). Unchanged mechanisms.")
    L.append("SAW")
    L.append("- SCOPE: groom6-base silhouette card, same station "
             "runner / scorer-v3 cameras / skull registration / "
             "aisha-v3 targets, no old-chain paths. Rulers "
             "probe-tested (analytic + planted) and FAIL groom6 on "
             "the card defects: protrude (flap/wings/fray), "
             "hemstep-back (trim staircase), grooveV2-3q "
             "(fibre-to-block 0.550 vs 0.478+0.05), loopProfile "
             "(29879 strands light the profile band, overlay on "
             "disk). Ruler revisions during the card: groove v1 "
             "energy -> v2 dome ratio (v1 insensitive: 8 "
             "photometric sweeps all read groom6 <= target); loop "
             "-> profile-visible + wrap-excluded + overlay; "
             "hemstep steps gate max(1.5x, t+3); protrude fields "
             "verified non-null. Fixes: kink-guard (loop/band/"
             "blocks root cause: switchback guides e.g. 317/324), "
             "hem taper (slabs), spike-trim (flap/fray), "
             "margin-trim (wings). D front IoU 0.6196 -> 0.5587 "
             "(PASS, margin 0.009). Hard gates all PASS "
             "(count/part/inside/pinna/determinism/lane/frames).")
    L.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
             "clinical validity, licensure, or scoring claims; "
             "EEVEE/Quest material response; other bodies/seeds; "
             "animation/combing dynamics.")
    (E7 / "RESULT.txt").write_text("\n".join(L) + "\n")

    apass = all(A["groom7/%s/%s" % (v, s)]["gateRatioOk"]
                for v in ("profile_90", "three_quarter")
                for s in ("xpos", "xneg"))
    atips = all(A["groom7/%s/%s" % (v, s)]["gateTipsOk"]
                for v in ("profile_90", "three_quarter")
                for s in ("xpos", "xneg"))
    G = []
    G.append("GATES_PASS hair-groom7: FAIL (honest record; failing "
             "gates stay failing, see REMAINING in RESULT.txt)")
    G.append("RULERS vs groom6: protrude still FAIL (smaller) | "
             "hemstep back PASS front FAIL | grooveV2 3q PASS "
             "profile PASS | loopProfile FAIL 8876 (was 29879)")
    G.append("A temple tuck: pixel ratio<=2x %s | tips<=3mm %s "
             "(profile xpos 32 float: FAIL) | hard gates %s"
             % (apass, atips, gates["pass"]))
    G.append("B hem edges: alpha<=0.05 %s miss<=0.10 %s (worse than "
             "groom6; left 0.145/0.33 right 0.63/0.65)"
             % (all(B[s]["gateAlphaOk"] for s in ("left", "right")),
                all(B[s]["gateMissOk"] for s in ("left", "right"))))
    G.append("C part: cross40=0 %s | back gapStd %.2f over %d rows "
             "(REGRESSED; REMAINING) | seam max %d px (gate <=4: "
             "FAIL; REMAINING)"
             % (C["crossWithin40mm"]["gateOk"],
                C["back"]["groom7"]["gapStdPx"],
                C["back"]["groom7"]["nGapRows"],
                g7c["seam"]["maxGapPx"]))
    G.append("LOBE boxes hair-ID px 3q 10/0 profile 89/114 (gate 0: "
             "FAIL; REMAINING)")
    G.append("D front IoU %.4f >= 0.55: %s (PASS; hard gates all "
             "pass, no old-chain paths)"
             % (D["iouFront"]["groom7"], D["iouFront"]["gateOk"]))
    G.append("groom6 carries: hard %s seam %s frizzRuler %s "
             "transCore %s streak %s pinna %s concha %s "
             "foe(advisory, xneg 137/245)"
             % (gates["pass"], carry["seamOk"],
                carry["frizzRulerPass"], carry["transCoreOk"],
                carry["streakOk"], carry["pinnaOk"],
                carry["conchaCrossOk"]))
    (E7 / "GATES_PASS.txt").write_text("\n".join(G) + "\n")
    (E7 / "DONE.txt").write_text(
        "DONE hair-groom7: silhouette rulers + taper curtains/hem + "
        "flap deflated + crown loops/band removed (grooveV2 3q "
        "PASS, loopProfile 29879->8876, hemstep-back PASS, D PASS "
        "front IoU 0.5587); sheet.png + crops.png + RESULT.txt + "
        "honest GATES_PASS.txt (seam/part-trench REGRESSION + "
        "loopProfile/protrude-front-back/hemstep-front/B/lobe/"
        "A-tips in REMAINING for next card); rulers+overlays/"
        "renders/score/gates/baseline on disk; strands.npz "
        "N=306001 sha 0548522c in the asset store.\n")
    prev = []
    if (E7 / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E7 / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E7 / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("wrote sheet.png crops.png RESULT.txt GATES_PASS.txt "
          "DONE.txt")


if __name__ == "__main__":
    main()
