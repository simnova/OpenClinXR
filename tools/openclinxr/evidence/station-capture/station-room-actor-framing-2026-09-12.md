# Station room actor framing (2026-09-12)

Instrument + recapture. Each shipped station is photographed with the
elevated interior camera (reframeCameraForRoom: eyeY standing-eye 1.68 m
capped 0.5 m below the ceiling, look y=1.0; 2.0 m readable nearest-actor
floor; zMid candidate ring; floor/ceiling tris do not reject) so people
visible. Rooms, lights, materials, population, wait budgets, and
interior-wall thresholds are unchanged.

- tree: `8b93e810c4c20c129714d1f9fee727ee23cec1dd`
- generatedAt: 2026-09-12T12:10:05.994Z
- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom
- compositor: buildContactSheet (isolated-subject-harness.ts)
- populationSource: shippedStationIds()
- population: 15
- cells: 15
- actorCells: 15
- columns: 5
- cellWidth: 640
- cellHeight: 400
- contactSheet: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-contact-sheet-2026-09-12.png
- contactSheetBytes: 2065906
- headFigureFloor: 4.17 (sqrt(1.91 × 9.11))
- knownGood: peds_asthma_parent_anxiety_v1, stepdown_sepsis_nurse_escalation_v1
- headBand: y 0.08..0.64 of the 1440×900 frame (upper 70% of 3D canvas)
- canvas: x 0..0.68 y 0.08..0.88

Count formula: cells = count(### `caseId` rows). framesActors = headFigurePct >
headFigureFloor. It is not a clinical grade.

## Stations

### `adult_abdominal_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/adult_abdominal_pain_v1-room.png
- environmentId: adult_ed_abdominal_bay_v1
- bytes: 709022
- headFigurePct: 5.49
- floorFloorPct: 75.64
- bottomFigurePct: 1.98
- framesActors: true

### `clinic_abdominal_pain_interpreter_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/clinic_abdominal_pain_interpreter_v1-room.png
- environmentId: urgent_care_clinic_room_v1
- bytes: 311648
- headFigurePct: 7.09
- floorFloorPct: 99.74
- bottomFigurePct: 0.24
- framesActors: true

### `ed_chest_pain_priority_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ed_chest_pain_priority_v1-room.png
- environmentId: ed_exam_bay_v1
- bytes: 310405
- headFigurePct: 30.52
- floorFloorPct: 66.35
- bottomFigurePct: 21.71
- framesActors: true

### `ed_chest_pain_priority_v2`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ed_chest_pain_priority_v2-room.png
- environmentId: ed_exam_bay_v1
- bytes: 297193
- headFigurePct: 30.53
- floorFloorPct: 67.05
- bottomFigurePct: 21.03
- framesActors: true

### `ed_stroke_alert_handoff_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ed_stroke_alert_handoff_v1-room.png
- environmentId: ed_stroke_bay_v1
- bytes: 532678
- headFigurePct: 24.11
- floorFloorPct: 89.51
- bottomFigurePct: 2.80
- framesActors: true

### `ob_headache_preeclampsia_triage_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ob_headache_preeclampsia_triage_v1-room.png
- environmentId: ob_triage_room_v1
- bytes: 278535
- headFigurePct: 8.83
- floorFloorPct: 90.29
- bottomFigurePct: 3.76
- framesActors: true

### `oncology_bad_news_family_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/oncology_bad_news_family_v1-room.png
- environmentId: oncology_consult_room_v1
- bytes: 264425
- headFigurePct: 6.18
- floorFloorPct: 93.14
- bottomFigurePct: 4.57
- framesActors: true

### `peds_asthma_parent_anxiety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/peds_asthma_parent_anxiety_v1-room.png
- environmentId: pediatric_urgent_care_bay_v1
- bytes: 340665
- headFigurePct: 28.55
- floorFloorPct: 80.88
- bottomFigurePct: 16.73
- framesActors: true

### `peds_fever_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/peds_fever_v1-room.png
- environmentId: pediatric_fever_urgent_care_bay_v1
- bytes: 469501
- headFigurePct: 16.55
- floorFloorPct: 80.93
- bottomFigurePct: 14.58
- framesActors: true

### `postop_fever_consult_pressure_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/postop_fever_consult_pressure_v1-room.png
- environmentId: surgical_ward_room_v1
- bytes: 581984
- headFigurePct: 14.84
- floorFloorPct: 82.54
- bottomFigurePct: 10.50
- framesActors: true

### `primary_care_dyslipidemia_joint_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/primary_care_dyslipidemia_joint_pain_v1-room.png
- environmentId: primary_care_clinic_room_v1
- bytes: 387847
- headFigurePct: 12.32
- floorFloorPct: 87.89
- bottomFigurePct: 9.87
- framesActors: true

### `psych_suicidal_ideation_safety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/psych_suicidal_ideation_safety_v1-room.png
- environmentId: behavioral_health_private_room_v1
- bytes: 363304
- headFigurePct: 25.94
- floorFloorPct: 87.02
- bottomFigurePct: 5.88
- framesActors: true

### `stepdown_sepsis_nurse_escalation_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/stepdown_sepsis_nurse_escalation_v1-room.png
- environmentId: stepdown_room_v1
- bytes: 397839
- headFigurePct: 14.20
- floorFloorPct: 76.85
- bottomFigurePct: 22.95
- framesActors: true

### `telehealth_diabetes_health_literacy_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/telehealth_diabetes_health_literacy_v1-room.png
- environmentId: telehealth_home_visit_v1
- bytes: 465977
- headFigurePct: 5.90
- floorFloorPct: 68.62
- bottomFigurePct: 7.44
- framesActors: true

### `ward_delirium_med_rec_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-actors-2026-09-12/ward_delirium_med_rec_v1-room.png
- environmentId: inpatient_ward_room_v1
- bytes: 607839
- headFigurePct: 12.31
- floorFloorPct: 67.91
- bottomFigurePct: 30.54
- framesActors: true

claimScope: native elevated-interior captures of the fifteen shipped stations
plus one labelled contact sheet; upper-canvas figure occupancy vs the
shin-crop / known-good binding pair measured on the 2026-09-12 interior frames.
notEvidenceFor: whether any environment is too small to frame its actors legally;
whether the rooms read as clinically plausible spaces; Quest readiness.

CLAIM: 15 of 15 shipped station captures frame actors head-to-foot (headFigurePct > 4.17).
NOT TESTED: Whether any environment is too small to frame its actors legally; whether the rooms read as clinically plausible spaces; Quest readiness.
