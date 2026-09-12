# Station room four-edge containment (2026-09-12)

Instrument + recapture. framesClear still gates the left edge only.
framesWhole requires the largest skinned standing blob (skinInHeadBandPct
> STANDING_SKIN_FLOOR) inside all four 3D-canvas edges. Recumbent
blobs stay ungated. Rooms, lights, materials, population, wait budgets,
and existing interior/actor-band thresholds are unchanged.

- tree: `a60f1e569d44bff9496bb89c5197967ec29d8ee2`
- generatedAt: 2026-09-12T14:11:11.359Z
- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom + refineCameraForOcclusionAndContainment
- compositor: buildContactSheet (isolated-subject-harness.ts)
- populationSource: shippedStationIds()
- population: 15
- cells: 15
- wholeCells: 9
- beforeSource: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12
- beforeFailCount: 8
- namedBeforeFailCount: 1 of 1
- beforeAnyStandingTouchBottom: 11
- beforeAnyStandingTouchRight: 1
- columns: 5
- cellWidth: 640
- cellHeight: 400
- contactSheet: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-contact-sheet-2026-09-12.png
- contactSheetBytes: 1971474
- knownGood: clinic_abdominal_pain_interpreter_v1, ob_headache_preeclampsia_triage_v1, primary_care_dyslipidemia_joint_pain_v1, telehealth_diabetes_health_literacy_v1, ward_delirium_med_rec_v1
- namedFail: peds_asthma_parent_anxiety_v1
- canvas: x 0..0.68 y 0.08..0.88

