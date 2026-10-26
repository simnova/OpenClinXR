import { createHash } from "node:crypto";
import { resolveInputBytes } from "../asset-store/resolve-store-ref.ts";

export interface CaptureChildArgs {
  outDir: string;
  glbPath: string;
  environmentId: string;
  posesFile: string;
  multiviewOnly: string;
}

export async function resolveCaptureGlb(
  glbRef: string,
  options?: { storeRoot?: string; expectedSha256?: string },
): Promise<{ glbPath: string; bytes: Buffer }> {
  const resolved = await resolveInputBytes(glbRef, { storeRoot: options?.storeRoot });
  if (options?.expectedSha256) {
    const actual = createHash("sha256").update(resolved.bytes).digest("hex");
    if (actual !== options.expectedSha256) {
      throw new Error(
        `resolveCaptureGlb: refused — ${glbRef} hashes to ${actual}, not expected ${options.expectedSha256}.`,
      );
    }
  }
  return { glbPath: resolved.filesystemPath, bytes: resolved.bytes };
}

export async function buildCaptureChildArgs(params: {
  glbRef: string;
  outDir: string;
  environmentId: string;
  posesFile: string;
  multiviewOnly: string;
  expectedSha256?: string;
  storeRoot?: string;
}): Promise<CaptureChildArgs> {
  const resolved = await resolveCaptureGlb(params.glbRef, {
    storeRoot: params.storeRoot,
    expectedSha256: params.expectedSha256,
  });
  return {
    outDir: params.outDir,
    glbPath: resolved.glbPath,
    environmentId: params.environmentId,
    posesFile: params.posesFile,
    multiviewOnly: params.multiviewOnly,
  };
}
