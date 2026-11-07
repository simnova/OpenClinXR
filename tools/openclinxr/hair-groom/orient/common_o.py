"""hair-orient0 shared loader (S10, new code; hull/route/strands/cage/scalp untouched).

Inputs (same aisha-v3 set as route2): hull3/hull.npz, scalp1 roots/scalp,
cage1 exact-SDF + body-depth (front/profile/back), hull3-workspace
body-depth-3q, station-frame, hull3 ear_pinna.npz, v4 manifest (identity
registration: render frame IS the target frame), Aisha GLB, plus the four
aisha-v3 target beauties from the scratch dir (route2 tile precedent).

Runtime-inputs-log rule (same as hull0c/route0/route2): every file opened
at runtime is tracked in OPENED and scorched into E0/inputs-opened.txt.
No absolute scratch paths inside the pipeline: target/mask paths come
from the v4 manifest where present; beauty tiles use the route2 scratch
constant (tracked, read-only).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np

S10 = Path(__file__).resolve().parent
HAIR_GROOM = S10.parent
sys.path.insert(0, str(S10))
sys.path.insert(0, str(HAIR_GROOM / "route"))
sys.path.insert(0, str(HAIR_GROOM / "cage"))
sys.path.insert(0, str(HAIR_GROOM))
import common2 as C2  # noqa: E402  (read-only reuse: loader + ENV/INS/EXACT)

ROOT = S10.parents[3]
# E0 override (hair-groom1 card): HAIR_E0 redirects stage outputs to a
# different evidence dir without overwriting hair-orient0. Default keeps
# orient0 behaviour bit-identical.
E0 = Path(os.environ.get(
    "HAIR_E0", str(ROOT / "tools/openclinxr/evidence/hair-orient0")))
VIEWS4 = ("front", "three_quarter", "profile_90", "back")

# aisha-v3 target beauties (route2 guides-vs-target tile precedent).
SCRATCH = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
               "/target-views/aisha-v3")
BEAUTY_TILE = {"front": "target-front-a1.png",
               "three_quarter": "target-three_quarter-a1.png",
               "profile_90": "target-profile.png",
               "back": "target-back.png"}

OPENED: list[str] = []


def track(path) -> Path:
    p = Path(path)
    OPENED.append(str(p.resolve()))
    return p


def write_inputs_log(extra=()):
    E0.mkdir(parents=True, exist_ok=True)
    seen = set()
    dest = E0 / "inputs-opened.txt"
    if dest.exists():
        seen.update(dest.read_text().splitlines())
    seen.update(OPENED)
    seen.update(str(Path(p).resolve()) for p in extra)
    dest.write_text("\n".join(sorted(seen)) + "\n")


def load_all():
    """common2 inputs (tracked there) + aisha-v3 target beauties."""
    track(S10 / "common_o.py")
    inp = C2.load_all()
    OPENED.extend(s for s in C2.OPENED if s not in OPENED)
    # Hull override (hair-groom1 card): run the orient pipeline on the
    # hull5 support instead of hull3. Route (common2) still loads hull3
    # (route/ is not a write root); only the hull + its shoulder plane
    # are swapped, everything else (roots, SDF, body-depth, pinna =
    # same-Aisha ears, masks, station frame) is shared. No other change.
    hul = os.environ.get("HAIR_HULL_NPZ")
    if hul:
        track(hul)
        h = np.load(str(Path(hul)), allow_pickle=True)
        inp["hull"] = h
        inp["shoulder_z"] = float(h["shoulder_plane_z"])
    from PIL import Image
    targets = {}
    for view in VIEWS4:
        tp = SCRATCH / BEAUTY_TILE[view]
        track(tp)
        targets[view] = (np.asarray(Image.open(tp).convert("RGB"),
                                   dtype=np.float64) / 255.0)
    inp["targets"] = targets
    return inp


def head_to_world(pts_head_mm, crown):
    return C2.head_to_world(pts_head_mm, crown)


def world_to_head(pts_world_m, crown):
    return C2.world_to_head(pts_world_m, crown)
