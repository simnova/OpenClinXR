# Copyright (C) 2026 OpenClinXR.
# Promoted from /Volumes/files/src/openclinxr-wt/infinigen-room
# tools/openclinxr/asset-pipeline/environment/infinigen-patches/fixed_footprint_state.py
# (stage-1b/2 injection module) and GENERALIZED: the door pin that was
# hardcoded to the +y wall at x=+0.50 is now a configure()d parameter
# accepting any of the four walls plus an along-wall offset.
#
# Hand-builds the pre-solidify State that BlueprintSolidifier expects, with
# ONE fixed room polygon. See the module docstring of the source for the
# State-shape rationale (segment.py:129-154 mirror, two-node RoomGraph).

import shapely

from infinigen.core.constraints import constraint_language as cl
from infinigen.core.constraints.example_solver.room.base import RoomGraph, room_name
from infinigen.core.constraints.example_solver.state_def import (
    ObjectState,
    RelationState,
    State,
)
from infinigen.core.tags import Semantics

# Proven defaults reproduce the room-dimensions-fix reference exactly:
# INTERIOR clear floor 4.3 x 3.9 (Blender x in [-2.15, 2.15],
# y in [-1.95, 1.95]), polygon grown by WALL_THICKNESS/2 per side because
# the solidifier treats the handed polygon as the EXTERIOR face (outer wall
# faces sit exactly on it; inner faces at polygon - wall_thickness/2 per
# side, measured on seed 202). canonicalize() only snaps coords within 1 mm
# of a 0.5 m grid multiple; 2.26/2.06 sit off-grid, so they survive unrounded.
DOOR_WALLS = ("+x", "-x", "+y", "-y")

_CONFIG = {
    "interior_width": 4.3,
    "interior_depth": 3.9,
    "wall_thickness": 0.22,
    "door_wall": "+y",
    # Along-wall offset of the door centerline from the wall midpoint, in
    # metres. Sign convention: for "+y"/"-y" walls the offset runs along +x
    # (east positive); for "+x"/"-x" walls it runs along +y (north positive).
    # +0.25 on "+y" is the room-dimensions-fix pin (0.50 scaled
    # proportionally from the 8.77 m stage-2 wall to the 4.3 m wall, so the
    # door keeps its east-of-center relative position per ref 01).
    "door_offset": 0.50,
}


def configure(**kwargs):
    """Override any subset of _CONFIG; fails closed on unknown keys or bad values."""
    for key, val in kwargs.items():
        if key not in _CONFIG:
            raise ValueError(f"[fixed_footprint] unknown config key: {key!r}")
        _CONFIG[key] = val
    if _CONFIG["door_wall"] not in DOOR_WALLS:
        raise ValueError(
            "[fixed_footprint] door_wall must be one of "
            f"{DOOR_WALLS} (got {_CONFIG['door_wall']!r})"
        )
    for dim in ("interior_width", "interior_depth", "wall_thickness"):
        val = _CONFIG[dim]
        if not isinstance(val, (int, float)) or not (val > 0):
            raise ValueError(f"[fixed_footprint] {dim} must be a positive number (got {val!r})")


def interior_bounds():
    """(x0, x1, y0, y1) interior clear floor, centred on the origin."""
    w = _CONFIG["interior_width"] / 2.0
    d = _CONFIG["interior_depth"] / 2.0
    return (-w, w, -d, d)


def polygon_bounds():
    """(x0, x1, y0, y1) pre-solidify polygon = interior grown by wt/2 per side."""
    g = _CONFIG["wall_thickness"] / 2.0
    x0, x1, y0, y1 = interior_bounds()
    return (x0 - g, x1 + g, y0 - g, y1 + g)


def door_target():
    """(wall, center) with center the along-wall coordinate of the door centerline.

    For "+y"/"-y" walls center is a Blender x; for "+x"/"-x" walls it is a
    Blender y. Wall midpoints sit at 0 (the room is centred), so center
    equals the configured offset.
    """
    return (_CONFIG["door_wall"], _CONFIG["door_offset"])


def wall_coordinate(wall):
    """Cross-wall coordinate of the polygon face for the requested wall."""
    x0, x1, y0, y1 = polygon_bounds()
    return {"+y": y1, "-y": y0, "+x": x1, "-x": x0}[wall]


def select_wall_segment(segments, tol=1e-3):
    """Pick the longest boundary segment lying on the configured door wall.

    segments: iterable of (x, y, x_, y_) in Blender coords. Fails closed
    when no segment matches (the caller then cannot pin the door).
    """
    wall = _CONFIG["door_wall"]
    c = wall_coordinate(wall)
    if wall in ("+y", "-y"):
        matching = [s for s in segments if abs(s[1] - c) < tol and abs(s[3] - c) < tol]
    else:
        matching = [s for s in segments if abs(s[0] - c) < tol and abs(s[2] - c) < tol]
    if not matching:
        raise RuntimeError(
            "[fixed_footprint] no boundary segment on door wall "
            f"{wall!r} (face at {c:.4f}; {len(segments)} segment(s) searched)"
        )
    import numpy as np

    matching.sort(key=lambda s: np.linalg.norm([s[3] - s[1], s[2] - s[0]]), reverse=True)
    return matching[0]


# Legacy module-level names kept for readers of the stage-2 provenance:
# with default config they equal the pinned stage-2 values.
PINNED_WALL_THICKNESS = 0.22
INTERIOR_X0, INTERIOR_X1 = -2.15, 2.15
INTERIOR_Y0, INTERIOR_Y1 = -1.95, 1.95
DOOR_WALL_Y = INTERIOR_Y1 + PINNED_WALL_THICKNESS / 2
DOOR_CENTER_X = 0.25
DOOR_HINGE_SIDE = "+x"


def build_fixed_pre_state(consgraph):
    """Hand-built single-room pre-solidify State + its RoomGraph.

    Names come from room_name() (lowercase values, e.g. 'bedroom_0/0'):
    hardcoding capitalized names breaks room_type() (ValueError: 'Bedroom'
    is not a valid Semantics). Polygon dimensions come from the current
    config (defaults reproduce the room-dimensions-fix 4.3 x 3.9 interior).
    """
    bedroom = room_name(Semantics.Bedroom, 0)
    exterior = room_name(Semantics.Exterior, 0)

    x0, x1, y0, y1 = polygon_bounds()
    poly = shapely.box(x0, y0, x1, y1)
    # Same exterior-edge encoding as segment.py:77-84 (boundary minus shared
    # interior edges; here there are none, so the full closed ring).
    ext_edges = shapely.MultiLineString([poly.boundary])

    st = State()
    st.objs[bedroom] = ObjectState(
        polygon=poly,
        relations=[],
        tags={Semantics.Bedroom, Semantics.RoomContour},
    )
    st.objs[exterior] = ObjectState(
        polygon=poly,
        relations=[RelationState(cl.SharedEdge(), bedroom, value=ext_edges)],
        tags={Semantics.Exterior, Semantics.RoomContour},
    )
    graph = RoomGraph([[1], [0]], [bedroom, exterior], entrance=0)
    st.graphs = [graph]
    return st, graph
