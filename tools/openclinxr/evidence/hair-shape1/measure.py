#!/usr/bin/env python3
"""Measure the T1 hairline relative to the visible brow in skull-H units.

This is deliberately a mask/landmark measurement, not an aesthetic estimate.
The front hairline is the median last solid-hair row in an 11-pixel column
window.  The profile hairline front edge is the median row within two pixels
of the most-anterior solid-hair boundary above the brow.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image


E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T1 = ROOT / "tools/openclinxr/evidence/hair-top1/cells/t1"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_JUDGE = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
    "tools/openclinxr/evidence/hair-judge/target-set-back"
)
SKULL_MM = 210.7
OFFSETS = (-0.2, -0.1, 0.0, 0.1, 0.2)


def mask(path: Path, alpha: bool) -> np.ndarray:
    im = Image.open(path)
    if alpha:
        return np.asarray(im.convert("RGBA"))[..., 3] >= 230
    return np.asarray(im.convert("L")) >= 128


def front_rows(hair: np.ndarray, centre: float, height: float, brow: float) -> list[dict]:
    out = []
    for offset in OFFSETS:
        col = int(round(centre + offset * height))
        samples = []
        for x in range(col - 5, col + 6):
            rows = np.flatnonzero(hair[: int(np.floor(brow)), x])
            if len(rows):
                samples.append(int(rows.max()))
        row = float(np.median(samples))
        px = float(brow - row)
        out.append(
            {
                "offsetSkullH": offset,
                "column": col,
                "hairlineRow": row,
                "browRow": float(brow),
                "browToHairlinePx": px,
                "browToHairlineSkullH": px / height,
                "browToHairlineMm": px / height * SKULL_MM,
                "windowRows": samples,
            }
        )
    return out


def profile_edge(hair: np.ndarray, crown: float, brow: float, height: float) -> dict:
    rows = np.arange(int(round(crown)), int(np.floor(brow)))
    left = np.asarray(
        [np.flatnonzero(hair[y]).min() if hair[y].any() else hair.shape[1] for y in rows]
    )
    anterior = int(left.min())
    selected = rows[left <= anterior + 2]
    row = float(np.median(selected))
    px = float(brow - row)
    return {
        "browRow": float(brow),
        "hairlineFrontEdge": {
            "column": float(np.median(left[left <= anterior + 2])),
            "row": row,
            "rowRangeWithin2PxOfAnterior": [int(selected.min()), int(selected.max())],
            "anteriorColumn": anterior,
        },
        "browToHairlinePx": px,
        "browToHairlineSkullH": px / height,
        "browToHairlineMm": px / height * SKULL_MM,
    }


def main() -> None:
    E.mkdir(parents=True, exist_ok=True)
    landmarks = json.loads(LANDMARKS.read_text())
    ours_front_lm = landmarks["judge"]["front"]
    ours_profile_lm = landmarks["judge"]["profile"]
    projected = landmarks["views"]

    # TS front brow=343 is the target-set-back registered facial row which
    # crosses the visible brows.  Profile brow=345 is the midpoint of the
    # judge landmark's documented 342..348 brow transition.  For T1, use the
    # exact projected anatomical brow from the required landmarks.json.
    configs = {
        "ts": {
            "front": {"crown": 127.0, "chin": 608.0, "centre": 513.0, "brow": 343.0},
            "profile": {"crown": 125.0, "chin": 577.0, "brow": 345.0},
        },
        "t1": {
            "front": {
                "crown": float(ours_front_lm["crown_top_row"]),
                "chin": float(ours_front_lm["chin_row"]),
                "centre": float(ours_front_lm["face_centre_col"]),
                "brow": float(projected["front"]["projected"]["brow"]["row"]),
            },
            "profile": {
                "crown": float(ours_profile_lm["crown_top_row"]),
                "chin": float(ours_profile_lm["chin_row"]),
                "brow": float(projected["profile_90"]["projected"]["brow"]["row"]),
            },
        },
    }
    masks = {
        "ts": {
            "front": mask(TARGET_JUDGE / "mask-front-v2.png", False),
            "profile": mask(TARGET_JUDGE / "mask-profile-v2.png", False),
        },
        "t1": {
            "front": mask(T1 / "front-id.png", True),
            "profile": mask(T1 / "profile_90-id.png", True),
        },
    }

    result = {
        "schemaVersion": 1,
        "skullHeightMm": SKULL_MM,
        "definitions": {
            "frontHairline": "median last alpha>=230 (T1) or white-mask (TS) row in an 11px window at each skull-H column",
            "profileHairline": "median row within 2px of the most-anterior solid-hair boundary above the brow",
            "targetBrow": "front row 343 crosses visible brows; profile row 345 is midpoint of judge-documented transition 342..348",
            "t1Brow": "projected anatomical brow from hair-curtain3/landmarks.json",
            "higherByMm": "T1 brow-to-hairline distance minus TS distance; positive means T1 hairline is higher",
        },
        "inputs": {
            "targetFront": str(TARGET / "target-front.png"),
            "targetProfile": str(TARGET / "target-profile.png"),
            "targetMasks": str(TARGET_JUDGE),
            "t1": str(T1),
            "landmarks": str(LANDMARKS),
        },
        "subjects": {},
    }
    for subject in ("ts", "t1"):
        fc = configs[subject]["front"]
        pc = configs[subject]["profile"]
        fh = fc["chin"] - fc["crown"]
        ph = pc["chin"] - pc["crown"]
        result["subjects"][subject] = {
            "front": {
                "skullHeightPx": fh,
                "crownRow": fc["crown"],
                "chinRow": fc["chin"],
                "centreColumn": fc["centre"],
                "browRow": fc["brow"],
                "columns": front_rows(masks[subject]["front"], fc["centre"], fh, fc["brow"]),
            },
            "profile": {
                "skullHeightPx": ph,
                "crownRow": pc["crown"],
                "chinRow": pc["chin"],
                **profile_edge(masks[subject]["profile"], pc["crown"], pc["brow"], ph),
            },
        }

    comparisons = []
    ts_cols = result["subjects"]["ts"]["front"]["columns"]
    t1_cols = result["subjects"]["t1"]["front"]["columns"]
    for ts, ours in zip(ts_cols, t1_cols):
        comparisons.append(
            {
                "offsetSkullH": ts["offsetSkullH"],
                "tsMm": ts["browToHairlineMm"],
                "t1Mm": ours["browToHairlineMm"],
                "t1HigherByMm": ours["browToHairlineMm"] - ts["browToHairlineMm"],
            }
        )
    p_ts = result["subjects"]["ts"]["profile"]["browToHairlineMm"]
    p_t1 = result["subjects"]["t1"]["profile"]["browToHairlineMm"]
    result["comparison"] = {
        "front": comparisons,
        "profile": {"tsMm": p_ts, "t1Mm": p_t1, "t1HigherByMm": p_t1 - p_ts},
    }
    all_front_under_four = all(row["t1HigherByMm"] < 4.0 for row in comparisons)
    result["premise"] = {
        "t1HigherThanTsAtEveryFrontColumn": all(row["t1HigherByMm"] > 0.0 for row in comparisons),
        "t1HigherByAtLeast4MmAtAnyFrontColumn": any(row["t1HigherByMm"] >= 4.0 for row in comparisons),
        "allFrontDifferencesBelow4Mm": all_front_under_four,
        "verdict": "PREMISE_WRONG_STOP" if all_front_under_four else "CONTINUE_TO_CAP_V9",
    }
    (E / "measure.json").write_text(json.dumps(result, indent=2) + "\n")

    lines = [
        "HAIR SHAPE 1 — BROW-RELATIVE HAIRLINE MEASUREMENT",
        "",
        "METHOD::solid T1 coverage is ID alpha>=230; TS uses judge-v6 white masks; front rows are 11px-window medians; skull height is 210.7mm.",
    ]
    for subject in ("ts", "t1"):
        front = result["subjects"][subject]["front"]
        values = " ".join(
            f"{r['offsetSkullH']:+.1f}H row={r['hairlineRow']:.1f} d={r['browToHairlineSkullH']:.4f}H/{r['browToHairlineMm']:.2f}mm"
            for r in front["columns"]
        )
        lines.append(f"{subject.upper()} FRONT::brow_row={front['browRow']:.3f}; {values}")
        prof = result["subjects"][subject]["profile"]
        edge = prof["hairlineFrontEdge"]
        lines.append(
            f"{subject.upper()} PROFILE::brow_row={prof['browRow']:.3f}; hairline_edge=({edge['column']:.1f},{edge['row']:.1f}); "
            f"d={prof['browToHairlineSkullH']:.4f}H/{prof['browToHairlineMm']:.2f}mm"
        )
    diff = " ".join(
        f"{r['offsetSkullH']:+.1f}H={r['t1HigherByMm']:+.2f}mm"
        for r in comparisons
    )
    worst = max(comparisons, key=lambda row: row["t1HigherByMm"])
    lines += [
        f"T1 HIGHER BY FRONT::{diff}",
        f"T1 HIGHER BY PROFILE::{result['comparison']['profile']['t1HigherByMm']:+.2f}mm",
        f"VERDICT::PREMISE WRONG — T1 is not >=4mm higher at any measured front column; it is lower through the central 0.2H span and only {worst['t1HigherByMm']:.2f}mm higher at the {worst['offsetSkullH']:+.1f}H temple maximum.",
        "STOP::Per brief, stop after RESULT; cap v9, groom rebuild, renders, judge, DONE, and commit were not produced.",
    ]
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
