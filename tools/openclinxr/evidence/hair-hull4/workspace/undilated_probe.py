"""hair-hull4 mechanism probe: undilated 6-view re-carve side symmetry.

stage_sensitivity discards recarve finals (keeps contours only). The RESULT
needs the undilated hull's below-shoulder L/R: does the SYMMETRY fix survive
zero-slack even though absolute hem length does not? Reuses the carve
method by import (carve_grids + close_and_filter, same calls as
stage_sensitivity's undilated branch); measures below_shoulder only.
Writes WS/undilated_probe.json. No E deliverables.
"""

import json
import sys
from pathlib import Path

import numpy as np

WORKTREE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom/hull"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(WORKTREE / "tools/openclinxr/evidence/hair-hull4/workspace"))

import hull as H  # noqa: E402
import hull1 as H1  # noqa: E402
from work import apply_all, loader  # noqa: E402

apply_all()
inp = loader()
assert len(inp["views"]) == 6, inp["views"]
res = H.carve_grids(inp, spacing=2.0, dil_px=0, store=False)
filt = H.close_and_filter(res, inp, res["dil"], res["occ"])
final = filt["final"]
b = H1.below_shoulder(final, res["xs"], res["ys"], res["zs"])
L, R = b["sideL"]["vox"], b["sideR"]["vox"]
out = {"keptFinal": int(final.sum()),
       "nCompPost": filt["n_post"],
       "sideL": L, "sideR": R,
       "L_over_R": round(L / max(1, R), 4),
       "sidePass08_125": bool(0.8 <= L / max(1, R) <= 1.25),
       "belowShoulder": b}
print(json.dumps({k: out[k] for k in
                  ("keptFinal", "nCompPost", "sideL", "sideR", "L_over_R",
                   "sidePass08_125")}, indent=1), flush=True)
(WORKTREE / "tools/openclinxr/evidence/hair-hull4/workspace/undilated_probe.json"
 ).write_text(json.dumps(out, indent=1))
