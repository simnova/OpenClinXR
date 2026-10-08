/** Private MPFB supine hand contact: shared relaxed fingers and geometry-bounded arm staging. */
import { type Object3D, Quaternion, Vector3 } from "three";
import { measureGarmentLane, type GarmentLane } from "./supine-garment-lane.js";
import { findSupineBone } from "./hob-extremity-flex.js";
import { makeSupineSupportPlanes, type SupineSupportPlane } from "./supine-support-contact.js";

const pristineHands = new WeakMap<Object3D, Map<Object3D, Quaternion>>();
const handBones = (root: Object3D): Object3D[] => {
  const names = ["handL", "handR"];
  for (const side of ["L", "R"]) for (let finger = 1; finger <= 5; finger += 1) {
    for (let joint = 1; joint <= 3; joint += 1) names.push(`finger${finger}-${joint}${side}`);
  }
  return names.map((name) => findSupineBone(root, name, name.replace(/([LR])$/u, ".$1")))
    .filter((bone): bone is Object3D => bone !== null);
};

/** Save real bone names; the existing production hold restores this array after pose/mixer writes. */
function storeCandidate(root: Object3D): void {
  const bones = [...handBones(root), ...["upper_armL", "upper_armR", "forearmL", "forearmR"]
    .map((name) => findSupineBone(root, name)).filter((bone): bone is Object3D => bone !== null)];
  root.userData.openClinXrSupineArmFlexBones = bones.map((bone) => ({
    name: bone.name,
    quaternion: { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w },
  }));
  root.updateMatrixWorld(true);
}

/** Same bind-relative hand preset for authored, IK and diagnostic physics comparisons. */
function applyRelaxedSupineHands(root: Object3D): { bones: number; missing: string[] } {
  const bones = handBones(root);
  let baseline = pristineHands.get(root);
  if (!baseline) {
    baseline = new Map(bones.map((bone) => [bone, bone.quaternion.clone()]));
    pristineHands.set(root, baseline);
  }
  const missing: string[] = [];
  for (const bone of bones) {
    const rest = baseline.get(bone);
    if (rest) bone.quaternion.copy(rest);
  }
  // Keep the shipped wrist bind orientation. Finger flexion is measured around local+X,
  // except thumb opposition, whose measured proximal axis is mirrored localZ.
  for (const side of ["L", "R"]) for (let finger = 1; finger <= 5; finger += 1) {
    for (let joint = 1; joint <= 3; joint += 1) {
      const name = `finger${finger}-${joint}${side}`;
      const bone = findSupineBone(root, name, name.replace(/([LR])$/u, ".$1"));
      if (!bone) { missing.push(name); continue; }
      const angle = finger === 1 ? (joint === 1 ? 0.10 : joint === 2 ? 0.05 : 0)
        : joint === 1 ? 0.2 : joint === 2 ? 0.4 : 0.2;
      const axis = finger === 1 && joint === 1 ? new Vector3(0, 0, side === "L" ? 1 : -1) : new Vector3(1, 0, 0);
      bone.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, angle));
    }
  }
  storeCandidate(root);
  return { bones: bones.length, missing };
}

type Attribute = { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number; getW: (i: number) => number };
type Skin = Object3D & {
  isSkinnedMesh?: boolean;
  geometry?: { attributes?: { position?: Attribute; skinIndex?: Attribute; skinWeight?: Attribute } };
  skeleton?: { bones: Object3D[]; update: () => void };
  getVertexPosition?: (index: number, target: Vector3) => Vector3;
};

