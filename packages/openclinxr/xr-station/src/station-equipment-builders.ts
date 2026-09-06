/**
 * Parametric equipment geometry builders + dispatcher (#140 / #202).
 *
 * Split from station-equipment.ts so the parent (plan + mount SSOT) stays under
 * the apps/ 600-line zone budget. Family-specific modules own screens/trays/etc.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type ColorRepresentation,
} from "three";
import {
  buildDeviceOnStandFamilyEquipment,
  buildIvPoleFamilyEquipment,
  buildScreenFamilyEquipment,
  buildTrayFamilyEquipment,
  type EquipmentFamily,
} from "./station-equipment-families.js";
import {
  buildAbdominalExamLightEquipment,
  buildEcgMachineEquipment,
  buildIvPumpEquipment,
  buildObservationStationEquipment,
  buildPediatricStretcherEquipment,
  buildPostOpBedEquipment,
} from "./station-equipment-care-stations.js";
import { buildMedicationCartEquipment } from "./station-equipment-medication-cart.js";
import { buildCallBellEquipment, buildPanicButtonEquipment } from "./station-equipment-call-bell.js";
import { buildPrivacyCurtainEquipment } from "./station-equipment-privacy-curtain.js";
import { buildSimpleTableEquipment } from "./station-equipment-tables.js";
import { buildWallSignEquipment } from "./station-equipment-signs.js";
import { buildMedicationBottlesEquipment } from "./station-equipment-medication-bottles.js";
import { buildUrineCupEquipment } from "./station-equipment-urine-cup.js";
import { buildDrainEquipment } from "./station-equipment-drain.js";
import { buildIncentiveSpirometerEquipment } from "./station-equipment-incentive-spirometer.js";
import { buildBloodCultureKitEquipment } from "./station-equipment-blood-culture-kit.js";
import {
  buildHospitalBedEquipment,
  buildSideRailsEquipment,
  buildStretcherEquipment,
} from "./station-equipment-support-surfaces.js";
import {
  buildCurtainTrackEquipment,
  buildHandGelDispenserEquipment,
  buildLightSwitchEquipment,
  buildWallOutletPlateEquipment,
} from "./station-equipment-scale-props.js";
import {
  buildEkgLeadsOnBedEquipment,
  buildSafetyPlanWhiteboardEquipment,
} from "./station-equipment-signs.js";

export {
  buildCurtainTrackEquipment,
  buildHandGelDispenserEquipment,
  buildLightSwitchEquipment,
  buildWallOutletPlateEquipment,
} from "./station-equipment-scale-props.js";
export {
  buildEkgLeadsOnBedEquipment,
  buildSafetyPlanWhiteboardEquipment,
} from "./station-equipment-signs.js";

export type { EquipmentMountSource } from "./station-equipment-clinical-devices.js";

export {
  buildWallClockEquipment,
  buildBedsideMonitorStand,
  buildGltfEquipmentStandSupport,
  buildBedsideMonitorEquipment,
  buildWallMonitorEquipment,
  buildFetalMonitorEquipment,
  buildExamTableEquipment,
  buildBloodPressureCuffEquipment,
  buildAbdominalExamZoneEquipment,
  buildAbdominalDressingEquipment,
  buildGenericClinicalEquipmentFallback,
  buildHandheldDeviceOnStand,
  buildSimpleChairEquipment,
  type ChairVariant,
  type HandheldKind,
  WALL_CLOCK_FACE_DIAMETER_M,
  MONITOR_SCREEN_WIDTH_M,
  EXAM_TABLE_LENGTH_M,
} from "./station-equipment-clinical-devices.js";
import {
  buildAbdominalDressingEquipment,
  buildAbdominalExamZoneEquipment,
  buildBedsideMonitorEquipment,
  buildBedsideMonitorStand,
  buildBloodPressureCuffEquipment,
  buildExamTableEquipment,
  buildFetalMonitorEquipment,
  buildGenericClinicalEquipmentFallback,
  buildGltfEquipmentStandSupport,
  buildHandheldDeviceOnStand,
  buildSimpleChairEquipment,
  buildWallClockEquipment,
  buildWallMonitorEquipment,
  type EquipmentMountSource,
} from "./station-equipment-clinical-devices.js";

/** Shared helpers for the tissue-box + placeholder builders below. */
function mat(color: ColorRepresentation, roughness = 0.55, metalness = 0.12): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function tagEquipmentRoot(
  root: Group,
  equipmentId: string,
  source: EquipmentMountSource,
  family?: EquipmentFamily,
): Group {
  root.userData.openClinXrEquipmentId = equipmentId;
  root.userData.openClinXrEquipmentSource = source;
  root.userData.openClinXrRuntimeEquipmentAssetId = equipmentId;
  root.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
  if (family) root.userData.openClinXrEquipmentFamily = family;
  return root;
}

