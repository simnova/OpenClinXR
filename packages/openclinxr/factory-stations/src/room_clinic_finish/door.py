"""room_clinic_finish door module: XR geometry baseline recipe fragment.

Recessed panels, bevel shadow, stile joints, lever highlight, kick plates.
XT/XU wallpaper-flat doors are the reject case. Recipe-only, no Blender.
"""

from __future__ import annotations

DOOR_MODULE_VERSION = "clinic-finish-door-v1"


def door_module(seed: int = 7) -> dict:
    return {
        "module": "door",
        "version": DOOR_MODULE_VERSION,
        "baseline": "xr_geometry",
        "recessedPanels": True,
        "bevelShadow": True,
        "stileJoints": True,
        "leverHighlight": True,
        "kickPlates": True,
        "rejectCase": "wallpaper_flat",
        "seed": seed,
    }
