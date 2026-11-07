#!/usr/bin/env python3
"""hair-groom26: 3D crossing count via diag23 step-A verbatim (guides only).

Measures guides-19, guides-25b (lock baseline), and the hem-blend
candidates. Writes E/metrics-cross26.json.
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
    "guides-25b": ROOT / "tools/openclinxr/evidence/hair-groom25"
    / "build-25b/guides-25b.npz",
    "guides-26keep200": E / "build-26keep200/guides-26keep200.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a()}
    (E / "metrics-cross26.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross26.json")
