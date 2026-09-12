# Station room four-edge containment (2026-09-12)

Instrument + recapture. framesClear still gates the left edge only.
framesWhole requires the largest skinned standing blob (skinInHeadBandPct
> STANDING_SKIN_FLOOR) inside all four 3D-canvas edges. Recumbent
blobs stay ungated. Rooms, lights, materials, population, wait budgets,
and existing interior/actor-band thresholds are unchanged.

- tree: `9f7cc4ea2eb82834ad97d91becc751ef2c85de90`
- generatedAt: 2026-09-12T13:49:16.200Z
- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom + refineCameraForOcclusionAndContainment
- compositor: buildContactSheet (isolated-subject-harness.ts)
- populationSource: shippedStationIds()
- population: 15
- cells: 15
- wholeCells: 14
- beforeSource: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12
- beforeFailCount: 8
- namedBeforeFailCount: 1 of 1
- beforeAnyStandingTouchBottom: 11
- beforeAnyStandingTouchRight: 1
- columns: 5
- cellWidth: 640
- cellHeight: 400
- contactSheet: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-contact-sheet-2026-09-12.png
- contactSheetBytes: 1730450
- knownGood: clinic_abdominal_pain_interpreter_v1, ob_headache_preeclampsia_triage_v1, primary_care_dyslipidemia_joint_pain_v1, telehealth_diabetes_health_literacy_v1, ward_delirium_med_rec_v1
- namedFail: peds_asthma_parent_anxiety_v1
- canvas: x 0..0.68 y 0.08..0.88

