#!/usr/bin/env python3
"""groom35: 3D crossing count via groom31's cross31 path (import, no copy).

STEP 2/3 children ride guides-34mirror unchanged: same diag23 step-A
call as cross31/cross33/cross34. Writes E/metrics-cross35.json."""
from __future__ import annotations
import json
import sys
from pathlib import Path
E35 = Path(__file__).resolve().parent
E31 = E35.parent / "hair-groom31"
sys.path.insert(0, str(E31.parent / "hair-groom23diag"))
import diag23 as D  # noqa: E402
D.GUIDE_FILES = {
    "guides-34mirror": Path("/Volumes/files/openclinxr-assets/store/hair-groom34/guides-34mirror.npz"),
}
if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "step2/step3 children ride guides-34mirror unchanged; "
                   "crossing count is guides-level by construction"}
    (E35 / "metrics-cross35.json").write_text(json.dumps(out, indent=1)
                                              + "\n")
    print("WROTE E/metrics-cross35.json")
