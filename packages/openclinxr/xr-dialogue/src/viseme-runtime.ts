/**
 * Public viseme runtime subpath: shipped dialogue timeline drive on the live scene graph.
 *
 * Narrow re-export — only the symbols real consumers bind. Internal constants
 * (JAW_OPEN_TEETH_CLEAR_RADIANS, JAW_TEETH_GAIN) stay inside the implementation
 * modules and are never republished here.
 */
export {
  applyDialogueVisemeTimelineToRoot,
  applyJawOpenToRoot,
  mapDialoguePhonemesToCues,
} from "./viseme-runtime-wire.js";
