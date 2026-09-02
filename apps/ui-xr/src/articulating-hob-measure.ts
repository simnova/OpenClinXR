/**
 * Live world-space measures for articulating head-of-bed (#159).
 * Used by the isolated-subject lab after the render loop advances.
 *
 * claimScope: staging incline geometry metrics.
 * notEvidenceFor: clinical positioning correctness, multi-joint bed fidelity.
 */

import { Box3, Mesh, type Object3D, Vector3 } from "three";
import {
  STRETCHER_DECK_TOP_METERS,
  findProceduralStretcher,
  readStretcherBackSectionWorldDeg,
  readStretcherDeckSectionNames,
  readStretcherInclineDegrees,
} from "./station-stretcher.js";
import { readSupineTorsoWorldDeg } from "./supine-deck-plant.js";

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

// Contact metrics live in hob-contact-metrics.ts (shared with plant step table).
import {
  measureBackToDeckGap,
  measurePelvisOnSeat,
} from "./hob-contact-metrics.js";
export {
  measureBackToDeckGap,
  measurePelvisOnSeat,
  measureSeatClearanceMeters,
  measureHeadPillowGapMeters,
  readBackSectionPlane,
  settleSupineOntoBackSection,
  settleSupineOntoBackSectionPreservingSeat,
} from "./hob-contact-metrics.js";

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
