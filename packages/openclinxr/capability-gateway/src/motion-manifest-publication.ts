import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import {
  bakeMotionProgramToGlb,
  compileMotionProgram,
  deriveSkeletonProfileFromRigAsset,
  planMotionProgram,
  readMotionGlbClipId,
} from "@openclinxr/motion-compiler";
import type { CompiledMotionClipV1, MotionGlbBakeClip } from "@openclinxr/motion-compiler";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";

import type {
  AssetGenerationArtifact,
  AssetGenerationManifest,
  AssetGenerationProvenance,
  AssetGenerationWorkerAdapter,
} from "./asset-generation-jobs.js";

/**
 * The pinned ED touch row this publication routes. Read from the bank at runtime —
 * never restated — so the clip identity cannot drift away from the case the factory
 * actually ships. Placement is the ED exam bay's stretcher: the fixture authors no
 * placement row, and a supine patient answers from the stretcher.
 */
const PINNED_SCENARIO_ID = "ed_chest_pain_priority_v1";
const PINNED_ACTOR_ID = "patient_robert_hayes_v1";
const PINNED_SUPPORT_SURFACE = "stretcher";
const PINNED_ACTOR_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
const ARM_LANDMARKS = ["upper_armR", "forearmR", "handR", "chest", "spine", "pelvis"] as const;
const MOTION_REGIONS = [
  "motion_guard_abdomen_rlq",
  "motion_guard_abdomen_ruq",
  "motion_guard_abdomen_luq",
  "motion_guard_abdomen_llq",
  "motion_guard_abdomen_epigastric",
  "motion_guard_abdomen_suprapubic",
  "motion_guard_chest_r",
  "motion_guard_chest_l",
  "motion_guard_neck_anterior",
  "motion_guard_neck_posterior",
] as const;

export type RealTouchPublicationInput = {
  scenarioId: string;
  actorId: string;
  region: string;
  actorGlbPath: string;
  jobId: string;
  sandboxWorkdir: string;
};

export type RealTouchPublicationOutput = {
  clip: CompiledMotionClipV1 & { targetRig: { jointNames: readonly string[] } };
  glbBytes: Uint8Array;
  glbArtifact: AssetGenerationArtifact;
  clipArtifact: AssetGenerationArtifact;
  manifestArtifact: AssetGenerationArtifact;
  manifest: AssetGenerationManifest;
  provenance: AssetGenerationProvenance;
};

export type MotionPublicationInput = {
  clipId: string;
  motionProgramHash: string;
  deterministicSeed: string;
  jobId: string;
  sandboxWorkdir: string;
};

export type MotionPublicationOutput = {
  glbArtifact: AssetGenerationArtifact;
  manifestArtifact: AssetGenerationArtifact;
  manifest: AssetGenerationManifest;
  provenance: AssetGenerationProvenance;
};

/**
 * Bake a clip-identity payload to a local GLB and write a zero-egress, zero-spend
 * animation-generation manifest. Uses the motion-compiler bake entry, not a reconstructed
 * compiler clip type — the public surface is bakeMotionProgramToGlb / MotionGlbBakeClip.
 *
 * Retained for the pre-existing sibling contract
 * (the-animation-generation-job-publishes-the-motion-glb.test.ts), which publishes a
 * caller-supplied clip identity with no scenario behind it. The real touch row below
 * replaces this path for case-authored motion; this function must not gain scenario
 * inputs, and the real path must not accept a caller-supplied clip identity.
 */