/**
 * Build multi-mesh geometry for a non-GLB equipment id.
 * Known kinds get recognisable silhouettes; unknown ids get the cart fallback.
 * #202: every declared id is parametric, GLB, or a named family — never silent pole.
 */
export function buildDeclaredEquipmentGeometry(equipmentId: string): Group {
  switch (equipmentId) {
    case "wall_clock_equipment":
      return buildWallClockEquipment(equipmentId);
    case "bedside_monitor_equipment":
      return buildBedsideMonitorEquipment(equipmentId);
    case "monitor_equipment":
      return buildWallMonitorEquipment(equipmentId);
    case "fetal_monitor_equipment":
      return buildFetalMonitorEquipment(equipmentId);
    case "exam_table_equipment":
      return buildExamTableEquipment(equipmentId);
    // #202 deck family: post_op → hospital_bed class; pediatric → stretcher @ child scale.
    case "post_op_bed_equipment":
      return buildPostOpBedEquipment(equipmentId, buildHospitalBedEquipment);
    case "pediatric_stretcher_equipment":
      return buildPediatricStretcherEquipment(equipmentId);
    case "hospital_bed_equipment":
      return buildHospitalBedEquipment(equipmentId);
    case "stretcher_equipment":
      return buildStretcherEquipment(equipmentId);
    case "side_rails_equipment":
      return buildSideRailsEquipment(equipmentId);
    case "blood_pressure_cuff_equipment":
      return buildBloodPressureCuffEquipment(equipmentId);
    case "abdominal_exam_zone_equipment":
      return buildAbdominalExamZoneEquipment(equipmentId);
    case "abdominal_dressing_equipment":
      return buildAbdominalDressingEquipment(equipmentId);
    case "parent_chair_equipment":
      return buildSimpleChairEquipment(equipmentId, "parent");
    case "chairs_equipment":
      return buildSimpleChairEquipment(equipmentId, "clinic");
    case "safe_room_chair_equipment":
      return buildSimpleChairEquipment(equipmentId, "safe_room");
    case "pulse_oximeter_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "pulse_ox");
    case "nebulizer_mask_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "nebulizer");
    case "inhaler_spacer_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "inhaler");
    case "oxygen_wall_port_equipment":
      return buildHandheldDeviceOnStand(equipmentId, "o2_port");
    case "iv_pump_equipment":
      return buildIvPumpEquipment(equipmentId);
    // #202 screens family
    case "ehr_screen_equipment":
      return buildScreenFamilyEquipment(equipmentId, "wall_panel");
    case "lab_results_panel_equipment":
      return buildScreenFamilyEquipment(equipmentId, "cart_monitor");
    case "tablet_visit_equipment":
      return buildScreenFamilyEquipment(equipmentId, "handheld");
    // #202 IV pole
    case "iv_pole_equipment":
      return buildIvPoleFamilyEquipment(equipmentId);
    // #202 trays
    case "antipyretic_tray_equipment":
      return buildTrayFamilyEquipment(equipmentId, "antipyretic");
    case "hydration_supplies_equipment":
      return buildTrayFamilyEquipment(equipmentId, "hydration");
    // #202 medication cart — honest class for "medication cart" prose (was unmapped)
    case "medication_cart_equipment": return buildMedicationCartEquipment(equipmentId);
    case "call_bell_equipment": return buildCallBellEquipment(equipmentId);
    case "panic_button_equipment": return buildPanicButtonEquipment(equipmentId);
    case "privacy_curtain_equipment": return buildPrivacyCurtainEquipment(equipmentId);
    case "small_table_equipment": return buildSimpleTableEquipment(equipmentId, "small_table");
    case "consultation_desk_equipment": return buildSimpleTableEquipment(equipmentId, "consultation_desk");
    case "wall_sign_equipment": return buildWallSignEquipment(equipmentId);
    // #202 medication bottles — telehealth diabetes; honest small-bottle class
    case "medication_bottles_equipment": return buildMedicationBottlesEquipment(equipmentId);
    // #202 urine cup — OB triage; honest specimen-cup class
    case "urine_cup_equipment": return buildUrineCupEquipment(equipmentId);
    // #202 drain — post-op bulb drain; honest surgical-drain class
    case "drain_equipment": return buildDrainEquipment(equipmentId);
    // #202 incentive spirometer — post-op breathing-exercise device
    case "incentive_spirometer_equipment": return buildIncentiveSpirometerEquipment(equipmentId);
    // #202 blood-culture kit — stepdown sepsis; honest 2-bottle collection set
    case "blood_culture_kit_equipment": return buildBloodCultureKitEquipment(equipmentId);
    // #202 device-on-stand
    case "digital_thermometer_equipment": return buildDeviceOnStandFamilyEquipment(equipmentId, "thermometer");
    case "glucometer_review_equipment": return buildDeviceOnStandFamilyEquipment(equipmentId, "glucometer");
    case "oxygen_nasal_cannula_equipment": return buildDeviceOnStandFamilyEquipment(equipmentId, "nasal_cannula");
    case "surgical_consult_phone_equipment": return buildDeviceOnStandFamilyEquipment(equipmentId, "consult_phone");
    // #202 own geometry
    case "observation_station_equipment":
      return buildObservationStationEquipment(equipmentId);
    case "12_lead_ecg_machine_equipment":
      return buildEcgMachineEquipment(equipmentId);
    case "abdominal_exam_light_equipment":
      return buildAbdominalExamLightEquipment(equipmentId);
    case "tissue_box_equipment": {
      const root = new Group();
      root.name = `openclinxr.equipment.${equipmentId}`;
      const box = new Mesh(new BoxGeometry(0.18, 0.1, 0.12), mat(0xfef9c3, 0.75, 0));
      box.position.set(0, 0.9, 0);
      box.name = `${root.name}.box`;
      const slot = new Mesh(new BoxGeometry(0.12, 0.02, 0.04), mat(0xf8fafc, 0.8, 0));
      slot.position.set(0, 0.96, 0);
      slot.name = `${root.name}.slot`;
      const base = new Mesh(new BoxGeometry(0.2, 0.02, 0.14), mat(0xd6d3d1, 0.7, 0));
      base.position.set(0, 0.84, 0);
      base.name = `${root.name}.base`;
      root.add(base, box, slot);
      return tagEquipmentRoot(root, equipmentId, "parametric", "own_geometry");
    }
    // #223 physical roomProps — whiteboard + ECG leads (not pedagogy cues).
    case "safety_plan_whiteboard_equipment":
      return buildSafetyPlanWhiteboardEquipment(equipmentId);
    case "ekg_leads_on_bed_equipment":
      return buildEkgLeadsOnBedEquipment(equipmentId);
    // #347 MADR 0055 item 5 — scale-setting wall props (origin-centred at mount point).
    case "outlet_plate_equipment":
      return buildWallOutletPlateEquipment(equipmentId);
    case "light_switch_equipment":
      return buildLightSwitchEquipment(equipmentId);
    case "hand_gel_dispenser_equipment":
      return buildHandGelDispenserEquipment(equipmentId);
    case "curtain_track_equipment":
      return buildCurtainTrackEquipment(equipmentId);
    default:
      return buildGenericClinicalEquipmentFallback(equipmentId);
  }
}

/** Placeholder slot mesh used under a GLB load (hidden when GLB attaches). */
export function buildGltfEquipmentPlaceholderSlot(equipmentId: string): Group {
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  const body = new Mesh(new BoxGeometry(0.42, 0.72, 0.32), mat(0xf3f5f0, 0.72, 0.05));
  body.position.y = 0.46;
  body.name = `${root.name}.placeholder_body`;
  const accent = new Mesh(new BoxGeometry(0.32, 0.18, 0.04), mat(0x111820, 0.65, 0.1));
  accent.position.set(0, 0.92, -0.18);
  accent.name = `${root.name}.placeholder_accent`;
  root.add(body, accent);
  return tagEquipmentRoot(root, equipmentId, "gltf");
}

