"""hair-route0 shared loader (S7, new code; hull/ untouched).

Loads the runtime inputs every route0 stage needs: hull0c hull.npz,
scalp1 roots + scalp mesh, cage1 exact SDF + body-depth maps, station
cameras/registration/targets/landmarks, station-frame 3D landmarks.
Every file opened at runtime is tracked in OPENED and scorched into
E/inputs-opened.txt by each stage (same runtime-inputs-log rule as hull0c).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

S7 = Path(__file__).resolve().parent
HAIR_GROOM = S7.parent
sys.path.insert(0, str(S7))
sys.path.insert(0, str(HAIR_GROOM / "cage"))
sys.path.insert(0, str(HAIR_GROOM))
import envelope as ENV  # noqa: E402
import instruments as INS  # noqa: E402
import exact as EXACT  # noqa: E402

ROOT = S7.parents[3]
E = ROOT / "tools/openclinxr/evidence/hair-route0"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/"
             "tools/openclinxr/evidence/hair-judge/target-set-back")
VIEWS = ("front", "profile_90", "back")
MASKS = {"front": "mask-front-v2.png",
         "profile_90": "mask-profile-v2.png",
         "back": "mask-back-v3.png"}

OPENED: list[str] = []


def track(path) -> Path:
    p = Path(path)
    OPENED.append(str(p.resolve()))
    return p


def load_all():
    manifest = json.loads(track(
        HAIR_GROOM / "manifests" / "aisha_straight_long.json").read_text())
    cams = INS.load_cameras(str(track(
        ROOT / manifest["camerasFile"]["path"])))
    track(HAIR_GROOM / "cage" / "instruments.py")
    track(HAIR_GROOM / "envelope.py")
    track(HAIR_GROOM / "register.py")
    track(HAIR_GROOM / "cage" / "exact.py")
    track(S7 / "common.py")
    transforms = INS.transforms_of(cams)
    sensor = INS.sensor_of(cams)
    masks = {}
    for view in VIEWS:
        mp = track(JUDGE / MASKS[view])
        masks[view] = np.array(__import__(
            "PIL.Image", fromlist=["open"]).open(mp)) > 127
    bd = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-cage1/body-depth.npz")))
    body = {v: {"cover": np.array(bd["%s/cover" % v], dtype=bool),
                "depth": np.array(bd["%s/depth" % v],
                                  dtype=np.float64)}
            for v in VIEWS}
    egrid = EXACT.load_exact(str(track(
        ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")))
    track(ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")
    scalp = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-scalp1/scalp.npz")))
    roots = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz")))
    hull = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-hull0c/hull.npz")))
    frame = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"))))
    crown = np.array(frame["point3d/crown"], dtype=np.float64)
    menton = np.array(frame["point3d/menton"], dtype=np.float64)
    brow = np.array(frame["point3d/brow"], dtype=np.float64)
    land = json.loads(track(Path(
        manifest["targets"]["landmarks"]["path"])).read_text())
    track(ROOT / "tools/openclinxr/evidence/hair-hull0c/hull.npz")
    return {"cams": cams, "transforms": transforms, "sensor": sensor,
            "masks": masks, "body": body, "egrid": egrid, "scalp": scalp,
            "roots": roots, "hull": hull, "crown": crown, "menton": menton,
            "brow": brow, "landmarks": land}


def write_inputs_log(extra=()):
    E.mkdir(parents=True, exist_ok=True)
    seen = set()
    dest = E / "inputs-opened.txt"
    if dest.exists():
        seen.update(dest.read_text().splitlines())
    seen.update(OPENED)
    seen.update(str(Path(p).resolve()) for p in extra)
    dest.write_text("\n".join(sorted(seen)) + "\n")


def head_to_world(pts_head_mm, crown):
    """head-mm (x right, y back-of-head positive?, drop) -> world metres.

    Inverse of the guides convention: world_x = x/1000,
    world_y = crown_y - y/1000, world_z = crown_z - z/1000.
    """
    pts = np.asarray(pts_head_mm, dtype=np.float64)
    world = np.empty_like(pts)
    world[:, 0] = pts[:, 0] / 1000.0
    world[:, 1] = float(crown[1]) - pts[:, 1] / 1000.0
    world[:, 2] = float(crown[2]) - pts[:, 2] / 1000.0
    return world


def world_to_head(pts_world_m, crown):
    pts = np.asarray(pts_world_m, dtype=np.float64)
    out = np.empty_like(pts)
    out[:, 0] = pts[:, 0] * 1000.0
    out[:, 1] = (float(crown[1]) - pts[:, 1]) * 1000.0
    out[:, 2] = (float(crown[2]) - pts[:, 2]) * 1000.0
    return out
