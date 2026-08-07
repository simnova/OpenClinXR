/**
 * Live world-space measures for articulating head-of-bed (#159).
 * Used by the isolated-subject lab after the render loop advances.
 *
 * claimScope: staging incline geometry metrics.
 * notEvidenceFor: clinical positioning correctness, multi-joint bed fidelity.
 */

import { Box3, Mesh, Object3D, Vector3 } from "three";
import {
  STRETCHER_DECK_TOP_METERS,
  findProceduralStretcher,
  readStretcherBackSectionWorldDeg,
  readStretcherDeckSectionNames,
  readStretcherInclineDegrees,
} from "./station-stretcher.js";
import { readSupineTorsoWorldDeg } from "./supine-pose.js";

export type ArticulatingHobMeasure = {
  requestedDeg: number;
  backSectionWorldDeg: number;
  torsoWorldDeg: number;
  /** Largest gap body-back → back-section plane (m). Negative = penetration. */
  backToDeckGapMeters: number;
  pelvisOnSeatSection: boolean;
  railsClippingTorso: boolean;
  framesAdvanced: number;
  deckSectionNames: string[];
  inclineSsot: number;
};

function findHumanoid(root: Object3D): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.userData?.openClinXrIsolatedSubject === true || obj.name === "isolated_subject_humanoid") {
      found = obj;
    }
  });
  return found;
}

/**
 * Signed gap: body back surface vs back-section top plane.
 * Positive = floating above deck; negative = penetrating.
 * Uses skinned mesh vertices (not bone centers) so plant contact reads near zero.
 */
function measureBackToDeckGap(humanoid: Object3D, stretcher: Object3D): number {
  stretcher.updateMatrixWorld(true);
  humanoid.updateMatrixWorld(true);

  const backPivotBox: { current: Object3D | null } = { current: null };
  stretcher.traverse((obj) => {
    if (backPivotBox.current) return;
    if (obj.userData?.openClinXrDeckSection === "back") backPivotBox.current = obj;
  });
  const backPivot = backPivotBox.current;
  let origin = new Vector3(0, STRETCHER_DECK_TOP_METERS, 0);
  let normal = new Vector3(0, 1, 0);
  if (backPivot) {
    backPivot.updateWorldMatrix(true, false);
    origin = new Vector3().setFromMatrixPosition(backPivot.matrixWorld);
    const e = backPivot.matrixWorld.elements;
    normal = new Vector3(e[4], e[5], e[6]).normalize();
  }

  let minSigned: number | null = null;
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      geometry?: {
        attributes?: {
          position?: {
            count: number;
            getX: (i: number) => number;
            getY: (i: number) => number;
            getZ: (i: number) => number;
          };
        };
      };
      matrixWorld?: { elements: number[] };
      skeleton?: { update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.geometry?.attributes?.position) return;
    skinned.skeleton?.update?.();
    const pos = skinned.geometry.attributes.position;
    const e = skinned.matrixWorld?.elements;
    if (!e) return;
    const stride = Math.max(1, Math.floor(pos.count / 2500));
    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const w = 1 / (e[3] * vx + e[7] * vy + e[11] * vz + e[15] || 1);
      const wx = (e[0] * vx + e[4] * vy + e[8] * vz + e[12]) * w;
      const wy = (e[1] * vx + e[5] * vy + e[9] * vz + e[13]) * w;
      const wz = (e[2] * vx + e[6] * vy + e[10] * vz + e[14]) * w;
      if (wx > 0.15) continue;
      if (Math.abs(wz) > 0.35) continue;
      const signed = normal.dot(new Vector3(wx - origin.x, wy - origin.y, wz - origin.z));
      if (minSigned === null || signed < minSigned) minSigned = signed;
    }
  });
  return minSigned ?? 0;
}

function measurePelvisOnSeat(humanoid: Object3D, seatTopY: number): boolean {
  humanoid.updateMatrixWorld(true);
  let pelvisY: number | null = null;
  const consider = (object: Object3D) => {
    if (pelvisY !== null) return;
    if (!/^(pelvis|hips)$/i.test(object.name ?? "")) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    pelvisY = object.matrixWorld.elements[13] ?? null;
  };
  humanoid.traverse(consider);
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  if (pelvisY === null) return false;
  const clearance = pelvisY - seatTopY;
  return clearance > 0.05 && clearance < 0.55;
}

function measureRailsClippingTorso(root: Object3D, humanoid: Object3D): boolean {
  const railBoxes: Box3[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (!/rail/i.test(obj.name ?? "")) return;
    obj.updateWorldMatrix(true, false);
    const box = new Box3().setFromObject(obj);
    if (!box.isEmpty()) railBoxes.push(box);
  });
  if (railBoxes.length === 0) return false;

  const torsoPoints: Vector3[] = [];
  const consider = (object: Object3D) => {
    if (!/^(spine|chest)$/i.test(object.name ?? "")) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    torsoPoints.push(new Vector3().setFromMatrixPosition(object.matrixWorld));
  };
  humanoid.traverse(consider);
  humanoid.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  if (torsoPoints.length === 0) return false;
  const torsoBox = new Box3().setFromPoints(torsoPoints);
  torsoBox.expandByScalar(0.08);
  for (const rail of railBoxes) {
    if (rail.intersectsBox(torsoBox)) {
      const railCenter = rail.getCenter(new Vector3());
      const torsoCenter = torsoBox.getCenter(new Vector3());
      if (Math.abs(railCenter.z - torsoCenter.z) < 0.25 && railCenter.y > STRETCHER_DECK_TOP_METERS + 0.15) {
        return true;
      }
    }
  }
  return false;
}

export function measureArticulatingHob(
  root: Object3D,
  requestedDeg: number,
  framesAdvanced: number,
): ArticulatingHobMeasure {
  const stretcher = findProceduralStretcher(root);
  const humanoid = findHumanoid(root);
  const deckSectionNames = stretcher ? readStretcherDeckSectionNames(stretcher) : [];
  const inclineSsot = stretcher ? readStretcherInclineDegrees(stretcher) : requestedDeg;
  const backSectionWorldDeg = stretcher ? readStretcherBackSectionWorldDeg(stretcher) : 0;
  const torsoWorldDeg = humanoid ? readSupineTorsoWorldDeg(humanoid) : 0;
  const backToDeckGapMeters =
    humanoid && stretcher ? measureBackToDeckGap(humanoid, stretcher) : 0;
  const pelvisOnSeatSection = humanoid
    ? measurePelvisOnSeat(humanoid, STRETCHER_DECK_TOP_METERS)
    : false;
  const railsClippingTorso =
    humanoid && stretcher ? measureRailsClippingTorso(stretcher, humanoid) : false;

  return {
    requestedDeg,
    backSectionWorldDeg,
    torsoWorldDeg,
    backToDeckGapMeters,
    pelvisOnSeatSection,
    railsClippingTorso,
    framesAdvanced,
    deckSectionNames,
    inclineSsot,
  };
}
