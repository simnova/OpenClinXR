# Screening — inpatient ward room reference set v2

Graded at native resolution (1280x720) against `ROOM-SPEC.md`, one candidate per view. Every
candidate passed on its first attempt, so no second or third attempts were generated.

Rejection criteria applied to every candidate: curved lines where the spec calls for straight,
non-square ceiling tiles, a louvred/cylindrical light fixture, a door wall/position/hinge/swing
inconsistent with the spec, a window contradicting the "no windows" spec, text/watermarks, or
garbled geometry.

| # | file | attempt | result | notes |
|---|---|---|---|---|
| 01 | `01-toward-door.jpg` | 1 | **pass** | Master/canonical view. Flat troffer, square T-bar grid, straight cove base, flat floor, door on the north wall offset right of center, hinges visible on the right (east) jamb, vision-lite offset toward the hinge side. No window. |
| 02 | `02-toward-bed-wall.jpg` | 1 | **pass** | Bare opposite wall, same cove base, floor, and ceiling finishes as 01. No window, no furniture. Perspective convergence is consistent with the same room envelope as 01 (mirrored view). |
| 03 | `03-ceiling-corner.jpg` | 1 | **pass** | Flat rectangular troffer flush in a straight, square T-bar grid (unlike v1's cylindrical louvre in an irregular grid). Square corner, no soffit or bulkhead. |
| 04 | `04-door-inside.jpg` | 1 | **pass** | Same door, same wall, same right-side hinge and vision-lite offset as 01 and 03 — this is the flaw v1 had (door position/hinge/handle differed between views) and it does not recur here. Closer framing than 01, as specified. Minor note: this candidate shows an extra deadbolt-style cylinder above the lever handle that 01 does not show; not a spec violation (the spec does not fix hardware count) but flagged for awareness. |
| 05 | `05-troffer-junction.jpg` | 1 | **pass** | Flat lens panel coplanar with the tile field, straight grid lines, framed off any wall/corner as specified. |
| 06 | `06-floor-base.jpg` | 1 | **pass** | Flat floor meeting a straight 100 mm cove base at a sharp junction — no upward curve or bench shape (the defect present in v1's `06-floor-base.jpg`). |

## Cross-view consistency check

- **Door**: identical maple leaf, white casing, narrow vertical vision-lite offset toward the
  hinge side, and right-side (east jamb) hinges in every view that shows it (01, 03, 04). This
  directly addresses the v1 flaw where the door's hinge side, handle side, and position differed
  between `01-toward-door.jpg` and `04-door-inside.jpg`.
- **Windows**: none appear in any of the six views, addressing the v1 flaw where a window
  appeared in `01-toward-door.jpg` only.
- **Ceiling**: every view shows the same flat 600x1200 mm lay-in troffer in a straight, square
  600 mm T-bar grid — no cylindrical louvre (v1's `03-ceiling-corner.jpg` defect) and no
  soffit/bulkhead (v1's other `03` defect).
- **Base/floor**: every view shows a straight 100 mm cove base and a flat floor — no curved
  wall/ceiling junction (v1's `05-troffer-junction.jpg` defect) and no floor curving into a
  bench (v1's `06-floor-base.jpg` defect).

## Correction (2026-09-28): door offset in ROOM-SPEC.md

`ROOM-SPEC.md`'s "Position" sentence (Door section) and its two cross-references (views 01 and
04) originally read "4.20 m from the west corner ... slightly east of the wall's midpoint,"
with clearance figures "3.72 m ... east edge and 3.53 m ... west edge." That sentence was
internally inconsistent, on two independent counts caught during a downstream dispatch that
measured the built room against it:

1. **Arithmetic**: 4.20 m from the west corner, on an 8.77 m wide wall with a midpoint at
   4.385 m, is 0.185 m WEST of midpoint — the opposite of what the same sentence claims
   ("slightly east").
2. **Clearance sum**: 3.72 + 0.95 (leaf width) + 3.53 = 8.20 m, not 8.77 m (the wall's own
   stated width) — short by 0.57 m, so the clearance figures do not even describe a consistent
   door position on this wall by themselves.

Three other signals in this same spec and its own reference images agreed with each other and
disagreed with the "4.20 m" figure: the "slightly east of the midpoint" clause, view 01's
"centered-right" framing description, and the door's visible right-of-center position in the
`01-toward-door.jpg` / `04-door-inside.jpg` reference photos themselves (the actual grading
target). Since the images are the ground truth this spec exists to describe, east wins:
**corrected to 4.885 m from the west corner (0.50 m east of midpoint), 3.41 m clear to the east
edge and 4.41 m to the west edge** (3.41 + 0.95 + 4.41 = 8.77 m, now consistent). This also
matches this codebase's already-live door pin (`WARD_CHAIN_DOOR.wallOffsetM = +0.50`), which
predates this correction and was never the thing in error.

## Not independently re-measured

Exact vanishing-point angle agreement between views (the v1 defect was a measured 50.7-degree
spread) was not re-measured with a line-fitting tool here; the views were graded by eye for
one-point-perspective plausibility given the shared room envelope and camera-height instructions
in `ROOM-SPEC.md`, which is a weaker check than the measurement used to find the v1 defect.