export function publishMotionManifest(input: MotionPublicationInput): MotionPublicationOutput {
  const clip: MotionGlbBakeClip = bakeClipFromPayload(input);
  const glbBytes = bakeMotionProgramToGlb(clip);
  const readbackClipId = readMotionGlbClipId(glbBytes);
  if (readbackClipId !== clip.clipId) {
    throw new Error(`GLB readback clipId mismatch: expected ${clip.clipId}, got ${readbackClipId}`);
  }

  const glbFileName = `${input.clipId}.glb`;
  const glbPath = resolvePath(input.sandboxWorkdir, input.jobId, glbFileName);
  const manifestPath = resolvePath(input.sandboxWorkdir, input.jobId, "animation-generation-manifest.json");
  mkdirSync(dirname(glbPath), { recursive: true });
  writeFileSync(glbPath, glbBytes);

  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");
  const manifest: AssetGenerationManifest = {
    schemaVersion: "asset-generation-manifest.v1",
    capabilityId: "animation-generation",
    clipId: input.clipId,
    outputs: [glbPath, manifestPath],
    glbByteLength: glbBytes.length,
    glbSha256,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    glbArtifact: {
      kind: "mesh",
      path: glbPath,
      mediaType: "model/gltf-binary",
    },
    manifestArtifact: {
      kind: "manifest",
      path: manifestPath,
      mediaType: "application/json",
    },
    manifest,
    provenance: {
      generator: "openclinxr-motion-compiler",
      license: "openclinxr-motion-clip-v1",
      spendCents: 0,
      externalNetworkUsed: false,
    },
  };
}

/**
 * Route the real authored touch row through planning, the exact loaded-actor skeleton
 * profile, canonical compile, deterministic bake, and zero-egress publication with one
 * stable clip identity. The sidecar GLB is interchange: it is written beside the
 * CompiledMotionClipV1 JSON and addressed by the manifest, never staged as a humanoid.
 *
 * Refuses: a scenario/actor/region outside the pinned ED row, an actor GLB outside the
 * pinned promoted cast, a missing touch row, a missing rig profile, missing landmarks,
 * and a compiled clip whose id is not the fixture row's responseClip. A payload that
 * merely supplies the expected clip id cannot reach this path — there is no clipId
 * input, and the adapter below only routes payloads carrying scenarioId + actorId +
 * region + actorGlbPath.
 */
export function publishRealTouchMotion(input: RealTouchPublicationInput): RealTouchPublicationOutput {
  if (input.scenarioId !== PINNED_SCENARIO_ID || input.actorId !== PINNED_ACTOR_ID) {
    throw new Error(
      `publishRealTouchMotion: pinned to ${PINNED_SCENARIO_ID} / ${PINNED_ACTOR_ID}, got ${input.scenarioId} / ${input.actorId}`,
    );
  }
  if (input.actorGlbPath !== PINNED_ACTOR_GLB) {
    throw new Error(
      `publishRealTouchMotion: pinned to the promoted cast ${PINNED_ACTOR_GLB}, got ${input.actorGlbPath}`,
    );
  }
  const row = readTouchRow(input.scenarioId, input.actorId, input.region);
  const program = planMotionProgram({
    scenarioId: input.scenarioId,
    actorId: input.actorId,
    touchResponses: [row],
    placement: { supportSurface: PINNED_SUPPORT_SURFACE },
  });
  const rig = deriveSkeletonProfileFromRigAsset(resolveRepositoryGlb(input.actorGlbPath), [...ARM_LANDMARKS]);
  const profile = withAnchors(rig);
  const clip = compileMotionProgram({ program, skeletonProfile: profile });
  if (clip.clipId !== row.responseClip) {
    throw new Error(
      `publishRealTouchMotion: compiled clipId ${clip.clipId} is not the fixture row's responseClip ${row.responseClip} — a hash fallback is a failed treatment`,
    );
  }
  const glbBytes = bakeMotionProgramToGlb({ clipId: clip.clipId, compileIdentity: clip.compileIdentity, tracks: clip.tracks });
  const readbackClipId = readMotionGlbClipId(glbBytes);
  if (readbackClipId !== clip.clipId) {
    throw new Error(`GLB readback clipId mismatch: expected ${clip.clipId}, got ${readbackClipId}`);
  }
  return writeRealTouchSidecar({ clip, jointNames: rig.jointNames, glbBytes, jobId: input.jobId, sandboxWorkdir: input.sandboxWorkdir });
}

