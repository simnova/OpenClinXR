#!/usr/bin/env python3
"""Build compact groom11 A/B/C diagnostic inputs for the pinned boxes."""
from pathlib import Path
import sys
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

FINAL = Path("/Volumes/files/openclinxr-assets/store/hair-groom11/build/strands.npz")
RAW = Path("/Volumes/files/openclinxr-assets/store/hair-groom11/raw-interpolation.npz")


def main():
    final = np.load(FINAL, allow_pickle=True)
    guides = np.load(E / "build/guides-11.npz", allow_pickle=True)
    gw = F.head_to_world(np.asarray(guides["curves_head"]), guides["crown"])
    gres = np.stack([F.resample_arc(g, 32) for g in gw])
    gi = np.asarray(final["guide_idx"], dtype=np.int64)[:, 0]
    roots = np.asarray(final["roots"], dtype=np.float64)
    raw = roots[:, None, :] + (gres[gi] - gres[gi, :1])
    np.savez_compressed(RAW, points=raw.astype(np.float32))

    old = np.load(ROOT / "tools/openclinxr/evidence/hair-groom10diag"
                  / "defect-strands.npz", allow_pickle=True)
    np.savez_compressed(E / "defect-strands.npz",
                        **{k: np.asarray(old[k]) for k in old.files})
    names = np.array(["bounded_downstream"])
    n = len(roots)
    np.savez_compressed(
        E / "stage-displacements.npz", stage_names=names,
        max_mm=np.zeros((n, 1), dtype=np.float32),
        final_guide_idx=np.asarray(final["guide_idx"], dtype=np.int32),
        final_guide_w=np.asarray(final["guide_w"], dtype=np.float32))
    print(RAW)


if __name__ == "__main__":
    main()
