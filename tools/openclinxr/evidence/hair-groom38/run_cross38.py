#!/usr/bin/env python3
"""groom38: 3D crossing count via groom31's cross31 path (import, no copy).

38 children ride guides-36 (unchanged guides file): same diag23 step-A
call as cross36/37. Writes E38/metrics-cross38.json."""
from __future__ import annotations
import json
import sys
from pathlib import Path
E38 = Path(__file__).resolve().parent
E31 = E38.parent / "hair-groom31"
sys.path.insert(0, str(E31.parent / "hair-groom23diag"))
import diag23 as D  # noqa: E402
D.GUIDE_FILES = {
    "guides-36": Path("/Volumes/files/openclinxr-assets/store/hair-groom36/guides-36.npz"),
}
if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "38 children ride guides-36; "
                   "crossing count is guides-level by construction"}
    (E38 / "metrics-cross38.json").write_text(json.dumps(out, indent=1)
                                              + "\n")
    print("WROTE E/metrics-cross38.json")
