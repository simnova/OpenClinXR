/**
 * Supine overlay composition seam (#171).
 *
 * qFinal = qPlanted * inv(qRef) * qAnimated per owned bone. Split from
 * supine-deck-plant.ts to keep that module under the zone budget.
 */
import { type Object3D, Quaternion } from "three";
import { boneIsOwnedOnRoot, ownedReferenceQuaternionOnRoot } from "./chain-ownership.js";

export type OwnedBoneRotation = { bone: Object3D; quaternion: { x: number; y: number; z: number; w: number } };

export function captureOwnedBoneRotations(humanoidRoot: Object3D): OwnedBoneRotation[] {
  const captured: OwnedBoneRotation[] = [];
  humanoidRoot.traverse((object) => {
    if (!boneIsOwnedOnRoot(humanoidRoot, object.name)) return;
    captured.push({
      bone: object,
      quaternion: { x: object.quaternion.x, y: object.quaternion.y, z: object.quaternion.z, w: object.quaternion.w },
    });
  });
  return captured;
}

export function composeOwnedBoneDeltas(humanoidRoot: Object3D, animated: OwnedBoneRotation[]): void {
  for (const entry of animated) {
    if (!boneIsOwnedOnRoot(humanoidRoot, entry.bone.name)) continue;
    const planted = new Quaternion(
      entry.bone.quaternion.x, entry.bone.quaternion.y, entry.bone.quaternion.z, entry.bone.quaternion.w,
    );
    const reference = ownedReferenceQuaternionOnRoot(humanoidRoot, entry.bone.name);
    if (!reference) continue;
    const qRef = new Quaternion(reference[0], reference[1], reference[2], reference[3]);
    const qAnimated = new Quaternion(entry.quaternion.x, entry.quaternion.y, entry.quaternion.z, entry.quaternion.w);
    const qDelta = qRef.clone().invert().multiply(qAnimated);
    const qFinal = planted.multiply(qDelta);
    entry.bone.quaternion.copy(qFinal);
    entry.bone.rotation.setFromQuaternion(entry.bone.quaternion, entry.bone.rotation.order);
  }
}
