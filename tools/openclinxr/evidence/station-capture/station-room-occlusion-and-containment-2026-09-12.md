# Station room occlusion and containment (2026-09-12)

Instrument + recapture. Each shipped station is photographed with the
elevated interior camera, then refineCameraForOcclusionAndContainment
orbits inside the interior AABB until standing actors (world AABB height
>= 1.15 m) are unoccluded and not left-clipped. Rooms, lights, materials,
population, wait budgets, and existing interior/actor-band thresholds are
unchanged. UI text bleeding over the canvas is named, not fixed here.

- tree: `01c5aaa1cb8dec1466e48594b415b51d223c5846`
- generatedAt: 2026-09-12T12:50:55.255Z
- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom + refineCameraForOcclusionAndContainment
- compositor: buildContactSheet (isolated-subject-harness.ts)
- populationSource: shippedStationIds()
- population: 15
- cells: 15
- clearCells: 15
- beforeSource: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12 at `fba57fb91a507295bdafa847be5c0858d65c2831`
- beforeFailCount: 3
- namedBeforeFailCount: 3 of 3
- columns: 5
- cellWidth: 640
- cellHeight: 400
- contactSheet: docs/openclinxr/humanoid-vetting-captures/station-rooms-clear-contact-sheet-2026-09-12.png
- contactSheetBytes: 1974067
- wallCenterPlasterFloor: 45.43 (sqrt(59.13 × 34.90))
- doorPctCeiling: 14.19 (sqrt(26.20 × 7.69))
- standingSkinFloor: 2.80 (sqrt(0.3 × 26.1))
- knownGood: peds_asthma_parent_anxiety_v1, stepdown_sepsis_nurse_escalation_v1
- canvas: x 0..0.68 y 0.08..0.88

