#!/usr/bin/env python3
"""hair-groom18: re-run the BOUNDED height transfer in Python (no Blender).

Input:  build/strands-18-pre.npz (Attach/Interp/Clump/Noise children,
        1 depth class, ig3, dtg 0.02, no outside pass) + groom16 cleared guides.
Runs strands/height_transfer.transfer (per-iter step cap 10 mm,
per-sample path cap 150 mm, best-residual restore) and writes
build/strands-18.npz + build/height-transfer.json.

The Blender build (build/build.log) ran the same transfer inline with the
unbounded walker; this rerun replaces strands-18.npz with the bounded result.
Deterministic: pure numpy, fixed guide input, no RNG.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STRANDS = ROOT / "tools/openclinxr/hair-groom/strands"
sys.path.insert(0, str(STRANDS))
from children import sdf_sampler  # noqa: E402
import body_clear as BC  # noqa: E402
import height_transfer as HT  # noqa: E402

SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
GUIDES = ROOT / "tools/openclinxr/evidence/hair-groom16/build/guides-cleared.npz"


def main():
    t0 = time.time()
    pre = np.load(str(E / "build" / "strands-18-pre.npz"), allow_pickle=True)
    pts = np.asarray(pre["points"], dtype=np.float64)
    radii = np.asarray(pre["radii"], dtype=np.float64)
    roots = np.asarray(pre["roots"], dtype=np.float64)
    g = np.load(str(GUIDES), allow_pickle=True)
    gw = np.asarray(g["curves_world"], dtype=np.float64)
    sdoc = np.load(str(SDFP), allow_pickle=True)
    sample, _ = sdf_sampler(sdoc)

    _pre = BC.sample_mm(sample, pts[:, 1:, :].reshape(-1, 3))
    _fin = int(np.isfinite(_pre).sum())
    _ins = int(np.nansum(_pre < 0.0))
    print("PRE insideSamplesSge1=%d finite=%d frac=%.6f"
          % (_ins, _fin, _ins / max(_fin, 1)), flush=True)

    out, net, pc, stats = HT.transfer(pts, gw, sample)
    stats["preInside"] = {"insideSamplesSge1": _ins, "finite": _fin,
                          "insideFracSge1": round(_ins / max(_fin, 1), 6)}

    outp = E / "build" / "strands-18.npz"
    np.savez(str(outp), points=out.astype(np.float32), radii=radii,
             roots=roots,
             guide_idx=np.zeros(len(out), dtype=np.int32),
             child_move_mm=np.asarray(pc, dtype=np.float32))
    (E / "build" / "height-transfer.json").write_text(
        json.dumps(stats, indent=1) + "\n")
    print("wrote %s in %.0fs" % (outp, time.time() - t0), flush=True)
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
