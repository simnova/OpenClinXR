/**
 * Motion asset pipeline — deterministic GLB bake and manifest publication.
 *
 * Bridge between the motion-compiler bake output and the capability-gateway
 * animation-generation job. Bakes a clip to GLB bytes and prepares a local
 * zero-egress, zero-spend manifest.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { bakeMotionProgramToGlb, readMotionGlbClipId } from "../../../../packages/openclinxr/motion-compiler/src/index.ts";
import type { MotionGlbBakeClip } from "../../../../packages/openclinxr/motion-compiler/src/index.ts";

export interface MotionAssetPipelineInput {
  clip: MotionGlbBakeClip;
  jobId: string;
  sandboxWorkdir: string;
}

export interface MotionAssetPipelineOutput {
  glbPath: string;
  glbBytes: Uint8Array;
  manifestPath: string;
  manifest: MotionAssetManifest;
  provenance: MotionAssetProvenance;
}

export interface MotionAssetManifest {
  schemaVersion: "openclinxr.motion-asset-manifest.v1";
  capabilityId: "animation-generation";
  clipId: string;
  outputs: string[];
  glbByteLength: number;
  glbSha256: string;
}

export interface MotionAssetProvenance {
  generator: "openclinxr-motion-compiler";
  license: "openclinxr-motion-clip-v1";
  spendCents: 0;
  externalNetworkUsed: false;
}

export async function runMotionAssetPipeline(input: MotionAssetPipelineInput): Promise<MotionAssetPipelineOutput> {
  const { clip, jobId, sandboxWorkdir } = input;
  const glbBytes = bakeMotionProgramToGlb(clip);
  const readbackClipId = readMotionGlbClipId(glbBytes);
  if (readbackClipId !== clip.clipId) {
    throw new Error(`GLB readback clipId mismatch: expected ${clip.clipId}, got ${readbackClipId}`);
  }

  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");
  const baseDir = resolve(sandboxWorkdir, jobId);
  const glbFileName = `${clip.clipId}.glb`;
  const glbPath = resolve(baseDir, glbFileName);
  const manifestPath = resolve(baseDir, "animation-generation-manifest.json");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(glbPath, glbBytes);

  const manifest: MotionAssetManifest = {
    schemaVersion: "openclinxr.motion-asset-manifest.v1",
    capabilityId: "animation-generation",
    clipId: clip.clipId,
    outputs: [glbFileName, "animation-generation-manifest.json"],
    glbByteLength: glbBytes.length,
    glbSha256,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    glbPath,
    glbBytes,
    manifestPath,
    manifest,
    provenance: {
      generator: "openclinxr-motion-compiler",
      license: "openclinxr-motion-clip-v1",
      spendCents: 0,
      externalNetworkUsed: false,
    },
  };
}
