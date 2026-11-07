#!/usr/bin/env python3
"""groom33: 3D crossing count via groom31's cross31 path (guides only).

groom33 rides guides-30 unchanged: same diag23 step-A call as cross31.
Writes E33/metrics-cross33.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

E33 = Path(__file__).resolve().parent
E31 = E33.parent / "hair-groom31"
sys.path.insert(0, str(E31.parent / "hair-groom23diag"))

import diag23 as D  # noqa: E402

D.GUIDE_FILES = {
    "guides-30": E31.parent / "hair-groom30" / "build-30/guides-30.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "groom33 children ride guides-30 unchanged; "
                   "crossing count is guides-level by construction"}
    (E33 / "metrics-cross33.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross33.json")
