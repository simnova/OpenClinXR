/**
 * Public evidence-viseme subpath: viseme, jaw, and morph drives for evidence
 * consumers (consumer-driven contracts, class "evidence").
 *
 * Narrow re-export — only the symbols real evidence consumers bind.
 * Apps/ui-xr keeps "."; packages and tools use their own entrypoints.
 */
export { applyBlinkClosureToRoot } from "./blink-runtime-wire.js";
export {
  applyDialogueVisemeTimelineToRoot,
  applyGeneratedScalarVisemeToRoot,
  applyJawOpenToRoot,
  JAW_TEETH_GAIN,
  mapDialoguePhonemesToCues,
} from "./viseme-runtime-wire.js";
export { applyVisemeWeights, MOUTH_OPEN_CAP, resolveMorphIndex } from "./viseme-morph-apply.js";
export {
  JAW_OPEN_TEETH_CLEAR_RADIANS,
  jawOpenRadiansForPhoneme,
} from "./viseme-timeline-drive.js";
export { phonemesForText } from "./dialogue-visemes.js";
