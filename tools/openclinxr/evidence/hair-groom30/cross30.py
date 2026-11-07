#!/usr/bin/env python3
"""hair-groom27: 3D crossing count via diag23 step-A verbatim (guides only).

Measures guides-19, guides-25b (lock baseline), guides-27 (s14 posterior bypass). Writes E/metrics-cross27.json.
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
    "guides-29": Path("/Volumes/files/openclinxr-assets/store/hair-groom29")
    / "guides-29.npz",
    "guides-30f": E / "build-30f/guides-30f.npz",
    "guides-30": E / "build-30/guides-30.npz",
    "guides-30nb": E / "build-30nb/guides-30nb.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a()}
    (E / "metrics-cross30.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross30.json")
