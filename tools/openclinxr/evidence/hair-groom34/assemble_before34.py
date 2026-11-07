"""groom34: assemble E/before.json (groom33 on the symmetric per-side gates)."""
from __future__ import annotations

import json
from pathlib import Path

E = Path(__file__).resolve().parent
E33 = E.parent / "hair-groom33"


def main():
    g = json.loads((E / "gates33.json").read_text())
    s = json.loads((E33 / "score31-33.json").read_text())
    iou = {v: s["grooms"]["33"]["iou"][v]["iou"]
           for v in ("front", "three_quarter", "profile_90", "back")}
    px = json.loads((E / "ear-proxy.json").read_text())
    mir = json.loads((E / "mirror-stats.json").read_text())
    out = {
        "tag": "groom33-before",
        "strandsSha16": g["strandsSha256"],
        "proxy": {"inflateMm": px["inflateMm"],
                  "shellTrisPerSide": px["xpos"]["shellTris"],
                  "fillBowlN": px["fillBowl"]["nAdded"],
                  "mirrorMaxDiffMm": px["mirrorMaxDiffMm"]},
        "shellSegments": {
            s_: {"nSegments": g["perSide"][s_]["shell"]["nSegments"],
                 "nStrands": g["perSide"][s_]["shell"]["nStrands"],
                 "gate": 0} for s_ in ("xpos", "xneg")},
        "column": {s_: g["perSide"][s_]["column"] for s_ in ("xpos",
                                                            "xneg")},
        "concha34": g["concha34"],
        "imgStd": g["imgStd"],
        "imgMirror": g["imgMirror"],
        "mirrorIou": g["mirrorIou"],
        "iouPlusX": iou,
        "segmentsGt30": g["segmentsGt30"],
        "insideBody": g["insideBody"],
        "note": "-x side never graded before: std-camera xneg boxes are "
                "occluded/misplaced (reported, not gated); the -x grades "
                "are the mirrored-camera rows. concha34 uses the "
                "symmetric (mirrored xpos) definition, unlike score31 "
                "which sums the asymmetric file sets.",
    }
    (E / "before.json").write_text(json.dumps(out, indent=1) + "\n")
    print("wrote E/before.json")
    print("shell xpos=%d/%d xneg=%d/%d (segs/strands)" % (
        out["shellSegments"]["xpos"]["nSegments"],
        out["shellSegments"]["xpos"]["nStrands"],
        out["shellSegments"]["xneg"]["nSegments"],
        out["shellSegments"]["xneg"]["nStrands"]))
    print("column xpos=%d xneg=%d (strands)" % (
        out["column"]["xpos"]["strands"], out["column"]["xneg"]["strands"]))
    print("imgMirror 3q/xneg=%d profile/xneg=%d" % (
        out["imgMirror"]["three_quarter/xneg"]["hairIDpx"],
        out["imgMirror"]["profile_90/xneg"]["hairIDpx"]))


if __name__ == "__main__":
    main()
