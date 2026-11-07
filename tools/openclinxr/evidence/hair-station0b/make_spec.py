#!/usr/bin/env python3
"""Evidence-only: freeze the envelope spec BEFORE any optimisation.

Reads the exported body verts, measures the crown point + head-section
anchors (half-width / front / back per drop below crown), collects the
pinned-input shas, and writes E/envelope-spec.json. The spec sha is
recorded by the fit step before fitting starts; the spec is not edited
after fitting.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(E.parents[1] / "hair-groom"))
import envelope as ENV  # noqa: E402

VIEWS = ("front", "profile_90", "back")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    body = np.load(str(E / "body-verts.npz"))
    verts_m = np.array(body["vertices"], dtype=np.float64)
    verts = verts_m * 1000.0  # mm head frame from here on
    crown_m = verts_m[int(np.argmax(verts_m[:, 2]))]
    crown = crown_m * 1000.0
    anchors = []
    for drop in range(0, 265, 5):
        z = crown[2] - drop
        sel = None
        for half in (3.0, 6.0, 10.0):
            sel = verts[np.abs(verts[:, 2] - z) < half]
            if sel.shape[0] >= 8:
                break
        if sel.shape[0] < 8:
            sel = verts[np.argsort(np.abs(verts[:, 2] - z))[:24]]
        xmax = float(np.abs(sel[:, 0]).max())
        ufront = float(-(sel[:, 1].min() - crown[1]))
        uback = float(-(sel[:, 1].max() - crown[1]))
        anchors.append([drop, round(xmax, 2), round(ufront, 2), round(uback, 2)])
    manifest = json.loads(
        (ROOT / "tools/openclinxr/hair-groom/manifests/aisha_straight_long.json")
        .read_text()
    )
    pins = {
        "body": {
            "id": manifest["body"]["id"],
            "sha256": manifest["body"]["sha256"],
        },
        "camerasFile": dict(manifest["camerasFile"]),
        "masks": {
            view: {"sha256": manifest["targets"]["masks"][view]["sha256"]}
            for view in VIEWS
        },
        "bodyVerts": sha256_file(E / "body-verts.npz"),
    }
    spec = ENV.default_spec(anchors, crown_m, pins)
    out = E / "envelope-spec.json"
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n")
    print("SPEC %s params=%d anchors=%d" % (out, len(spec["params"]), len(anchors)))
    print("SPEC_SHA %s" % sha256_file(out))
    print("CROWN_M", [round(float(v), 4) for v in crown_m])
    print("ANCHOR_DROP60", anchors[12])


if __name__ == "__main__":
    main()
