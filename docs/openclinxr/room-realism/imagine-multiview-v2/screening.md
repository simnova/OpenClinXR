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

## Not independently re-measured

Exact vanishing-point angle agreement between views (the v1 defect was a measured 50.7-degree
spread) was not re-measured with a line-fitting tool here; the views were graded by eye for
one-point-perspective plausibility given the shared room envelope and camera-height instructions
in `ROOM-SPEC.md`, which is a weaker check than the measurement used to find the v1 defect.
