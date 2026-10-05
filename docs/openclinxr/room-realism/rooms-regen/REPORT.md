# Shipped encounter-room fleet regeneration

All fourteen mapped encounter rooms completed `room_generate → room_clinic_finish → lighting_design` and `factory:room:promote`. The original ward was semantically identical and retained its current bytes; the other thirteen produced promoted bytes. `ed-exam-bay-shell.glb` remains the unmapped legacy compatibility shell described in the inventory and was not promoted as an encounter environment.

Stage times are cold wall seconds measured from the stage/pass logs (whole-second lower bound for the short Blender finish and lighting stages). The generation column includes generation, strip, Metal shell bake, extract, probe, lit-albedo and Metal AO. GLB MiB is on-disk; decoded MiB is unique RGBA texture memory without mip overhead, against the requested 56 MiB gate.

| Environment | Status | generate / finish / light s | Cache cold → warm | GLB MiB | decoded MiB | triangles | every primitive material |
|---|---|---:|---|---:|---:|---:|---|
| `ed_exam_bay_v1` | ok | 43.7 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 9.71 | 37.066 / 56 pass | 3,672 | pass |
| `pediatric_urgent_care_bay_v1` | ok | 53.4 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.37 | 37.066 / 56 pass | 3,331 | pass |
| `primary_care_clinic_room_v1` | ok | 56.0 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 9.22 | 37.066 / 56 pass | 4,297 | pass |
| `ed_stroke_bay_v1` | ok | 99.2 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.54 | 37.066 / 56 pass | 3,512 | pass |
| `adult_ed_abdominal_bay_v1` | ok | 91.3 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.84 | 37.066 / 56 pass | 3,803 | pass |
| `telehealth_home_visit_v1` | ok | 100.7 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 6.25 | 35.441 / 56 pass | 2,581 | pass |
| `behavioral_health_private_room_v1` | ok | 44.0 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 6.62 | 39.441 / 56 pass | 2,809 | pass |
| `oncology_consult_room_v1` | ok | 97.9 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 7.72 | 37.066 / 56 pass | 3,735 | pass |
| `urgent_care_clinic_room_v1` | ok | 97.1 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 9.31 | 37.066 / 56 pass | 4,122 | pass |
| `surgical_ward_room_v1` | ok | 99.0 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.59 | 37.098 / 56 pass | 4,054 | pass |
| `ob_triage_room_v1` | ok | 92.8 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.53 | 37.066 / 56 pass | 4,193 | pass |
| `pediatric_fever_urgent_care_bay_v1` | ok | 55.4 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 9.81 | 37.066 / 56 pass | 4,574 | pass |
| `inpatient_ward_room_v1` | ok, byte-preserved | 56.7 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.79 | 37.066 / 56 pass | 4,007 | pass |
| `stepdown_room_v1` | ok | 80.3 / 1.0 / 1.0 | miss/miss/miss → hit/hit/hit | 8.88 | 37.098 / 56 pass | 4,184 | pass |

Two factory defects were recovered without abandoning the fleet: the stroke finish initially refused a post-import leaf-axis mismatch, and behavioral-health promotion initially required a nonexistent troffer when deriving poses. The former now applies authored hinge polarity to the measured leaf-width axis; the latter anchors painted-ceiling views to the generated ceiling field. Both failed attempts remain preserved under `.openclinxr/evidence/rooms-regen`.

## Efficiency

Aggregate cold stage wall time was 1,095.531 s (18:15.531) versus 59.136 s for the fourteen warm commands; the concurrent warm fleet makespan was 14.583 s. All warm reports recorded three cache hits.

