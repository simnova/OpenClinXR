# Destructive probe

SUBSTITUTION::`light = Vitruvian_Face_BaseColor_Utility - Linear - sRGB.exr`; `African = Vitruvian_Face_BaseColor_Utility - Linear - sRGB.exr` (the light map was deliberately supplied as both inputs).

The resulting cheek multiplier was exactly `(1.0, 1.0, 1.0)`. Every predicted-to-input CIEDE2000 was exactly `0.000000`:

| Region | CIEDE2000 | Probe floor | Margin |
|---|---:|---:|---:|
| forehead | 0.000000 | 1.257699 | -1.257699 |
| cheek | 0.000000 | 1.257699 | -1.257699 |
| lip | 0.000000 | 1.257699 | -1.257699 |
| ear | 0.000000 | 1.257699 | -1.257699 |
| nose | 0.000000 | 1.257699 | -1.257699 |

VERDICT::kill

This confirms the instrument rejects its own identical-input destructive probe.
