"""room_clinic_finish floor module: XT/XR lesson recipe fragment.

XT: matte response (specular 0). XR: shift-crop seam hiding.
Albedo ref: 11.jpg carpet photo. Recipe-only, no Blender here.
"""

from __future__ import annotations

FLOOR_MODULE_VERSION = "clinic-finish-floor-v1"
FLOOR_SPECULAR = 0.0
FLOOR_TEXTURE_REF = "11.jpg"


def floor_module(seed: int = 7) -> dict:
    return {
        "module": "floor",
        "version": FLOOR_MODULE_VERSION,
        "textureRef": FLOOR_TEXTURE_REF,
        "specular": FLOOR_SPECULAR,
        "seamHiding": "shift-crop",
        "seed": seed,
    }
