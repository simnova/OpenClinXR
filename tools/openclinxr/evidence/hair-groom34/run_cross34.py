#!/usr/bin/env python3
"""groom34: 3D crossing count via groom31's cross31 path (import, no copy).

mask20 children ride guides-34mirror unchanged: same diag23 step-A call as
cross31/cross33 with GUIDE_FILES pointed at guides-34mirror.
Writes E/metrics-cross34.json."""
from __future__ import annotations
import json, sys
from pathlib import Path
E34 = Path(__file__).resolve().parent
E31 = E34.parent / "hair-groom31"
sys.path.insert(0, str(E31.parent / "hair-groom23diag"))
import diag23 as D  # noqa: E402
D.GUIDE_FILES = {
    "guides-34mirror": Path("/Volumes/files/openclinxr-assets/store/hair-groom34/guides-34mirror.npz"),
}
if __name__ == "__main__":
    out = {"crossing3D": D.step_a(),
           "note": "mask20 children ride guides-34mirror unchanged; "
                   "crossing count is guides-level by construction"}
    (E34 / "metrics-cross34.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-cross34.json")