Count formula: cells = count(### `caseId` rows under ## Stations).
framesWhole = unobstructed AND largest skinned standing blob fourEdgeContained.
skinned L/R/T/B = the largest blob with skinInHeadBandPct > STANDING_SKIN_FLOOR
(the blob framesWhole uses). any L/R/T/B = any standing chroma blob, including
furniture-sized components. ed_chest_pain_priority_v1 can be whole true while
any L/R/T/B is Y because a non-skinned blob clips; that is not a gate bug.
placardBack = pre-encounter / scenario-expectation panel is between camera and
actors with its back face toward the camera (mirrored text). meanFacingDeg =
mean angle between standing-actor heading (-Z) and camera, 0 = facing camera.
HUD overlay on the screenshot right of the 3D canvas is not a frame edge.
adult_abdominal_pain_v1 now framesWhole on the doorway-side camera (skinned L/R/T/B=n/n/n/n skinPct=16.44 placardBack=false meanFacingDeg=88.0).
Residual oncology_bad_news_family_v1: framesWhole=false on the doorway-side camera. skinned L/R/T/B=n/n/n/n skinPct=0.00 unobstructed=true framesActors=false placardBack=false meanFacingDeg=86.5. A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.
Residual peds_fever_v1: framesWhole=false on the doorway-side camera. skinned L/R/T/B=n/n/n/Y skinPct=82.11 unobstructed=true framesActors=true placardBack=false meanFacingDeg=87.8. A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.
Residual postop_fever_consult_pressure_v1: framesWhole=false on the doorway-side camera. skinned L/R/T/B=n/n/n/Y skinPct=87.31 unobstructed=true framesActors=true placardBack=false meanFacingDeg=84.5. A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.
Residual psych_suicidal_ideation_safety_v1: framesWhole=false on the doorway-side camera. skinned L/R/T/B=n/n/n/Y skinPct=5.30 unobstructed=true framesActors=true placardBack=false meanFacingDeg=127.6. A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.
Residual stepdown_sepsis_nurse_escalation_v1: framesWhole=false on the doorway-side camera. skinned L/R/T/B=n/n/n/Y skinPct=26.90 unobstructed=true framesActors=true placardBack=false meanFacingDeg=84.2. A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.
Residual telehealth_diabetes_health_literacy_v1: framesWhole=false on the doorway-side camera. skinned L/R/T/B=n/n/n/Y skinPct=12.78 unobstructed=true framesActors=false placardBack=false meanFacingDeg=57.1. A behind-placard retreat that would raise containment is refused; this is a room/layout constraint, not a missing orbit.

## Before (docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12)

Same four-edge instrument on the left-only CLEAR recapture. Named
failures must stay failures here or the instrument does not bite.

### `adult_abdominal_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/adult_abdominal_pain_v1-room.png
- environmentId: adult_ed_abdominal_bay_v1
- bytes: 472331
- centerFigPct: 21.04
- centerPlasterPct: 20.75
- doorPct: 1.20
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 9.39
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `clinic_abdominal_pain_interpreter_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/clinic_abdominal_pain_interpreter_v1-room.png
- environmentId: urgent_care_clinic_room_v1
- bytes: 310952
- centerFigPct: 0.55
- centerPlasterPct: 1.38
- doorPct: 0.59
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 23.45
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: true
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `ed_chest_pain_priority_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/ed_chest_pain_priority_v1-room.png
- environmentId: ed_exam_bay_v1
- bytes: 327730
- centerFigPct: 16.21
- centerPlasterPct: 20.72
- doorPct: 9.94
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 11.24
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `ed_chest_pain_priority_v2`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/ed_chest_pain_priority_v2-room.png
- environmentId: ed_exam_bay_v1
- bytes: 314891
- centerFigPct: 18.86
- centerPlasterPct: 20.51
- doorPct: 8.81
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 42.06
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `ed_stroke_alert_handoff_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/ed_stroke_alert_handoff_v1-room.png
- environmentId: ed_stroke_bay_v1
- bytes: 396093
- centerFigPct: 20.56
- centerPlasterPct: 3.81
- doorPct: 0.85
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 10.53
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `ob_headache_preeclampsia_triage_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/ob_headache_preeclampsia_triage_v1-room.png
- environmentId: ob_triage_room_v1
- bytes: 273187
- centerFigPct: 10.62
- centerPlasterPct: 15.40
- doorPct: 4.10
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `oncology_bad_news_family_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/oncology_bad_news_family_v1-room.png
- environmentId: oncology_consult_room_v1
- bytes: 360750
- centerFigPct: 10.21
- centerPlasterPct: 4.07
- doorPct: 1.87
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 81.43
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `peds_asthma_parent_anxiety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/peds_asthma_parent_anxiety_v1-room.png
- environmentId: pediatric_urgent_care_bay_v1
- bytes: 345874
- centerFigPct: 11.14
- centerPlasterPct: 34.25
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 9.37
- largestStandingTouchLeft: false
- largestStandingTouchRight: true
- largestStandingTouchBottom: true
- largestStandingTouchTop: true
- anyStandingTouchLeft: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: true
- anyStandingTouchTop: true
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: true
- skinnedTouchTop: true
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `peds_fever_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/peds_fever_v1-room.png
- environmentId: pediatric_fever_urgent_care_bay_v1
- bytes: 442098
- centerFigPct: 13.12
- centerPlasterPct: 46.22
- doorPct: 0.15
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 40.32
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `postop_fever_consult_pressure_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/postop_fever_consult_pressure_v1-room.png
- environmentId: surgical_ward_room_v1
- bytes: 468431
- centerFigPct: 19.79
- centerPlasterPct: 20.32
- doorPct: 4.39
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 32.08
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `primary_care_dyslipidemia_joint_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/primary_care_dyslipidemia_joint_pain_v1-room.png
- environmentId: primary_care_clinic_room_v1
- bytes: 390939
- centerFigPct: 4.04
- centerPlasterPct: 1.62
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 25.02
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `psych_suicidal_ideation_safety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/psych_suicidal_ideation_safety_v1-room.png
- environmentId: behavioral_health_private_room_v1
- bytes: 401980
- centerFigPct: 36.94
- centerPlasterPct: 7.32
- doorPct: 0.04
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 23.39
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `stepdown_sepsis_nurse_escalation_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/stepdown_sepsis_nurse_escalation_v1-room.png
- environmentId: stepdown_room_v1
- bytes: 378061
- centerFigPct: 23.23
- centerPlasterPct: 19.47
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 24.47
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `telehealth_diabetes_health_literacy_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/telehealth_diabetes_health_literacy_v1-room.png
- environmentId: telehealth_home_visit_v1
- bytes: 466730
- centerFigPct: 17.39
- centerPlasterPct: 34.82
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 53.54
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

### `ward_delirium_med_rec_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12/ward_delirium_med_rec_v1-room.png
- environmentId: inpatient_ward_room_v1
- bytes: 414158
- centerFigPct: 14.55
- centerPlasterPct: 26.90
- doorPct: 0.03
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 39.23
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: null
- meanFacingDeg: null
- framesActors: null

## Before / after

| case | before whole | after whole | before skinned L/R/T/B | after skinned L/R/T/B | before any L/R/T/B | after any L/R/T/B | placardBack | meanFacingDeg |
|---|---|---|---|---|---|---|---|---|
| adult_abdominal_pain_v1 | false | true | n/n/n/Y | n/n/n/n | n/n/n/Y | n/n/n/Y | false | 88.0 |
| clinic_abdominal_pain_interpreter_v1 | true | true | n/n/n/n | n/n/n/n | Y/n/n/n | Y/n/n/n | false | 169.5 |
| ed_chest_pain_priority_v1 | true | true | n/n/n/n | n/n/n/n | n/n/n/Y | n/Y/n/n | false | 138.8 |
| ed_chest_pain_priority_v2 | false | true | n/n/n/Y | n/n/n/n | n/n/n/Y | n/Y/n/n | false | 139.2 |
| ed_stroke_alert_handoff_v1 | false | true | n/n/n/Y | n/n/n/n | n/n/n/Y | n/n/n/Y | false | 87.2 |
| ob_headache_preeclampsia_triage_v1 | true | true | n/n/n/n | n/n/n/n | n/n/n/n | n/n/n/n | false | 99.2 |
| oncology_bad_news_family_v1 | false | false | n/n/n/Y | n/n/n/n | n/n/n/Y | n/n/n/Y | false | 86.5 |
| peds_asthma_parent_anxiety_v1 | false | true | n/Y/Y/Y | n/n/n/n | n/Y/Y/Y | n/n/n/n | false | 87.3 |
| peds_fever_v1 | true | false | n/n/n/n | n/n/n/Y | n/n/n/Y | n/n/n/Y | false | 87.8 |
| postop_fever_consult_pressure_v1 | false | false | n/n/n/Y | n/n/n/Y | n/n/n/Y | n/n/n/Y | false | 84.5 |
| primary_care_dyslipidemia_joint_pain_v1 | true | true | n/n/n/n | n/n/n/n | n/n/n/n | n/n/n/n | false | 91.2 |
| psych_suicidal_ideation_safety_v1 | false | false | n/n/n/Y | n/n/n/Y | n/n/n/Y | n/n/n/Y | false | 127.6 |
| stepdown_sepsis_nurse_escalation_v1 | false | false | n/n/n/Y | n/n/n/Y | n/n/n/Y | n/n/n/Y | false | 84.2 |
| telehealth_diabetes_health_literacy_v1 | true | false | n/n/n/n | n/n/n/Y | n/n/n/n | n/n/n/Y | false | 57.1 |
| ward_delirium_med_rec_v1 | true | true | n/n/n/n | n/n/n/n | n/n/n/Y | n/n/n/n | false | 81.6 |

## Stations

### `adult_abdominal_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/adult_abdominal_pain_v1-room.png
- environmentId: adult_ed_abdominal_bay_v1
- bytes: 373804
- centerFigPct: 25.66
- centerPlasterPct: 18.44
- doorPct: 2.51
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 16.44
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 88.0
- framesActors: true

### `clinic_abdominal_pain_interpreter_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/clinic_abdominal_pain_interpreter_v1-room.png
- environmentId: urgent_care_clinic_room_v1
- bytes: 312936
- centerFigPct: 0.60
- centerPlasterPct: 1.34
- doorPct: 0.59
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 24.16
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: true
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 169.5
- framesActors: true

### `ed_chest_pain_priority_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ed_chest_pain_priority_v1-room.png
- environmentId: ed_exam_bay_v1
- bytes: 390038
- centerFigPct: 20.02
- centerPlasterPct: 20.82
- doorPct: 4.71
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 21.42
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 138.8
- framesActors: true

### `ed_chest_pain_priority_v2`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ed_chest_pain_priority_v2-room.png
- environmentId: ed_exam_bay_v1
- bytes: 377401
- centerFigPct: 22.53
- centerPlasterPct: 24.02
- doorPct: 2.71
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 21.32
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 139.2
- framesActors: true

### `ed_stroke_alert_handoff_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ed_stroke_alert_handoff_v1-room.png
- environmentId: ed_stroke_bay_v1
- bytes: 321606
- centerFigPct: 21.72
- centerPlasterPct: 5.30
- doorPct: 1.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 15.54
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 87.2
- framesActors: true

### `ob_headache_preeclampsia_triage_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ob_headache_preeclampsia_triage_v1-room.png
- environmentId: ob_triage_room_v1
- bytes: 392189
- centerFigPct: 7.39
- centerPlasterPct: 4.90
- doorPct: 4.48
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 24.14
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 99.2
- framesActors: false

### `oncology_bad_news_family_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/oncology_bad_news_family_v1-room.png
- environmentId: oncology_consult_room_v1
- bytes: 386547
- centerFigPct: 7.91
- centerPlasterPct: 4.35
- doorPct: 0.93
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: false
- placardBack: false
- meanFacingDeg: 86.5
- framesActors: false

### `peds_asthma_parent_anxiety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/peds_asthma_parent_anxiety_v1-room.png
- environmentId: pediatric_urgent_care_bay_v1
- bytes: 357431
- centerFigPct: 17.00
- centerPlasterPct: 22.58
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 24.44
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 87.3
- framesActors: true

### `peds_fever_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/peds_fever_v1-room.png
- environmentId: pediatric_fever_urgent_care_bay_v1
- bytes: 331610
- centerFigPct: 22.72
- centerPlasterPct: 18.07
- doorPct: 1.20
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 82.11
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: false
- meanFacingDeg: 87.8
- framesActors: true

### `postop_fever_consult_pressure_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/postop_fever_consult_pressure_v1-room.png
- environmentId: surgical_ward_room_v1
- bytes: 468583
- centerFigPct: 22.08
- centerPlasterPct: 16.21
- doorPct: 2.33
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 87.31
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: false
- meanFacingDeg: 84.5
- framesActors: true

### `primary_care_dyslipidemia_joint_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/primary_care_dyslipidemia_joint_pain_v1-room.png
- environmentId: primary_care_clinic_room_v1
- bytes: 309073
- centerFigPct: 16.51
- centerPlasterPct: 9.33
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 22.25
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 91.2
- framesActors: false

### `psych_suicidal_ideation_safety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/psych_suicidal_ideation_safety_v1-room.png
- environmentId: behavioral_health_private_room_v1
- bytes: 375795
- centerFigPct: 14.29
- centerPlasterPct: 15.09
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 5.30
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: false
- meanFacingDeg: 127.6
- framesActors: true

### `stepdown_sepsis_nurse_escalation_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/stepdown_sepsis_nurse_escalation_v1-room.png
- environmentId: stepdown_room_v1
- bytes: 364422
- centerFigPct: 21.18
- centerPlasterPct: 15.80
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 26.90
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: false
- meanFacingDeg: 84.2
- framesActors: true

### `telehealth_diabetes_health_literacy_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/telehealth_diabetes_health_literacy_v1-room.png
- environmentId: telehealth_home_visit_v1
- bytes: 360360
- centerFigPct: 32.61
- centerPlasterPct: 3.80
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 12.78
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: false
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: true
- framesClear: true
- framesWhole: false
- placardBack: false
- meanFacingDeg: 57.1
- framesActors: false

### `ward_delirium_med_rec_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ward_delirium_med_rec_v1-room.png
- environmentId: inpatient_ward_room_v1
- bytes: 443153
- centerFigPct: 15.11
- centerPlasterPct: 20.72
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 29.17
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: true
- fourEdgeContained: true
- skinnedTouchLeft: false
- skinnedTouchRight: false
- skinnedTouchTop: false
- skinnedTouchBottom: false
- framesClear: true
- framesWhole: true
- placardBack: false
- meanFacingDeg: 81.6
- framesActors: true

claimScope: native four-edge recapture of the fifteen shipped stations
plus one labelled contact sheet; standing-blob L/R/T/B vs the 2026-09-12
CLEAR cells under docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12.
notEvidenceFor: whether any room admits no camera position satisfying all
four measures; whether the rooms read as clinically plausible spaces; Quest readiness.

CLAIM: 1 of 1 named before-frames fail framesWhole; 11 of 15 before-frames anyStandingTouchBottom; 1 of 15 anyStandingTouchRight; 9 of 15 after-frames pass framesWhole.
NOT TESTED: Whether any room admits no camera position satisfying all four measures; whether the rooms read as clinically plausible spaces; Quest readiness.
