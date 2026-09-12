# Station room occlusion and containment (2026-09-12)

Instrument + recapture. Each shipped station is photographed with the
elevated interior camera, then refineCameraForOcclusionAndContainment
orbits inside the interior AABB until standing actors (world AABB height
>= 1.15 m) are unoccluded and not left-clipped. Rooms, lights, materials,
population, wait budgets, and existing interior/actor-band thresholds are
unchanged. UI text bleeding over the canvas is named, not fixed here.

- tree: `fba57fb91a507295bdafa847be5c0858d65c2831`
- generatedAt: 2026-09-12T12:50:55.255Z
- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom + refineCameraForOcclusionAndContainment
- compositor: buildContactSheet (isolated-subject-harness.ts)
- populationSource: shippedStationIds()
- population: 15
- cells: 15
- clearCells: 15
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

Count formula: cells = count(### `caseId` rows). framesClear = unobstructed
(not wallOccluded and not doorOccluded) AND largest standing blob contained
(!touchLeft and skinInHeadBandPct > standingSkinFloor). Per-actor blobs, not
a band percentage. Recumbent bed actors may clip the left edge. HUD text
overlay on the right of the 3D canvas is named, not gated.

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
- largestStandingContained: true
- framesClear: true

claimScope: native refined-interior captures of the fifteen shipped stations
plus one labelled contact sheet; per-actor standing-blob containment and
wall/door occlusion vs the 2026-09-12 actor-frame binding pair.
notEvidenceFor: whether any room admits no camera position satisfying all
four measures; whether the rooms read as clinically plausible spaces; Quest readiness.

CLAIM: 15 of 15 shipped station captures have an unobstructed view of standing actors contained in the frame.
NOT TESTED: Whether any room admits no camera position satisfying all four measures; whether the rooms read as clinically plausible spaces; Quest readiness.
