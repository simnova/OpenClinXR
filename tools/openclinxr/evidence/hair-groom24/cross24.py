#!/usr/bin/env python3
"""hair-groom24: 3D crossing count via diag23 step-A verbatim.

Monkeypatches diag23.GUIDE_FILES to the two groom24 inputs (guides-19,
guides-21 -- the exact guide files the two builds were grown from) and
runs diag23.step_a() unchanged. Writes E/metrics-cross24.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(E.parent / "hair-groom23diag"))

import diag23 as D  # noqa: E402

D.GUIDE_FILES = {
    "guides-19": ROOT / "tools/openclinxr/evidence/hair-groom19"
    / "build/guides-19.npz",
    "guides-21": ROOT / "tools/openclinxr/evidence/hair-groom21"
    / "build/guides-21.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a()}
    (E / "metrics-cross24.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross24.json")
