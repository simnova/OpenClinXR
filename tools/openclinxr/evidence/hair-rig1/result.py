#!/usr/bin/env python3
"""Hair rig 1 RESULT.txt + DONE.txt from E/base and E/best score.json files."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
VIEWS = ("front", "three_quarter", "profile_90", "back")


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def alpha(path):
    return np.asarray(Image.open(path).convert("RGBA"), np.uint8)[..., 3]


def luminance(image):
    return .2126 * image[..., 0] + .7152 * image[..., 1] + .0722 * image[..., 2]


def face_cheek(root):
    a = rgb(root / "front.png")
    m = alpha(root / "front-id.png") >= 230
    y = luminance(a)
    cheek = ((np.arange(m.shape[0])[:, None] >= .40 * m.shape[0])
             & (np.arange(m.shape[0])[:, None] <= .52 * m.shape[0])
             & (np.arange(m.shape[1]) >= .39 * m.shape[1])
             & (np.arange(m.shape[1]) <= .61 * m.shape[1]) & ~m)
    return float(np.percentile(y[cheek], 50))


def mask_iou(a_path, b_path):
    a = alpha(a_path) >= 230
    b = alpha(b_path) >= 230
    return float((a & b).sum() / max((a | b).sum(), 1))


def main():
    base = json.load(open(E / "base/score.json"))
    best = json.load(open(E / "best/score.json"))
    search_best = json.load(open(E / "search_best.json"))
    rim = json.load(open(E / "rim_check.json"))
    rig = search_best["rig"]

    face_base, face_best = face_cheek(E / "base"), face_cheek(E / "best")
    face_move = abs(face_best - face_base) / face_base

    lines = ["HAIR RIG 1 — CAMERA-RELATIVE LIGHT RE-SOLVE ON B9", "",
             "b9 = hair-tilt5/cells/s5/strands.npz (current best strands) + "
             "hair-look7/best-params.json COLOR material, scored with hair-score/score.py v2."]  # noqa: E501
    lines += ["",
              "RIM CHECK::hair-look1/station.py lights() sets OCLX_rim energy to "
              f"SEARCH_BASE[rim_W] = {rim['stationHardcodedRim_W']:.4f}, ignoring params. "
              "Probe with sentinel params rim_W = 1234.5 through ST.lights + stock "
              "cell_rel.place_camera_relative (which only touches OCLX_key/OCLX_fill): "
              f"OCLX_rim reads back {rim['rimReadback_front']:.4f} on front and "
              f"{rim['rimReadback_back']:.4f} on back. Readback matches the hardcode "
              "to 6 decimals and never the sentinel, so the stock camera-relative path "
              "does NOT deliver rim energy. The search harness (rig.py place_rig) and the "
              "best 1024-px score (rigAdapter wrapping scorer.C.place_camera_relative) set "
              "OCLX_rim explicitly from params rim_W; per-eval readbacks in search.jsonl "
              "confirm delivery (eval22 rim readback = 12.0523 on all views)."]
    lines += ["",
              "BEST RIG (search_best.json, eval 22, 512-px fitness 3.1634 vs stock-rig eval00 3.5444)::"]
    start = search_best["startRig"]
    for key in ("key_energy", "key_elev_deg", "key_daz_deg", "key_size_m",
                "fill_energy", "fill_elev_deg", "rim_energy"):
        lines.append(f"  {key} = {rig[key]:.4f} (stock effective {start[key]:.4f})")
    lines += ["",
              "PER-VIEW PHOTOMETRICS (p50 / p90 / hueDeg / saturation, ours vs TS)::"]
    for view in VIEWS:
        for tag, doc in (("base", base), ("best", best)):
            row, tgt = doc["photometrics"][view], doc["photometrics"][view]["target"]
            lines.append(f"  {tag}.{view}::p50={row['p50']:.6f} vs TS {tgt['p50']:.6f} "
                         f"(d {row['p50'] - tgt['p50']:+.6f}); "
                         f"p90={row['p90']:.6f} vs TS {tgt['p90']:.6f} "
                         f"(d {row['p90'] - tgt['p90']:+.6f}); "
                         f"hue={row['hueDeg']:.3f} vs TS {tgt['hueDeg']:.3f}; "
                         f"sat={row['saturation']:.3f} vs TS {tgt['saturation']:.3f}")
    lines += ["",
              "BANDS (lit highlight-band count x mean size px, ours vs TS)::"]
    for crop in ("back", "ear"):
        for tag, doc in (("base", base), ("best", best)):
            ours, tgt = doc["bands"][crop]["ours"], doc["bands"][crop]["target"]
            lines.append(f"  {tag}.{crop}::{ours['count']}x{ours['meanAreaPx']:.1f} vs TS "
                         f"{tgt['count']}x{tgt['meanAreaPx']:.1f}")
    lines += ["",
              "IoU (judge v6, silhouette must be unchanged — strands frozen)::"]
    for view in ("front", "profile", "back"):
        lines.append(f"  {view}::base {base['judgeV6']['iou'][view]:.4f} vs "
                     f"best {best['judgeV6']['iou'][view]:.4f} "
                     f"(d {best['judgeV6']['iou'][view] - base['judgeV6']['iou'][view]:+.4f})")
    lines.append("  base-vs-best ID-mask cross-IoU (geometry bit-identity check)::")
    for view in VIEWS:
        iou = mask_iou(E / f"base/{view}-id.png", E / f"best/{view}-id.png")
        lines.append(f"    {view} {iou:.6f} {'UNCHANGED' if iou >= .999 else 'CHANGED'}")
    lines += ["",
              f"FACE::cheek p50 base {face_base:.6f} vs best {face_best:.6f} "
              f"(move {face_move * 100:.2f}% of base; gate <= 5% "
              f"{'PASS' if face_move <= .05 else 'FAIL'})",
              "",
              "ORIENTATION (meanAbsErrDeg / histEMD, base vs best; strands frozen, "
              "light-driven jitter only)::"]
    for view in VIEWS:
        a, b = base["orientation"][view], best["orientation"][view]
        lines.append(f"  {view}::base {a['meanAbsErrDeg']:.2f}/{a['histEMD']:.2f} vs "
                     f"best {b['meanAbsErrDeg']:.2f}/{b['histEMD']:.2f}")
    lines += ["",
              "SAW::Against TS, the first wrong read is still per-view brightness: the "
              "re-solved rig (key 149.4->132.4 and lower at 29.0 deg, fill raised to 35.2 "
              "deg, rim halved 26.7->12.1) pulls three_quarter/profile/back medians toward "
              "TS and lands front p90 almost exactly (0.1742 vs TS 0.1747), but front p50 "
              "does not move (0.0961 vs TS 0.0661) and hue/saturation barely shift "
              "(front hue 23.6 vs 14.0, sat 0.14 vs 0.19) — the residual is diffuse body "
              "brightness the 7-dim rig cannot trade without tripping the 5% face gate "
              "(13 of 24 evals paid the +10 face penalty). Bands move the right way "
              "(back 442x35.4 -> 520x29.3 vs TS 849x16.4; ear 73x11.8 -> 82x10.5 vs TS "
              "89x11.7) yet stay far from TS fragmentation, and orientation is flat "
              "(strands frozen). Next load-bearing step is geometry/fragmentation, not light.",
              "",
              "NOT TESTED::Physical Quest 3 / worn-headset evidence; clinical validity/ "
              "scoring claims (out of scope per repo guardrails)."]
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    (E / "DONE.txt").write_text(
        "DONE: b9 re-score via score.py (E/base/score.json), 24-evaluation bounded CMA-ES "
        "camera-relative rig search with verified rim delivery (E/search.jsonl, "
        "E/search_best.json, E/rim_check.json), best rig at 1024x64 via score.py "
        "(E/best/score.json), TS/base/best look sheet (E/look-sheet.png), RESULT, and "
        "reproducible sources (E/rig.py, E/sheet.py, E/result.py) are present.\n")
    print("RESULT WRITTEN")


if __name__ == "__main__":
    main()
