import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import { bakeMotionProgramToGlb, readMotionGlbClipId } from "@openclinxr/motion-compiler";
import type { MotionGlbBakeClip } from "@openclinxr/motion-compiler";

import type {
  AssetGenerationArtifact,
  AssetGenerationManifest,
  AssetGenerationProvenance,
  AssetGenerationWorkerAdapter,
} from "./asset-generation-jobs.js";

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
 * Animation-generation worker: publishes the motion GLB under clip identity with
 * local-only, zero-spend license provenance.
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
        clipId?: unknown;
        requestId?: unknown;
        motionProgramHash?: unknown;
        deterministicSeed?: unknown;
      };
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
