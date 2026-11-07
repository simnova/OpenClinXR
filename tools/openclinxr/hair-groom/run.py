#!/usr/bin/env python3
"""Deterministic station runner: manifest -> registered camera frame.

Usage: run.py <manifest.json> <outdir>

Validates the manifest, verifies every pinned input sha256, computes the
station codeHash (sha256 over sorted station source-file contents),
renders the camera frame in Blender, registers the target triples onto
the projected render triples, and writes registration.json,
run-record.json, station-frame.npz (+ renders), and inputs-opened.txt.

Deterministic: sorted keys, fixed separators, no timestamps, no run
specific paths in JSON/NPZ payloads. No groom.npz is emitted by this card.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

STATION = Path(__file__).resolve().parent
ROOT = STATION.parents[2]
sys.path.insert(0, str(STATION))
import register as REG  # noqa: E402

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
SOURCE_FILES = ("export_frame.py", "register.py", "run.py")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
REGISTERED_VIEWS = ("front", "profile_90", "back")
RENDER_TRIPLE = {
    "front": ("crown", "menton", "face_centre"),
    "profile_90": ("crown", "menton", "brow"),
    "back": ("crown", "shoulder", "face_centre"),
}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_manifest(doc):
    if doc.get("schemaVersion") != "openclinxr.hair-groom.manifest.v1":
        raise ValueError("bad schemaVersion")
    for section in ("body", "targets", "camerasFile", "cameras", "style"):
        if section not in doc:
            raise ValueError("manifest missing %r" % section)
    if not isinstance(doc["seed"], int):
        raise ValueError("seed must be int")
    body = doc["body"]
    if not body.get("id") or not SHA_RE.match(body.get("sha256", "")):
        raise ValueError("bad body pin")
    land = doc["targets"]["landmarks"]
    if not SHA_RE.match(land.get("sha256", "")):
        raise ValueError("bad landmarks pin")
    for view in ("front", "profile_90", "back"):
        entry = doc["targets"]["masks"][view]
        if not SHA_RE.match(entry.get("sha256", "")):
            raise ValueError("bad mask pin for %s" % view)
    allowed = ("front", "three_quarter", "profile_90", "back", "crown_top")
    if [c for c in doc["cameras"] if c not in allowed] or not doc["cameras"]:
        raise ValueError("bad camera set")
    if doc["style"].get("part") not in ("centre", "left", "right"):
        raise ValueError("bad style.part")
    fams = doc["style"].get("families")
    if not fams or any("name" not in f or "mirror" not in f for f in fams):
        raise ValueError("bad style.families")
    return True


def code_hash():
    digest = hashlib.sha256()
    for name in sorted(SOURCE_FILES):
        content = (STATION / name).read_bytes()
        digest.update(name.encode() + b"\0" + content)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("outdir")
    args = parser.parse_args()
    opened = []

    schema_path = STATION / "manifest.schema.json"
    opened.append(str(schema_path.resolve()))
    schema_path.read_text()
    manifest_path = Path(args.manifest).resolve(strict=True)
    opened.append(str(manifest_path))
    doc = json.loads(manifest_path.read_text())
    check_manifest(doc)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    body_path = (ROOT / doc["body"]["glb"]).resolve(strict=True)
    opened.append(str(body_path))
    body_sha = sha256_file(body_path)
    if body_sha != doc["body"]["sha256"]:
        raise ValueError("body sha mismatch")

    land_path = Path(doc["targets"]["landmarks"]["path"]).resolve(strict=True)
    opened.append(str(land_path))
    land_sha = sha256_file(land_path)
    if land_sha != doc["targets"]["landmarks"]["sha256"]:
        raise ValueError("landmarks sha mismatch")
    landmarks = json.loads(land_path.read_text())

    cams_rel = doc["camerasFile"]["path"]
    cams_path = (ROOT / cams_rel).resolve(strict=True) if not Path(cams_rel).is_absolute() \
        else Path(cams_rel).resolve(strict=True)
    opened.append(str(cams_path))
    cams_sha = sha256_file(cams_path)
    if cams_sha != doc["camerasFile"]["sha256"]:
        raise ValueError("cameras file sha mismatch")
    cams = json.loads(cams_path.read_text())

    mask_paths, mask_stats = {}, {}
    for view in ("front", "profile_90", "back"):
        entry = doc["targets"]["masks"][view]
        path = Path(entry["path"]).resolve(strict=True)
        opened.append(str(path))
        digest = sha256_file(path)
        if digest != entry["sha256"]:
            raise ValueError("mask sha mismatch for %s" % view)
        mask_paths[view] = str(path)
        pixels = np.asarray(Image.open(path).convert("L")) > 127
        mask_stats[view] = {
            "size": [int(v) for v in Image.open(path).size],
            "areaPx": int(pixels.sum()),
        }

    for name in SOURCE_FILES:
        opened.append(str((STATION / name).resolve()))
    digest_code = code_hash()

    blender_opened = outdir / "blender-opened.txt"
    cmd = [
        BLENDER, "--background",
        "--python", str(STATION / "export_frame.py"),
        "--",
        "--manifest", str(manifest_path),
        "--outdir", str(outdir),
        "--glb", str(body_path),
        "--cameras", str(cams_path),
        "--opened", str(blender_opened),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError("blender export_frame failed")

    frame_path = outdir / "station-frame.npz"
    opened.append(str(frame_path.resolve()))
    with np.load(frame_path) as frame:
        proj = {
            view: {
                name: (float(frame["%s/%s_row" % (view, name)]),
                       float(frame["%s/%s_col" % (view, name)]))
                for name in ("crown", "menton", "brow", "face_centre", "shoulder")
            }
            for view in doc["cameras"]
        }
        frame_keys = sorted(frame.files)
    opened.append(str(blender_opened.resolve()))
    for line in blender_opened.read_text().split():
        opened.append(line)

    registration = {"frame": 1024, "views": {}, "projectionCheck": {}}
    proj_worst = 0.0
    for view in doc["cameras"]:
        if view not in REGISTERED_VIEWS:
            registration["views"][view] = {"status": "NO_TRIPLE"}
            continue
        a_r, b_r, c_r = [float(v) for v in cams["registrationRenderTriples"][view]]
        a_t, b_t, c_t = [float(v) for v in cams["registrationTargetTriples"][view]]
        rn, rm, rc = RENDER_TRIPLE[view]
        pa_r = proj[view][rn][0]
        pb_r = proj[view][rm][0]
        pc_r = proj[view][rc][1]
        deltas = [abs(pa_r - a_r), abs(pb_r - b_r), abs(pc_r - c_r)]
        proj_worst = max(proj_worst, max(deltas))
        registration["projectionCheck"][view] = {
            "projectedTriple": [pa_r, pb_r, pc_r],
            "pinnedTriple": [a_r, b_r, c_r],
            "absDelta": deltas,
        }
        transform = REG.similarity_from_triples(a_r, b_r, c_r, a_t, b_t, c_t)
        registration["views"][view] = {
            "renderTriple": [a_r, b_r, c_r],
            "targetTriple": [a_t, b_t, c_t],
            "transform": transform,
            "residuals": REG.residuals(a_r, b_r, c_r, a_t, b_t, c_t, transform),
            "renderH": float(b_r - a_r),
            "targetH": float(b_t - a_t),
        }
    registration["projectionCheckWorstPx"] = proj_worst
    if proj_worst >= 0.5:
        raise ValueError("station projections do not reproduce the pinned frame")
    (outdir / "registration.json").write_text(
        json.dumps(registration, indent=2, sort_keys=True) + "\n"
    )

    record = {
        "schemaVersion": "openclinxr.hair-groom.manifest.v1",
        "manifest": {"path": str(manifest_path), "sha256": sha256_file(manifest_path)},
        "codeHash": digest_code,
        "body": {"id": doc["body"]["id"], "path": str(body_path), "sha256": body_sha},
        "targets": {
            "landmarks": {"path": str(land_path), "sha256": land_sha},
            "masks": {
                view: {"path": mask_paths[view],
                       "sha256": doc["targets"]["masks"][view]["sha256"],
                       **mask_stats[view]}
                for view in ("front", "profile_90", "back")
            },
        },
        "camerasFile": {"path": str(cams_path), "sha256": cams_sha},
        "registrationTriples": {
            "render": cams["registrationRenderTriples"],
            "target": cams["registrationTargetTriples"],
        },
        "projectionCheckWorstPx": proj_worst,
        "cameras": list(doc["cameras"]),
        "style": doc["style"],
        "seed": doc["seed"],
        "stationFrame": {"file": "station-frame.npz", "keys": frame_keys},
        "views": sorted(doc["cameras"]),
    }
    (outdir / "run-record.json").write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n"
    )
    (outdir / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(opened))) + "\n"
    )
    print("STATION_DONE codeHash=%s views=%s" % (digest_code, ",".join(doc["cameras"])))


if __name__ == "__main__":
    main()
