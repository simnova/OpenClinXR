#!/usr/bin/env python3
"""
room-extract-predicate.py — deterministic extract-time room predicate (Q1).

Turns "which extracted Infinigen room suits which station" into a deterministic,
measureable gate at extract time. Pure stdlib; no bpy import at module level so the
same functions run inside `infinigen-single-room-extract.py` (in-process) and from the
evidence dry-run/test suite (python3 subprocess, like `actor-phenotype-reader.test.ts`).

Geometry payload format (world frame, room centred at origin, floor top at y=0 — the
frame the extract exports and the runtime re-derives from):
    { "room": str, "parts": { "<name>": [ [[x,y,z],[x,y,z],[x,y,z]], ... ], ... } }

Part classification mirrors the runtime's room-root naming: a part whose name ends in
`.wall` / `.floor` / `.ceiling` is interior structure; `.exterior` is the hull shell.
The doorway side is +Z — the face the extract's `--yaw-deg` orients toward the
interior-camera derivation (PROVENANCE #407) and the side a learner enters from.

Measures:
  floorAspect                       longest/shortest XZ extent of the floor part (>=1)
  floorAreaM2                       X span x Z span of the floor part
  ceilingHeightM                    ceiling top minus floor top
  hullFrontFacingToDoorwayEyeCount  exterior triangles whose geometric normal faces
                                    the doorway-side interior eye (max over the 5
                                    candidate eyes) — the peds pre-fix L-sheet class
                                    (10 faces / 7.95 m2 measured toward the derived eye)
  doorwayCandidateSurviveCount      of the 5 doorway-side camera candidates, how many
                                    pass the same eye→look ray test the capture scoring
                                    applies (a pocket behind a partition is rejected)

Thresholds are DERIVED from the two shipped rooms (ED known-good, peds post-719cadf8
known-good after `--drop-interior-hull-faces`): see `KNOWN_GOOD_ROOMS` and
`derive_thresholds`. The derivation is recorded in the predicate JSON under
`derivedFrom`. Refuse semantics:
  - exterior hull front-facing count above the shipped rooms' maximum -> refuse
    (the pre-fix peds L-sheet measured 10 toward the derived eye and must refuse)
  - zero surviving doorway candidates                              -> refuse (pocket-only room)
  - a room extracted from a passage semantic (`hallway`/`corridor`, by NAME) -> refuse
    (the #407 corridor class; aspect alone cannot separate it from the declared-aspect
    2.0 ED bay since 2026-08-28)
  - aspect / area / ceiling height outside the derived band        -> refuse (corridor class)

CLI:  python3 room-extract-predicate.py --geometry <payload.json> [--output <out.json>]
Prints one JSON line (the predicate result); writes it to --output when given.
Exit 0 on pass, 2 on refuse, 1 on a malformed payload.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from typing import Any, Dict, List, Sequence, Tuple

# --- shipped-room constants ---------------------------------------------------------
# Measured on the two shipped rooms in the predicate dry-run (2026-08-18); the test
# `room-extract-predicate.test.ts` re-measures the shipped GLBs and asserts these rows
# still match, so a re-bake that changes a room's measures fails the test (anti-drift).
# `hullFrontFacingToDoorwayEyeCount` and `doorwayCandidateSurviveCount` are the values
# the SAME predicate code computes on the shipped bytes, so the "derived from" rows are
# the predicate's own honest measurements, not hand-typed numbers.
#
# NOTE: the ED bay's shipped bytes are PRE-drop — its exterior mesh still carries two
# interior wall fragments (8 triangles front-facing some doorway-side eyes at x=-0.25).
# A future ED re-extraction with the default `--drop-interior-hull-faces` removes them
# (their centroids sit inside the interior volume) and its front-facing count drops to 0.
# The 2026-08-18 slice deliberately does NOT rebake ED; the derived threshold therefore
# sits at the shipped maximum (8). Peds is already post-drop (0 intruders, 4 triangles at
# the +Z doorway trim that front-face the right-corner eye — legitimate structure).
KNOWN_GOOD_ROOMS: List[Dict[str, Any]] = [
    {
        "file": "apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb",
        "sha256": "a3b5e68699e3e709a1863b999576ca7c92960daf2059f2313dc51067cfadc5f4",
        "room": "dining-room_0",
        "measures": {
            "floorAspect": 1.02,
            "floorAreaM2": 39.85,
            "ceilingHeightM": 2.401,
            "hullFrontFacingToDoorwayEyeCount": 8,
            "doorwayCandidateSurviveCount": 5,
        },
    },
    {
        "file": "apps/ui-xr/public/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb",
        "sha256": "731fed258393fc386a669b626ad78e9b0d42c7652d9230177e19c3226d7eff9e",
        "room": "kitchen_0",
        "measures": {
            "floorAspect": 1.021,
            "floorAreaM2": 28.47,
            "ceilingHeightM": 2.445,
            "hullFrontFacingToDoorwayEyeCount": 4,
            "doorwayCandidateSurviveCount": 4,
        },
    },
]

# Proxy constants — the runtime camera derives from live ACTOR bounds, which do not
# exist at extract time. These are the deterministic stand-ins, documented as proxies:
EYE_HEIGHT_M = 1.6      # stand-in for actors.max.Y (a standing learner's eye ~1.6 m)
LOOK_HEIGHT_M = 0.9     # stand-in for the actor-bounds centre height (torso centre)
LOOK_QUADRANT_FRACTION = 0.4  # interior quadrant look points sit 0.4 x half-span from centre

# Derived-band slack factors. Each is a simple multiple of the SHIPPED ROOMS' own
# measured values (see derive_thresholds); not tuned to clear an observation.
ASPECT_SLACK = 1.5      # corridor (aspect 2.02, #407) must stay outside this band
AREA_MIN_FACTOR = 0.5
AREA_MAX_FACTOR = 2.0
HEIGHT_MIN_FACTOR = 0.9
HEIGHT_MAX_FACTOR = 1.1

FLOAT_GUARD = 1e-6      # ray-cast precision guard, not a design number
RE_INTERIOR = re.compile(r"\.(wall|floor|ceiling)$")
RE_FLOOR = re.compile(r"\.floor$")
RE_CEILING = re.compile(r"\.ceiling$")
RE_HULL = re.compile(r"\.exterior$")
# The #407 corridor class (a 9.9 m hallway shipped as the peds bay). Since the ED bay's
# declared aspect_ratio_range (2.0, 2.1) legitimately reaches ~2.0 (2026-08-28 re-bake),
# floor ASPECT alone can no longer separate a declared-aspect bay from a passage — both are
# ~2:1. The deterministic discriminator left is Infinigen's own room SEMANTIC: a clinical
# bay must not be extracted from a hallway/corridor room, whatever its aspect measures.
RE_PASSAGE = re.compile(r"^(hallway|corridor)", re.IGNORECASE)

Vec = Tuple[float, float, float]
Tri = Tuple[Vec, Vec, Vec]


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _normal(a: Vec, b: Vec, c: Vec) -> Vec:
    """Geometric normal from winding (three.js convention: CCW front faces)."""
    return _cross(_sub(b, a), _sub(c, a))


def _length(v: Vec) -> float:
    return math.sqrt(_dot(v, v))


def _tri_aabb(part: List[Tri]) -> Tuple[Vec, Vec]:
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    for tri in part:
        for v in tri:
            for i in range(3):
                if v[i] < mn[i]:
                    mn[i] = v[i]
                if v[i] > mx[i]:
                    mx[i] = v[i]
    return (tuple(mn), tuple(mx))  # type: ignore[return-value]


def _classify(parts: Dict[str, List[Tri]]) -> Dict[str, List[Tri]]:
    interior: List[Tri] = []
    floor: List[Tri] = []
    ceiling: List[Tri] = []
    hull: List[Tri] = []
    for name, tris in parts.items():
        if RE_FLOOR.search(name):
            floor.extend(tris)
        if RE_CEILING.search(name):
            ceiling.extend(tris)
        if RE_INTERIOR.search(name):
            interior.extend(tris)
        if RE_HULL.search(name):
            hull.extend(tris)
    return {"interior": interior, "floor": floor, "ceiling": ceiling, "hull": hull}


def _ray_tri_hit(
    origin: Vec, direction: Vec, a: Vec, b: Vec, c: Vec, max_t: float
) -> bool:
    """Möller–Trumbore; mirrors the capture scoring rule (`ui-xr-environment-room-capture.ts`)."""
    e1 = _sub(b, a)
    e2 = _sub(c, a)
    p = _cross(direction, e2)
    det = _dot(e1, p)
    if -FLOAT_GUARD < det < FLOAT_GUARD:
        return False
    inv = 1.0 / det
    t_vec = _sub(origin, a)
    u = _dot(t_vec, p) * inv
    if u < 0 or u > 1:
        return False
    q = _cross(t_vec, e1)
    v = _dot(direction, q) * inv
    if v < 0 or u + v > 1:
        return False
    t = _dot(e2, q) * inv
    return FLOAT_GUARD < t < max_t


def _look_ray_blocked(origin: Vec, look: Vec, tris: Sequence[Tri]) -> bool:
    dx, dy, dz = _sub(look, origin)
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < FLOAT_GUARD:
        return False
    direction = (dx / length, dy / length, dz / length)
    for a, b, c in tris:
        if _ray_tri_hit(origin, direction, a, b, c, length):
            return True
    return False


def _interior_look_points(
    interior_min: Vec, interior_max: Vec, floor_top: float
) -> List[Vec]:
    """Look points for the doorway-ray test.

    The runtime looks at the ACTOR-bounds centre; at extract time there are no actors, so
    the proxy is the interior floor centre plus four quadrant points (0.4 x half-span off
    centre, inside the room). A doorway-side candidate is REJECTED only when it has no
    unobstructed sightline to ANY look point — i.e. its view into the room is fully
    enclosed (the pocket class). A single centre look point falsely rejects a room whose
    interior has a partition between the eye and the centre (ED's bay has one at z=0.374);
    the runtime avoids that because its look is the actor centre, which lies beyond the
    partition's doorway portal.
    """
    cx = (interior_min[0] + interior_max[0]) / 2.0
    cz = (interior_min[2] + interior_max[2]) / 2.0
    dx = (interior_max[0] - interior_min[0]) * LOOK_QUADRANT_FRACTION
    dz = (interior_max[2] - interior_min[2]) * LOOK_QUADRANT_FRACTION
    return [
        (cx, floor_top + LOOK_HEIGHT_M, cz),
        (cx + dx, floor_top + LOOK_HEIGHT_M, cz),
        (cx - dx, floor_top + LOOK_HEIGHT_M, cz),
        (cx, floor_top + LOOK_HEIGHT_M, cz + dz),
        (cx, floor_top + LOOK_HEIGHT_M, cz - dz),
    ]


def _candidate_sees_interior(
    eye: Vec, look_points: Sequence[Vec], tris: Sequence[Tri]
) -> bool:
    """True when ANY look ray from the eye reaches a look point unobstructed."""
    for look in look_points:
        if not _look_ray_blocked(eye, look, tris):
            return True
    return False


def _doorway_candidates(
    interior_min: Vec, interior_max: Vec, wall_thickness: float
) -> List[Tuple[float, float]]:
    """The same 5 doorway-side (+Z) camera candidates the capture scoring derives."""
    z_eye = interior_max[2] - 2 * wall_thickness
    x_left = interior_min[0] + 2 * wall_thickness
    x_right = interior_max[0] - 2 * wall_thickness
    mid = (x_left + x_right) / 2.0
    return [
        (x_left, z_eye),
        (x_right, z_eye),
        (mid, z_eye),
        ((x_left + mid) / 2.0, z_eye),
        ((mid + x_right) / 2.0, z_eye),
    ]


def compute_measures(
    parts: Dict[str, List[Tri]],
) -> Tuple[Dict[str, float], List[str]]:
    """Compute the five predicate measures; returns (measures, missing_parts)."""
    cls = _classify(parts)
    missing: List[str] = []
    if not cls["floor"]:
        missing.append("no floor part")
    if not cls["interior"]:
        missing.append("no wall/floor/ceiling part")
    if not cls["hull"]:
        missing.append("no exterior hull")

    floor_min, floor_max = _tri_aabb(cls["floor"]) if cls["floor"] else ((0, 0, 0), (0, 0, 0))
    floor_top = floor_max[1]
    ceiling_top = _tri_aabb(cls["ceiling"])[1][1] if cls["ceiling"] else 0.0
    if not cls["ceiling"] and cls["interior"]:
        ceiling_top = _tri_aabb(cls["interior"])[1][1]

    xspan = floor_max[0] - floor_min[0]
    zspan = floor_max[2] - floor_min[2]
    aspect = max(xspan, zspan) / min(xspan, zspan) if min(xspan, zspan) > 0 else 0.0
    area = xspan * zspan

    interior_min = interior_max = None
    if cls["interior"]:
        interior_min, interior_max = _tri_aabb(cls["interior"])
    wall_thickness = 0.0
    if cls["hull"] and interior_max is not None:
        hull_min, hull_max = _tri_aabb(cls["hull"])
        wall_thickness = max(0.0, hull_max[2] - interior_max[2])

    candidates: List[Tuple[float, float]] = []
    look_points: List[Vec] = []
    if interior_min is not None and interior_max is not None:
        candidates = _doorway_candidates(interior_min, interior_max, wall_thickness)
        look_points = _interior_look_points(interior_min, interior_max, floor_top)

    eye_y = floor_top + EYE_HEIGHT_M
    blocked_tris = cls["interior"] + cls["hull"]
    survive_count = 0
    front_facing = 0
    for x, z in candidates:
        eye: Vec = (x, eye_y, z)
        if _candidate_sees_interior(eye, look_points, blocked_tris):
            survive_count += 1
        count = 0
        for a, b, c in cls["hull"]:
            if _dot(_normal(a, b, c), _sub(eye, a)) > 0:
                count += 1
        front_facing = max(front_facing, count)

    return (
        {
            "floorAspect": round(aspect, 3),
            "floorAreaM2": round(area, 2),
            "ceilingHeightM": round(ceiling_top - floor_top, 3),
            "hullFrontFacingToDoorwayEyeCount": front_facing,
            "doorwayCandidateSurviveCount": survive_count,
        },
        missing,
    )


def derive_thresholds() -> Dict[str, Dict[str, Any]]:
    """Derive per-measure pass bands from the two shipped rooms' measured values."""
    goods = [room["measures"] for room in KNOWN_GOOD_ROOMS if room["measures"].get("floorAspect") is not None]
    if not goods:
        raise RuntimeError("KNOWN_GOOD_ROOMS not measured yet — run the predicate dry-run first")

    aspects = [g["floorAspect"] for g in goods]
    areas = [g["floorAreaM2"] for g in goods]
    heights = [g["ceilingHeightM"] for g in goods]
    facing = [g["hullFrontFacingToDoorwayEyeCount"] for g in goods]
    survivors = [g["doorwayCandidateSurviveCount"] for g in goods]

    min_aspect = min(aspects)
    max_aspect = max(aspects)
    min_area = min(areas)
    max_area = max(areas)
    min_height = min(heights)
    max_height = max(heights)

    return {
        "floorAspect": {
            "min": round(min_aspect / ASPECT_SLACK, 3),
            "max": round(max_aspect * ASPECT_SLACK, 3),
            "lowerIsBetter": False,
            "basis": (
                f"shipped rooms aspect {min_aspect}..{max_aspect}; refuse outside "
                f"[{min_aspect}/{ASPECT_SLACK}, {max_aspect}*{ASPECT_SLACK}] — the #407 "
                f"corridor (2.02) sits outside this band"
            ),
        },
        "floorAreaM2": {
            "min": round(min_area * AREA_MIN_FACTOR, 2),
            "max": round(max_area * AREA_MAX_FACTOR, 2),
            "lowerIsBetter": False,
            "basis": (
                f"shipped rooms area {min_area}..{max_area} m2; refuse outside "
                f"[{min_area}*{AREA_MIN_FACTOR}, {max_area}*{AREA_MAX_FACTOR}]"
            ),
        },
        "ceilingHeightM": {
            "min": round(min_height * HEIGHT_MIN_FACTOR, 3),
            "max": round(max_height * HEIGHT_MAX_FACTOR, 3),
            "lowerIsBetter": False,
            "basis": (
                f"shipped rooms ceiling height {min_height}..{max_height} m; refuse outside "
                f"[{min_height}*{HEIGHT_MIN_FACTOR}, {max_height}*{HEIGHT_MAX_FACTOR}]"
            ),
        },
        "hullFrontFacingToDoorwayEyeCount": {
            "max": max(facing),
            "lowerIsBetter": True,
            "basis": (
                f"shipped rooms front-facing count {facing} (max {max(facing)}); refuse above "
                f"the shipped maximum — the peds pre-fix L-sheet measured 10 toward the derived "
                f"eye and must refuse"
            ),
        },
        "doorwayCandidateSurviveCount": {
            "min": 1,
            "lowerIsBetter": False,
            "basis": (
                f"shipped rooms survivors {survivors} (all > 0); refuse an EMPTY candidate "
                f"set — the pocket-only room whose doorway edges all fail the look-ray rule"
            ),
        },
    }


def evaluate(payload: Dict[str, Any]) -> Dict[str, Any]:
    room = payload.get("room", "unknown")
    raw_parts = payload.get("parts", {})
    parts: Dict[str, List[Tri]] = {}
    for name, tris in raw_parts.items():
        parts[name] = [
            (tuple(t[0]), tuple(t[1]), tuple(t[2])) for t in tris  # type: ignore[index]
        ]

    measures, missing = compute_measures(parts)
    thresholds = derive_thresholds()

    refuse_reasons: List[str] = []
    if RE_PASSAGE.match(room):
        refuse_reasons.append(
            f"room is a passage semantic ({room!r}), not a clinical bay — the #407 corridor "
            f"class; a bay must not be extracted from a hallway"
        )
    for name, t in thresholds.items():
        value = measures[name]
        if t.get("max") is not None and value > t["max"]:
            refuse_reasons.append(f"{name} {value} > {t['max']}")
        if t.get("min") is not None and value < t["min"]:
            refuse_reasons.append(f"{name} {value} < {t['min']}")
    for m in missing:
        refuse_reasons.append(m)

    return {
        "room": room,
        "predicateVersion": 1,
        "measures": measures,
        "thresholds": thresholds,
        "pass": len(refuse_reasons) == 0,
        "refuseReasons": refuse_reasons,
        "derivedFrom": {
            "method": (
                "Threshold bands are multiples of the two shipped rooms' own measured "
                "values (ED known-good `infinigen-ed-exam-bay.glb`; peds post-719cadf8 "
                "known-good `infinigen-pediatric-urgent-care-bay.glb`, already extracted "
                "with --drop-interior-hull-faces). front-facing count refuses above the "
                "shipped maximum (8 — ED's shipped bytes are PRE-drop and still carry "
                "interior hull fragments; the default drop removes them, so a default-dropped "
                "re-extract measures 0); survive count refuses below 1 (both shipped rooms "
                "survive the look-ray rule)."
            ),
            "rooms": KNOWN_GOOD_ROOMS,
        },
    }


def main(argv: Sequence[str]) -> int:
    p = argparse.ArgumentParser(description="Deterministic extract-time room predicate")
    p.add_argument("--geometry", required=True, help="room geometry payload JSON file")
    p.add_argument("--output", help="optional file to write the predicate JSON to")
    args = p.parse_args(argv)

    with open(args.geometry, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    result = evaluate(payload)
    # Compact single-line JSON on stdout (the evidence dry-run parses the last `{` line);
    # the --output file, when given, gets the pretty form.
    print(json.dumps(result))
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
    return 0 if result["pass"] else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
