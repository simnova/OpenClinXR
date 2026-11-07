#!/usr/bin/env python3
"""hair-part1: 3D back crossings via diag23 step A (import, no copy).

Every hair-part1 variant rides guides-36 unchanged (a/b/c/d edit roots
or children only), so the guides-level count is one number for all of
them. Writes E/metrics-cross-part1.json."""
from __future__ import annotations
import json
import sys
from pathlib import Path
E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parent / "hair-groom23diag"))
import diag23 as D  # noqa: E402
D.GUIDE_FILES = {"guides-36": Path(
    "/Volumes/files/openclinxr-assets/store/hair-groom36/guides-36.npz")}
if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "all hair-part1 variants ride guides-36 unchanged"}
    (E / "metrics-cross-part1.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE metrics-cross-part1.json")
