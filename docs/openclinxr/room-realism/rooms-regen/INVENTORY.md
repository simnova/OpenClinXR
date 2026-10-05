# Shipped encounter-room regeneration inventory

Measured against `b0bc59909` before regeneration. `Footprint / height` is the complete shipped GLB scene AABB (`X × Z / Y`) measured with trimesh 5.0.0, so finish/door projections make the two already-factory-generated rooms slightly larger than their fixed input footprints. Provenance details and source-room dimensions remain authoritative in `apps/ui-xr/public/xr-assets/environment/PROVENANCE.md`.

| Environment ID | Shipped GLB | Scenario(s) | Footprint / height (m) | Door state and position | Current shipped provenance | Multi-case runner |
|---|---|---|---:|---|---|---|
| `adult_ed_abdominal_bay_v1` | `infinigen-adult-ed-abdominal-bay.glb` | `adult_abdominal_pain_v1` | 6.50 × 6.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 0, kitchen 0/0 yaw 90, local albedo/AO | yes |
| `behavioral_health_private_room_v1` | `infinigen-behavioral-health-private.glb` | `psych_suicidal_ideation_safety_v1` | 5.00 × 6.00 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 16, dining 0/0 yaw 90, local albedo/AO | yes |
| `ed_exam_bay_v1` | `infinigen-ed-exam-bay.glb` | `ed_chest_pain_priority_v1`, `ed_chest_pain_priority_v2` | 3.00 × 6.00 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 22, bedroom 0/2 yaw 90, local albedo/AO | yes (both) |
| `ed_stroke_bay_v1` | `infinigen-ed-stroke-bay.glb` | `ed_stroke_alert_handoff_v1` | 7.00 × 7.00 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 2, bedroom 0/1 yaw 0, local albedo/AO | yes |
| `inpatient_ward_room_v1` | `infinigen-inpatient-ward.glb` | `ward_delirium_med_rec_v1` | 4.52 × 4.44 / 2.62 | 1 leaf; recipe +Y wall, +0.25 m | Infinigen BSD-3-Clause, room chain seed 205, fixed 4.3 × 3.9 × 2.4 | yes |
| `ob_triage_room_v1` | `infinigen-ob-triage.glb` | `ob_headache_preeclampsia_triage_v1` | 6.00 × 5.00 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 27, dining 0/0 yaw 180, local albedo/AO | yes |
| `oncology_consult_room_v1` | `infinigen-oncology-consult.glb` | `oncology_bad_news_family_v1` | 5.50 × 5.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 17, dining 0/0 yaw 0, local albedo/AO | yes |
| `pediatric_fever_urgent_care_bay_v1` | `infinigen-pediatric-fever-urgent-care.glb` | `peds_fever_v1` | 6.50 × 6.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 34, bedroom 0/1 yaw 0, local albedo/AO | yes |
| `pediatric_urgent_care_bay_v1` | `infinigen-pediatric-urgent-care-bay.glb` | `peds_asthma_parent_anxiety_v1` | 5.50 × 5.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, recorded seed 13, kitchen 0/0 yaw 90, local albedo/AO | yes |
| `primary_care_clinic_room_v1` | `infinigen-primary-care-clinic.glb` | `primary_care_dyslipidemia_joint_pain_v1` | 6.50 × 6.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 1, bedroom 0/2 yaw 0, local albedo/AO | yes |
| `stepdown_room_v1` | `infinigen-stepdown.glb` | `stepdown_sepsis_nurse_escalation_v1` | 6.42 × 3.79 / 2.82 | 1 leaf; recipe +Y wall, +0.25 m | Infinigen BSD-3-Clause, room chain seed 205, fixed 6.2 × 3.25 × 2.6 | yes |
| `surgical_ward_room_v1` | `infinigen-surgical-ward.glb` | `postop_fever_consult_pressure_v1` | 7.50 × 7.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 25, bedroom 0/0 yaw 90, local albedo/AO | yes |
| `telehealth_home_visit_v1` | `infinigen-telehealth-home-visit.glb` | `telehealth_diabetes_health_literacy_v1` | 9.50 × 6.50 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 14, bedroom 0/2 yaw 180, local albedo/AO | yes |
| `urgent_care_clinic_room_v1` | `infinigen-urgent-care-clinic.glb` | `clinic_abdominal_pain_interpreter_v1` | 7.50 × 8.00 / 2.65 | 0 authored leaves; +Z entrance convention, opening offset not semantic | Infinigen BSD-3-Clause, seed 22, bedroom 0/0 yaw 270, local albedo/AO | yes |

## What `ed-exam-bay-shell.glb` is

It is not a fifteenth `environmentId` room and is excluded from fleet regeneration. It is a repo-authored Blender compatibility fixture produced by `tools/openclinxr/evidence/environment-artifacts.ts`, with an AABB of 9.070 × 4.015 / 5.320 m including its fixtures. It has a centered +Z doorway threshold, header and jamb reveal but no authored door leaf. `resolveLocalEnvironmentRuntimeAssetFileName` maps only the historical `ed.glb` and `ed_environment.glb` names to it; normal ED scenarios resolve `ed_exam_bay_v1` to `infinigen-ed-exam-bay.glb`.

## Door interpretation

The twelve pre-chain Infinigen GLBs were generated with `no_objects`: they contain no semantic door leaf or casing nodes. Their provenance establishes a +Z doorway/camera side, but the opening offset is not recoverable as an authored door position, so the inventory records it as `null` rather than inventing precision. The ward and step-down assets are the only current room-chain outputs and each contains one complete hospital-door assembly at the recipe’s logical +Y wall / +0.25 m offset.
