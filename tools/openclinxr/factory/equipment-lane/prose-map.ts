/**
 * Scenario-bank prose labels → runtime equipmentId.
 * Incomplete maps surface as unmappedProse in the catalogue (fail closed later).
 */

/** Lowercased prose → equipmentId */
export const PROSE_TO_EQUIPMENT_ID: Readonly<Record<string, string>> = {
  "12-lead ecg machine": "12_lead_ecg_machine_equipment",
  "bedside monitor": "bedside_monitor_equipment",
  monitor: "monitor_equipment",
  stretcher: "stretcher_equipment",
  "pediatric stretcher": "pediatric_stretcher_equipment",
  "hospital bed": "hospital_bed_equipment",
  "post-op bed": "post_op_bed_equipment",
  "ob triage bed": "hospital_bed_equipment",
  "iv pole": "iv_pole_equipment",
  "iv pump": "iv_pump_equipment",
  "wall clock": "wall_clock_equipment",
  "oxygen nasal cannula": "oxygen_nasal_cannula_equipment",
  "oxygen cannula": "oxygen_nasal_cannula_equipment",
  "pulse oximeter": "pulse_oximeter_equipment",
  "nebulizer mask": "nebulizer_mask_equipment",
  "inhaler spacer": "inhaler_spacer_equipment",
  "oxygen wall port": "oxygen_wall_port_equipment",
  "parent chair": "parent_chair_equipment",
  chairs: "chairs_equipment",
  "two chairs": "chairs_equipment",
  "family chair": "chairs_equipment",
  "exam table": "exam_table_equipment",
  "fetal monitor": "fetal_monitor_equipment",
  "blood-pressure cuff": "blood_pressure_cuff_equipment",
  "blood pressure cuff": "blood_pressure_cuff_equipment",
  "side rails": "side_rails_equipment",
  "abdominal exam zone": "abdominal_exam_zone_equipment",
  "abdominal dressing": "abdominal_dressing_equipment",
  "abdominal exam light": "abdominal_exam_light_equipment",
  "ehr screen": "ehr_screen_equipment",
  "lab results panel": "lab_results_panel_equipment",
  "digital thermometer": "digital_thermometer_equipment",
  "antipyretic tray": "antipyretic_tray_equipment",
  "hydration supplies": "hydration_supplies_equipment",
  "tissue box": "tissue_box_equipment",
  "surgical consult phone": "surgical_consult_phone_equipment",
  whiteboard: "safety_plan_whiteboard_equipment",
  "glucose meter": "glucometer_review_equipment",
  // Honest secondary maps (same class of object)
  "observation checklist": "observation_station_equipment",
  "vitals panel": "bedside_monitor_equipment",
  "vitals board": "bedside_monitor_equipment",
  "simulated ehr panel": "ehr_screen_equipment",
  "video visit frame": "tablet_visit_equipment",
  "tablet interpreter station": "tablet_visit_equipment",
  "ehr laptop": "ehr_screen_equipment",
  "imaging report panel": "lab_results_panel_equipment",
  "medication list": "ehr_screen_equipment",
  "home glucose log": "glucometer_review_equipment",
  "caption panel": "ehr_screen_equipment",
  "low-bandwidth indicator": "tablet_visit_equipment",
  // Dedicated thin parametric id (family "medication_cart") — honest class, not ECG cart.
  "medication cart": "medication_cart_equipment",
  // Deliberately NOT mapped (appear as unmappedProse until real ids exist):
  // privacy curtain/notice, call light/bell, panic button, small table,
  // consultation desk, joint diagram, medication bottles, urine cup,
  // blood-culture kit, neuro exam card, CT/fall-risk/sepsis signs,
  // drain, soft lighting, incentive spirometer — factory honesty > silent fallback.
};

export function resolveProseToEquipmentId(prose: string): string | null {
  const key = prose.trim().toLowerCase();
  return PROSE_TO_EQUIPMENT_ID[key] ?? null;
}
