"""Score target + five renders, write scoreboard.json/png. Run from worktree root:

    MISE_TRUSTED_CONFIG_PATHS=$PWD python3 tools/openclinxr/evidence/hair-judge/make_scoreboard.py
"""
import json
import os

from PIL import Image, ImageDraw

import hair_judge

HERE = os.path.dirname(os.path.abspath(__file__))
W = "/Users/patrick/.grok/worktrees/src-openclinxr"
RENDERS = [
    ("search1", W + "/hair-search/tools/openclinxr/evidence/hair-search/best-1024.png",
     W + "/hair-search/tools/openclinxr/evidence/hair-search/best-1024-id.png"),
    ("search2", W + "/hair-search2/tools/openclinxr/evidence/hair-search2/best-1024.png",
     W + "/hair-search2/tools/openclinxr/evidence/hair-search2/best-1024-id.png"),
    ("length15", W + "/hair-length2/tools/openclinxr/evidence/hair-length/length2-1.5x.png",
     W + "/hair-length2/tools/openclinxr/evidence/hair-length/length2-1.5x-id.png"),
    ("attach", W + "/hair-nodes/tools/openclinxr/evidence/hair-nodes/C1/front.png",
     W + "/hair-nodes/tools/openclinxr/evidence/hair-nodes/C1/front-id.png"),
    ("packdup", W + "/hair-guides/tools/openclinxr/evidence/hair-guides/G0/front.png",
     W + "/hair-guides/tools/openclinxr/evidence/hair-guides/G0/front-id.png"),
]
TLM = {"crown_top_row": 127, "chin_row": 607, "face_centre_col": 514}


def row_summary(r):
    if not r.get("registered"):
        return {"name": r["name"], "registered": False,
                "unregistered_reason": r.get("unregistered_reason"),
                "landmarks_render": r.get("landmarks_render"),
                "mask_encoding": r.get("mask_encoding"),
                "contaminated": r.get("contaminated")}
    return {"name": r["name"], "registered": True,
            "iou": r["iou"], "width_rms": r["width_rms"],
            "below_chin_ours": r["below_chin_ours"],
            "below_chin_target": r["below_chin_target"],
            "p50_ours": r["photometrics_render"]["p50"],
            "p50_target": r["photometrics_target"]["p50"],
            "RB": r["photometrics_render"]["RB"],
            "score": r["score"], "overall": r["overall"],
            "clauses": r["clauses"],
            "failed_clauses": sorted(k for k, v in r["clauses"].items() if not v),
            "landmarks_render": r["landmarks_render"],
            "mask_encoding": r["mask_encoding"],
            "contaminated": r["contaminated"]}


def main():
    results = [hair_judge.judge(hair_judge.TARGET_PHOTO, hair_judge.TARGET_MASK,
                                "target", TLM, HERE)]
    for name, b, m in RENDERS:
        results.append(hair_judge.judge(b, m, name, None, HERE))
    rows = [row_summary(r) for r in results]
    scored = sorted([x for x in rows if x["registered"] and x["name"] != "target"],
                    key=lambda x: x["score"])
    unreg = sorted([x for x in rows if not x["registered"]], key=lambda x: x["name"])
    tgt = [x for x in rows if x["name"] == "target"]
    ordered = tgt + scored + unreg
    with open(os.path.join(HERE, "scoreboard.json"), "w") as f:
        json.dump({"rows": ordered,
                   "score_formula": hair_judge.SCORE_FORMULA,
                   "stopbar_provenance": hair_judge.STOPBAR_PROVENANCE}, f,
                  indent=2, sort_keys=True)

    # PNG: one row per render, thumbnail + key numbers, target first.
    TH, ROWH, Wpx = 176, 200, 1400
    img = Image.new("RGB", (Wpx, 20 + ROWH * len(ordered)), (20, 20, 20))
    d = ImageDraw.Draw(img)
    y = 20
    for x in ordered:
        n = x["name"]
        thumb_src = ("overlay-%s.png" % n if x["registered"]
                     else "landmarks-%s.png" % n)
        th = Image.open(os.path.join(HERE, thumb_src)).convert("RGB")
        th.thumbnail((TH, TH), Image.BILINEAR)
        img.paste(th, (10, y + (ROWH - th.size[1]) // 2))
        tx = 200
        if not x["registered"]:
            lines = [n + "  UNREGISTERED",
                     "landmarks crown=%s chin=%s centre=%s" % (
                         x["landmarks_render"].get("crown_top_row"),
                         x["landmarks_render"].get("chin_row"),
                         x["landmarks_render"].get("face_centre_col")),
                     "reason: %s" % x["unregistered_reason"],
                     "mask: %s" % x["mask_encoding"]]
        else:
            fail = ",".join(x["failed_clauses"]) if x["failed_clauses"] else "none"
            lines = ["%s  score=%.4f  %s" % (
                         n, x.get("score", 0.0),
                         "PASS" if x["overall"] else "FAIL"),
                     "IoU=%.3f width_rms=%.3f below_chin ours=%.3f tgt=%.3f" % (
                         x["iou"], x["width_rms"], x["below_chin_ours"],
                         x["below_chin_target"]),
                     "p50 ours=%.4f tgt=%.4f R/B=%.3f mask=%s" % (
                         x["p50_ours"], x["p50_target"], x["RB"],
                         x["mask_encoding"]),
                     "clauses failed: %s" % fail]
        d.text((tx, y + 20), lines[0], fill=(255, 255, 255))
        for i, ln in enumerate(lines[1:], 1):
            d.text((tx, y + 20 + i * 40), ln, fill=(200, 200, 200))
        y += ROWH
    img.save(os.path.join(HERE, "scoreboard.png"))

    for x in ordered:
        if x["name"] == "target":
            continue
        lm = x["landmarks_render"]
        print("%s crown=%s chin=%s centre=%s registered=%s" % (
            x["name"], lm.get("crown_top_row"), lm.get("chin_row"),
            lm.get("face_centre_col"), x["registered"]))


if __name__ == "__main__":
    main()