/**
 * Animation-generation worker: publishes the motion GLB under clip identity with
 * local-only, zero-spend license provenance.
 *
 * Two payload shapes, kept apart on purpose. A payload carrying scenarioId + actorId +
 * region + actorGlbPath routes the real authored row through publishRealTouchMotion.
 * Anything else keeps the legacy caller-supplied identity path — which writes the GLB
 * only, never the compiled sidecar JSON, so it cannot satisfy the real-row contract.
 */
export function createAnimationGenerationAdapter(): AssetGenerationWorkerAdapter {
  return {
    capabilityId: "animation-generation",
    providerId: "deterministic-animation-generation",
    providerKind: "deterministic-mock",
    implementationLanguage: "typescript",
    transport: "in-process",
    async run(request, policy, context) {
      const payload = (request.payload ?? {}) as {
        scenarioId?: unknown;
        actorId?: unknown;
        region?: unknown;
        actorGlbPath?: unknown;
        clipId?: unknown;
        requestId?: unknown;
        motionProgramHash?: unknown;
        deterministicSeed?: unknown;
      };
      if (
        typeof payload.scenarioId === "string"
        && typeof payload.actorId === "string"
        && typeof payload.region === "string"
        && typeof payload.actorGlbPath === "string"
      ) {
        const published = publishRealTouchMotion({
          scenarioId: payload.scenarioId,
          actorId: payload.actorId,
          region: payload.region,
          actorGlbPath: payload.actorGlbPath,
          jobId: context.jobId,
          sandboxWorkdir: policy.sandboxWorkdir,
        });
        return {
          artifacts: [published.glbArtifact, published.clipArtifact, published.manifestArtifact],
          manifest: published.manifest,
          provenance: published.provenance,
        };
      }
      const clipId =
        typeof payload.clipId === "string" && payload.clipId.length > 0
          ? payload.clipId
          : typeof payload.requestId === "string" && payload.requestId.length > 0
            ? payload.requestId
            : "openclinxr_animation_generation_fixture";
      const published = publishMotionManifest({
        clipId,
        motionProgramHash: typeof payload.motionProgramHash === "string" ? payload.motionProgramHash : clipId,
        deterministicSeed: typeof payload.deterministicSeed === "string" ? payload.deterministicSeed : clipId,
        jobId: context.jobId,
        sandboxWorkdir: policy.sandboxWorkdir,
      });
      return {
        artifacts: [published.glbArtifact, published.manifestArtifact],
        manifest: published.manifest,
        provenance: published.provenance,
      };
    },
  };
}

function readTouchRow(scenarioId: string, actorId: string, region: string): AuthoredTouchRow {
  const scenario = scenarioBank.find(
    (candidate: { scenarioId: string }) => candidate.scenarioId === scenarioId,
  );
  const actor = scenario?.actors.find((candidate: { actorId: string }) => candidate.actorId === actorId);
  const row = actor?.bodyMechanics?.touchResponses.find(
    (candidate: { region: string }) => candidate.region === region,
  );
  if (row === undefined) {
    throw new Error(
      `publishRealTouchMotion: no authored touch row for ${scenarioId} / ${actorId} / ${region} — missing program refuses`,
    );
  }
  return {
    region: row.region,
    responseKind: row.responseKind,
    forceThreshold: row.forceThreshold,
    emotionEventId: row.emotionEventId,
    emotion: row.emotion,
    responseClip: row.responseClip,
    dialogueLine: row.dialogueLine,
    traceTag: row.traceTag,
  };
}

type AuthoredTouchRow = {
  region: string;
  responseKind: string;
  forceThreshold: number;
  emotionEventId: string;
  emotion: string;
  responseClip: string;
  dialogueLine: string;
  traceTag: string;
};

function resolveRepositoryGlb(actorGlbPath: string): string {
  const absolute = resolvePath(REPOSITORY_ROOT, actorGlbPath);
  if (existsSync(absolute)) return absolute;
  throw new Error(`publishRealTouchMotion: actor GLB ${actorGlbPath} is not on disk — missing profile refuses`);
}

