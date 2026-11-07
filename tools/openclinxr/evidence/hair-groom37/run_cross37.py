#!/usr/bin/env python3
"""groom37: 3D crossing count via groom31's cross31 path (import, no copy).

37 children ride guides-36 (unchanged guides file): same diag23 step-A
call as cross36. Writes E37/metrics-cross37.json."""
from __future__ import annotations
import json
import sys
from pathlib import Path
E37 = Path(__file__).resolve().parent
E31 = E37.parent / "hair-groom31"
sys.path.insert(0, str(E31.parent / "hair-groom23diag"))
import diag23 as D  # noqa: E402
D.GUIDE_FILES = {
    "guides-36": Path("/Volumes/files/openclinxr-assets/store/hair-groom36/guides-36.npz"),
}
if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "37 children ride guides-36; "
                   "crossing count is guides-level by construction"}
    (E37 / "metrics-cross37.json").write_text(json.dumps(out, indent=1)
                                              + "\n")
    print("WROTE E/metrics-cross37.json")
