#!/usr/bin/env python3
"""hair-groom25: 3D crossing count via diag23 step-A verbatim.

Monkeypatches diag23.GUIDE_FILES to groom19 + groom21 + the three groom25
bounded-fairing candidates and runs diag23.step_a() unchanged.
Writes E/metrics-cross25.json.
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
    "guides-25a": E / "build-25a/guides-25a.npz",
    "guides-25b": E / "build-25b/guides-25b.npz",
    "guides-25c": E / "build-25c/guides-25c.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a()}
    (E / "metrics-cross25.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross25.json")
