"""room_clinic_finish ceiling module: XR/XS lesson recipe fragment.

S5 deleted the flat ceiling field and the T-bar grid (the old hardcoded
constant sat above this room's own 2.42 m ceiling).
S6 rebuilds the grid from the room's measured shell bounds: the derivation
is ceiling plane minus TBAR_DROP_M, never a fixed constant. Recipe-only:
emits deterministic params for compose.py. No Blender here.
"""

from __future__ import annotations

CEILING_MODULE_VERSION = "clinic-finish-ceiling-v1"
CEILING_TEXTURE_REF = "ceiling-acoustic-tile.jpg"
# T-bar suspension drop below the measured ceiling plane (S6 grid anchor).
TBAR_DROP_M = 0.06


def ceiling_tbar_z(shell_ceiling_z: float) -> float:
    """T-bar height derived from the room's own measured ceiling plane."""
    return float(shell_ceiling_z) - TBAR_DROP_M


def ceiling_module(seed: int = 7, shell_ceiling_z: float | None = None) -> dict:
    return {
        "module": "ceiling",
        "version": CEILING_MODULE_VERSION,
        "textureRef": CEILING_TEXTURE_REF,
        # None until S6 measures the shell: no fixed constant lives here.
        "tbarZ": ceiling_tbar_z(shell_ceiling_z) if shell_ceiling_z is not None else None,
        "fixSeamTiling": True,
        "fixGreenCast": True,
        "seed": seed,
    }