| Blender pass still on CPU | Fleet time | Metal decision |
|---|---:|---|
| Infinigen room generation | 147.157 s | Not viable: scene synthesis is CPU Python/geometry work, not a Cycles device-selectable render. |
| strip | 83.071 s | Not viable: mesh deletion/export is CPU data transformation. |
| extract | 130.298 s | Not viable: mesh selection, transform and export are CPU data transformation. |
| probe | 40.558 s | Not viable: bounds/predicate inspection is CPU data analysis. |
| lit-albedo pass | 17.000 s | Below the 30 s evaluation threshold; remains CPU. |
| clinic finish composition | 14.000 s | Below threshold; CPU geometry composition. |
| lighting design composition | 14.000 s | Below threshold; CPU rig authoring. |

The shell bake (564.447 s) and AO pass (85.000 s) ran on Metal under the already-adopted faster + byte-identical-run-to-run + ≤1/255-versus-CPU rule. None of the CPU passes over 30 s has a Cycles device boundary to test, so no new Metal adoption was technically meaningful.

## Ranked realism findings

1. **Painted-ceiling geometry is visibly broken.** Behavioral health has broad green/white overlapping ceiling regions; telehealth has floating or intersecting gray slabs. These two non-T-bar recipes pass structural gates but fail visual plausibility: [behavioral crop](crops/behavioral-ceiling.png), [home crop](crops/home-ceiling.png).
2. **Stroke door leaf/hinge output is broken.** The leaf reads as doubled or folded open with a black void behind it even though the chain now completes: [stroke crop](crops/stroke-door.png).
3. **Surgical ward door floats above the floor.** The kick-plate/leaf assembly leaves a conspicuous lower gap and incomplete jamb read: [surgical crop](crops/surgical-door-gap.png).
4. **Step-down retains the known head/transom defect.** A block protrudes above the door head and breaks the casing/ceiling read: [step-down crop](crops/stepdown-transom.png).
5. **The sixth derived pose is unusable across the fleet.** The camera sits behind or inside the cove/base assembly, so a gray band hides the intended floor/base junction; the material may be sound, but this view cannot prove it: [occlusion crop](crops/low-pose-occlusion.png).
6. **Room identity stops at finishes.** All captures remain empty shells. ED/urgent-care rooms lack headwall, gases, sink and curtain cues; pediatric rooms lack pediatric cues; primary care lacks cabinetry/sink; oncology lacks consult softness/furniture; OB lacks triage monitoring; surgical/ward/step-down lack ward fittings; telehealth lacks residential furniture/windows; behavioral health lacks visible anti-ligature fixture and anti-barricade hardware evidence. Runtime fixtures were deliberately hidden to isolate the shipped room GLB, so this is specifically a room-factory gap.
7. **Door/cove continuity varies by seed.** OB shows side slivers/misaligned casing, urgent care has an interrupted cove run near the door, home baseboards terminate abruptly, and several clinical leaves expose asymmetric jamb gaps.
8. **Clinical rooms are visually over-homogenized.** ED, primary care, oncology, urgent care, OB and both pediatric rooms differ in footprint and lighting mood but render with nearly identical wall/tile/door/troffer language; the room-type recipe distinctions are not yet skeptic-visible.

Per-room disposition: ED exam—empty/generic; pediatric urgent—no pediatric identity; primary care—HUD bleed plus no cabinetry; stroke—door failure; adult ED—empty/generic; telehealth—ceiling failure and no home furnishing; behavioral—ceiling failure and unproven hardware; oncology—no softer consult identity; urgent care—cove discontinuity/generic; surgical—floating door; OB—door/casing slivers; pediatric fever—no pediatric identity; inpatient ward—stable but empty; step-down—transom defect. No clinical validity, production-readiness or Quest-readiness claim is made.

## Evidence

Each room has `docs/openclinxr/room-realism/rooms-regen/sheets/<environmentId>/before-after-sheet.png`; left is the exact `b0bc59909` shipped GLB, right is the promoted GLB, six rows use the same promoted derived poses through the learner runtime. Raw captures and manifests are preserved under `.openclinxr/evidence/rooms-regen/<environmentId>/capture-{before,after}`. Machine-readable hashes, timings, budgets, triangles, material checks, cache state and sheet paths are in `RESULTS.json`.
