#!/usr/bin/env python3
"""hair-part1: collect each variant's instrument outputs into one table.

Reads only files the lane's instruments wrote: gates-T.json (gates34),
iou-T.json (iou35), cells/T/part.json (hair-top1 metric via
part1_metric), metrics-cross-part1.json (diag23 step A), build.json.
Writes E/table.json and prints a fixed-width table."""
import json
from pathlib import Path

E = Path(__file__).resolve().parent
ST = Path("/Volumes/files/openclinxr-assets/store/hair-part1")
TAGS = ("id", "a", "b", "c", "d")
NAMES = {"id": "groom36", "a": "a jitter 3mm", "b": "b edge density",
         "c": "c flow +2deg", "d": "d a+b+c"}


def row(t):
    g = json.loads((E / f"gates-{t}.json").read_text())
    i = json.loads((E / f"iou-{t}.json").read_text())["iou"]
    p = json.loads((E / "cells" / t / "part.json").read_text())
    return {"tag": t, "name": NAMES[t], "strandsSha": p["strandsSha256"],
            "nStrands": p["nStrands"],
            "crownTopPartSide": round(p["crownTop"]["partSide"], 4),
            "frontPartSide": round(p["frontHonest"]["partSide"], 4),
            "tiles": {k: round(v["skinFraction"], 4)
                      for k, v in p["crownTop"]["tiles"].items()},
            "shellXpos": g["perSide"]["xpos"]["shell"]["nSegments"],
            "shellXneg": g["perSide"]["xneg"]["shell"]["nSegments"],
            "columnXpos": g["perSide"]["xpos"]["column"]["strands"],
            "columnXneg": g["perSide"]["xneg"]["column"]["strands"],
            "gt30": g["segmentsGt30"]["nGt30mm"],
            "insideBody": g["insideBody"]["nSge1Inside"],
            "iouFront": i["front"]["iou"], "iou3q": i["three_quarter"]["iou"],
            "iouProfile": i["profile_90"]["iou"], "iouBack": i["back"]["iou"]}


def main():
    rows = [row(t) for t in TAGS if (E / "cells" / t / "part.json").exists()]
    cross = json.loads((E / "metrics-cross-part1.json").read_text())
    ts = json.loads((E / "cells" / "id" / "part.json").read_text())["TS"]
    doc = {"rows": rows, "crossings3D": cross["crossing3D"],
           "targetFrontPartSide": round(ts["partSide"], 4)}
    (E / "table.json").write_text(json.dumps(doc, indent=1) + "\n")
    h = "%-16s %7s %7s %11s %7s %6s %6s %6s %5s"
    print(h % ("variant", "crown", "front", "shell+/-", "column", "front", "3q", "prof", "gt30"))
    for r in rows:
        print(h % (r["name"], r["crownTopPartSide"], r["frontPartSide"],
                   f'{r["shellXpos"]}/{r["shellXneg"]}',
                   f'{r["columnXpos"]}/{r["columnXneg"]}', r["iouFront"],
                   r["iou3q"], r["iouProfile"], r["gt30"]))
    print("target front part/side", doc["targetFrontPartSide"])


if __name__ == "__main__":
    main()
