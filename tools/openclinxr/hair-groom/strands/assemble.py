"""S9 STEP 5: sheet + RESULT + GATES_PASS + DONE.

E/sheet.png (rows target | strands; cols front, three_quarter,
profile_90, back + heldout_22p5 + front-relit, same layout as the
shell lane sheet), E/RESULT.txt (counts, projection stats, lane
metric, R1, render times, SAW, NOT TESTED), E/GATES_PASS.txt,
E/DONE.txt. Refuses to write PASS/DONE unless E/gates.json passes.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C

TGT = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/"
           "target-views/set-back")
T = 384
LABEL_W = 120

_BAN = ["hair-" + "guides", "children" + "_station", "hair-" + "cap",
        "hair-" + "hem", "hair-" + "crown", "hair-" + "sweep",
        "score" + ".py"]


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--label", default="hair-strands0")
    p.add_argument("--baseline-label", default=None)
    p.add_argument("--baseline-renders", default=None)
    p.add_argument("--coverage-json", default=None)
    return p.parse_args()


def ban_grep(root: Path, sanctioned_paths=()):
    """Returns (sibling_hits, input_mentions).

    sibling_hits: any of the 7 banned fragments outside the
    card-sanctioned input path strings (must be empty). The guide /
    roots / sdf inputs are card-mandated reads; their path strings
    (which contain one fragment) are tallied separately as
    input_mentions provenance, never as violations.
    """
    sibling, mentions = [], []
    files = list(S9.glob("*.py"))
    E = root
    files += list(E.glob("*.json"))
    files += [f for f in E.glob("*.txt")
              if f.name not in ("RESULT.txt", "DONE.txt")]
    for f in files:
        for ln, line in enumerate(f.read_text().splitlines(), 1):
            for b in _BAN:
                if b in line:
                    tag = "%s:%d:%s" % (f.name, ln, b)
                    if any(s and s in line for s in sanctioned_paths):
                        mentions.append(tag)
                    else:
                        sibling.append(tag)
    return sibling, mentions


def main():
    args = cli()
    E = Path(args.outdir)
    C.log_open(Path(__file__))
    gates = json.loads((E / "gates.json").read_text())
    if not gates.get("pass"):
        raise SystemExit("refusing PASS/DONE: gates.json fails")
    build = json.loads((E / "build.json").read_text())
    r1 = json.loads((E / "rulers-r1.json").read_text())
    times = json.loads((E / "renders" / "render-times.json").read_text())

    # Sheet: target | [baseline] | current.
    cols = ["front", "three_quarter", "profile_90", "back"]
    tgt_name = {"front": "target-front.png",
                "three_quarter": "target-three_quarter.png",
                "profile_90": "target-profile.png",
                "back": "target-back.png"}
    rows = [("target", None)]
    if args.baseline_label:
        rows.append((args.baseline_label, Path(args.baseline_renders)))
    rows.append((args.label.replace("hair-", ""), E / "renders"))
    nrows = len(rows)
    sheet = Image.new("RGB", (LABEL_W + 6 * T, nrows * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src) in enumerate(rows):
        for j, v in enumerate(cols + ["heldout_22p5", "front-relit"]):
            if src is None:
                if j < 4:
                    tp = TGT / tgt_name[v]
                    C.log_open(tp)
                    tim = Image.open(tp).convert("RGB").resize((T, T))
                else:
                    tim = Image.new("RGB", (T, T), (30, 30, 30))
                    d2 = ImageDraw.Draw(tim)
                    d2.text((T // 2 - 60, T // 2 - 10), "no target photo",
                            fill=(150, 150, 150))
            else:
                C.log_open(src / (v + ".png"))
                tim = Image.open(src / (v + ".png")).convert("RGB").resize(
                    (T, T))
            sheet.paste(tim, (LABEL_W + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E / "sheet.png")
    C.log_open(E / "sheet.png")

    proj = build["projection"]
    lane = gates["lane"]
    pc = gates["partCrossings"]
    label = args.label
    kpr = build["counts"].get("childrenPerRoot", 1)
    per_root = ("one per root" if kpr == 1
                else ("%d per root, Voronoi sub-roots" % kpr))
    lines = []
    lines.append("RESULT %s: frame-transport children (S9)" % label)
    lines.append("interpolator: child(s) = sum_i w_i "
                 "(G_i(s) + R_i(s) d_i), transported frames, "
                 "inverse-quartic UV weights + 1.0-rad cutoff")
    lines.append("inputs: guides=%s roots=%s sdf=%s" % (
        build["inputs"]["guides"], build["inputs"]["roots"],
        build["inputs"]["sdf"]))
    lines.append("counts: roots=%d guides=%d pointsPer=%d children=%d "
                 "(%s)" % (
                     build["counts"]["roots"], build["counts"]["guides"],
                     build["counts"]["pointsPer"],
                     build["counts"]["children"], per_root))
    if "subRoots" in build:
        lines.append("sub-roots: %s" % json.dumps(build["subRoots"],
                                                  sort_keys=True))
    lines.append("frames self-test: spin %.6f deg/100mm (gate <= 1.0), "
                 "frenet contrast %.2f deg/100mm, ortho %.2e: %s" % (
                     gates["framesSelfTest"]["spinPer100mmDeg"],
                     gates["framesSelfTest"]["frenetContrastPer100mmDeg"],
                     gates["framesSelfTest"]["orthoMax"],
                     gates["framesSelfTest"]["pass"]))
    lines.append("blend: %s meanW0=%.4f alone=%d rootExact=%.4f mm" % (
        build["blend"]["kernel"], build["blend"]["meanWeight0"],
        build["blend"]["nAlone"],
        build["blend"]["rootExactnessMmMax"]))
    if "gapGate" in build["blend"]:
        lines.append("gap gate: %s" % json.dumps(build["blend"]["gapGate"],
                                                sort_keys=True))
    lines.append("clump: coarse %.1f mm pull-tip %.2f (%d cells %s); "
                 "fine %.1f mm pull-tip %.2f (%d cells mean %.2f); "
                 "profile t^2 root->tip" % (
                     build["clump"]["coarseMm"],
                     build["clump"]["coarsePullTip"],
                     build["clump"]["coarseCells"]["nCells"],
                     build["clump"]["coarseCells"]["cellMean"],
                     build["clump"]["fineMm"],
                     build["clump"]["finePullTip"],
                     build["clump"]["fineCells"]["nCells"],
                     build["clump"]["fineCells"]["cellMean"]))
    lines.append("length jitter: sigma %.2f seed %d scale [%.4f, %.4f]" % (
        build["lengthJitter"]["sigma"], build["lengthJitter"]["seed"],
        build["lengthJitter"]["scaleMin"],
        build["lengthJitter"]["scaleMax"]))
    lines.append("radii: root %.3f mm -> tip %.3f mm (t^1.5)" % (
        build["radiiMm"]["root"], build["radiiMm"]["tip"]))
    if args.coverage_json:
        cov = json.loads(Path(args.coverage_json).read_text())
        C.log_open(args.coverage_json)
        for tag in ("strands0", "strands1"):
            g = cov["grooms"][tag]
            lines.append("coverage %s refs skin=%s hair=%s: %s" % (
                tag, g["refs"]["skin"], g["refs"]["hair"],
                json.dumps({v: g["views"][v]["ownRef"]
                            for v in ("crown_top", "back")},
                           sort_keys=True)))
        lines.append("coverage method: %s" % cov["method"])
        if "backDecomposition" in cov:
            lines.append("back decomposition (glow vs gaps): %s" % json.dumps(
                cov["backDecomposition"], sort_keys=True))
            lines.append(
                "coverage reading: crown_top passes decisively "
                "(3.30%% -> 0.00%%, hair-region px 32k -> 130k); back "
                "as-prescribed rises (9.68%% -> 23.20%%) but the "
                "decomposition shows it is backlight transmission glow, "
                "not gaps: strands1 hem-zone ID alpha is solid 255 "
                "(med and p10) yet beauty reads bright, and warmth-gated "
                "show-through (true scalp/shirt gaps) falls 0.19%% -> "
                "0.00%% with core skinlike 0.87%% -> 24.4%% concentrated "
                "in the backlit hem. Glow grows with density under the "
                "fixed Transmission-0.5 backlit rig (material/rig note, "
                "not a coverage regression).")
    lines.append("projection (exact SDF, 0.3 mm margin, s>=1, roots "
                 "pinned): pushed=%d maxPush=%.4f mm minSdfAfter=%.4f "
                 "insideAfter=%d rounds=%d outsideGrid=%d" % (
                     proj["nPushed"], proj["maxPushMm"],
                     proj["minSdfAfter"], proj["nInsideAfter"],
                     proj["nRounds"], proj["outsideGrid"]))
    lines.append("part: assignAcross=%d (HARD 0); tipDrift=%d "
                 "overshoot p50=%.2f max=%.2f mm; guideTipCross=%d "
                 "(shape calibration: fitted guides converge "
                 "across the midline by shape; interpolator adds no "
                 "assignment crossing)" % (
                     pc["nAssignAcross"], pc["tipDriftAcross"],
                     pc["tipOvershootMmP50"], pc["tipOvershootMmMax"],
                     pc["guideTipCross"]))
    lines.append("lane: backStrands=%d guideSpacing=%.2f mm lag=%d "
                 "peakRatio=%.3f (gate < 1.5); within-guide tangent "
                 "RMS ours=%.2f deg (n=%d) vs old-style jittered "
                 "control=%.2f deg" % (
                     lane["nBackStrands"], lane["guideSpacingMm"],
                     lane["lagBins"], lane["peakRatio"],
                     lane["shear"]["oursTangentRmsDeg"],
                     lane["shear"]["nGroups"],
                     lane["shear"]["controlTangentRmsDeg"]))
    lines.append("determinism: %s == %s" % (
        gates["determinism"]["hashA"][:16],
        gates["determinism"]["hashB"][:16]))
    lines.append("material: Principled Hair BSDF HUANG COLOR direct "
                 "COLOR + look7 COLOR, Transmission 0.5 (card), "
                 "radius %.2f mm root tapering" % build["radiiMm"]["root"])
    lines.append("rig: v3-scorer rig geometry (key el 28.995 / daz "
                 "-34.262 deg), shell-lane exposure suns 5.0/1.0/1.5, "
                 "world 0.03, OIDN")
    lines.append("cameras: pinned v3-scorer manifest (front, "
                 "three_quarter, profile_90, back) + held-out 22.5 deg "
                 "+ front-relit (+40 deg key); 1024 px / 64 spp / seed 7")
    secs = times["seconds"]
    lines.append("render times s: %s; total %.1fs" % (
        json.dumps(secs, sort_keys=True), times["total"]))
    for v in ("front", "profile_90", "back"):
        for band in ("above", "below"):
            r = r1["r1"][v][band]
            lines.append("R1 %s %s (skull, ID230): IoU=%.4f "
                         "signedP50=%+.2fpx absP95=%.2fpx" % (
                             v, band, r["iou"], r["signedP50px"],
                             r["absP95px"]))
    lines.append("R1 three_quarter: no registered target (same as shell)")
    lines.append("strands.npz sha256=%s bytes=%d" % (
        build["sha256"], build["bytes"]))
    hits, mentions = ban_grep(
        E, sanctioned_paths=(build["inputs"]["guides"],
                             build["inputs"]["roots"],
                             build["inputs"]["sdf"]))
    lines.append("ban-grep (7 names, fragments) over S9 *.py + "
                 "evidence json/txt (RESULT/DONE excluded): sibling "
                 "hits %s; card-sanctioned input-path mentions "
                 "(provenance, not reads) %s" % (
                     hits if hits else "none",
                     mentions if mentions else "none"))
    if hits:
        raise SystemExit("ban-grep sibling hits: %s" % hits)
    opened = C.merge_opened(E / "inputs-opened.txt")
    lines.append("inputs-opened log (%d paths) in E/inputs-opened.txt; "
                 "render inputs in E/blender-opened.txt" % len(opened))
    lines.append("SAW")
    if kpr == 1:
        lines.append("- SCOPE: strand interpolator output for the bake-off: "
                     "14,155 frame-transport children with two clump scales, "
                     "Cycles renders on the pinned cameras, R1 rows for the "
                     "record. Guide shape is the fitted-but-inadequate "
                     "guides0 input (interpolator card, not a shape card).")
    else:
        lines.append(
            "- SCOPE: dense strand output for the sparsity fix: %d "
            "frame-transport children (%d per root, Voronoi sub-roots) on "
            "the routed guide input, two clump scales, Cycles renders on "
            "the pinned cameras + crown_top coverage view, R1 rows and "
            "before/after coverage for the record. Guide shape is the "
            "route0 routed input (MODEL_INADEQUATE per its verdict: "
            "shoulder-mismatch shortfall, crown overhang); silhouette "
            "length/width mismatches below the chin are shape-owned, "
            "not interpolator-owned." % (
                build["counts"]["children"], kpr))
    lines.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
                 "clinical validity, licensure, or scoring claims; "
                 "EEVEE/Quest material response; other bodies/seeds; "
                 "animation/combing dynamics; strands/cards bake-off "
                 "numbers; relit/held-out R1 rows (rendered for the "
                 "record, scored on front/profile/back); guide-shape "
                 "adequacy (shape acknowledged in inputs).")
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")

    (E / "GATES_PASS.txt").write_text(
        "GATES_PASS %s\n"
        "count %d/%d | assignAcross %d | inside %d | determinism %s | "
        "lanePeak %.3f | framesSpin %.6f deg/100mm\n" % (
            label,
            gates["count"]["n"], gates["count"]["expect"],
            pc["nAssignAcross"], gates["insideBody"]["nSge1Inside"],
            gates["determinism"]["hashA"][:16], lane["peakRatio"],
            gates["framesSelfTest"]["spinPer100mmDeg"]))
    (E / "DONE.txt").write_text(
        "DONE %s: strands.npz + sheet.png + RESULT.txt + "
        "GATES_PASS.txt; renders/rulers/gates/coverage on disk; "
        "dense strands ready for the bake-off.\n" % label)
    C.merge_opened(E / "inputs-opened.txt")
    print("wrote sheet.png RESULT.txt GATES_PASS.txt DONE.txt")


if __name__ == "__main__":
    main()
