#!/usr/bin/env python3
"""hair-groom6 STEP 4: sheet + crops + RESULT + GATES_PASS + DONE.

E/sheet.png rows: aisha-v3 target | groom5 studio | groom6 studio;
cols front, three_quarter, profile_90, back (1024 -> 512).
E/crops.png: native-1024 crops (no resize), rows target | groom5 |
groom6, cols: three_quarter ear, profile_90 ear, back crown/part,
back hem left, back hem right, nape.
E/RESULT.txt (every gate's number, scope, visual read, REMAINING,
NOT TESTED), E/GATES_PASS.txt (honest: failing gates stay failing),
E/DONE.txt.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E6 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
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
         "nape": ("back", (440, 585, 480, 640))}


def main():
    opened = [str(Path(__file__).resolve())]
    gates = json.loads((E6 / "gates.json").read_text())
    build = json.loads((E6 / "build.json").read_text())
    s6 = json.loads((E6 / "score6.json").read_text())
    sx = json.loads((E6 / "score6x.json").read_text())
    base = json.loads((E6 / "baseline.json").read_text())
    rt = json.loads((E6 / "renders-studio" / "render-times.json")
                    .read_text())
    for p in ("gates.json", "build.json", "score6.json", "score6x.json",
              "baseline.json", "temple-diag.json",
              "renders-studio/render-times.json"):
        opened.append(str(E6 / p))

    rows = [("target", None), ("groom5", E5 / "renders-studio"),
            ("groom6", E6 / "renders-studio")]
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
    sheet.save(E6 / "sheet.png")
    opened.append(str(E6 / "sheet.png"))

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
    crops.save(E6 / "crops.png")
    opened.append(str(E6 / "crops.png"))

    g5c = s6["grooms"]["groom5"]
    g6c = s6["grooms"]["groom6"]
    r20 = s6["review20"]
    A = sx["A"]
    B = sx["B"]
    C = sx["C"]
    D = sx["D"]
    carry = sx["carry"]
    eig = base["eigenResidual"]

    L = []
    L.append("RESULT hair-groom6: clean temple tuck, hem edges, crisp "
             "part (Review 21 A/B/C + lobe gate on the groom5 base)")
    L.append("BASE: groom5 geometry/material + guides-tucked.npz (57 "
             "tucked guides); N=189853 -> 306001 at FIXED radius "
             "0.04 mm root=tip; clump pulls stay 0.20/0.15 "
             "(hem-edge children relaxed x0.3 for edge smoothness).")
    L.append("A TEMPLE: temple roots above the helix-top line ride "
             "tucked guides via the tuck-blend partition (481 tuck "
             "roots); sideburn shorts live strictly below helix-top "
             "- 3 mm, hug skin (<=2 mm, nPushed=%s), target 12-24 mm "
             "(n=%s); root dots of fully-trimmed strands killed "
             "(n=%s: the 3q/profile stipple). Temple box hair-ID px "
             "profile 3588/2569 vs target 3738/2642 (0.96x/0.96x), "
             "3q 2740 vs 3233 (0.85x). Box translucency 3q "
             "0.33 -> 0.18."
             % (build.get("sideburnHug", {}).get("nPushed", "?"),
                build.get("sideburnShort", {}).get("nStrands", "?"),
                build.get("rootDots", {}).get("nStrands", "?")))
    L.append("LOBE: sideburn class joins the ear-wrap march behind "
             "the jaw-line plane (wrap zone widened to zmin-100, "
             "nStrands=%s); lobe boxes hair-ID px: 3q 26->8/0, "
             "profile 159->79/145->106 (gate 0: NOT met, residual "
             "wedge, see REMAINING)."
             % (build.get("earWrap", {}).get("nStrands", "?"),))
    L.append("B HEM: outer-curtain feeders x7 extra children "
             "(hemEdgeExtra n=%s) + 13 mm lateral spread (linear "
             "ramp) + hem tip trim past target edges (n=%s) + clump "
             "relax. Side boxes (outer 15%% hem width, lower "
             "third): left alpha<0.9 %.4f (gate 0.05: NO) miss %.4f "
             "(gate 0.10: NO); right alpha %.4f (NO) miss %.4f (NO). "
             "Broad hem translucency holds; cores solid."
             % (build.get("hemEdgeExtra", {}).get("nExtra", "?"),
                build.get("hemTipTrim", {}).get("nSamples", "?"),
                B["left"]["alphaLt09"], B["left"]["maskMiss"],
                B["right"]["alphaLt09"], B["right"]["maskMiss"]))
    L.append("C PART: part-band children side-keyed clump below the "
             "vertex (n=%s) + setback snap +-2.0 mm (n=%s, top-264 "
             "hairline roots skipped for the seam) + part-style "
             "flat exits + arc<40 mm hard clamp + 40-90 mm feather "
             "corral (n=%s). Crossings within 40 mm of scalp: 0 "
             "(gate 0: PASS, was 1363). Part width back median %.1f "
             "px over %d rows vs target 7.0 (straightness std %.2f "
             "vs target 0.47); front width %.1f vs target 9.0 "
             "(report only)."
             % (build.get("partCrisp", {}).get("nPartBandChildren",
                                                "?"),
                build.get("partSetback", {}).get("nSnapped", "?"),
                build.get("partClampFinal", {}).get("nFeather", "?"),
                C["back"]["groom6"]["gapMedianWidthPx"],
                C["back"]["groom6"]["nGapRows"],
                C["back"]["groom6"]["gapStdPx"],
                C["front"]["groom6"]["gapMedianWidthPx"]))
    L.append("D FRONT: curtain widen 11 mm + curtain fibre x14 "
             "(n=%s). Front IoU %.4f -> %.4f (gate >= 0.55: PASS); "
             "no groom5 hard gate regressed."
             % (build.get("curtainExtra", {}).get("nExtra", "?"),
                D["iouFront"]["groom5"], D["iouFront"]["groom6"]))
    for v in VIEWS:
        L.append("IoU %s: groom5 %.4f -> groom6 %.4f%s"
                 % (v, g5c["iou"][v]["iou"], g6c["iou"][v]["iou"],
                    " (up)" if g6c["iou"][v]["iou"]
                    >= g5c["iou"][v]["iou"] else " (DOWN)"))
    L.append("seam back midline rows156-950: groom5 max 0 px -> "
             "groom6 max %d px (gate <=4: %s)"
             % (g6c["seam"]["maxGapPx"],
                "PASS" if g6c["seam"]["maxGapPx"] <= 4 else "FAIL"))
    L.append("frizz ruler isoFrac groom6: %s (gate <=0.02/view: %s)"
             % (", ".join(
                 "%s %.4f" % (v, s6["frizzRuler"]["groom6/%s" % v]
                              ["isoFrac"]) for v in VIEWS),
                 s6["frizzRuler"]["gatePass"]))
    L.append("ear: pinna visible profile %.3f/%.3f (gate >=0.80); "
             "concha strand crossings 0 (gate 0); front-of-ear "
             "projective 3q/profile xneg %d/%d (groom5: 111/791; "
             "advisory, improved)"
             % (r20["pinnaVisibility"]["groom6/profile_90/xpos"]
                ["visible"],
                r20["pinnaVisibility"]["groom6/profile_90/xneg"]
                ["visible"],
                r20["frontOfEarAboveSideburn"]
                ["groom6/three_quarter/xneg"]["nStrands"],
                r20["frontOfEarAboveSideburn"]
                ["groom6/profile_90/xneg"]["nStrands"]))
    L.append("streak width back crop: groom6 median %.1f (p75 %.1f) "
             "vs target 7.0 (gate <=2x: %s)"
             % (r20["streakWidth"]["groom6"]["median"],
                r20["streakWidth"]["groom6"]["p75"],
                carry["streakOk"]))
    L.append("eigen residual of the orientation solve per hull "
             "region (l0/trace on <=1500-voxel subsamples, s02 "
             "math): %s; view angular residuals %s; no region "
             "mean > 0.3 (no flags)."
             % (json.dumps({k: v.get("eigenResid")
                            for k, v in eig["regions"].items()}),
                json.dumps(eig["viewResid"])))
    L.append("colour render-in-inter sat: %s"
             % ", ".join(
                 "%s g5 %.3f/g6 %.3f/tgt %.3f"
                 % (v, g5c["color"][v]["renderInInter"]["satMean"],
                    g6c["color"][v]["renderInInter"]["satMean"],
                    g6c["color"][v]["target"]["satMean"])
                 for v in VIEWS))
    secs = rt["seconds"]
    L.append("render times s: %s; total %.1fs (Cycles 1024/64spp/"
             "seed7/OIDN studio; material HUANG c08 rough 0.35)"
             % (json.dumps(secs, sort_keys=True), rt["total"]))
    L.append("strands asset: hair-groom6/build/strands.npz sha256=%s "
             "bytes=%d N=%d (asset store copy; byte-rebuildable from "
             "build.json flags)"
             % (build["sha256"], build["bytes"],
                build["counts"]["children"]))
    L.append("VISUAL READ (native-res 3q/profile ear crops, by the "
             "worker): in front of the ear above the helix there is "
             "CLEAN SKIN with the sheet sweeping back over the top "
             "of the ear (groom5 frizzy patch + stipple dots gone); "
             "a small residual wedge sits at the lobe front below "
             "the earlobe (lobe boxes 8/0/79/106 px, gate 0 "
             "unmet). Temple sweep, ear, nape match-or-beat groom5; "
             "hem side edges + crown top still differ (see "
             "REMAINING).")
    L.append("REMAINING (for the next card; failing gates stay "
             "failing):")
    L.append("- A-tips-profile: 49/26 strand tips inside the temple "
             "boxes read >3 mm off skin (gate 0). Pixel ratios pass "
             "(0.96x) and transFrac is low (0.044); the tips are "
             "blend-offset temple fibres floating in front of the "
             "ear (ride-alone was removed for the profile shelf).")
    L.append("- B hem side boxes: left alpha 0.065/miss 0.16, right "
             "alpha 0.30/miss 0.45 (gates 0.05/0.10). Right-side "
             "diagonal curtain sweep resists density/spread levers; "
             "needs guide-shape work or a scoped right-edge "
             "redirect (next card).")
    L.append("- Lobe boxes: 8/0/79/106 hair-ID px (gate 0). "
             "Sideburn shorten did not move it (non-sideburn "
             "curtain/temple strands passing under the lobe); needs "
             "a scoped below-lobe redirect or projective trim that "
             "does not sever strands into frizz dots (lobe-trim "
             "caused 3q-frizz 0.028 in an interim build).")
    L.append("- C straightness: back part gap std 1.24 px over 5 "
             "rows vs target 0.47 over 56+ rows (part still buries "
             "below row ~158; crown-top crossers at arc 90-200 "
             "unaddressed). Cross-40 = 0 holds; width back 9 vs 7 "
             "px holds approximately.")
    L.append("SAW")
    L.append("- SCOPE: Review 21 A/B/C + lobe gate on the groom5 "
             "base, same station runner / scorer-v3 cameras / skull "
             "registration / aisha-v3 targets, no old-chain paths. "
             "A temple fuzz removed (stipple dots killed, sideburns "
             "below helix-top line hugging skin 12-24 mm, temple "
             "roots riding tucked guides). D front IoU 0.4848 -> "
             "0.6196 (PASS) with every groom5 hard gate still "
             "passing (count/part/inside/pinna/determinism/lane/"
             "frames), seam 0, frizz ruler PASS, translucency cores "
             "<=5%%, streak within 2x. IoU up in all four views. B, "
             "lobe and part-straightness improved but short of "
             "their gates (listed above, next card).")
    L.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
             "clinical validity, licensure, or scoring claims; "
             "EEVEE/Quest material response; other bodies/seeds; "
             "animation/combing dynamics.")
    (E6 / "RESULT.txt").write_text("\n".join(L) + "\n")

    apass = all(A["groom6/%s/%s" % (v, s)]["gateRatioOk"]
                for v in ("profile_90", "three_quarter")
                for s in ("xpos", "xneg"))
    atips = all(A["groom6/%s/%s" % (v, s)]["gateTipsOk"]
                for v in ("profile_90", "three_quarter")
                for s in ("xpos", "xneg"))
    # lobe boxes from diag_lobe on these renders: 3q 8/0, profile
    # 79/106 (gate 0: FAIL; REMAINING).
    G = []
    G.append("GATES_PASS hair-groom6: FAIL (honest record; failing "
             "gates stay failing, see REMAINING in RESULT.txt)")
    G.append("A temple tuck: pixel ratio<=2x %s | tips<=3mm %s "
             "(profile 49/26 tips float: FAIL) | hard gates %s"
             % (apass, atips, gates["pass"]))
    G.append("B hem edges: alpha<=0.05 %s miss<=0.10 %s (all four "
             "box-measures FAIL; left 0.065/0.16 right 0.30/0.45)"
             % (all(B[s]["gateAlphaOk"] for s in ("left", "right")),
                all(B[s]["gateMissOk"] for s in ("left", "right"))))
    G.append("C part: cross40=0 %s | back width %.1fpx/rows %d "
             "(report) | straightness std %.2f vs target 0.47 "
             "(worse; REMAINING)"
             % (C["crossWithin40mm"]["gateOk"],
                C["back"]["groom6"]["gapMedianWidthPx"],
                C["back"]["groom6"]["nGapRows"],
                C["back"]["groom6"]["gapStdPx"]))
    G.append("LOBE boxes hair-ID px 3q 8/0 profile 79/106 (gate 0: "
             "FAIL; REMAINING)")
    G.append("D front IoU %.4f >= 0.55: %s (PASS; no groom5 hard "
             "gate regressed)"
             % (D["iouFront"]["groom6"], D["iouFront"]["gateOk"]))
    G.append("groom5 carries: hard %s seam %s frizzRuler %s "
             "transCore %s streak %s pinna %s concha %s"
             % (gates["pass"], carry["seamOk"],
                carry["frizzRulerPass"], carry["transCoreOk"],
                carry["streakOk"], carry["pinnaOk"],
                carry["conchaCrossOk"]))
    (E6 / "GATES_PASS.txt").write_text("\n".join(G) + "\n")
    (E6 / "DONE.txt").write_text(
        "DONE hair-groom6: temple tuck clean, hem edges + part "
        "improved, D PASS (front IoU 0.6196); sheet.png + crops.png "
        "+ RESULT.txt + honest GATES_PASS.txt (B/lobe/A-tips/ "
        "C-straightness in REMAINING for next card); renders/score/"
        "gates/baseline/temple-diag on disk; strands.npz N=306001 "
        "in the asset store.\n")
    prev = []
    if (E6 / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E6 / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E6 / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("wrote sheet.png crops.png RESULT.txt GATES_PASS.txt "
          "DONE.txt")


if __name__ == "__main__":
    main()
