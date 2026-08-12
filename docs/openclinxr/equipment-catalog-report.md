# Equipment catalogue report

MADRs: 0054, 0055 · schema `openclinxr.equipment-catalog.v1`

- measuredAt: 2026-08-12T03:59:40.222Z
- scenarios: 14
- equipment rows: 39
- lanes: {"bank":4,"thin_parametric":34,"modular_kit":1}
- runtimeSource: {"parametric":35,"gltf":4}
- unmapped prose: 19
- gltf missing on disk: 0

## Blueprints (14 scenario-bank cases)

### adult_abdominal_pain_v1

- abdominal_exam_light_equipment (thin_parametric/parametric)
- bedside_monitor_equipment (bank/gltf)
- iv_pole_equipment (thin_parametric/parametric)
- stretcher_equipment (thin_parametric/parametric)
- surgical_consult_phone_equipment (thin_parametric/parametric)
- wall_clock_equipment (bank/gltf)

### clinic_abdominal_pain_interpreter_v1

- abdominal_exam_zone_equipment (thin_parametric/parametric)
- bedside_monitor_equipment (bank/gltf)
- exam_table_equipment (thin_parametric/parametric)
- tablet_visit_equipment (thin_parametric/parametric)

### ed_chest_pain_priority_v1

- 12_lead_ecg_machine_equipment (modular_kit/parametric)
- bedside_monitor_equipment (bank/gltf)
- iv_pole_equipment (thin_parametric/parametric)
- oxygen_nasal_cannula_equipment (thin_parametric/parametric)
- stretcher_equipment (thin_parametric/parametric)
- wall_clock_equipment (bank/gltf)

### ed_stroke_alert_handoff_v1

- bedside_monitor_equipment (bank/gltf)
- chairs_equipment (thin_parametric/parametric)
- glucometer_review_equipment (thin_parametric/parametric)
- wall_clock_equipment (bank/gltf)

### ob_headache_preeclampsia_triage_v1

- blood_pressure_cuff_equipment (thin_parametric/parametric)
- fetal_monitor_equipment (thin_parametric/parametric)
- hospital_bed_equipment (thin_parametric/parametric)

### oncology_bad_news_family_v1

- chairs_equipment (thin_parametric/parametric)
- lab_results_panel_equipment (thin_parametric/parametric)
- tissue_box_equipment (thin_parametric/parametric)

### peds_asthma_parent_anxiety_v1

- inhaler_spacer_equipment (thin_parametric/parametric)
- nebulizer_mask_equipment (thin_parametric/parametric)
- oxygen_wall_port_equipment (thin_parametric/parametric)
- parent_chair_equipment (thin_parametric/parametric)
- pediatric_stretcher_equipment (thin_parametric/parametric)
- pulse_oximeter_equipment (thin_parametric/parametric)

### peds_fever_v1

- antipyretic_tray_equipment (thin_parametric/parametric)
- digital_thermometer_equipment (thin_parametric/parametric)
- hydration_supplies_equipment (thin_parametric/parametric)
- parent_chair_equipment (thin_parametric/parametric)
- pediatric_stretcher_equipment (thin_parametric/parametric)
- pulse_oximeter_equipment (thin_parametric/parametric)

### postop_fever_consult_pressure_v1

- abdominal_dressing_equipment (thin_parametric/parametric)
- bedside_monitor_equipment (bank/gltf)
- ehr_screen_equipment (thin_parametric/parametric)
- post_op_bed_equipment (thin_parametric/parametric)

### primary_care_dyslipidemia_joint_pain_v1

- chairs_equipment (thin_parametric/parametric)
- ehr_screen_equipment (thin_parametric/parametric)
- exam_table_equipment (thin_parametric/parametric)
- lab_results_panel_equipment (thin_parametric/parametric)

### psych_suicidal_ideation_safety_v1

- chairs_equipment (thin_parametric/parametric)
- observation_station_equipment (thin_parametric/parametric)
- tissue_box_equipment (thin_parametric/parametric)

### stepdown_sepsis_nurse_escalation_v1

- iv_pump_equipment (thin_parametric/parametric)
- monitor_equipment (thin_parametric/parametric)
- oxygen_nasal_cannula_equipment (thin_parametric/parametric)

### telehealth_diabetes_health_literacy_v1

- ehr_screen_equipment (thin_parametric/parametric)
- glucometer_review_equipment (thin_parametric/parametric)
- tablet_visit_equipment (thin_parametric/parametric)

### ward_delirium_med_rec_v1

- ehr_screen_equipment (thin_parametric/parametric)
- hospital_bed_equipment (thin_parametric/parametric)
- iv_pump_equipment (thin_parametric/parametric)
- safety_plan_whiteboard_equipment (thin_parametric/parametric)
- side_rails_equipment (thin_parametric/parametric)

## Bank lane

- `bedside_monitor_equipment` → `bedside-monitor-generated.glb`
- `ecg_cart_equipment` → `ecg-cart-12-lead.glb`
- `iv_stand_equipment` → `iv-pole-with-pump.glb`
- `wall_clock_equipment` → `wall-clock-analog.glb`

## Modular kit lane

- `12_lead_ecg_machine_equipment` recipe=`ecg_cart_midband_v1_pending_merge` — kit on feature/equipment-kit-approach-b — catalogue provisional modular_kit

## Next gaps (priority)

- Deck surfaces still thin_parametric: hospital_bed, stretcher, pediatric_stretcher, post_op_bed (prefer lane-1 bank GLB when licence-green mid-band exists)
- ECG modular kit pending merge from feature/equipment-kit-approach-b
- Weak prose maps (curtains/signs to whiteboard; medication cart to ECG class) need dedicated ids or honest props

claimScope: equipment three-lane catalogue over scenario-bank blueprints + runtime builders (MADR 0054/0055)
notEvidenceFor: clinical_accuracy, quest_readiness, exam_equivalence, photoreal_match
