/**
 * arena-physics-realbind-r3-ui-xr-bind (R3 / AD-3):
 * Apply precomputed Rapier palpation bone transforms to the patient humanoid.
 *
 * PRE-PRODUCTION FENCE (physics-realbind-pre-prod-fence-v1):
 *   Gated by caller (isPhysicsClinicalTouchCapture) — only when capture mode is
 *   "physics-clinical-touch" or "physics-touch". Default session path must not call.
 *   UI_XR_PHYSICS_TOUCH_RUNTIME_PROMOTION_ALLOWED = false.
 *   notEvidenceFor: production_physics_readiness, learner_readiness.
 */

import {
  Color,
  Mesh,
  MeshStandardMaterial,
  type Group,
  type Object3D,
  type Vector3,
} from "three";
import physicsBoneTransformsArtifact from "./ed-palpation-bone-transforms.json" with { type: "json" };

export type PhysicsBoneTransformSlot = {
  actorId: string;
  root: Object3D;
  _physicsBoneMap?: Map<string, Object3D>;
};

type BoneDelta = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
};

type PhysicsArtifact = {
  frames: Array<{ boneDeltas: Record<string, BoneDelta> }>;
  bones: string[];
  engineId: string;
  seed: string | number;
  scenarioId: string;
  notEvidenceFor: string[];
};

/**
 * Apply one frame of precomputed bone deltas. No-op when enabled is false.
 */
export function applyPhysicsBoneTransforms(input: {
  enabled: boolean;
  nowMs: number;
  patientSlot: PhysicsBoneTransformSlot | undefined;
}): void {
  if (!input.enabled) return;
  const patientSlot = input.patientSlot;
  if (!patientSlot) return;

  const artifact = physicsBoneTransformsArtifact as PhysicsArtifact;
  const totalTicks = artifact.frames.length;
  if (totalTicks === 0) return;

  const scenarioDurationMs = (totalTicks / 60) * 1000;
  const elapsedInCycle = input.nowMs % scenarioDurationMs;
  const tick = Math.floor((elapsedInCycle / scenarioDurationMs) * totalTicks);
  const frame = artifact.frames[Math.min(tick, totalTicks - 1)]!;

  if (!patientSlot._physicsBoneMap) {
    const map = new Map<string, Object3D>();
    patientSlot.root.traverse((obj) => {
      if (artifact.bones.includes(obj.name)) {
        map.set(obj.name, obj);
      }
    });
    patientSlot._physicsBoneMap = map;
  }

  const boneMap = patientSlot._physicsBoneMap;

  for (const [boneName, delta] of Object.entries(frame.boneDeltas)) {
    const bone = boneMap.get(boneName);
    if (!bone) continue;

    const boneAny = bone as Object3D & {
      _physicsBindPos?: Vector3;
      _physicsBindRot?: { x: number; y: number; z: number; w: number };
      position: { set: (x: number, y: number, z: number) => void; clone: () => Vector3 };
      quaternion: { x: number; y: number; z: number; w: number; set: (x: number, y: number, z: number, w: number) => void; clone: () => { x: number; y: number; z: number; w: number } };
    };

    if (!boneAny._physicsBindPos) {
      boneAny._physicsBindPos = boneAny.position.clone();
      boneAny._physicsBindRot = boneAny.quaternion.clone();
    }

    const bindPos = boneAny._physicsBindPos;
    const bindRot = boneAny._physicsBindRot!;

    boneAny.position.set(
      bindPos.x + delta.position.x,
      bindPos.y + delta.position.y,
      bindPos.z + delta.position.z,
    );

    boneAny.quaternion.set(bindRot.x, bindRot.y, bindRot.z, bindRot.w);
    const dq = delta.rotation;
    const q = boneAny.quaternion;
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    q.x = w * dq.x + x * dq.w + y * dq.z - z * dq.y;
    q.y = w * dq.y - x * dq.z + y * dq.w + z * dq.x;
    q.z = w * dq.z + x * dq.y - y * dq.x + z * dq.w;
    q.w = w * dq.w - x * dq.x - y * dq.y - z * dq.z;
  }

  patientSlot.root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const nm = obj.name || "";
    if (!/openclinxr_real_garment|real_garment_from_phenotype/i.test(nm)) return;

    obj.frustumCulled = false;
    obj.visible = true;

    const mat = obj.material as MeshStandardMaterial;
    if (mat && mat.emissive && !(obj.userData as { openClinXrPhysicsTouchEvidenceApplied?: boolean }).openClinXrPhysicsTouchEvidenceApplied) {
      mat.emissive = new Color(0xff4400);
      mat.emissiveIntensity = 0.8;
      mat.needsUpdate = true;
      (obj.userData as { openClinXrPhysicsTouchEvidenceApplied?: boolean }).openClinXrPhysicsTouchEvidenceApplied = true;
    }

    (obj.userData as { openClinXrPhysicsTouchEvidence?: unknown }).openClinXrPhysicsTouchEvidence = {
      engineId: artifact.engineId,
      seed: artifact.seed,
      scenarioId: artifact.scenarioId,
      bonesAffected: artifact.bones,
      currentTick: tick,
      spineDz: frame.boneDeltas.spine?.position.z ?? 0,
      guardingAngle: frame.boneDeltas["upper_arm.L"]?.rotation.x ?? 0,
      runtimePromotionAllowed: false,
      notEvidenceFor: [
        ...artifact.notEvidenceFor,
        "production_physics_readiness",
        "learner_readiness",
      ],
    };
  });
}

export type { Group };
