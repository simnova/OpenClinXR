#!/usr/bin/env python3
"""hair-groom28 MITIG: 3D crossing count (diag23 step A verbatim) for the
curtain-preserving candidate guides-28M vs guides-25b."""
from __future__ import annotations

import json
import sys

sys.path.insert(
    0, "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2"
    "/tools/openclinxr/evidence/hair-groom23diag")

import diag23 as D  # noqa: E402

from pathlib import Path

D.GUIDE_FILES = {
    "guides-25b": Path(
        "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2"
        "/tools/openclinxr/evidence/hair-groom25/build-25b/guides-25b.npz"),
    "guides-28M": Path("/tmp/hair28/guides-28M.npz"),
}
out = {"crossing3D": D.step_a()}
print(json.dumps(out, indent=1))
