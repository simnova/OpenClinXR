# Station room interior framing (2026-09-12)

Instrument + recapture. Each shipped station is photographed with the
interior-framing camera (reframeCameraForRoom: min stand-off 2× known-good
ED +Z thickness 0.1245 m; no rejected-viewpoint pool) and assembled into
one labelled contact sheet. Rooms, lights, materials, population, and
wait budgets are unchanged.

- tree: `756adb853aa00404ff5b4f3e326cdbb427df7908`
- generatedAt: 2026-09-12T10:39:08.676Z
- renderer: captureStationEnvironmentRooms scene-overview + reframeCameraForRoom
- compositor: buildContactSheet (isolated-subject-harness.ts)
- populationSource: shippedStationIds()
- population: 15
- cells: 15
- interiorCells: 15
- columns: 5
- cellWidth: 640
- cellHeight: 400
- contactSheet: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-contact-sheet-2026-09-12.png
- contactSheetBytes: 1958951
- interiorSdFloor: 33.17 (sqrt(24.5 × 44.9))
- beigeCeiling: 70.05 ((93.0 + 47.1) / 2)
- knownGood: postop_fever_consult_pressure_v1, ward_delirium_med_rec_v1
- centerRegion: left 0.22 top 0.12 width 0.44 height 0.70 of the 1440×900 frame

Count formula: cells = count(### `caseId` rows). framesInterior = centerSd >
interiorSdFloor AND beigePct < beigeCeiling. It is not a clinical grade.

## Stations

### `adult_abdominal_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/adult_abdominal_pain_v1-room.png
- environmentId: adult_ed_abdominal_bay_v1
- bytes: 662706
- centerSd: 56.4
- beigePct: 64.9
- edgePct: 7.4
- framesInterior: true

### `clinic_abdominal_pain_interpreter_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/clinic_abdominal_pain_interpreter_v1-room.png
- environmentId: urgent_care_clinic_room_v1
- bytes: 296391
- centerSd: 81.2
- beigePct: 3.7
- edgePct: 4.0
- framesInterior: true

### `ed_chest_pain_priority_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/ed_chest_pain_priority_v1-room.png
- environmentId: ed_exam_bay_v1
- bytes: 328253
- centerSd: 55.4
- beigePct: 28.5
- edgePct: 3.2
- framesInterior: true

### `ed_chest_pain_priority_v2`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/ed_chest_pain_priority_v2-room.png
- environmentId: ed_exam_bay_v1
- bytes: 312286
- centerSd: 56.2
- beigePct: 27.4
- edgePct: 3.2
- framesInterior: true

### `ed_stroke_alert_handoff_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/ed_stroke_alert_handoff_v1-room.png
- environmentId: ed_stroke_bay_v1
- bytes: 461271
- centerSd: 43.2
- beigePct: 30.9
- edgePct: 3.2
- framesInterior: true

### `ob_headache_preeclampsia_triage_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/ob_headache_preeclampsia_triage_v1-room.png
- environmentId: ob_triage_room_v1
- bytes: 331870
- centerSd: 35.5
- beigePct: 15.9
- edgePct: 3.8
- framesInterior: true

### `oncology_bad_news_family_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/oncology_bad_news_family_v1-room.png
- environmentId: oncology_consult_room_v1
- bytes: 204446
- centerSd: 41.8
- beigePct: 3.6
- edgePct: 1.1
- framesInterior: true

### `peds_asthma_parent_anxiety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/peds_asthma_parent_anxiety_v1-room.png
- environmentId: pediatric_urgent_care_bay_v1
- bytes: 303996
- centerSd: 56.3
- beigePct: 29.8
- edgePct: 3.9
- framesInterior: true

### `peds_fever_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/peds_fever_v1-room.png
- environmentId: pediatric_fever_urgent_care_bay_v1
- bytes: 403832
- centerSd: 65.6
- beigePct: 21.4
- edgePct: 4.3
- framesInterior: true

### `postop_fever_consult_pressure_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/postop_fever_consult_pressure_v1-room.png
- environmentId: surgical_ward_room_v1
- bytes: 516080
- centerSd: 69.3
- beigePct: 25.4
- edgePct: 4.7
- framesInterior: true

### `primary_care_dyslipidemia_joint_pain_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/primary_care_dyslipidemia_joint_pain_v1-room.png
- environmentId: primary_care_clinic_room_v1
- bytes: 373737
- centerSd: 80.7
- beigePct: 11.2
- edgePct: 2.2
- framesInterior: true

### `psych_suicidal_ideation_safety_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/psych_suicidal_ideation_safety_v1-room.png
- environmentId: behavioral_health_private_room_v1
- bytes: 324698
- centerSd: 45.4
- beigePct: 22.5
- edgePct: 2.8
- framesInterior: true

### `stepdown_sepsis_nurse_escalation_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/stepdown_sepsis_nurse_escalation_v1-room.png
- environmentId: stepdown_room_v1
- bytes: 328683
- centerSd: 82.2
- beigePct: 9.3
- edgePct: 4.3
- framesInterior: true

### `telehealth_diabetes_health_literacy_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/telehealth_diabetes_health_literacy_v1-room.png
- environmentId: telehealth_home_visit_v1
- bytes: 442545
- centerSd: 55.5
- beigePct: 25.4
- edgePct: 4.4
- framesInterior: true

### `ward_delirium_med_rec_v1`
- image: docs/openclinxr/humanoid-vetting-captures/station-rooms-interior-2026-09-12/ward_delirium_med_rec_v1-room.png
- environmentId: inpatient_ward_room_v1
- bytes: 556681
- centerSd: 67.0
- beigePct: 30.4
- edgePct: 5.8
- framesInterior: true

claimScope: native interior-framed captures of the fifteen shipped stations
plus one labelled contact sheet; center-viewport occupancy vs the wall/interior
binding pair measured on the 2026-09-12 doorway-wall frames.
notEvidenceFor: whether any environment genuinely lacks clinical furniture;
Quest readiness; whether the rooms read as clinically plausible spaces.

CLAIM: 15 of 15 shipped station captures frame the room interior (centerSd > 33.17, beigePct < 70.05).
NOT TESTED: Whether any environment genuinely lacks clinical furniture; Quest readiness; whether the rooms read as clinically plausible spaces.
