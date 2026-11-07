#!/usr/bin/env python3
"""Evidence-only: freeze the guide-cage spec BEFORE any fitting/rendering.

Reads the station0b exported body verts, measures the crown point and the
head-section anchor table (same slab method as the station0b spec), resolves
the five attachment rows by signed-azimuth surface search, and writes
E/cage-spec.json via S/cage.py. Records the spec sha; nothing downstream
may edit the spec (cage1 fits against this sha).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/cage"))
import cage as CAGE  # noqa: E402

BODY_VERTS = (ROOT / "tools/openclinxr/evidence/hair-station0b/body-verts.npz")
OPENED = []


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def main():
    track(STATION_SRC := (ROOT / "tools/openclinxr/hair-groom/cage/cage.py"))
    body = np.load(str(track(BODY_VERTS)))
    verts_m = np.array(body["vertices"], dtype=np.float64)
    verts = verts_m * 1000.0
    crown_m = verts_m[int(np.argmax(verts_m[:, 2]))]
    crown = crown_m * 1000.0
    cx = float((verts[:, 0].min() + verts[:, 0].max()) * 0.5)

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
        xmax = float(np.abs(sel[:, 0] - cx).max())
        ufront = float(-(sel[:, 1].min() - crown[1]))
        uback = float(-(sel[:, 1].max() - crown[1]))
        anchors.append([drop, round(xmax, 2), round(ufront, 2),
                        round(uback, 2)])

    X = verts[:, 0] - cx
    U = -(verts[:, 1] - crown[1])
    attachments = {}
    for base, (drop, az) in CAGE.ATTACH_ROWS.items():
        z = crown[2] - drop
        sel = None
        for half in (3.0, 6.0, 10.0):
            sel = verts[np.abs(verts[:, 2] - z) < half]
            if sel.shape[0] >= 8:
                break
        dx, du = float(np.sin(np.radians(az))), float(np.cos(np.radians(az)))
        sx = X[np.abs(verts[:, 2] - z) < half]
        su = U[np.abs(verts[:, 2] - z) < half]
        score = sx * dx + su * du
        j = int(np.argmax(score))
        ax, au = float(sx[j]), float(su[j])
        radial = float(np.hypot(ax, au))
        elev = float(-np.degrees(np.arctan2(drop, max(radial, 1e-6))))
        attachments[base if base in ("back", "nape") else base] = {
            "Xmm": round(ax, 2), "Umm": round(au, 2), "dropMm": drop,
            "azimuthDeg": az if base in ("back", "nape") else None,
            "elevationDeg": round(elev, 2),
            "radialMm": round(radial, 2),
        }
    # mirrored rows share the +az resolution; mirrors negate X at build time
    for base in ("part", "temple", "side"):
        attachments[base]["azimuthDeg"] = CAGE.ATTACH_ROWS[base][1]

    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    pins = {
        "body": dict(manifest["body"]),
        "camerasFile": dict(manifest["camerasFile"]),
        "bodyVerts": sha256_file(BODY_VERTS),
        "landmarks": dict(manifest["targets"]["landmarks"]),
        "masks": {v: {"sha256": manifest["targets"]["masks"][v]["sha256"]}
                  for v in ("front", "profile_90", "back")},
    }
    flat = {k: [v["Xmm"], v["Umm"], v["dropMm"]]
            for k, v in attachments.items()}
    spec = CAGE.default_spec(flat, anchors, crown_m, pins)
    spec["attachmentDetail"] = attachments
    out = E / "cage-spec.json"
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n")
    print("SPEC %s params=%d" % (out, len(spec["params"])))
    print("SPEC_SHA %s" % sha256_file(out))
    print("CROWN_M", [round(float(v), 4) for v in crown_m])
    for base in ("part", "temple", "side", "back", "nape"):
        print("ATTACH", base, attachments[base])
    CAGE.append_inputs(E, OPENED)


if __name__ == "__main__":
    main()