function withAnchors(rig: {
  rigFingerprint: string;
  bindSpace: string;
  jointNames: readonly string[];
  joints: readonly FkJoint[];
  bindFrame: Readonly<Record<string, Vec3>>;
}): FullProfile {
  const positions = Object.values(rig.bindFrame);
  if (positions.length === 0) {
    throw new Error(`publishRealTouchMotion: ${rig.rigFingerprint} carries no bind frame — missing landmarks refuse`);
  }
  const ys = positions.map((point) => point.y);
  const bodyExtent = {
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    halfWidth: Math.max(...positions.map((point) => Math.abs(point.x))),
    halfDepth: Math.max(...positions.map((point) => Math.abs(point.z))),
  };
  const joints = rig.joints.map((joint) => ({
    boneName: joint.boneName,
    ...(joint.parentBoneName === undefined ? {} : { parentBoneName: joint.parentBoneName }),
    bindLocalPosition: joint.bindLocalPosition,
    bindLocalQuaternion: joint.bindLocalQuaternion,
  }));
  const anchors: Record<string, Vec3> = {};
  for (const region of MOTION_REGIONS) {
    anchors[region] = anchorForRegion(region, rig.bindFrame, bodyExtent);
  }
  return {
    rigFingerprint: rig.rigFingerprint,
    jointNames: rig.jointNames,
    joints,
    bindFrame: rig.bindFrame,
    regionAnchorSpace: rig.bindSpace,
    regionAnchors: anchors,
  };
}

type Vec3 = { x: number; y: number; z: number };

type FkJoint = {
  boneName: string;
  parentBoneName?: string;
  bindLocalPosition: Vec3;
  bindLocalQuaternion: { x: number; y: number; z: number; w: number };
};

type FullProfile = {
  rigFingerprint: string;
  jointNames: readonly string[];
  joints: readonly FkJoint[];
  bindFrame: Readonly<Record<string, Vec3>>;
  regionAnchorSpace: string;
  regionAnchors: Readonly<Record<string, Vec3>>;
};

/**
 * Region anchor derivation, same contract the motion-compiler anchor producer owns:
 * a landmark position plus a per-region direction offset, scaled by the asset's own
 * measured torso height, shoulder half-width, and half depth. Duplicated here rather
 * than imported because the anchor producer's input shape (RigAsset with hand-supplied
 * bodyExtent) is not what the rig deriver returns, and threading the compiler's exact
 * module would widen this package's dependency beyond the published entrypoint.
 * The direction table mirrors the compiler's anchor producer field for field.
 */
function anchorForRegion(
  region: string,
  bindFrame: Readonly<Record<string, Vec3>>,
  bodyExtent: { minY: number; maxY: number; halfWidth: number; halfDepth: number },
): Vec3 {
  const direction = ANCHOR_DIRECTIONS[region];
  if (direction === undefined) {
    throw new Error(`publishRealTouchMotion: region ${region} has no anchor direction — missing landmarks refuse`);
  }
  const reference = bindFrame[direction.bone];
  if (reference === undefined) {
    throw new Error(
      `publishRealTouchMotion: landmark bone ${direction.bone} is not on this rig — missing landmarks refuse`,
    );
  }
  return {
    x: reference.x + direction.dx * bodyExtent.halfWidth,
    y: reference.y + direction.dy * torsoHeight(bindFrame, bodyExtent),
    z: reference.z + direction.dz * bodyExtent.halfDepth,
  };
}

function torsoHeight(
  bindFrame: Readonly<Record<string, Vec3>>,
  bodyExtent: { minY: number; maxY: number; halfWidth: number; halfDepth: number },
): number {
  const chest = bindFrame["spine01"] ?? bindFrame["chest"];
  const base = bindFrame["root"] ?? bindFrame["pelvis"] ?? bindFrame["spine03"];
  if (chest !== undefined && base !== undefined && chest.y > base.y) return chest.y - base.y;
  return bodyExtent.maxY - bodyExtent.minY;
}

const ANCHOR_DIRECTIONS: Readonly<
  Record<string, { bone: string; dx: number; dy: number; dz: number }>
