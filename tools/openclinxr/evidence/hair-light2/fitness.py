"""Deterministic Hair Search round-2 fitness (lower is better).

Weights/provenance: the 2026-10-12 Fable review replaced the v1 symmetric
tone matching with a 2.0 p50 log term, one-sided p90/p10 hinges, and a 1.0
crown-band sheen term. Colour, below-chin length, threshold volume, face and
background bands, face left/right balance, and the 5.0 contamination guard are
the task-specified round-2 weights. p90 is intentionally only a hinge.
"""
from __future__ import annotations
import math
from typing import Any, Mapping

TARGET = {"p50": .078, "p90Max": .24, "p10Min": .03, "rb": 1.52,
          "volume": .294, "lengthBelowChinFrac": .51}

def band_violation(value: float, low: float, high: float) -> float:
    if value < low: return (low-value)/(high-low)
    if value > high: return (value-high)/(high-low)
    return 0.0

def breakdown(metrics: Mapping[str, Any]) -> dict[str, float]:
    terms = {
        "p50": 2.0*abs(math.log(max(float(metrics["p50"]),1e-9)/TARGET["p50"])),
        "p90Hinge": max(0.0,float(metrics["p90"])-TARGET["p90Max"])/TARGET["p90Max"],
        "p10Hinge": max(0.0,TARGET["p10Min"]-float(metrics["p10"]))/TARGET["p10Min"],
        "rb": abs(math.log(max(float(metrics["rb"]),1e-9)/TARGET["rb"])),
        "length": abs(float(metrics["lengthBelowChinFrac"])-TARGET["lengthBelowChinFrac"])/TARGET["lengthBelowChinFrac"],
        "volume": abs(float(metrics["volume"])-TARGET["volume"])/TARGET["volume"],
        "faceBand": 2.0*band_violation(float(metrics["face"]),.55,.70),
        "bgBand": band_violation(float(metrics["bg"]),.45,.55),
        "faceLR": .5*max(0.0,.6-float(metrics["faceLR"])),
        "sheenBand": max(0.0,.6-float(metrics["sheenTopFrac"])),
        "contamination": 5.0 if int(metrics["maskPx"])<100000 or float(metrics["meanRBSpread"])>=.20 else 0.0,
    }
    terms["total"] = float(sum(terms.values()))
    return terms

def fitness(metrics: Mapping[str, Any]) -> float:
    return breakdown(metrics)["total"]
