"""groom34: mirrored scorer cameras + ear close-up cameras (E driver).

Mirror: M' = F M F with F = diag(-1,1,1,1) (reflect across x=0;
proper rotation preserved). Ear close-ups: look-at cameras at ~0.18 m
from each ear centroid, 50 mm lens (same sensor), stored under the
standard view names so render_studio.py runs unmodified
(HAIR_VIEWS selects; outputs renamed after).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
MAN = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"


def look_at(pos, tgt, up=np.array([0.0, 0.0, 1.0])):
    z = np.asarray(pos, dtype=float) - np.asarray(tgt, dtype=float)
    z /= np.linalg.norm(z)
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, np.asarray(pos)
    return M


def main():
    man = json.loads(MAN.read_text())
    F = np.diag([-1.0, 1.0, 1.0, 1.0])
    mir = {"sensorWidthMm": man["sensorWidthMm"], "views": {},
           "provenance": "M'=F M F across x=0 from cameras-scorer-v3.json"}
    for v, rec in man["views"].items():
        M = np.array(rec["matrixWorld"], dtype=float)
        Mm = F @ M @ F
        mir["views"][v] = {"matrixWorld": Mm.tolist(),
                           "lensMm": rec["lensMm"]}
    (E / "cameras-mirror34.json").write_text(json.dumps(mir, indent=1)
                                             + "\n")

    ear = {"sensorWidthMm": man["sensorWidthMm"], "views": {},
           "provenance": "look-at close-ups, 0.18 m from ear centroid, "
                         "50mm; stored under standard names for "
                         "render_studio.py (HAIR_VIEWS picks)"}
    for nm, sgn, slot in (("xpos", 1.0, "front"),
                          ("xneg", -1.0, "three_quarter")):
        tgt = np.array([sgn * 0.071, -0.068, 1.531])
        d = np.array([sgn * 0.85, -0.45, 0.25])
        d /= np.linalg.norm(d)
        pos = tgt + d * 0.18
        ear["views"][slot] = {"matrixWorld": look_at(pos, tgt).tolist(),
                              "lensMm": 50.0,
                              "note": "ear-%s close-up" % nm}
    # unused slots (never rendered; valid matrices required by loader)
    for slot in ("profile_90", "back"):
        ear["views"][slot] = {"matrixWorld": man["views"][slot]
                              ["matrixWorld"], "lensMm": 50.0,
                              "note": "unused"}
    (E / "cameras-ear34.json").write_text(json.dumps(ear, indent=1) + "\n")
    print("wrote cameras-mirror34.json + cameras-ear34.json")
    # sanity: mirrored 3q camera position
    print("3q std pos", np.array(
        man["views"]["three_quarter"]["matrixWorld"])[:3, 3].tolist())
    print("3q mir pos", np.array(
        mir["views"]["three_quarter"]["matrixWorld"])[:3, 3].tolist())


if __name__ == "__main__":
    main()
