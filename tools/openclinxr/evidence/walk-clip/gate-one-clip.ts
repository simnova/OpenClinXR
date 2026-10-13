/**
 * One shared sample-and-evaluate entry for the walk-clip tools (measure, census,
 * symmetrise): sample one GLB clip through the retarget-station gate module and evaluate
 * it. The station's gateWalkClip stays package-internal for the station runner; the
 * evidence CLIs bind these two published names instead, which is what the consumer
 * contracts record.
 */

import { evaluateWalkSymmetry, sampleWalkClip } from "@openclinxr/factory-stations";
import type { WalkGateJoints, WalkGateReport } from "@openclinxr/factory-stations";

export async function gateOneClip(input: {
  glbPath: string;
  clipName: string;
  joints: WalkGateJoints;
}): Promise<WalkGateReport> {
  const { sample, frames, durationS, sha256 } = await sampleWalkClip(input);
  return {
    provenance: { glb: input.glbPath, clip: input.clipName, sha256, frames, durationS },
    ...evaluateWalkSymmetry(sample, input.joints),
  };
}