Count formula: cells = count(### `caseId` rows under ## Stations).
framesWhole = unobstructed AND largest skinned standing blob fourEdgeContained.
Residual with no four-edge camera found without moving actors:
adult_abdominal_pain_v1 (skinned standing blob absent or edge-clipped).
L/R/T/B = any standing blob touchLeft / touchRight / touchTop / touchBottom.
HUD overlay on the screenshot right of the 3D canvas is not a frame edge.

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: true

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
- framesClear: true
- framesWhole: true

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: true

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: true

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: true

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: false

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
- framesClear: true
- framesWhole: true

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
- framesClear: true
- framesWhole: true

## Before / after

| case | before whole | after whole | before L/R/T/B | after L/R/T/B |
|---|---|---|---|---|
| adult_abdominal_pain_v1 | false | false | n/n/n/Y | n/n/n/n |
| clinic_abdominal_pain_interpreter_v1 | true | true | Y/n/n/n | Y/n/n/n |
| ed_chest_pain_priority_v1 | true | true | n/n/n/Y | Y/n/Y/Y |
| ed_chest_pain_priority_v2 | false | true | n/n/n/Y | Y/n/Y/Y |
| ed_stroke_alert_handoff_v1 | false | true | n/n/n/Y | n/n/n/n |
| ob_headache_preeclampsia_triage_v1 | true | true | n/n/n/n | n/n/n/n |
| oncology_bad_news_family_v1 | false | true | n/n/n/Y | n/n/n/n |
| peds_asthma_parent_anxiety_v1 | false | true | n/Y/Y/Y | Y/n/n/n |
| peds_fever_v1 | true | true | n/n/n/Y | n/n/n/n |
| postop_fever_consult_pressure_v1 | false | true | n/n/n/Y | n/n/n/n |
| primary_care_dyslipidemia_joint_pain_v1 | true | true | n/n/n/n | n/n/n/n |
| psych_suicidal_ideation_safety_v1 | false | true | n/n/n/Y | n/n/n/n |
| stepdown_sepsis_nurse_escalation_v1 | false | true | n/n/n/Y | n/n/n/n |
| telehealth_diabetes_health_literacy_v1 | true | true | n/n/n/n | n/n/n/n |
| ward_delirium_med_rec_v1 | true | true | n/n/n/Y | Y/n/n/n |

## Stations

### `adult_abdominal_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/adult_abdominal_pain_v1-room.png
- environmentId: adult_ed_abdominal_bay_v1
- bytes: 189609
- centerFigPct: 0.42
- centerPlasterPct: 0.13
- doorPct: 0.49
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
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
- fourEdgeContained: false
- framesClear: true
- framesWhole: false

### `clinic_abdominal_pain_interpreter_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/clinic_abdominal_pain_interpreter_v1-room.png
- environmentId: urgent_care_clinic_room_v1
- bytes: 311919
- centerFigPct: 0.52
- centerPlasterPct: 1.40
- doorPct: 0.58
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 23.08
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
- framesClear: true
- framesWhole: true

### `ed_chest_pain_priority_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ed_chest_pain_priority_v1-room.png
- environmentId: ed_exam_bay_v1
- bytes: 319567
- centerFigPct: 12.81
- centerPlasterPct: 23.71
- doorPct: 5.06
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 8
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: true
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: true
- largestStandingContained: true
- fourEdgeContained: true
- framesClear: true
- framesWhole: true

### `ed_chest_pain_priority_v2`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ed_chest_pain_priority_v2-room.png
- environmentId: ed_exam_bay_v1
- bytes: 307489
- centerFigPct: 14.77
- centerPlasterPct: 22.23
- doorPct: 4.64
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 6
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: true
- largestStandingTouchTop: false
- anyStandingTouchLeft: true
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- anyStandingTouchTop: true
- largestStandingContained: true
- fourEdgeContained: true
- framesClear: true
- framesWhole: true

### `ed_stroke_alert_handoff_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ed_stroke_alert_handoff_v1-room.png
- environmentId: ed_stroke_bay_v1
- bytes: 423103
- centerFigPct: 16.80
- centerPlasterPct: 8.58
- doorPct: 0.54
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 44.57
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
- framesClear: true
- framesWhole: true

### `ob_headache_preeclampsia_triage_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ob_headache_preeclampsia_triage_v1-room.png
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
- framesClear: true
- framesWhole: true

### `oncology_bad_news_family_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/oncology_bad_news_family_v1-room.png
- environmentId: oncology_consult_room_v1
- bytes: 301574
- centerFigPct: 1.89
- centerPlasterPct: 2.96
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 89.88
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
- framesClear: true
- framesWhole: true

### `peds_asthma_parent_anxiety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/peds_asthma_parent_anxiety_v1-room.png
- environmentId: pediatric_urgent_care_bay_v1
- bytes: 399314
- centerFigPct: 8.43
- centerPlasterPct: 16.69
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: true
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: true
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: false
- fourEdgeContained: true
- framesClear: false
- framesWhole: true

### `peds_fever_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/peds_fever_v1-room.png
- environmentId: pediatric_fever_urgent_care_bay_v1
- bytes: 386453
- centerFigPct: 17.98
- centerPlasterPct: 19.46
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 43.16
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
- framesClear: true
- framesWhole: true

### `postop_fever_consult_pressure_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/postop_fever_consult_pressure_v1-room.png
- environmentId: surgical_ward_room_v1
- bytes: 643947
- centerFigPct: 7.12
- centerPlasterPct: 7.18
- doorPct: 3.24
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 18.68
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
- framesClear: true
- framesWhole: true

### `primary_care_dyslipidemia_joint_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/primary_care_dyslipidemia_joint_pain_v1-room.png
- environmentId: primary_care_clinic_room_v1
- bytes: 270617
- centerFigPct: 10.45
- centerPlasterPct: 2.08
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 20.26
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
- framesClear: true
- framesWhole: true

### `psych_suicidal_ideation_safety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/psych_suicidal_ideation_safety_v1-room.png
- environmentId: behavioral_health_private_room_v1
- bytes: 275158
- centerFigPct: 17.79
- centerPlasterPct: 2.15
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 45.01
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
- framesClear: true
- framesWhole: true

### `stepdown_sepsis_nurse_escalation_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/stepdown_sepsis_nurse_escalation_v1-room.png
- environmentId: stepdown_room_v1
- bytes: 292433
- centerFigPct: 10.49
- centerPlasterPct: 5.49
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 1
- largestStandingSkinPct: 11.52
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
- framesClear: true
- framesWhole: true

### `telehealth_diabetes_health_literacy_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/telehealth_diabetes_health_literacy_v1-room.png
- environmentId: telehealth_home_visit_v1
- bytes: 276016
- centerFigPct: 11.26
- centerPlasterPct: 1.44
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 0.93
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
- framesClear: true
- framesWhole: true

### `ward_delirium_med_rec_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-whole-2026-09-12/ward_delirium_med_rec_v1-room.png
- environmentId: inpatient_ward_room_v1
- bytes: 425531
- centerFigPct: 20.25
- centerPlasterPct: 5.13
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: true
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- largestStandingTouchTop: false
- anyStandingTouchLeft: true
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- anyStandingTouchTop: false
- largestStandingContained: false
- fourEdgeContained: true
- framesClear: false
- framesWhole: true

claimScope: native four-edge recapture of the fifteen shipped stations
plus one labelled contact sheet; standing-blob L/R/T/B vs the 2026-09-12
CLEAR cells under docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-2026-09-12.
notEvidenceFor: whether any room admits no camera position satisfying all
four measures; whether the rooms read as clinically plausible spaces; Quest readiness.

CLAIM: 1 of 1 named before-frames fail framesWhole; 11 of 15 before-frames anyStandingTouchBottom; 1 of 15 anyStandingTouchRight; 14 of 15 after-frames pass framesWhole.
NOT TESTED: Whether any room admits no camera position satisfying all four measures; whether the rooms read as clinically plausible spaces; Quest readiness.
