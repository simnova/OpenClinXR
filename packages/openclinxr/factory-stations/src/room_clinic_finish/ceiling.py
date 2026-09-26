"""room_clinic_finish ceiling module: XR/XS lesson recipe fragment.

XR: T-bar grid strips at z~2.744. XS: acoustic-tile photo texture
(12.jpg speckle/perforation); fix seam tiling + green cast.
Recipe-only: emits deterministic params for compose.py. No Blender here.
"""

from __future__ import annotations

CEILING_MODULE_VERSION = "clinic-finish-ceiling-v1"
CEILING_TBAR_Z = 2.744
CEILING_TEXTURE_REF = "12.jpg"


def ceiling_module(seed: int = 7) -> dict:
    return {
        "module": "ceiling",
        "version": CEILING_MODULE_VERSION,
        "textureRef": CEILING_TEXTURE_REF,
        "tbarZ": CEILING_TBAR_Z,
        "fixSeamTiling": True,
        "fixGreenCast": True,
        "seed": seed,
    }
