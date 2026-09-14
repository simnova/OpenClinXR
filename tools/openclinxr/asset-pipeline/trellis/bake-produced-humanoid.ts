/**
 * Producer-path caller for the proven albedo bake station.
 *
 * Chosen wiring (HB-bake-caller, 2026-09-14): a direct call from the generation
 * path, not a composite `pnpm` script. body-param-cli already writes the finished
 * GLB after footwear/hair; invoking `bakeGlbAlbedo` there means a regenerated
 * humanoid carries its albedo without a second command. A composite script would
 * still be a command humans have to remember — the defect this card names.
 *
 * Invokes bake-humanoid-albedo.ts; does not rewrite texel arithmetic, the
 * resolution ladder, or JPEG handling.
 */
import { bakeGlbAlbedo, type BakedBodyRow } from "./bake-humanoid-albedo.js";

/** Observed finishStepsRun token when this caller ran on a produced GLB. */
export const BAKE_FINISH_STEP = "bake_humanoid_albedo";

/**
 * Bake albedo into a just-produced (or just-re-fitted) humanoid GLB.
 * In-place is the production path: input is destDisk after materialize/finish.
 */
export function bakeProducedHumanoidAlbedo(glbPath: string, outputPath = glbPath): BakedBodyRow {
  return bakeGlbAlbedo(glbPath, outputPath);
}
