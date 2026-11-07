"""STEP 6b driver (pure python): spikes contact sheet + yellow-hair check.

Stacks E/spike_<view>.png into E/spikes.png (2x2, 1024px) and counts
would-be library-hair yellow pixels (R>0.75 & G>0.65 & B<0.35) per render;
the bob shell is bright yellow, skin is not. Writes E/spikes_check.json.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-scalp1")
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
VIEWS = ("front", "three_quarter", "profile_90", "crown_top")


def main():
    missing = [v for v in VIEWS if not (E / ("spike_%s.png" % v)).exists()]
    if missing:
        proc = subprocess.run(
            [BLENDER, "--background", "--python", str(S2 / "_blender_spikes.py"),
             "--", str(E)], capture_output=True, text=True)
        sys.stdout.write(proc.stdout[-2000:])
        sys.stderr.write(proc.stderr[-1500:])
        if proc.returncode != 0 or "SPIKES_DONE" not in proc.stdout:
            raise RuntimeError("blender spikes render failed")
    tiles = []
    check = {}
    for v in VIEWS:
        img = Image.open(E / ("spike_%s.png" % v)).convert("RGB")
        a = np.asarray(img).astype(np.float64) / 255.0
        yellow = ((a[..., 0] > 0.75) & (a[..., 1] > 0.65) & (a[..., 2] < 0.35)).sum()
        check[v] = {"yellowPx": int(yellow),
                    "frac": float(yellow / (a.shape[0] * a.shape[1]))}
        tiles.append(img)
    sheet = Image.new("RGB", (tiles[0].width * 2, tiles[0].height * 2), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * t.width, (i // 2) * t.height))
    sheet.save(E / "spikes.png")
    check["gate"] = all(v["frac"] < 0.001 for v in check.values() if isinstance(v, dict))
    (E / "spikes_check.json").write_text(json.dumps(check, indent=2, sort_keys=True) + "\n")
    print("SPIKESHEET yellow=%s gate=%s" % (
        {v: check[v]["yellowPx"] for v in VIEWS}, check["gate"]))


if __name__ == "__main__":
    main()