/** Physical hand/forearm envelope; anatomical body only, never a hanging gown contact proxy. */
function limbPoints(root: Object3D, side: string, family: "hand" | "forearm"): Vector3[] {
  root.updateMatrixWorld(true);
  const result: Vector3[] = [];
  root.traverse((object) => {
    const mesh = object as Skin;
    if (!mesh.isSkinnedMesh || !/mpfb.*body|reference_body/iu.test(mesh.name)) return;
    const { position, skinIndex, skinWeight } = mesh.geometry?.attributes ?? {};
    if (!position || !skinIndex || !skinWeight || !mesh.skeleton || !mesh.getVertexPosition) return;
    mesh.skeleton.update();
    for (let i = 0; i < position.count; i += 1) {
      const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
      const lane = weights.indexOf(Math.max(...weights));
      const indices = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
      const name = mesh.skeleton.bones[indices[lane] ?? 0]?.name.replaceAll(".", "") ?? "";
      if (!name.endsWith(side) || !(family === "hand" ? /wrist|finger|metacarpal/iu : /lowerarm|forearm/iu).test(name)) continue;
      result.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  });
  return result;
}

function gap(point: Vector3, plane: SupineSupportPlane): number {
  return plane.normal.dot(point.clone().sub(plane.origin));
}

function surfaceMetrics(points: Vector3[], planes: SupineSupportPlane[]): { total: number; outside: number; samples: number; minGap: number | null; contactGap: number | null } {
  const gaps = points.flatMap((point) => {
    const plane = planes.find((candidate) => !candidate.contains || candidate.contains(point));
    return plane ? [gap(point, plane)] : [];
  }).sort((a, b) => a - b);
  return { total: points.length, outside: points.length - gaps.length, samples: gaps.length, minGap: gaps[0] ?? null, contactGap: gaps[Math.floor((gaps.length - 1) * 0.08)] ?? null };
}

function swingWorld(bone: Object3D, from: Vector3, to: Vector3): void {
  const delta = new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  const world = bone.getWorldQuaternion(new Quaternion()).premultiply(delta);
  const parentWorld = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  bone.quaternion.copy(parentWorld.invert().multiply(world));
  bone.updateWorldMatrix(true, true);
}

type SupineArmCandidateResult = {
  side: string;
  unresolved: string | null;
  target: number[] | null;
  residualMetres: number | null;
  hand: ReturnType<typeof surfaceMetrics>;
  forearm: ReturnType<typeof surfaceMetrics>;
  angles?: { shoulder: number; elbow: number; wrist: number };
  lengths?: { before: number[]; after: number[] };
  accepted?: boolean;
  garmentLane?: { before: GarmentLane; after: GarmentLane; status: "clear" | "unavailable" | "overlap-retained-contact" | "improved" | "infeasible-retained-contact"; attempted?: GarmentLane; refusal?: string };
  poleSamples?: Array<{ bias: number; forearmMin: number | null }>;
  /** On refusal, hand/forearm describe the attempted candidate, not restored pixels. */
  metricsPose?: "accepted" | "attempted-before-rollback";
  restoredHand?: ReturnType<typeof surfaceMetrics>;
  restoredForearm?: ReturnType<typeof surfaceMetrics>;
};

/** Two flexing joints, with actual split-chain FK and a finite skin-derived resting target. */
export function applyContactAwareSupineArms(root: Object3D, bed: Object3D): SupineArmCandidateResult[] {
  const callerBones = [...handBones(root), ...["upper_armL", "upper_armR", "forearmL", "forearmR"].map((name) => findSupineBone(root, name)).filter((bone): bone is Object3D => bone !== null)];
  const callerQuats = new Map(callerBones.map((bone) => [bone, bone.quaternion.clone()]));
  const callerCache = root.userData.openClinXrSupineArmFlexBones;
  const rollbackSide = (side: string): void => {
    for (const [bone, quat] of callerQuats) if (bone.name.replaceAll(".", "").endsWith(side)) bone.quaternion.copy(quat);
    root.updateMatrixWorld(true);
  };
  applyRelaxedSupineHands(root);
  const support = makeSupineSupportPlanes(bed, 0);
  const planes = [support.pelvis, support.thorax];
  const result: SupineArmCandidateResult[] = [];
  const lanes = new Map<string, { forward: Vector3; lateral: Vector3; baseline: SupineArmCandidateResult; quats: Map<Object3D, Quaternion> }>();
  for (const side of ["L", "R"]) {
    const shoulder = findSupineBone(root, `upper_arm${side}`);
    const elbow = findSupineBone(root, `forearm${side}`);
    const wrist = findSupineBone(root, `hand${side}`);
    const handPoints = limbPoints(root, side, "hand");
    const empty = { total: 0, outside: 0, samples: 0, minGap: null, contactGap: null };
    if (!shoulder || !elbow || !wrist || handPoints.length < 4) {
      rollbackSide(side);
      result.push({ side, unresolved: "missing real chain or anatomical hand surface", target: null, residualMetres: null, hand: empty, forearm: empty });
      continue;
    }
    const s = shoulder.getWorldPosition(new Vector3());
    const e = elbow.getWorldPosition(new Vector3());
    const w = wrist.getWorldPosition(new Vector3());
    const plane = planes.find((candidate) => !candidate.contains || candidate.contains(w));
    if (!plane) {
      rollbackSide(side);
      result.push({ side, unresolved: "wrist outside finite support footprint", target: null, residualMetres: null, hand: empty, forearm: empty });
      continue;
    }
    const initial = surfaceMetrics(handPoints, planes);
    if (initial.contactGap === null) {
      rollbackSide(side);
      result.push({ side, unresolved: "no finite hand contact patch", target: null, residualMetres: null, hand: initial, forearm: empty });
      continue;
    }
    const originalShoulder = shoulder.quaternion.clone();
    const originalElbow = elbow.quaternion.clone();
    const originalWrist = wrist.quaternion.clone();
    const restoreArm = (): void => {
      shoulder.quaternion.copy(originalShoulder); elbow.quaternion.copy(originalElbow); wrist.quaternion.copy(originalWrist);
    };
    // Relax alongside the trunk, using this actor's shoulder-to-pelvis direction and reach.
    const pelvis = findSupineBone(root, "pelvis")?.getWorldPosition(new Vector3());
    const torsoDirection = pelvis ? pelvis.clone().sub(s) : w.clone().sub(s);
    torsoDirection.addScaledVector(plane.normal, -torsoDirection.dot(plane.normal)).normalize();
    // Stay beside the body rather than converging the wrists toward the pelvis centre.
    const bedForward = support.pelvis.forward?.clone() ?? torsoDirection.clone();
    if (bedForward.dot(torsoDirection) < 0) bedForward.negate();
    torsoDirection.copy(bedForward).addScaledVector(plane.normal, -bedForward.dot(plane.normal)).normalize();
    const armLength = s.distanceTo(e) + e.distanceTo(w);
    const target = s.clone().addScaledVector(torsoDirection, armLength * 0.90);
    const lateral = new Vector3().crossVectors(plane.normal, torsoDirection).normalize();
    if (lateral.dot(s.clone().sub(support.pelvis.origin)) < 0) lateral.negate();
    const handLateral = handPoints.map((point) => point.dot(lateral));
    const handWidth = Math.max(...handLateral) - Math.min(...handLateral);
    // Clear a measured hand-width lane beside the shoulder, bounded by actual finite skin coverage.
    target.addScaledVector(lateral, handWidth * 0.85);
    // Offset the wrist from the finite mattress by the measured lower hand skin thickness.
    const desiredGap = gap(w, plane) - initial.contactGap + 0.005;
    target.addScaledVector(plane.normal, desiredGap - gap(target, plane));
    const l1 = s.distanceTo(e);
    const l2 = e.distanceTo(w);
    let unreachable = false;
    let poleBias = 0;
    const solveTarget = (): void => {
    const direction = target.clone().sub(s);
    const requested = direction.length();
    const maxReach = (l1 + l2) * 0.995;
    const minReach = Math.abs(l1 - l2) + 1e-4;
    unreachable = requested > maxReach || requested < minReach;
    const distance = Math.max(minReach, Math.min(maxReach, requested));
    direction.normalize();
    const pole = e.clone().sub(s).addScaledVector(direction, -e.clone().sub(s).dot(direction));
    if (pole.lengthSq() < 1e-10) pole.copy(plane.normal).addScaledVector(direction, -plane.normal.dot(direction));
    pole.normalize();
    const aboveDeck = plane.normal.clone().addScaledVector(direction, -plane.normal.dot(direction)).normalize();
    pole.lerp(aboveDeck, poleBias).normalize();
    const along = (l1 * l1 + distance * distance - l2 * l2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const desiredElbow = s.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    const reachableTarget = s.clone().addScaledVector(direction, distance);
    swingWorld(shoulder, e.clone().sub(s), desiredElbow.clone().sub(s));
    root.updateMatrixWorld(true);
    const actualElbow = elbow.getWorldPosition(new Vector3());
    const actualWrist = wrist.getWorldPosition(new Vector3());
    swingWorld(elbow, actualWrist.clone().sub(actualElbow), reachableTarget.clone().sub(actualElbow));
    root.updateMatrixWorld(true);
    };
    const alignWrist = (): void => {
    // Compensate unsigned hand-plane roll at the wrist without twisting the split arm segments.
    const index = findSupineBone(root, `finger2-1${side}`);
    const little = findSupineBone(root, `finger5-1${side}`);
    const middle = findSupineBone(root, `finger3-2${side}`);
    if (index && little && middle) {
      const a = index.getWorldPosition(new Vector3()).sub(wrist.getWorldPosition(new Vector3()));
      const b = little.getWorldPosition(new Vector3()).sub(wrist.getWorldPosition(new Vector3()));
      const palmNormal = a.cross(b).normalize();
      if (palmNormal.dot(plane.normal) < 0) palmNormal.negate();
      const adjustment = new Quaternion().setFromUnitVectors(palmNormal, plane.normal);
      if (adjustment.angleTo(new Quaternion()) <= 0.65) {
        const world = wrist.getWorldQuaternion(new Quaternion()).premultiply(adjustment);
        const parentWorld = (wrist.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert();
        wrist.quaternion.copy(parentWorld.multiply(world));
        root.updateMatrixWorld(true);
      }
    }
    };
    const initialTarget = target.clone();
    const solveSkin = (bias: number): number | null => {
      poleBias = bias; target.copy(initialTarget);
      restoreArm();
      root.updateMatrixWorld(true);
    solveTarget();
    // Correct the hand envelope after actual FK changed its orientation; no fixed adult offset.
    for (let pass = 0; pass < 2; pass += 1) {
      const actual = surfaceMetrics(limbPoints(root, side, "hand"), planes);
      if (actual.contactGap === null || actual.minGap === null) break;
      const correction = Math.max(0.005 - actual.contactGap, -0.015 - actual.minGap);
      if (Math.abs(correction) < 0.001) break;
      target.addScaledVector(plane.normal, correction);
      shoulder.quaternion.copy(originalShoulder); elbow.quaternion.copy(originalElbow);
      root.updateMatrixWorld(true);
      solveTarget();
    }
    alignWrist();
    // Curl/roll changes the skin envelope: resolve actual final skin again after wrist alignment.
    for (let pass = 0; pass < 2; pass += 1) {
      const actual = surfaceMetrics(limbPoints(root, side, "hand"), planes);
      if (actual.contactGap === null || actual.minGap === null) break;
      const correction = Math.max(0.01 - actual.contactGap, 0.001 - actual.minGap);
      if (Math.abs(correction) < 0.001) break;
      target.addScaledVector(plane.normal, correction);
      restoreArm();
      root.updateMatrixWorld(true); solveTarget(); alignWrist();
    }
      const coverage = surfaceMetrics(limbPoints(root, side, "forearm"), planes);
      return coverage.samples >= 4 && coverage.outside <= coverage.total * 0.1 ? coverage.minGap : null;
    };
    // Select the smallest measured above-deck elbow pole, rather than one adult/child bias.
    const poleSamples: Array<{ bias: number; forearmMin: number | null }> = [];
    const sample = (bias: number): number | null => {
      const forearmMin = solveSkin(bias); poleSamples.push({ bias, forearmMin }); return forearmMin;
    };
    let high = 0.35;
    let poleUnresolved: string | null = null;
    const choosePole = (): void => {
    poleSamples.length = 0;
    let low = 0; high = 0.35;
    poleUnresolved = null;
    const lowGap = sample(low); const highGap = sample(high);
    if (lowGap === null || highGap === null) poleUnresolved = "missing forearm pole bracket coverage";
    else if (highGap < lowGap || highGap < 0) poleUnresolved = "no monotonic nonpenetrating forearm pole bracket";
    else if (lowGap >= 0) high = 0;
    else {
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const middle = (low + high) / 2; const measured = sample(middle);
        if (measured === null) { poleUnresolved = "missing forearm pole sample"; break; }
        if (measured >= 0) high = middle; else low = middle;
      }
      const ordered = [...poleSamples].sort((a, b) => a.bias - b.bias);
      if (ordered.some((row, i) => {
        const previous = ordered[i - 1];
        return previous && row.forearmMin !== null && previous.forearmMin !== null && row.forearmMin < previous.forearmMin - 1e-5;
      })) poleUnresolved = "nonmonotonic forearm pole samples";
    }
    solveSkin(high);
    };
    choosePole();
    const evaluate = (): SupineArmCandidateResult => {
    const hand = surfaceMetrics(limbPoints(root, side, "hand"), planes);
    const forearm = surfaceMetrics(limbPoints(root, side, "forearm"), planes);
    const residual = wrist.getWorldPosition(new Vector3()).distanceTo(target);
    const angles = { shoulder: shoulder.quaternion.angleTo(originalShoulder), elbow: elbow.quaternion.angleTo(originalElbow), wrist: wrist.quaternion.angleTo(originalWrist) };
    const lengths = { before: [l1, l2], after: [shoulder.getWorldPosition(new Vector3()).distanceTo(elbow.getWorldPosition(new Vector3())), elbow.getWorldPosition(new Vector3()).distanceTo(wrist.getWorldPosition(new Vector3()))] };
    const unresolved = poleUnresolved ?? (unreachable ? "target outside non-singular reach annulus"
      : hand.samples < 4 || forearm.samples < 4 || hand.outside > hand.total * 0.1 || forearm.outside > forearm.total * 0.1 ? "missing finite skin coverage"
      : angles.shoulder > 1.6 || angles.elbow > 2.0 || angles.wrist > 0.65 ? "provisional angular correction budget exceeded"
      : residual > 0.005 ? "actual split-chain FK residual"
      : hand.minGap !== null && hand.minGap < 0 ? "hand skin penetrates support"
      : forearm.minGap !== null && forearm.minGap < 0 ? "forearm skin penetrates support"
      : hand.contactGap === null || hand.contactGap > 0.025 ? "hand skin floats above support"
      : forearm.contactGap === null || forearm.contactGap > 0.025 ? "forearm skin floats above support" : null);
    return { side, unresolved, target: target.toArray(), residualMetres: residual, hand, forearm, angles, lengths, accepted: unresolved === null, metricsPose: unresolved ? "attempted-before-rollback" : "accepted",
      poleSamples: [...poleSamples] };
    };
    let accepted = evaluate();
    if (accepted.unresolved) {
      rollbackSide(side);
      accepted.restoredHand = surfaceMetrics(limbPoints(root, side, "hand"), planes);
      accepted.restoredForearm = surfaceMetrics(limbPoints(root, side, "forearm"), planes);
    } else {
      const before = measureGarmentLane(root, limbPoints(root, side, "hand"), torsoDirection, lateral);
      accepted.garmentLane = { before, after: before, status: before.triangles === 0 ? "unavailable" : "clear" };
      lanes.set(side, { forward: torsoDirection.clone(), lateral: lateral.clone(), baseline: { ...accepted }, quats: new Map(callerBones.filter((bone) => bone.name.replaceAll(".", "").endsWith(side)).map((bone) => [bone, bone.quaternion.clone()])) });
      if (before.shift > 0) {
        // Optional clearance transaction: never replace supported B with an unsafe legacy fallback.
        const contactPose = new Map(callerBones.map((bone) => [bone, bone.quaternion.clone()]));
        initialTarget.addScaledVector(lateral, before.shift);
        const requested = initialTarget.distanceTo(s);
        if (requested > (l1 + l2) * 0.995 || requested < Math.abs(l1 - l2) + 1e-4) {
          accepted.garmentLane = { before, after: before, status: "infeasible-retained-contact", refusal: "optional garment target outside non-singular reach annulus" };
        } else {
        choosePole();
        const attempted = evaluate();
        const after = measureGarmentLane(root, limbPoints(root, side, "hand"), torsoDirection, lateral);
        if (attempted.unresolved === null && after.separation !== null && after.shift <= 1e-5) {
          accepted = attempted; accepted.garmentLane = { before, after, status: "improved" };
        } else {
          for (const [bone, quat] of contactPose) bone.quaternion.copy(quat);
          root.updateMatrixWorld(true);
          accepted.garmentLane = { before, after: measureGarmentLane(root, limbPoints(root, side, "hand"), torsoDirection, lateral), attempted: after, status: "infeasible-retained-contact", refusal: attempted.unresolved ?? "projected garment clearance remains unresolved" };
        }
        }
      }
    }
    result.push(accepted);
  }
  // The second arm can deform shared cloth: audit the settled pair, not stale first-side cloth.
  let stale = false;
  for (const row of result) {
    const lane = lanes.get(row.side);
    if (!lane || !row.garmentLane) continue;
    const final = measureGarmentLane(root, limbPoints(root, row.side, "hand"), lane.forward, lane.lateral);
    row.garmentLane.after = final;
    if (row.garmentLane.status === "improved" && (final.separation === null || final.shift > 1e-5)) stale = true;
  }
  if (stale) {
    for (const row of result) {
      const lane = lanes.get(row.side);
      if (lane && row.garmentLane?.status === "improved") for (const [bone, quat] of lane.quats) bone.quaternion.copy(quat);
    }
    root.updateMatrixWorld(true);
    for (let index = 0; index < result.length; index += 1) {
      const row = result[index]; const lane = row && lanes.get(row.side);
      if (!row || !lane || row.garmentLane?.status !== "improved") continue;
      result[index] = { ...lane.baseline, garmentLane: { ...row.garmentLane, attempted: row.garmentLane.after,
        after: measureGarmentLane(root, limbPoints(root, row.side, "hand"), lane.forward, lane.lateral),
        status: "infeasible-retained-contact", refusal: "bilateral settled cloth clearance changed" } };
    }
  }
  for (const row of result) if (row.accepted) {
    row.hand = surfaceMetrics(limbPoints(root, row.side, "hand"), planes);
    row.forearm = surfaceMetrics(limbPoints(root, row.side, "forearm"), planes);
    const lane = lanes.get(row.side);
    if (lane && row.garmentLane) {
      row.garmentLane.after = measureGarmentLane(root, limbPoints(root, row.side, "hand"), lane.forward, lane.lateral);
      if (row.garmentLane.status === "clear" && row.garmentLane.after.shift > 1e-5) row.garmentLane.status = "overlap-retained-contact";
    }
  }
  if (result.every((row) => row.unresolved !== null)) root.userData.openClinXrSupineArmFlexBones = callerCache;
  else storeCandidate(root);
  root.userData.openClinXrSupineHandCandidate = result;
  return result;
}
