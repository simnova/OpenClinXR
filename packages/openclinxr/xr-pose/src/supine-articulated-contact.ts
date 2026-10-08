/** Bounded deterministic joint/contact solve; each support region keeps its own surface error. */
import { type Object3D, Vector3 } from "three";
import { findSupineBone } from "./hob-extremity-flex.js";
import { makeSupineSupportPlanes, measureSupineSupportRegions, type SupineSupportPlane, type SupineSupportRegion } from "./supine-support-contact.js";

const solvedRotations = new WeakMap<Object3D, Array<{ bone: Object3D; rotation: [number, number, number] }>>();
const baselineRotations = new WeakMap<Object3D, Array<{ bone: Object3D; rotation: [number, number, number] }>>();

export function resetSupineArticulatedContact(root: Object3D): void {
  if (!baselineRotations.has(root)) {
    const bones = ["spine05", "spine04", "spine", "spine02", "chest", "neck", "neck02", "neck03", "head", "thighL", "thighR", "shinL", "shinR", "upper_armL", "upper_armR", "forearmL", "forearmR"]
      .map((name) => findSupineBone(root, name)).filter((bone): bone is Object3D => bone !== null);
    baselineRotations.set(root, bones.map((bone) => ({ bone, rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z] })));
  }
  for (const row of baselineRotations.get(root) ?? []) row.bone.rotation.set(...row.rotation);
  delete root.userData.openClinXrSupineArticulatedSupport;
}

const axes = ["x", "y", "z"] as const;
const regions = ["pelvis", "lumbar", "thorax", "heelL", "heelR", "occiput"] as const;

/** Restore the accepted articulation after absolute pose/mixer writes, without additive drift. */
export function reapplySupineArticulatedContact(root: Object3D): void {
  for (const row of solvedRotations.get(root) ?? []) row.bone.rotation.set(...row.rotation);
}

/**
 * Coordinate descent over bounded spine and leg rotations plus root height. The objective uses
 * deformed anatomical body patches (including body hidden by clothing masks), not a joint centre or a lowest whole-body vertex. Bone lengths
 * remain fixed. This is a plant-time staging solve; no physics integration or stochastic motion.
 */