> = {
  motion_guard_abdomen_rlq: { bone: "spine01", dx: 0.3, dy: -0.55, dz: 0 },
  motion_guard_abdomen_ruq: { bone: "spine01", dx: 0.3, dy: -0.3, dz: 0 },
  motion_guard_abdomen_luq: { bone: "spine01", dx: -0.3, dy: -0.55, dz: 0 },
  motion_guard_abdomen_llq: { bone: "spine01", dx: -0.3, dy: -0.55, dz: 0 },
  motion_guard_abdomen_epigastric: { bone: "spine01", dx: 0, dy: -0.25, dz: 0 },
  motion_guard_abdomen_suprapubic: { bone: "spine01", dx: 0, dy: -0.6, dz: 0 },
  motion_guard_chest_r: { bone: "spine01", dx: 0.45, dy: 0, dz: 0 },
  motion_guard_chest_l: { bone: "spine01", dx: -0.45, dy: 0, dz: 0 },
  motion_guard_neck_anterior: { bone: "neck01", dx: 0, dy: 0, dz: 0.25 },
  motion_guard_neck_posterior: { bone: "neck01", dx: 0, dy: 0, dz: -0.25 },
};

function writeRealTouchSidecar(input: {
  clip: CompiledMotionClipV1;
  jointNames: readonly string[];
  glbBytes: Uint8Array;
  jobId: string;
  sandboxWorkdir: string;
}): RealTouchPublicationOutput {
  const glbFileName = `${input.clip.clipId}.glb`;
  const clipFileName = `${input.clip.clipId}.compiled-motion-clip.v1.json`;
  const glbPath = resolvePath(input.sandboxWorkdir, input.jobId, glbFileName);
  const clipPath = resolvePath(input.sandboxWorkdir, input.jobId, clipFileName);
  const manifestPath = resolvePath(input.sandboxWorkdir, input.jobId, "animation-generation-manifest.json");
  mkdirSync(dirname(glbPath), { recursive: true });
  writeFileSync(glbPath, input.glbBytes);
  const clipRecord = {
    ...input.clip,
    targetRig: { ...input.clip.targetRig, jointNames: input.jointNames },
  };
  writeFileSync(clipPath, JSON.stringify(clipRecord, null, 2));
  const glbSha256 = createHash("sha256").update(input.glbBytes).digest("hex");
  const manifest: AssetGenerationManifest = {
    schemaVersion: "asset-generation-manifest.v1",
    capabilityId: "animation-generation",
    clipId: input.clip.clipId,
    outputs: [glbPath, clipPath, manifestPath],
    glbByteLength: input.glbBytes.length,
    glbSha256,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return {
    clip: clipRecord,
    glbBytes: input.glbBytes,
    glbArtifact: { kind: "mesh", path: glbPath, mediaType: "model/gltf-binary" },
    clipArtifact: { kind: "manifest", path: clipPath, mediaType: "application/json" },
    manifestArtifact: { kind: "manifest", path: manifestPath, mediaType: "application/json" },
    manifest,
    provenance: {
      generator: "openclinxr-motion-compiler",
      license: "openclinxr-motion-clip-v1",
      spendCents: 0,
      externalNetworkUsed: false,
    },
  };
}

const REPOSITORY_ROOT = resolveRepositoryRoot();

function resolveRepositoryRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 32; depth += 1) {
    if (existsSync(resolvePath(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function bakeClipFromPayload(input: MotionPublicationInput): MotionGlbBakeClip {
  return {
    clipId: input.clipId,
    compileIdentity: { deterministicSeed: input.deterministicSeed },
    tracks: [
      {
        property: "rotationAbsoluteNodeLocal",
        boneName: "upper_armR",
        interpolation: "LINEAR",
        times: [0, 0.5, 1],
        values: [
          [0, 0, 0, 1],
          [Math.sin(0.1), 0, 0, Math.cos(0.1)],
          [0, 0, 0, 1],
        ],
      },
    ],
  };
}
