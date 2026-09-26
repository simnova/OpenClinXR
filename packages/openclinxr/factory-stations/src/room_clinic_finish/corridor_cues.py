"""room_clinic_finish corridor_cues module: XU 90-breaker recipe fragment.

Keep crash rail + exit-sign box; add wall-wash light so the sign
illuminates instead of reading as a sticker. Recipe-only, no Blender.
"""

from __future__ import annotations

CORRIDOR_CUES_MODULE_VERSION = "clinic-finish-corridor-cues-v1"


def corridor_cues_module(seed: int = 7) -> dict:
    return {
        "module": "corridor_cues",
        "version": CORRIDOR_CUES_MODULE_VERSION,
        "crashRail": True,
        "exitSignBox": True,
        "wallWashLight": True,
        "seed": seed,
    }
