"""Assemble E/RESULT.txt + E/DONE.txt from the evidence JSONs (pure python).

Reads: hairline.json, hairline_2d.json, scalp.npz (meta), uv.json,
rulers.json, spikes_check.json, inputs-opened.txt. Writes: E/RESULT.txt
(numbers, gates, plants, ban-grep + inputs-opened, SAW, NOT TESTED,
GATES_PASS) and E/DONE.txt. Fails (no DONE) if any gate fails.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-scalp1")
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
# built from fragments so this file itself stays grep-clean for the ban list
BANNED = ["hair-" + "guides", "children" + "_station", "hair-" + "cap",
          "hair-" + "hem", "hair-" + "crown", "hair-" + "sweep",
          "score" + ".py"]


def main():
    hl = json.loads((E / "hairline.json").read_text())
    d2 = json.loads((E / "hairline_2d.json").read_text())
    z = np.load(E / "scalp.npz")
    uv = json.loads((E / "uv.json").read_text())["gates"]
    ru = json.loads((E / "rulers.json").read_text())
    sc = json.loads((E / "spikes_check.json").read_text())
    opened = (E / "inputs-opened.txt").read_text().split()

    # ban grep over S2 sources + evidence json/txt (not png/npz/obj binaries)
    hits = []
    for p in sorted(S2.glob("*.py")) + sorted(E.glob("*.json")) + sorted(E.glob("*.txt")):
        if p.name in ("RESULT.txt", "DONE.txt"):
            continue
        txt = p.read_text(errors="replace")
        for b in BANNED:
            if b in txt:
                hits.append("%s: %s" % (p.name, b))
    # runtime inputs-opened log cross-check: no banned path ever opened
    opened_hits = [o for o in opened if any(b in o for b in BANNED)]

    cov = z["coverMm"]
    over = z["overMm"]
    seg = hl["segments"]["forehead"]
    lines = []
    lines.append("RESULT hair-scalp1: target hairline, clean-UV scalp and root map")
    lines.append("correction: 1 (temple curtain pixels removed; frontal arc + PRIOR temples)")
    lines.append("")
    lines.append("CORRECTION 1 (orchestrator defect + fix)")
    lines.append("- defect: temple segments traced the inner edges of hanging curtains (hair in air against the face), back-projected onto skin where no hairline exists; midline peaked at the part (skin, not hairline).")
    lines.append("- fix (a): frontal arc only, between departure points cols %d/%d (rule: last col each side with run-end <= central-third median %.1f + 35px)." % (
        d2["departure"]["left"]["col"], d2["departure"]["right"]["col"], d2["centralMedian"]))
    lines.append("- fix (b): part band +- %d px around col %d excluded (part gap %d px), interpolated in 3D across %d bridge points." % (
        d2["part"]["bandHalfWidthPx"], d2["roi"]["centreCol"], d2["part"]["widthPx"], seg["nInterp"]))
    lines.append("- temples/sideburn/ear-front are PRIOR (azimuth sweep from each departure to 62deg, +12mm temporal peak, bottom earTop+5mm, skin-snapped; sideburn/nape geometric rules on measured ear extent).")
    lines.append("- sanity: TARGET points >= brow plane (%.4f) + 15mm and within 25mm of anatomical parabola boundary: drops brow=%d anat=%d %s." % (
        hl["sanity"]["browPlaneZ"] - 0.015, hl["sanity"]["nDropBrow"], hl["sanity"]["nDropAnat"], hl["sanity"]["dropAnatMm"]))
    lines.append("")
    lines.append("STEP 1 hairline (E/hairline.json + overlay front/profile/three_quarter)")
    lines.append("- TARGET frontal arc: %d points (%d observed + %d interp), cols %d..%d; mm/target-px front %.4f." % (
        seg["n"], seg["n"] - seg["nInterp"], seg["nInterp"],
        d2["departure"]["left"]["col"], d2["departure"]["right"]["col"],
        hl["mmPerTargetPx"]["front"]))
    lines.append("- cast: n=%d miss=%d methods=%s; residuals px p50=%.4f p95=%.3f max=%.2f (requested-vs-hit pixel; re-projection is exact by construction, depth validated by overlay + R2')." % (
        hl["nCast"], hl["nMiss"], hl["castMethods"], hl["residualsPx"]["p50"], hl["residualsPx"]["p95"], hl["residualsPx"]["max"]))
    lines.append("- PRIOR: templeA/B %d/%d pts, sideburnA/B %d/%d, nape %d; earTop=%.4f earBot=%.4f; library hair hidden %s." % (
        hl["segments"]["templeA"]["n"], hl["segments"]["templeB"]["n"],
        hl["segments"]["sideburnA"]["n"], hl["segments"]["sideburnB"]["n"],
        hl["segments"]["nape"]["n"], hl["priorRules"]["earTop"], hl["priorRules"]["earBottom"],
        hl["libraryHairHidden"]))
    lines.append("- part: %d px x %.4f mm/px = %.2f mm (row %d)." % (
        d2["part"]["widthPx"], hl["mmPerTargetPx"]["front"],
        d2["part"]["widthPx"] * hl["mmPerTargetPx"]["front"], d2["part"]["row"]))
    lines.append("")
    lines.append("STEP 2 scalp mesh (E/scalp.npz %d tris of %d head tris + E/scalp.obj; separate object, copied, no inset)" % (
        len(z["tris"]), int(z["headTris"])))
    lines.append("- region: 3D flood from crown (2.5mm loop barrier + 5mm ear collar) AND graph V>f(U) clip, minus ear-apparatus box (earCut=%d tris)." % int(z["earCutTris"]))
    lines.append("- boundary vs TARGET loop: coverage p50=%.2f p95=%.2f max=%.2fmm (n=%d); mesh overshoot p50=%.2f p95=%.2f max=%.2fmm (n=%d, mesh-only, roots graph-exact)." % (
        float(np.median(cov)), float(np.percentile(cov, 95)), float(cov.max()), len(cov),
        float(np.median(over)), float(np.percentile(over, 95)), float(over.max()), len(over)))
    lines.append("- UV chart: U = SIGNED azimuth about head axis (seam +-pi back midline, side-preserving, never abs), V = elevation; pole dome r<15mm circular-mean repair (57 verts); seam-duplicate body verts (11 groups) unified for gate A.")
    lines.append("")
    lines.append("STEP 3 UV gates (E/uv.json): A overlaps=%d (dome-dome %d, excluded stated) pass=%s; B flips=%d pass=%s; C1 round-trip max=%.4f mean=%.4fmm (n=10000, same-tri %d) pass=%s; C2 analytic diagnostic max=%.3fmm (nUsed=%d). ALL=%s." % (
        uv["A_overlaps"], uv["A_domeDome"], uv["A_pass"], uv["B_flips"], uv["B_pass"],
        uv["C1_maxMm"], uv["C1_meanMm"], uv["C1_sameTri"], uv["C_pass"],
        uv["C2_maxMm"], uv["C2_nUsed"], uv["ALL_PASS"]))
    lines.append("")
    lines.append("STEP 4 roots (E/roots.npz): n=%d seed=%d spacing r0=%.2fmm meanNN=%.3fmm proposals=%d stop=%s." % (
        ru["rootCount"], ru["seed"], ru["spacingMm"], ru["meanSpacingMm"], ru["nProposals"], ru["stopReason"]))
    lines.append("- density: full to hairline, 3mm smoothstep ramp, no setback; part valley 1-0.70*exp(-(x/3.3mm)^2) via variable radii (acceptance coins cannot hold valleys under saturation).")
    lines.append("")
    lines.append("STEP 5 ruler R2' hairline-based, TARGET frontal arc only (n=%d samples): p50=%.2f p95=%.2f max=%.2fmm; gates p95<=2 max<=4: %s." % (
        ru["R2"]["n"], ru["R2"]["p50"], ru["R2"]["p95"], ru["R2"]["max"], ru["R2"]["pass"]))
    lines.append("- plant drop<10mm: p50=%.2fmm (expect 10+-1) nDropped=%d: %s." % (
        ru["plantDrop10mm"]["p50mm"], ru["plantDrop10mm"]["nDropped"], ru["plantDrop10mm"]["pass"]))
    lines.append("- plant restore: p50=%.2fmm (<2): %s." % (
        ru["plantRestore"]["p50mm"], ru["plantRestore"]["pass"]))
    lines.append("- part: target valley %.2fmm, measured FWHM %.2fmm, depth %.3f (crown band n=%d): %s." % (
        ru["part"]["targetValleyMm"], ru["part"]["measFwhmMm"], ru["part"]["valleyDepth"],
        ru["part"]["nCrownBand"], ru["part"]["pass"]))
    lines.append("- rulers gatesPass=%s." % ru["gatesPass"])
    lines.append("")
    lines.append("STEP 6 spikes (E/spikes.png 2x2: front/three_quarter/profile_90/crown_top; 5mm red cones, no strands; library hair excluded, yellow-px %s, gate<0.1%%: %s)." % (
        {k: sc[k]["yellowPx"] for k in ("front", "three_quarter", "profile_90", "crown_top")}, sc["gate"]))
    lines.append("")
    lines.append("provenance: manifest %s; run.py/register.py/export_frame.py/manifests untouched (S2 reads manifest + cameras-scorer-v3.json + register.py read-only; integrated into run.py later by the owning worker)." % "aisha_straight_long.json")
    lines.append("ban-grep (7 banned names, built from fragments) over S2+evidence text: %s." % (hits if hits else "clean"))
    lines.append("inputs-opened log (%d paths) banned-path check: %s." % (len(opened), opened_hits if opened_hits else "clean"))
    lines.append("")
    lines.append("SAW (scope, assumptions, watch-outs)")
    lines.append("- SCOPE: frontal TARGET arc + PRIOR sides; temples carry no target observation (parallax wedge az 30..37deg chorded ~21mm in the pre-correction build; correction replaces temples with PRIOR sweeps).")
    lines.append("- ASSUMED: pin-hole camera inverse (f=FRAME*lens/sensor, centred principal) validated by sub-px re-projection + overlay; mm scale from local projection derivative at crown; part valley centred x=0 (target centre col).")
    lines.append("- WATCH: scalp mesh tris are coarse (boundary overshoot <=%.2fmm mesh-only, roots graph-exact); C2 analytic leg is diagnostic (chart nonlinearity on coarse tris); valley depth 0.72 by radii geometry." % float(over.max()))
    lines.append("")
    lines.append("NOT TESTED: strand growth/combing from these roots; cross-view (three_quarter/back/crown) hairline consistency beyond the overlay; other bodies/seeds; run.py integration (owned by hair-p7 worker).")
    lines.append("")

    gates_ok = (ru["gatesPass"] and uv["ALL_PASS"] and sc["gate"]
                and not hits and not opened_hits
                and float(np.percentile(cov, 95)) < 3.0)
    reason = ("all gates pass (R2' p95 %.2f<=2 max %.2f<=4, plants, part, UV ALL, yellow, coverage p95 %.2f<3, ban-grep clean)"
              % (ru["R2"]["p95"], ru["R2"]["max"], float(np.percentile(cov, 95)))) if gates_ok else "see gate lines above"
    lines.append("GATES_PASS=%s (%s)" % ("yes" if gates_ok else "no", reason))
    (E / "RESULT.txt").write_text("\n".join(lines))
    if not gates_ok:
        raise RuntimeError("gates failed; RESULT written, DONE withheld: " + reason)
    (E / "DONE.txt").write_text("hair-scalp1 STEPS 1-6 complete (CORRECTION 1 applied). GATES_PASS=yes. %s\n" % reason)
    print("RESULT_DONE GATES_PASS=yes")


if __name__ == "__main__":
    main()
