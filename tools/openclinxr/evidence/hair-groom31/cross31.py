#!/usr/bin/env python3
"""hair-groom31: 3D crossing count via diag23 step-A verbatim (guides only).

groom31 reuses guides-30 (no guide change this round): measures the same
guides file the groom31 children ride. Writes E/metrics-cross31.json.
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
    "guides-30": E.parent / "hair-groom30" / "build-30/guides-30.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "groom31 children ride guides-30 unchanged; "
                   "crossing count is guides-level by construction"}
    (E / "metrics-cross31.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross31.json")
