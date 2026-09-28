"""room_clinic_finish corridor_cues module: XU 90-breaker recipe fragment.

S5: the exit-sign box is deleted (corridor prop, not a patient room) and the
crash rail is off by default (kept as a capability for room types that want
it; compose.py gates it behind recipe options.crashRail). Recipe-only,
no Blender here.
"""

from __future__ import annotations

CORRIDOR_CUES_MODULE_VERSION = "clinic-finish-corridor-cues-v1"


def corridor_cues_module(seed: int = 7, crash_rail: bool = False) -> dict:
    return {
        "module": "corridor_cues",
        "version": CORRIDOR_CUES_MODULE_VERSION,
        "crashRail": crash_rail,
        "exitSignBox": False,
        "wallWashLight": False,
        "seed": seed,
    }
