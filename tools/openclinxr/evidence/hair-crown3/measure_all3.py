#!/usr/bin/env python3
"""hair-crown3: edge ruler + crown2 ruler for every scored cell."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E = Path(__file__).resolve().parent
C2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-crown2")
sys.path.insert(0, str(C2))
from ruler import rgb, stats  # noqa: E402


def main():
    R = C2 / "ruler"
    rep = json.loads((R / "ruler_stats.json").read_text())
    cells = [d.name for d in (E / "scores").iterdir() if d.is_dir()]
    out = {}
    for tag in sorted(cells):
        d = E / "scores" / tag
        if not (d / "score.json").exists():
            continue
        subprocess.run([sys.executable, str(E / "edge_ruler.py"), "--scores", str(d),
                        "--tag", tag, "--capmask", str(R / "capmask_front.png"),
                        "--out", str(d / "edge.json"), "--overlay", str(d / "edge_overlay.png")],
                       check=True, capture_output=True, text=True)
        edge = json.loads((d / "edge.json").read_text())
        line = {"edge": {v: {"ours": {"tw": edge[v]["ours"]["transWidth"].get("medianPx"),
                                              "maxgrad": edge[v]["ours"]["transWidth"].get("medianMaxGrad"),
                                              "dark": edge[v]["ours"]["darkBandPx"],
                                              "part": edge[v]["ours"].get("part", {})},
                                      "tgt": {"tw": edge[v]["target"]["transWidth"].get("medianPx"),
                                              "dark": edge[v]["target"]["darkBandPx"],
                                              "part": edge[v]["target"].get("part", {})}}
                             for v in ("front", "three_quarter")}}
        sj = json.loads((d / "score.json").read_text())
        line["iou"] = {k: round(v, 4) for k, v in sj["judgeV6"]["iou"].items()}
        line["orientation"] = {v: round(sj["orientation"][v]["meanAbsErrDeg"], 2)
                               for v in ("front", "three_quarter", "profile_90", "back")}
        line["bands"] = {"backCount": sj["bands"]["back"]["ours"]["count"],
                         "earCount": sj["bands"]["ear"]["ours"]["count"]}
        line["crownTop"] = {k: round(v["bareFractionAlphaLt30"], 4)
                            for k, v in sj["honestPartSide"]["crownTop"]["tiles"].items()}
        line["partSide"] = {k: (round(v, 4) if isinstance(v, float) else v)
                            for k, v in sj["honestPartSide"]["front"].items()
                            if k != "definition"} if isinstance(sj["honestPartSide"]["front"], dict) else sj["honestPartSide"]["front"]
        ruler = {}
        for view in ("front", "back"):
            r0, r1 = rep["bands"][view]["ours"]
            band = np.zeros((1024, 1024), bool)
            band[r0:r1, :] = True
            capm = np.asarray(Image.open(R / f"capmask_{view}.png").convert("L")) > 127
            alpha = np.asarray(Image.open(d / f"{view}-id.png").convert("RGBA"),
                               dtype=np.uint8)[..., 3]
            sil = ndimage.binary_dilation(ndimage.binary_closing(alpha >= 30, iterations=7), iterations=5)
            st = stats(rgb(d / f"{view}.png"), capm & sil & band)
            ruler[view] = {k: (round(v, 4) if isinstance(v, float) else v)
                           for k, v in st.items()}
        line["ruler"] = ruler
        out[tag] = line
        print(tag, "iou", line["iou"], "ori", line["orientation"], flush=True)
    (E / "measure_all.json").write_text(json.dumps(out, indent=1) + "\n")
    print("wrote measure_all.json", flush=True)


if __name__ == "__main__":
    main()
