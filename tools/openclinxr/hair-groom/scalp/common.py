"""Shared read-only helpers for the S2 scalp/root station.

Reads (never writes): the station manifest, the pinned cameras file, the
target masks/landmarks, the body GLB (inside Blender only), and
hair-groom/register.py (imported from its canonical path, not copied).

Writes: nothing. Callers maintain the inputs-opened log.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np

S2 = Path(__file__).resolve().parent
STATION = S2.parent
ROOT = STATION.parents[2]
FRAME = 1024

OPENED: list[str] = []


def log_open(path) -> str:
    s = str(Path(path).resolve())
    if s not in OPENED:
        OPENED.append(s)
    return s


def load_manifest(manifest_path=None) -> tuple[dict, str]:
    p = Path(manifest_path) if manifest_path else STATION / "manifests" / "aisha_straight_long.json"
    log_open(p)
    doc = json.loads(Path(p).read_text())
    return doc, str(Path(p).resolve())


def load_cameras(doc) -> tuple[dict, str]:
    rel = doc["camerasFile"]["path"]
    p = (ROOT / rel).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
    log_open(p)
    raw = p.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != doc["camerasFile"]["sha256"]:
        raise ValueError("cameras file sha mismatch: %s" % digest)
    return json.loads(raw.decode()), str(p)


def load_register():
    p = STATION / "register.py"
    log_open(p)
    spec = importlib.util.spec_from_file_location("station_register_ro", str(p))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def similarity_inverse(transform) -> dict:
    s = float(transform["scale"])
    return {"scale": 1.0 / s,
            "tx": -float(transform["tx"]) / s,
            "ty": -float(transform["ty"]) / s}


def target_to_render(col_t, row_t, view, cams, reg) -> tuple[float, float]:
    """Map a target-frame pixel into the render (pinned-camera) frame."""
    t = reg.similarity_from_triples(
        *[float(v) for v in cams["registrationRenderTriples"][view]],
        *[float(v) for v in cams["registrationTargetTriples"][view]])
    inv = similarity_inverse(t)
    s, tx, ty = inv["scale"], inv["tx"], inv["ty"]
    return (s * float(col_t) + tx, s * float(row_t) + ty)


def camera_ray(col_r, row_r, view_rec, sensor_width_mm) -> tuple[np.ndarray, np.ndarray]:
    """Return (origin, direction) world-space ray for a render-frame pixel.

    Inverts the station projection (export_frame world_to_camera_view path):
    square FRAME frame, centred principal point, focal f_px = FRAME*lens/sensor.
    """
    lens = float(view_rec["lensMm"])
    f = FRAME * lens / float(sensor_width_mm)
    d_cam = np.array([(float(col_r) - FRAME / 2.0) / f,
                      (FRAME / 2.0 - float(row_r)) / f,
                      -1.0], dtype=np.float64)
    M = np.array(view_rec["matrixWorld"], dtype=np.float64)
    R = M[:3, :3]
    origin = M[:3, 3].copy()
    direction = R @ d_cam
    direction = direction / np.linalg.norm(direction)
    return origin, direction


def write_opened(path) -> None:
    p = Path(path)
    prev = p.read_text().splitlines() if p.exists() else []
    merged = sorted(set(prev) | set(OPENED))
    p.write_text("\n".join(merged) + "\n")
