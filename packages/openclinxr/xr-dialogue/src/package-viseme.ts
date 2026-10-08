/**
 * Public package-viseme subpath: face rig, gaze, and jaw/morph viseme drives
 * for package consumers (consumer-driven contracts, class "package").
 *
 * Narrow re-export — only the symbols real package consumers bind.
 * Apps/ui-xr keeps "."; tools and evidence use their own entrypoints.
 */
export { applyBlinkClosureToRoot } from "./blink-runtime-wire.js";
export { applyGazeToHumanoid } from "./gaze-drives-eyes.js";
export type { SpeechSlotLike } from "./viseme-runtime-wire.js";
export {
  applyGeneratedScalarVisemeToRoot,
  applyJawOpenToRoot,
  applyNamedSpeechVisemes,
  JAW_TEETH_GAIN,
} from "./viseme-runtime-wire.js";
export {
  collectResolvedMorphTargets,
  MOUTH_OPEN_CAP,
} from "./viseme-morph-apply.js";
export type {
  UiXrExpressionEmotion,
  UiXrExpressionWeights,
} from "./actor-turn-plan-consumption.js";
export { expressionWeightsForEmotion } from "./actor-turn-plan-consumption.js";
export type { PhonemeCue } from "./viseme-timeline-drive.js";
export { jawOpenRadiansForPhoneme } from "./viseme-timeline-drive.js";
