/**
 * Face-realism station contract: the runner factory-stations binds plus the
 * stage entry points the station evidence sidecar replays.
 *
 * Every name here is consumed: factory-stations binds faceRealismRunner;
 * `@openclinxr/station-face-realism-evidence` binds the rest. No name the
 * sidecar needs lives off this subpath, so no `./evidence-face` seam exists.
 */
export {
  assertNoModelStage,
  EYE_SHADE_ATTEN,
  EYE_SHADE_BAND_M,
  EYE_SHADE_DARKEN,
  EYE_SHADE_REPORT_REL,
  FACE_REALISM_FIXTURE_ALBEDO_REL,
  faceRealismModelCallCount,
  faceRealismRunner,
  planChainManifest,
  planFaceRealismStation,
  prepareFixtureReplayDir,
  replayEyeShade,
  runFaceRealism,
  runReplayChain,
  runStage3Chain,
  runStage5,
  sanitizedFaceRealismEnv,
} from "./run.js";
export { cfgPinOrNull, pinGate } from "./stages-c.js";
export { stage3EntryKind } from "./stage3-entry.js";
export { stage4OutputStem } from "./stages-b.js";
export { planFaceRealism } from "./plan.js";
export { resolveRunDir } from "./run-case.js";
export { toneAnchorGate } from "./tone-anchor.js";
