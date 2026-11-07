"""hair-route2 shared loader (S7, new code; hull/route0/route1 untouched).

Why this file exists: route/common.py hardcodes the route0 evidence dir,
the v1 manifest, the hull0c hull and 3 views (front/profile_90/back, no
three_quarter). Route2 runs on hull3 (ear-tucked set aisha-v3, manifest
aisha_straight_long_v4.json) with 4 views, the cage1 body-depth maps plus
the hull3-workspace three_quarter map, and the hull3 ear-pinna sets for
the new ear gate. Same runtime-inputs-log rule as hull0c/route0: every
file opened at runtime is tracked in OPENED and scorched into
E2/inputs-opened.txt by each stage.
"""
from __future__ import annotations

import hashlib
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
E = ROOT / "tools/openclinxr/evidence/hair-route2"
VIEWS = ("front", "three_quarter", "profile_90", "back")
MASK_FILE = {"front": "mask-front.png",
             "three_quarter": "mask-three_quarter.png",
             "profile_90": "mask-profile.png",
             "back": "mask-back.png"}

OPENED: list[str] = []


def track(path) -> Path:
    p = Path(path)
    OPENED.append(str(p.resolve()))
    return p


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def load_all():
    manifest = json.loads(track(
        HAIR_GROOM / "manifests" / "aisha_straight_long_v4.json").read_text())
    assert manifest["registration"]["method"] == "identity"
    cams = INS.load_cameras(str(track(
        ROOT / manifest["camerasFile"]["path"])))
    track(HAIR_GROOM / "cage" / "instruments.py")
    track(HAIR_GROOM / "envelope.py")
    track(HAIR_GROOM / "register.py")
    track(HAIR_GROOM / "cage" / "exact.py")
    track(S7 / "common2.py")
    sensor = INS.sensor_of(cams)
    # identity registration: render frame IS the target frame per v4
    transforms = {v: {"scale": 1.0, "tx": 0.0, "ty": 0.0} for v in VIEWS}
    masks = {}
    for view in VIEWS:
        entry = manifest["targets"]["masks"][view]
        mp = Path(entry["path"])
        track(mp)
        assert _sha256(mp) == entry["sha256"], "mask sha drift %s" % view
        masks[view] = np.array(__import__(
            "PIL.Image", fromlist=["open"]).open(mp)) > 127
    bd = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-cage1/body-depth.npz")))
    bd3q = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-hull3/workspace"
        / "body-depth-3q.npz")))
    body = {v: {"cover": np.array(bd["%s/cover" % v], dtype=bool),
                "depth": np.array(bd["%s/depth" % v],
                                  dtype=np.float64)}
            for v in ("front", "profile_90", "back")}
    body["three_quarter"] = {
        "cover": np.array(bd3q["cover"], dtype=bool),
        "depth": np.array(bd3q["depth"], dtype=np.float64)}
    egrid = EXACT.load_exact(str(track(
        ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")))
    track(ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")
    scalp = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-scalp1/scalp.npz")))
    roots = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz")))
    hull = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-hull3/hull.npz")))
    assert list(hull["views"]) == list(VIEWS), list(hull["views"])
    frame = np.load(str(track(Path("/tmp/station0b-run/station-frame.npz"))))
    crown = np.array(frame["point3d/crown"], dtype=np.float64)
    menton = np.array(frame["point3d/menton"], dtype=np.float64)
    brow = np.array(frame["point3d/brow"], dtype=np.float64)
    pin = np.load(str(track(
        ROOT / "tools/openclinxr/evidence/hair-hull3/workspace"
        / "ear_pinna.npz")))
    xyz_mm = np.asarray(pin["xyz"], dtype=np.float64) * 1000.0
    pinna = {"xpos": np.asarray(xyz_mm[np.asarray(pin["idx_earXpos"])],
                                dtype=np.float64),
             "xneg": np.asarray(xyz_mm[np.asarray(pin["idx_earXneg"])],
                                dtype=np.float64)}
    shoulder_z = float(hull["shoulder_plane_z"])
    track(ROOT / "tools/openclinxr/evidence/hair-hull3/hull.npz")
    return {"manifest": manifest, "cams": cams, "transforms": transforms,
            "sensor": sensor, "masks": masks, "body": body, "egrid": egrid,
            "scalp": scalp, "roots": roots, "hull": hull, "crown": crown,
            "menton": menton, "brow": brow, "pinna": pinna,
            "shoulder_z": shoulder_z}


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
    (Same convention as route0 common.py.)
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