Count formula: cells = count(### `caseId` rows under ## Stations). framesClear
= unobstructed (not wallOccluded and not doorOccluded) AND largest standing
blob contained (!touchLeft). touchRight and touchBottom are reported, not
gated. Per-actor blobs, not a band percentage. Recumbent bed actors may
clip the left edge. HUD text overlay on the right of the 3D canvas is
named, not gated.

## Before (docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12 at `fba57fb91a507295bdafa847be5c0858d65c2831`)

Same instrument on the actor-frame PNGs this branch replaced. Named
failures must stay failures here or the instrument does not bite.

### `adult_abdominal_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/adult_abdominal_pain_v1-room.png
- environmentId: adult_ed_abdominal_bay_v1
- bytes: 709022
- centerFigPct: 0.00
- centerPlasterPct: 59.13
- doorPct: 0.15
- wallOccluded: true
- doorOccluded: false
- unobstructed: false
- standingCount: 1
- largestStandingSkinPct: 0.32
- largestStandingTouchLeft: true
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: false
- framesClear: false

### `clinic_abdominal_pain_interpreter_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/clinic_abdominal_pain_interpreter_v1-room.png
- environmentId: urgent_care_clinic_room_v1
- bytes: 311648
- centerFigPct: 0.54
- centerPlasterPct: 1.38
- doorPct: 0.60
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 23.77
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `ed_chest_pain_priority_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ed_chest_pain_priority_v1-room.png
- environmentId: ed_exam_bay_v1
- bytes: 310405
- centerFigPct: 6.14
- centerPlasterPct: 27.93
- doorPct: 26.20
- wallOccluded: false
- doorOccluded: true
- unobstructed: false
- standingCount: 2
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: true
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: false
- framesClear: false

### `ed_chest_pain_priority_v2`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ed_chest_pain_priority_v2-room.png
- environmentId: ed_exam_bay_v1
- bytes: 297193
- centerFigPct: 6.27
- centerPlasterPct: 27.86
- doorPct: 25.93
- wallOccluded: false
- doorOccluded: true
- unobstructed: false
- standingCount: 2
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: true
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: false
- framesClear: false

### `ed_stroke_alert_handoff_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ed_stroke_alert_handoff_v1-room.png
- environmentId: ed_stroke_bay_v1
- bytes: 532678
- centerFigPct: 13.40
- centerPlasterPct: 21.51
- doorPct: 0.15
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 23.49
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `ob_headache_preeclampsia_triage_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ob_headache_preeclampsia_triage_v1-room.png
- environmentId: ob_triage_room_v1
- bytes: 278535
- centerFigPct: 10.55
- centerPlasterPct: 13.20
- doorPct: 4.06
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 0.00
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `oncology_bad_news_family_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/oncology_bad_news_family_v1-room.png
- environmentId: oncology_consult_room_v1
- bytes: 264425
- centerFigPct: 0.03
- centerPlasterPct: 5.71
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 63.45
- largestStandingTouchLeft: false
- largestStandingTouchRight: true
- largestStandingTouchBottom: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

### `peds_asthma_parent_anxiety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/peds_asthma_parent_anxiety_v1-room.png
- environmentId: pediatric_urgent_care_bay_v1
- bytes: 340665
- centerFigPct: 11.01
- centerPlasterPct: 34.90
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 2
- largestStandingSkinPct: 9.42
- largestStandingTouchLeft: false
- largestStandingTouchRight: true
- largestStandingTouchBottom: true
- anyStandingTouchRight: true
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

### `peds_fever_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/peds_fever_v1-room.png
- environmentId: pediatric_fever_urgent_care_bay_v1
- bytes: 469501
- centerFigPct: 24.35
- centerPlasterPct: 0.27
- doorPct: 0.11
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 24.31
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `postop_fever_consult_pressure_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/postop_fever_consult_pressure_v1-room.png
- environmentId: surgical_ward_room_v1
- bytes: 581984
- centerFigPct: 18.40
- centerPlasterPct: 27.44
- doorPct: 5.03
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 23.49
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `primary_care_dyslipidemia_joint_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/primary_care_dyslipidemia_joint_pain_v1-room.png
- environmentId: primary_care_clinic_room_v1
- bytes: 387847
- centerFigPct: 4.20
- centerPlasterPct: 1.79
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 25.10
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `psych_suicidal_ideation_safety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/psych_suicidal_ideation_safety_v1-room.png
- environmentId: behavioral_health_private_room_v1
- bytes: 363304
- centerFigPct: 13.60
- centerPlasterPct: 24.77
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 25.64
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `stepdown_sepsis_nurse_escalation_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/stepdown_sepsis_nurse_escalation_v1-room.png
- environmentId: stepdown_room_v1
- bytes: 397839
- centerFigPct: 17.94
- centerPlasterPct: 9.92
- doorPct: 0.00
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 26.15
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `telehealth_diabetes_health_literacy_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/telehealth_diabetes_health_literacy_v1-room.png
- environmentId: telehealth_home_visit_v1
- bytes: 465977
- centerFigPct: 17.17
- centerPlasterPct: 35.28
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 4
- largestStandingSkinPct: 52.75
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

### `ward_delirium_med_rec_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ward_delirium_med_rec_v1-room.png
- environmentId: inpatient_ward_room_v1
- bytes: 607839
- centerFigPct: 25.63
- centerPlasterPct: 31.93
- doorPct: 0.01
- wallOccluded: false
- doorOccluded: false
- unobstructed: true
- standingCount: 3
- largestStandingSkinPct: 23.51
- largestStandingTouchLeft: false
- largestStandingTouchRight: false
- largestStandingTouchBottom: false
- anyStandingTouchRight: true
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

## Before / after

| case | before wall | after wall | before door | after door | before unob | after unob | before clear | after clear | before L/R/B | after L/R/B | after anyR/anyB |
|---|---|---|---|---|---|---|---|---|---|---|---|
| adult_abdominal_pain_v1 | true | false | false | false | false | true | false | true | Y/n/n | n/n/Y | n/Y |
| clinic_abdominal_pain_interpreter_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/n | n/n |
| ed_chest_pain_priority_v1 | false | false | true | false | false | true | false | true | Y/n/n | n/n/n | n/Y |
| ed_chest_pain_priority_v2 | false | false | true | false | false | true | false | true | Y/n/n | n/n/Y | n/Y |
| ed_stroke_alert_handoff_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/Y | n/Y |
| ob_headache_preeclampsia_triage_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/n | n/n |
| oncology_bad_news_family_v1 | false | false | false | false | true | true | true | true | n/Y/n | n/n/Y | n/Y |
| peds_asthma_parent_anxiety_v1 | false | false | false | false | true | true | true | true | n/Y/Y | n/Y/Y | Y/Y |
| peds_fever_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/n | n/Y |
| postop_fever_consult_pressure_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/Y | n/Y |
| primary_care_dyslipidemia_joint_pain_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/n | n/n |
| psych_suicidal_ideation_safety_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/Y | n/Y |
| stepdown_sepsis_nurse_escalation_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/Y | n/Y |
| telehealth_diabetes_health_literacy_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/n | n/n |
| ward_delirium_med_rec_v1 | false | false | false | false | true | true | true | true | n/n/n | n/n/n | n/Y |

L/R/B = largest standing blob touchLeft / touchRight / touchBottom on the
3D canvas (x 0..0.68, y 0.08..0.88). anyR/anyB = any standing blob. Right
and bottom are reported only; they do not enter framesClear.

## Stations

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: true
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: false
- largestStandingContained: true
- framesClear: true

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
- anyStandingTouchRight: false
- anyStandingTouchBottom: true
- largestStandingContained: true
- framesClear: true

claimScope: native refined-interior captures of the fifteen shipped stations
plus one labelled contact sheet; per-actor standing-blob containment and
wall/door occlusion vs the 2026-09-12 actor-frame binding pair; before/after
on docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12.
notEvidenceFor: whether any room admits no camera position satisfying all
four measures; whether the rooms read as clinically plausible spaces; Quest readiness;
whether a sub-threshold sleeve at the canvas/HUD seam is a standing blob.

CLAIM: 3 of 3 named before-frames fail framesClear; 15 of 15 after-frames pass framesClear (!touchLeft). touchRight/touchBottom reported, not gated.
NOT TESTED: Whether any room admits no camera position satisfying all four measures; whether the rooms read as clinically plausible spaces; Quest readiness.
