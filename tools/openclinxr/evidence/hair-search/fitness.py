"""Deterministic hair-search fitness.

Weights and targets are copied from the Hair search v1 task (2026-10-12):
tone 1.0/0.5/0.5, colour 1.0, face/background bands 2.0 each,
face LR 0.5, volume 1.0, below-chin length 1.0, contamination 5.0.
Lower is better.  This module intentionally has no Blender dependency.
"""
from __future__ import annotations

import math
from typing import Mapping, Any


TARGET = {
    "p10": 0.039,
    "p50": 0.078,
    "p90": 0.159,
    "rb": 1.52,
    "volume": 0.294,
    "lengthBelowChinFrac": 0.51,
}


def band_violation(value: float, low: float, high: float) -> float:
    """Distance outside a band, normalised by band width."""
    if value < low:
        return (low - value) / (high - low)
    if value > high:
        return (value - high) / (high - low)
    return 0.0


def fitness(metrics: Mapping[str, Any], include_length: bool = True) -> float:
    p10 = max(float(metrics["p10"]), 0.01)
    p50 = max(float(metrics["p50"]), 1e-9)
    p90 = max(float(metrics["p90"]), 1e-9)
    rb = max(float(metrics["rb"]), 1e-9)
    score = (
        abs(math.log(p50 / TARGET["p50"]))
        + 0.5 * abs(math.log(p90 / TARGET["p90"]))
        + 0.5 * abs(math.log(p10 / TARGET["p10"]))
        + abs(math.log(rb / TARGET["rb"]))
        + 2.0 * band_violation(float(metrics["face"]), 0.55, 0.70)
        + 2.0 * band_violation(float(metrics["bg"]), 0.45, 0.55)
        + 0.5 * max(0.0, 0.6 - float(metrics["faceLR"]))
        + abs(float(metrics["volume"]) - TARGET["volume"]) / TARGET["volume"]
    )
    if include_length:
        score += abs(float(metrics["lengthBelowChinFrac"]) - TARGET["lengthBelowChinFrac"]) / TARGET["lengthBelowChinFrac"]
    if int(metrics["maskPx"]) < 100000 or float(metrics["meanRBSpread"]) >= 0.20:
        score += 5.0
    return float(score)


def breakdown(metrics: Mapping[str, Any], include_length: bool = True) -> dict[str, float]:
    """Auditable term-by-term score, including total."""
    terms = {
        "p50": abs(math.log(max(float(metrics["p50"]), 1e-9) / TARGET["p50"])),
        "p90": 0.5 * abs(math.log(max(float(metrics["p90"]), 1e-9) / TARGET["p90"])),
        "p10": 0.5 * abs(math.log(max(float(metrics["p10"]), 0.01) / TARGET["p10"])),
        "rb": abs(math.log(max(float(metrics["rb"]), 1e-9) / TARGET["rb"])),
        "faceBand": 2.0 * band_violation(float(metrics["face"]), 0.55, 0.70),
        "bgBand": 2.0 * band_violation(float(metrics["bg"]), 0.45, 0.55),
        "faceLR": 0.5 * max(0.0, 0.6 - float(metrics["faceLR"])),
        "volume": abs(float(metrics["volume"]) - TARGET["volume"]) / TARGET["volume"],
        "length": (abs(float(metrics["lengthBelowChinFrac"]) - TARGET["lengthBelowChinFrac"]) / TARGET["lengthBelowChinFrac"] if include_length else 0.0),
        "contamination": (5.0 if int(metrics["maskPx"]) < 100000 or float(metrics["meanRBSpread"]) >= 0.20 else 0.0),
    }
    terms["total"] = sum(terms.values())
    return terms

