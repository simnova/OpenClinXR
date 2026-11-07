"""Judge copied baselines and generated cells using landmarks.json only."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS = JUDGE / "target-set-back"

BASE_OLD = {
    "b0": REPO / "tools/openclinxr/evidence/hair-sweep1/cells/b0/judge/b0.json",
    "x1": REPO / "tools/openclinxr/evidence/hair-sweep2/cells/x1/judge/x1.json",
    "g1": REPO / "tools/openclinxr/evidence/hair-curtain1/cells/g1/judge/g1.json",
    "v1": REPO / "tools/openclinxr/evidence/hair-curtain1/cells/v1/judge/v1.json",
    "f3": REPO / "tools/openclinxr/evidence/hair-curtain2/cells/f3/judge/f3.json",
    "f4": REPO / "tools/openclinxr/evidence/hair-curtain2/cells/f4/judge/f4.json",
}


def load_judge():
    spec = importlib.util.spec_from_file_location("hair_judge_v6_curtain3", JUDGE / "hair_judge.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    sys.path.insert(0, str(JUDGE))
    spec.loader.exec_module(mod)
    return mod


def triple(values, keys):
    return ",".join(str(values[k]) for k in keys)


def summary(doc):
    gaps = doc.get("face_gaps", {}).get("eye", {})
    standing = doc.get("standing_hair", {})
    return {
        "front_iou": doc.get("iou"),
        "eroded": doc.get("iou_eroded"),
        "width_rms_head": doc.get("width_rms_head"),
        "eye_gap_L": (gaps.get("L") or {}).get("ratio"),
        "eye_gap_R": (gaps.get("R") or {}).get("ratio"),
        "profile_iou": (doc.get("profile_view") or {}).get("iou"),
        "back_iou": (doc.get("back_view") or {}).get("iou"),
        "standing_hair": standing.get("flag"),
        "standing_excess_px": standing.get("excess_px"),
        "transform": doc.get("transform"),
        "profile_transform": (doc.get("profile_view") or {}).get("transform"),
        "back_transform": (doc.get("back_view") or {}).get("transform"),
    }


def judge_one(tag, root, out):
    lm = json.loads((HERE / "landmarks.json").read_text())["judge"]
    front = triple(lm["front"], ("crown_top_row", "chin_row", "face_centre_col"))
    profile = triple(lm["profile"], ("crown_top_row", "chin_row", "forehead_front_col"))
    back = triple(lm["back"], ("crown_top_row", "shoulder_row", "hair_centre_col"))
    h = load_judge()
    child = root / "children"
    out.mkdir(parents=True, exist_ok=True)
    doc = h.judge(
        str(child / "front.png"), str(child / "front-id.png"), tag,
        front, str(out), target_set="back", id_mask_path=str(child / "front-id.png"),
        profile_mask_path=str(child / "profile_90-id.png"), profile_landmarks=profile,
        back_mask_path=str(child / "back-id.png"), back_landmarks=back,
        target_front_mask=str(TARGET_MASKS / "mask-front-v2.png"),
        target_profile_mask=str(TARGET_MASKS / "mask-profile-v2.png"),
        target_back_mask=str(TARGET_MASKS / "mask-back-v3.png"),
        overlay_prefix="overlay-",
    )
    return doc


def baselines():
    rows = []
    for tag, old_path in BASE_OLD.items():
        old = json.loads(old_path.read_text())
        new = judge_one(tag, HERE / "baselines" / tag, HERE / "rejudge" / tag)
        rows.append({"tag": tag, "old": summary(old), "new": summary(new)})
    doc = {"schemaVersion": 1, "landmarks": "landmarks.json", "rows": rows}
    (HERE / "old-vs-new.json").write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    for row in rows:
        print("OLD_NEW", row["tag"], json.dumps(row, sort_keys=True), flush=True)


def cell(tag):
    root = HERE / "cells" / tag
    doc = judge_one(tag, root, root / "judge")
    print("CELL_JUDGE", tag, json.dumps(summary(doc), sort_keys=True), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("baselines", "cell"))
    ap.add_argument("tag", nargs="?")
    args = ap.parse_args()
    if args.mode == "baselines":
        baselines()
    else:
        if not args.tag:
            raise SystemExit("cell mode requires tag")
        cell(args.tag)


if __name__ == "__main__":
    main()
