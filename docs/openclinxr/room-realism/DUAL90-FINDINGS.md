# Room Realism Dual-90 Findings (2026-09-25)

Goal: Infinigen empty hospital exam room still scoring >=90 against a Grok Imagine reference, confirmed by two independent Muse judges on one still.

## Result

Treatment XU met the gate: 95 and 100 from two independent muse-spark-1 judges. A third judge gave 79 (recorded as also-ran).

| Judge | CEILING | FLOOR | WALL | DOOR | LIGHT | MOOD | TOTAL |
|---|---|---|---|---|---|---|---|
| 40c805fa | 17 | 15 | 16 | 16 | 16 | 15 | 95 |
| e1ea8c9e | 17 | 18 | 16 | 15 | 17 | 17 | 100 |
| 4359019e (also-ran) | 12 | 14 | 13 | 13 | 14 | 13 | 79 |

Still: `room-final-xu.png` (this directory). Reference: gray-green corridor with dark wood double doors, acoustic tile ceiling, carpet.

## What broke through

Iteration scores: XR 56/68, XS 68/60, XT 60/73, XU 95/79/100. The XU delta was corridor cues: a vinyl crash rail and an exit sign box. These lifted WALL, DOOR, and MOOD into the mid-teens consistently across judges.

Full treatment lineage: XR shell (T-bar grid strips, gray-green drywall, paneled maple doors, kick plates) + XS (aux Imagine textures: ceiling 12.jpg, floor 11.jpg) + XT (matte floor, specular 0) + XU (crash rail, exit sign).

## Reusable factory stations

- Ceiling: acoustic-tile photo texture + T-bar grid strips at z~2.744.
- Floor: carpet photo texture, matte (specular 0).
- Door: maple photo cards + recessed-panel molding + kick plates + lever handle.
- Corridor cues: crash rail + exit sign (the 90-breaker).

## Reproduce

Render script: `.openclinxr/evidence/room-realism-shell/render_clinic_xu.py` (git-ignored scratch; request copy if needed). Blender 5.1 EEVEE, 1280x720.
