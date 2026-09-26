"""room_clinic_finish geometry stage: T-bar, paneled door kit, rail, sign.

Grok 4.7 verdict: recipe.ts cannot emit door/ceiling/corridor geometry the
seed-7 log still lacks. This stage builds it. Bevel via attributes API
(attributes['bevel_weight_edge']) since edges.foreach_set bevel_weight
throws on bpy 4.2.0. Deterministic on seed. No-op dict when bpy absent.
"""

from __future__ import annotations

GEOMETRY_STAGE_VERSION = "clinic-finish-geometry-v1"
TBAR_Z = 2.744


def geometry_stage(seed: int = 7) -> dict:
    try:
        import bpy  # noqa: F401
    except ImportError:
        return {
            "stage": "geometry",
            "version": GEOMETRY_STAGE_VERSION,
            "blender": False,
            "ops": ["tbar_grid", "paneled_door_kit", "crash_rail", "exit_sign"],
            "tbarZ": TBAR_Z,
            "bevelApi": "attributes['bevel_weight_edge'].data.foreach_set",
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
        "tbarZ": TBAR_Z,
        "bevelApi": "attributes['bevel_weight_edge'].data.foreach_set",
        "seed": seed,
    }
