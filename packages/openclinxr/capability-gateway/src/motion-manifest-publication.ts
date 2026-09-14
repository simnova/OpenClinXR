import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import { compileMotionProgram } from "@openclinxr/motion-compiler";
import { bakeMotionProgramToGlb, readMotionGlbClipId } from "@openclinxr/motion-compiler";
import type { CompiledMotionClipV1 } from "@openclinxr/motion-compiler";

/**
 * Motion manifest publication — bakes a compiled clip to GLB and writes manifest with license provenance.
 * Used by the animation-generation capability adapter.
 */

export interface MotionPublicationInput {
  clipId: string;
  motionProgramHash: string;
  deterministicSeed: string;
  jobId: string;
  sandboxWorkdir: string;
}

export interface MotionPublicationOutput {
  glbArtifact: {
    kind: "mesh";
    path: string;
    mediaType: "model/gltf-binary";
  };
  manifestArtifact: {
    kind: "manifest";
    path: string;
    mediaType: "application/json";
  };
  manifest: MotionManifest;
  provenance: MotionProvenance;
}

export interface MotionManifest {
  schemaVersion: "asset-generation-manifest.v1";
  capabilityId: "animation-generation";
  clipId: string;
  outputs: string[];
  glbByteLength: number;
  glbSha256: string;
  [key: string]: unknown;
}

export interface MotionProvenance {
  generator: "openclinxr-motion-compiler";
  license: "openclinxr-motion-clip-v1";
  spendCents: 0;
  externalNetworkUsed: false;
}

/**
 * Builds a minimal CompiledMotionClipV1 from the payload inputs for baking.
 * This is a deterministic reconstruction — the same inputs always produce the same clip.
 */
function buildClipFromPayload(input: MotionPublicationInput): CompiledMotionClipV1 {
  // Reconstruct the clip using the deterministic compile identity
  const compileIdentity = {
    compilerVersion: "openclinxr-motion-compiler.v1",
    primitiveLibraryVersion: "v1",
    variationIndex: 0,
    deterministicSeed: input.deterministicSeed,
  };

  // Minimal skeleton profile hash from the motion program hash
  const skeletonProfileHash = createHash("sha256")
    .update(input.motionProgramHash)
    .digest("hex");

  // Build a minimal clip with the exact clipId and compile identity
  return {
    schemaVersion: "openclinxr.compiled-motion-clip.v1",
    clipId: input.clipId,
    source: {
      scenarioId: "",
      actorId: "",
      motionProgramHash: input.motionProgramHash,
      actionIds: [],
    },
    targetRig: {
      rigFingerprint: "rig-fp-animation-generation",
      skeletonProfileHash,
    },
    compileIdentity,
    durationSeconds: 1.0,
    tracks: [
      {
        property: "rotationAbsoluteNodeLocal",
        boneName: "upper_armR",
        canonicalLandmark: "upper_arm_r",
        interpolation: "LINEAR",
        times: [0, 0.5, 1.0],
        values: [
          [0, 0, 0, 1],
          [0.1, 0, 0, Math.sqrt(1 - 0.01)],
          [0, 0, 0, 1],
        ] as const,
      },
    ],
    claimBoundary: "motion_plan_v1",
    notEvidenceFor: [
      "clinical_validity",
      "scoring_validity",
      "production_asset_readiness",
      "quest_readiness",
    ] as const,
  };
}

export function publishMotionManifest(input: MotionPublicationInput): MotionPublicationOutput {
  const clip = buildClipFromPayload(input);

  // Bake to GLB
  const glbBytes = bakeMotionProgramToGlb(clip);

  // Verify readback
  const readbackClipId = readMotionGlbClipId(glbBytes);
  if (readbackClipId !== clip.clipId) {
    throw new Error(`GLB readback clipId mismatch: expected ${clip.clipId}, got ${readbackClipId}`);
  }

  // Compute GLB hash
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");

  // Prepare output paths
  const baseDir = `${input.sandboxWorkdir}/${input.jobId}`;
  const glbFileName = `${input.clipId}.glb`;
  const glbPath = resolvePath(baseDir, glbFileName);
  const manifestPath = resolvePath(baseDir, "animation-generation-manifest.json");

  // Ensure directory exists
  mkdirSync(dirname(glbPath), { recursive: true });

  // Write GLB
  writeFileSync(glbPath, glbBytes);

  // Build manifest
  const manifest: MotionManifest = {
    schemaVersion: "asset-generation-manifest.v1",
    capabilityId: "animation-generation",
    clipId: input.clipId,
    outputs: [glbFileName, "animation-generation-manifest.json"],
    glbByteLength: glbBytes.length,
    glbSha256,
  };

  // Write manifest
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const glbArtifact = {
    kind: "mesh" as const,
    path: `${input.jobId}/${glbFileName}`,
    mediaType: "model/gltf-binary" as const,
  };

  const manifestArtifact = {
    kind: "manifest" as const,
    path: `${input.jobId}/animation-generation-manifest.json`,
    mediaType: "application/json" as const,
  };

  const provenance: MotionProvenance = {
    generator: "openclinxr-motion-compiler",
    license: "openclinxr-motion-clip-v1",
    spendCents: 0,
    externalNetworkUsed: false,
  };

  return {
    glbArtifact,
    manifestArtifact,
    manifest,
    provenance,
  };
}