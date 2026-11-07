#!/usr/bin/env python3
"""hair-groom29: 3D crossing count via diag23 step-A verbatim (guides only).

Measures guides-19 (lock baseline), guides-26keep200 (= groom26 guides,
gate reference 885), guides-29a (re-draped pre-fairing, for information),
and guides-29 (final). Writes E/metrics-cross29.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
STORE29 = Path("/Volumes/files/openclinxr-assets/store/hair-groom29")
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-groom23diag"))

import diag23 as D  # noqa: E402

D.GUIDE_FILES = {
    "guides-19": T2 / "tools/openclinxr/evidence/hair-groom19"
    / "build/guides-19.npz",
    "guides-26keep200": T2 / "tools/openclinxr/evidence/hair-groom26"
    / "build-26keep200/guides-26keep200.npz",
    "guides-29a": STORE29 / "guides-29a.npz",
    "guides-29": STORE29 / "guides-29.npz",
}

if __name__ == "__main__":
    out = {"crossing3D": D.step_a()}
    (E / "metrics-cross29.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross29.json")
