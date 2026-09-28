"""room_clinic_finish geometry stage: floor field, kept-leaf door skin, gated rail.

S5 deleted the T-bar grid, the paneled door kit and the exit sign; S6 owns
the ceiling grid rebuild. Bevel via attributes API
(attributes['bevel_weight_edge']) since edges.foreach_set bevel_weight
throws on bpy 4.2.0. Deterministic on seed. No-op dict when bpy absent.
"""

from __future__ import annotations

GEOMETRY_STAGE_VERSION = "clinic-finish-geometry-v1"


def geometry_stage(seed: int = 7) -> dict:
    try:
        import bpy  # noqa: F401
    except ImportError:
        return {
            "stage": "geometry",
            "version": GEOMETRY_STAGE_VERSION,
            "blender": False,
            "ops": ["floor_field", "kept_leaf_maple_skin", "crash_rail_gated_off"],
            "seed": seed,
        }
    from .ceiling import ceiling_module
    from .door import door_module
    from .corridor_cues import corridor_cues_module
    from .floor import floor_module
    return {
        "stage": "geometry",
        "version": GEOMETRY_STAGE_VERSION,
        "blender": True,
        "ceiling": ceiling_module(seed),
        "door": door_module(seed),
        "corridor": corridor_cues_module(seed),
        "floor": floor_module(seed),
        "seed": seed,
    }
