/**
 * Virtual-device actor affordance (#81 extract from main.ts freeze).
 */

import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from "three";

export type VirtualDevicePlacement = {
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  labelPrefix: string;
};

export function createVirtualDeviceActorAffordance(input: {
  actorId: string;
  placement: VirtualDevicePlacement;
  createAffordanceMarker: (id: string, color: number) => Object3D;
  createActorNameplate: (label: string, accentColor: number) => Object3D;
  actorNameplateLabel: (prefix: string, actorId: string) => string;
  registerSlot: (actorId: string, group: Group) => void;
}): Group {
  const { actorId, placement } = input;
  const group = new Group();
  group.name = `openclinxr.virtual-device-actor.${actorId}`;
  group.position.set(placement.position.x, placement.position.y + 0.18, placement.position.z);
  group.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
  const tablet = new Mesh(
    new BoxGeometry(0.38, 0.28, 0.035),
    new MeshStandardMaterial({ color: 0x101820, emissive: 0x12324a, roughness: 0.5 }),
  );
  tablet.name = `${group.name}.tablet-body`;
  const screen = new Mesh(
    new PlaneGeometry(0.32, 0.21),
    new MeshBasicMaterial({ color: 0x79d4ff, transparent: true, opacity: 0.88, side: DoubleSide }),
  );
  screen.name = `${group.name}.remote-screen`;
  screen.position.set(0, 0, -0.021);
  group.add(tablet, screen);
  const marker = input.createAffordanceMarker(`${actorId}:virtual_device_dialogue_target`, 0x79d4ff);
  marker.position.set(0, 0.22, 0);
  group.add(marker);
  const labelPlate = input.createActorNameplate(
    input.actorNameplateLabel(placement.labelPrefix, actorId),
    0x79d4ff,
  );
  labelPlate.position.set(0, 0.38, 0);
  labelPlate.scale.set(0.42, 0.42, 0.42);
  group.add(labelPlate);
  group.userData.openClinXrVirtualDeviceActor = actorId;
  group.userData.openClinXrAffordances = ["virtual_device_dialogue_target", "remote_actor_presence_cue"];
  input.registerSlot(actorId, group);
  return group;
}
