/**
 * #185 — room-prop geometry: consult parametric equipment builders (no dual SSOT).
 *
 * POSITION from manifest. SCALE ignored for builder-backed props (builders emit metric
 * geometry; manifest scale is a box-proxy dimension). Marker/nameplate from builder AABB.
 * openClinXrEquipmentSource = "parametric" when builder-backed, else "fallback".
 *
 * XOR: callers must not mount a room prop whose equipment id is already on the equipment
 * plan (see createDetailedEdRoomProps / exclusiveMountedEquipmentIds).
 *
 * claimScope: room-prop channel consumes station-equipment-builders.
 * notEvidenceFor: clinical staging, Quest readiness, art realism.
 */

import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import {
  buildDeclaredEquipmentGeometry,
  resolveRoomPropBuilderEquipmentId,
} from "./station-equipment.js";

export {
  hasDeclaredEquipmentBuilderArm,
  listDeclaredEquipmentBuilderArms,
  resolveRoomPropBuilderEquipmentId,
} from "./station-equipment.js";

export type RoomPropVector3 = { x: number; y: number; z: number };

export type BuildRoomPropInput = {
  propId: string;
  color: number;
  accentColor: number;
  position: RoomPropVector3;
  scale: RoomPropVector3;
  label: string;
  affordanceCueIds: string[];
  /** Scene object name prefix (e.g. openclinxr.<scenario>.room-prop). */
  namePrefix: string;
  /**
   * Equipment ids already mounted by planStationEquipmentMounts.
   * When propId is in this set, returns null (XOR exclusive-mount).
   */
  exclusiveMountedEquipmentIds?: ReadonlySet<string> | ReadonlyArray<string>;
  createAffordanceMarker: (cueId: string, accentColor: number) => Object3D;
  createActorNameplate: (label: string, accentColor: number) => Object3D;
  /**
   * Optional fallback detail silhouettes (chair/whiteboard/etc.) for unit-box props only.
   * Builder-backed props skip this — the builder owns the silhouette.
   */
  addFallbackDetailVisuals?: (
    group: Group,
    propId: string,
    label: string,
    scale: RoomPropVector3,
    color: number,
    accentColor: number,
  ) => void;
};

/**
 * Build a room-prop root, or null when XOR suppresses (already equipment-mounted).
 */
export function buildRoomPropGroup(input: BuildRoomPropInput): Group | null {
  const exclusive = toSet(input.exclusiveMountedEquipmentIds);
  const builderId = resolveRoomPropBuilderEquipmentId(input.propId);
  // XOR: suppress when this propId OR its resolved builder arm is already equipment-mounted.
  if (exclusive.has(input.propId) || (builderId !== null && exclusive.has(builderId))) {
    return null;
  }

  const group = new Group();
  group.name = `${input.namePrefix}.${input.propId}`;
  group.position.set(input.position.x, input.position.y, input.position.z);
  group.userData.openClinXrBaseY = input.position.y;

  let markerY = input.scale.y + 0.08;
  let labelY = input.scale.y + 0.18;

  if (builderId !== null) {
    // Metric builder geometry — ignore manifest scale (box-proxy dimensions).
    const geometry = buildDeclaredEquipmentGeometry(builderId);
    geometry.name = `${group.name}.builder`;
    // Collapse equipment identity onto the room-prop root only — nested builder tags would
    // register as a second openClinXrEquipmentId root (XOR false dual).
    if (typeof geometry.userData.openClinXrEquipmentFamily === "string") {
      group.userData.openClinXrEquipmentFamily = geometry.userData.openClinXrEquipmentFamily;
    }
    delete geometry.userData.openClinXrEquipmentId;
    delete geometry.userData.openClinXrRuntimeEquipmentAssetId;
    delete geometry.userData.openClinXrEquipmentSource;
    group.add(geometry);
    // Tag the room-prop ROOT so exclusive-mount / #209 inspectors key one surface.
    // Keep manifest propId as openClinXrEquipmentId (declared id identity).
    group.userData.openClinXrEquipmentSource = "parametric";
    group.userData.openClinXrEquipmentId = input.propId;
    group.userData.openClinXrRuntimeEquipmentAssetId = input.propId;
    group.userData.openClinXrRoomPropBuilderEquipmentId = builderId;
    group.userData.openClinXrRoomPropFulfillsDeclaredEquipment = true;
    group.userData.openClinXrRoomPropUsedBuilder = true;

    group.updateMatrixWorld(true);
    const aabb = new Box3().setFromObject(group);
    if (!aabb.isEmpty()) {
      const size = new Vector3();
      aabb.getSize(size);
      // Markers above local top of builder AABB (group is at prop position).
      const localTop = aabb.max.y - group.position.y;
      markerY = localTop + 0.08;
      labelY = localTop + 0.18;
      group.userData.openClinXrBuilderAabbHeight = size.y;
    }
  } else {
    const body = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: input.color, roughness: 0.7 }),
    );
    body.name = `${group.name}.body`;
    body.scale.set(input.scale.x, input.scale.y, input.scale.z);
    group.add(body);
    input.addFallbackDetailVisuals?.(
      group,
      input.propId,
      input.label,
      input.scale,
      input.color,
      input.accentColor,
    );
    group.userData.openClinXrEquipmentId = input.propId;
    group.userData.openClinXrRuntimeEquipmentAssetId = input.propId;
    group.userData.openClinXrEquipmentSource = "fallback";
    group.userData.openClinXrRoomPropFulfillsDeclaredEquipment = true;
    group.userData.openClinXrRoomPropUsedBuilder = false;
  }

  const cueId = input.affordanceCueIds[0] ?? `${input.propId}:visual_context`;
  const marker = input.createAffordanceMarker(cueId, input.accentColor);
  marker.position.set(0, markerY, 0);
  group.add(marker);

  const labelPlate = input.createActorNameplate(input.label, input.accentColor);
  labelPlate.name = `${group.name}.label`;
  labelPlate.position.set(0, labelY, 0);
  labelPlate.scale.set(0.48, 0.48, 0.48);
  group.add(labelPlate);

  group.userData.openClinXrAffordances = [
    "room_context_cue",
    "clinical_environment_reference",
    "runtime_scene_manifest_prop",
  ];
  group.userData.openClinXrRuntimeSceneManifestAffordanceCueIds = input.affordanceCueIds;
  group.userData.openClinXrDynamicEncounterAssetPolicy =
    "room_prop_rendered_from_active_encounter_scene_manifest_not_hardcoded_shared_world";

  return group;
}

function toSet(
  ids: ReadonlySet<string> | ReadonlyArray<string> | undefined,
): Set<string> {
  if (!ids) return new Set();
  return ids instanceof Set ? ids : new Set(ids);
}
