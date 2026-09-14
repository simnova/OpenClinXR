/**
 * Motion asset pipeline — deterministic GLB bake and manifest publication.
 *
 * This module provides the bridge between the motion-compiler bake output and the
 * capability-gateway animation-generation job. It reads the compiled clip, bakes
 * it to GLB bytes, and prepares the manifest with license provenance.
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { bakeMotionProgramToGlb, readMotionGlbClipId } from "@openclinxr/motion-compiler";
import type { CompiledMotionClipV1 } from "@openclinxr/motion-compiler";

export interface MotionAssetPipelineInput {
  clip: CompiledMotionClipV1;
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

/**
 * Runs the motion asset pipeline: bakes the clip to GLB, writes artifacts, and returns manifest.
 */
export async function runMotionAssetPipeline(input: MotionAssetPipelineInput): Promise<MotionAssetPipelineOutput> {
  const { clip, jobId, sandboxWorkdir } = input;

  // Bake the clip to GLB
  const glbBytes = bakeMotionProgramToGlb(clip);

  // Verify readback
  const readbackClipId = readMotionGlbClipId(glbBytes);
  if (readbackClipId !== clip.clipId) {
    throw new Error(`GLB readback clipId mismatch: expected ${clip.clipId}, got ${readbackClipId}`);
  }

  // Compute GLB hash
  const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");

  // Prepare output paths
  const baseDir = resolve(sandboxWorkdir, jobId);
  const glbFileName = `${clip.clipId}.glb`;
  const glbPath = resolve(baseDir, glbFileName);
  const manifestPath = resolve(baseDir, "animation-generation-manifest.json");

  // Ensure directory exists
  mkdirSync(baseDir, { recursive: true });

  // Write GLB
  writeFileSync(glbPath, glbBytes);

  // Build manifest
  const manifest: MotionAssetManifest = {
    schemaVersion: "openclinxr.motion-asset-manifest.v1",
    capabilityId: "animation-generation",
    clipId: clip.clipId,
    outputs: [glbFileName, "animation-generation-manifest.json"],
    glbByteLength: glbBytes.length,
    glbSha256,
  };

  // Write manifest
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const provenance: MotionAssetProvenance = {
    generator: "openclinxr-motion-compiler",
    license: "openclinxr-motion-clip-v1",
    spendCents: 0,
    externalNetworkUsed: false,
  };

  return {
    glbPath,
    glbBytes,
    manifestPath,
    manifest,
    provenance,
  };
}