"""STEP 2 driver (pure python): build the scalp mesh via Blender, verify outputs.

Runs _blender_scalp.py in Blender background mode, then checks E/scalp.npz
+ E/scalp.obj exist with sane counts. The mesh is a separate object copied
from the body head surface (no inset); the region is the head surface inside
the hairline loop with ear exclusion and the nape line (loop-tested, so ears
and face fall outside by construction).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-scalp1")
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


def main():
    proc = subprocess.run(
        [BLENDER, "--background", "--python", str(S2 / "_blender_scalp.py"),
         "--", str(E)], capture_output=True, text=True)
    sys.stdout.write(proc.stdout[-3000:])
    sys.stderr.write(proc.stderr[-2000:])
    if proc.returncode != 0 or "SCALP_DONE" not in proc.stdout:
        raise RuntimeError("blender scalp build failed")
    z = np.load(E / "scalp.npz")
    verts, tris = z["verts"], z["tris"]
    assert verts.shape[1] == 3 and tris.shape[1] == 3 and len(tris) > 1000
    assert (E / "scalp.obj").stat().st_size > 100000
    print("STEP2_DONE scalpTris=%d" % len(tris))


if __name__ == "__main__":
    main()
