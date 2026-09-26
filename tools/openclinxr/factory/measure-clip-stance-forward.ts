import { boundClipJointTrack } from "../evidence/foot-plant/bound-clip-foot-track.js";
import { measureStanceGroundAdvance } from "../../../packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime-mod.js";
import { FOOT_CONTACT_HEIGHT_METERS } from "../../../packages/openclinxr/asset-registry/src/approach-executor-mod.js";

/**
 * Measure a bound clip's own stance-advance direction and speed, OFFLINE, using the SAME
 * production functions the runtime uses at playback time (`measureStanceGroundAdvance`), not a
 * re-derivation. Read directly from the exported GLB's animation sampler data via
 * `boundClipJointTrack` (forward kinematics over the glTF bytes) -- no browser, no Blender.
 *
 * WHY THIS EXISTS: the kimodo cagematch (docs/openclinxr/kimodo-mlx-bedside-approach-cagematch-
 * 2026-09-26.md) needed this measurement by hand, round after round, first via an ad hoc scratch
 * script and then by reading it back from a live browser capture's own diagnostic global
 * (`__openClinXrBedsideApproachClipForwardDiagnostic`, `station-bedside-approach-mod.ts`). The
 * `kimodo-walk-loop-station.py` factory station needs the SAME measurement as an internal,
 * deterministic step (bind once, measure, correct, bind again) with no browser dependency --
 * this is that measurement, promoted from scratch and reused by both.
 *
 * `clipYawDeg` is exactly the number `travelYawForClipForward` (xr-runtime-state) would compute
 * from this clip's own `forward` vector: `atan2(forward.x, forward.z)` in degrees. The shipped
 * physician's own walk clip measures close to 0 degrees (its rig's canonical +Z) -- a target clip
 * measuring far from that is the "crabbing" symptom this cagematch's rounds 9-12 diagnosed.
 *
 * claimScope: one named clip's own measured stance-foot advance direction and speed, read from the
 * GLB's animation data alone (no slot, no runtime, no browser).
 * notEvidenceFor: what the runtime will measure once the clip is actually played (its own contact-
 * band, sample-count and windowing may differ slightly); gait realism; clinical plausibility.
 */
export type ClipStanceForward = {
  metersPerSecond: number;
  forward: { x: number; z: number };
  windowFrames: number;
  clipYawDeg: number;
};

export async function measureClipStanceForward(
  glbPath: string,
  clipName: string,
  footBone = "toe1-1.L",
): Promise<ClipStanceForward> {
  const track = await boundClipJointTrack({ glbPath, clipName, boneName: footBone });
  const advance = measureStanceGroundAdvance(track.samples, {
    contactBandMeters: FOOT_CONTACT_HEIGHT_METERS,
    floorOriginY: 0,
  });
  const clipYawDeg = (Math.atan2(advance.forward.x, advance.forward.z) * 180) / Math.PI;
  return {
    metersPerSecond: advance.metersPerSecond,
    forward: advance.forward,
    windowFrames: advance.windowFrames,
    clipYawDeg,
  };
}

async function main(): Promise<void> {
  const [, , glbPath, clipName, footBone] = process.argv;
  if (!glbPath || !clipName) {
    process.stderr.write("usage: measure-clip-stance-forward.ts <glbPath> <clipName> [footBone=toe1-1.L]\n");
    process.exit(2);
  }
  const result = await measureClipStanceForward(glbPath, clipName, footBone);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1]?.endsWith("measure-clip-stance-forward.ts")) await main();
