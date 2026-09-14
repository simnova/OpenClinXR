/** Re-export from bake directory so the plant's BAKE_MODULE = "./motion-glb-bake.js" resolves. */
export {
  bakeMotionProgramToGlb,
  readMotionGlb,
  readMotionGlbClipId,
} from "./bake/motion-glb-bake.js";
export type {
  MotionGlbBakeClip,
  MotionGlbBakeTrack,
  MotionGlbReadback,
} from "./bake/motion-glb-bake.js";