export function solveSupineArticulatedContact(
  root: Object3D,
  planes: Readonly<Record<SupineSupportRegion, SupineSupportPlane>>,
  bed?: Object3D,
): void {
  const pelvis = findSupineBone(root, "pelvis");
  if (pelvis) {
    root.updateMatrixWorld(true);
    const hip = pelvis.getWorldPosition(new Vector3());
    const hinge = planes.lumbar.origin;
    const displacement = hinge.clone().addScaledVector(planes.pelvis.forward ?? new Vector3(1, 0, 0), 0.04).sub(hip);
    displacement.addScaledVector(planes.pelvis.normal, -displacement.dot(planes.pelvis.normal));
    if (root.parent) {
      const current = root.getWorldPosition(new Vector3());
      displacement.copy(root.parent.worldToLocal(current.clone().add(displacement)).sub(root.parent.worldToLocal(current)));
    }
    root.position.add(displacement);
  }
  // MPFB's lower spine pivot starts the raised torso; the legs keep the horizontal root basis.
  const spine = findSupineBone(root, "spine05", "spine");
  const incline = Math.atan2(planes.lumbar.normal.dot(planes.pelvis.forward ?? new Vector3(1, 0, 0)), planes.lumbar.normal.dot(planes.pelvis.normal));
  if (spine && Math.abs(incline) > 0.001) spine.rotation.x += incline;
  const first = measureSupineSupportRegions(root, planes);
  const pelvisGap = first.pelvis.contactGapMeters;
  const world = root.getWorldPosition(new Vector3());
  const localNormal = root.parent ? root.parent.worldToLocal(world.clone().add(planes.pelvis.normal)).sub(root.parent.worldToLocal(world.clone())) : planes.pelvis.normal.clone();
  if (pelvisGap !== null) root.position.addScaledVector(localNormal, -(pelvisGap - 0.005));
  const bones = ["spine05", "spine04", "spine", "spine02", "chest", "neck", "neck02", "neck03", "head", "thighL", "thighR", "shinL", "shinR"]
    .map((name) => findSupineBone(root, name)).filter((bone): bone is Object3D => bone !== null);
  const originals = bones.map((bone) => bone.rotation.clone());
  const rootPosition = root.position.clone();
  const required = regions;
  const pillow = root.userData.openClinXrSupinePillowWorld as { x: number; y: number; z: number } | undefined;
  const head = findSupineBone(root, "head");
  const loss = () => {
    const metrics = measureSupineSupportRegions(root, planes);
    let score = 0;
    for (const region of required) {
      const row = metrics[region];
      if (row.samples < 4 || row.contactGapMeters === null || row.minGapMeters === null) return Infinity;
      const gap = row.contactGapMeters;
      score += (region === "pelvis" ? 12 : region.startsWith("heel") ? 3 : 6) * (gap - (region === "occiput" ? 0.015 : 0.005)) ** 2;
      // The support can compress a little; a penetrating region cannot buy another's contact.
      score += 80 * Math.min(0, row.minGapMeters + 0.016) ** 2;
      score += 160 * Math.max(0, gap - 0.02) ** 2;
    }
    if (head && pillow && !bed) {
      const p = head.getWorldPosition(new Vector3());
      score += 0.8 * ((p.x - pillow.x) ** 2 + (p.y - pillow.y - 0.04) ** 2 + (p.z - pillow.z) ** 2);
    }
    return score;
  };
  let best = loss();
  for (const step of [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025]) {
    for (let pass = 0; pass < 8; pass += 1) {
      let improved = false;
      for (let i = 0; i < bones.length; i += 1) {
        const bone = bones[i]!;
        for (const axis of axes) {
          if (!/leg|thigh|shin/iu.test(bone.name) && axis !== "x") continue;
          const initial = bone.rotation[axis];
          let selected = initial;
          for (const sign of [-1, 1]) {
            const candidate = initial + sign * step;
            if (Math.abs(candidate - originals[i]![axis]) > (/head|neck/iu.test(bone.name) ? 0.35 : 0.7)) continue;
            bone.rotation[axis] = candidate;
            const score = loss();
            if (score < best - 1e-7) { best = score; selected = candidate; improved = true; }
          }
          bone.rotation[axis] = selected;
        }
      }
      const initialPosition = root.position.clone();
      let selectedPosition = initialPosition.clone();
      for (const sign of [-1, 1]) {
        const candidate = initialPosition.clone().addScaledVector(localNormal, sign * step * 0.25);
        if (candidate.distanceTo(rootPosition) > 0.3) continue;
        root.position.copy(candidate);
        const score = loss();
        if (score < best - 1e-7) { best = score; selectedPosition = candidate; improved = true; }
      }
      root.position.copy(selectedPosition);
      if (!improved) break;
    }
  }
  root.updateMatrixWorld(true);
  solvedRotations.set(root, bones.map((bone) => ({ bone, rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z] })));
  const metrics = measureSupineSupportRegions(root, planes);
  const occiput = metrics.occiput.contactPoint;
  if (bed && occiput) {
    let pillowMesh: Object3D | null = null;
    bed.traverse((object) => { if (/\.pillow$/u.test(object.name)) pillowMesh = object; });
    if (pillowMesh) {
      const pillowObject = pillowMesh as Object3D;
      const surface = new Vector3(occiput.x, occiput.y, occiput.z);
      const distance = planes.lumbar.normal.dot(surface.clone().sub(planes.lumbar.origin));
      surface.addScaledVector(planes.lumbar.normal, 0.04 - distance);
      pillowObject.position.copy(pillowObject.parent!.worldToLocal(surface));
      pillowObject.updateMatrixWorld(true);
      const pillowWorld = pillowObject.getWorldPosition(new Vector3());
      root.userData.openClinXrSupinePillowWorld = { x: pillowWorld.x, y: pillowWorld.y, z: pillowWorld.z };
    }
  }
  const finalMetrics = bed ? measureSupineSupportRegions(root, makeSupineSupportPlanes(bed, planes.pelvis.origin.y)) : metrics;
  root.userData.openClinXrSupineArticulatedSupport = finalMetrics;
  root.userData.openClinXrSupineArticulatedSupportResolved = regions.every((region) => {
    const row = finalMetrics[region];
    return row.samples >= 4 && row.contactGapMeters !== null && row.contactGapMeters <= 0.025
      && row.minGapMeters !== null && row.minGapMeters >= -0.02;
  });
}
