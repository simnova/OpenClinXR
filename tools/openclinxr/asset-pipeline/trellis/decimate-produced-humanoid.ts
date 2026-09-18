/**
 * Producer-path caller for the proven face-preserving decimation station.
 *
 * Chosen wiring (HB-decimate-caller, 2026-09-14): a direct call from the generation
 * path, not a composite `pnpm` script. body-param-cli already writes the finished
 * GLB after the albedo bake; invoking `decimateProducedHumanoid` there means a
 * regenerated humanoid carries its decimation without a second command. A composite
 * script would still be a command humans have to remember — the defect this card names.
 *
 * Runs AFTER the bake: HB-05's reproduceCommands take `--input <hb02-bytes>` (the
 * baked bytes), so the ladder ran on post-bake input. In-place, unconditional, at
 * fp-r0.4 — the same rung HB-05 used on mpfb-ob-patient-aisha and
 * mpfb-peds-parent-aisha. Rung policy (budget-conditional vs unconditional) is out
 * of scope for the wiring card; reachability is the asserted property.
 *
 * Invokes iterate-optimize.ts; does not rewrite its ladder, ratios, error value,
 * face rule, hand rule or budgets.
 */
import { MeshoptSimplifier } from "meshoptimizer";
import { countFaceTris, facePreservingError, writeFacePreservingRung } from "./iterate-optimize.js";

/** Rung applied by the producing path (HB-05 rung on the two aisha bodies). */
export const DECIMATE_RUNG_RATIO = 0.4;
export const DECIMATE_RUNG_ID = "fp-r0.4";

/** Observed finishStepsRun token when this caller ran on a produced GLB. */
export const DECIMATE_FINISH_STEP = "decimate_face_preserving_fp_r0_4";

export type DecimatedBodyRow = {
  rungId: string;
  ratio: number;
  error: number;
  trisBefore: number;
  trisAfter: number;
  faceAfter: number;
};

/**
 * Decimate a just-produced (post-bake) humanoid GLB.
 * In-place is the production path: input is destDisk after bake.
 */
export async function decimateProducedHumanoid(
  glbPath: string,
  outputPath = glbPath,
): Promise<DecimatedBodyRow> {
  const before = await countFaceTris(glbPath);
  await MeshoptSimplifier.ready;
  const after = await writeFacePreservingRung(glbPath, outputPath, DECIMATE_RUNG_RATIO);
  // 2026-09-18 eyebrow-visibility: the face-preserving rung must NEVER touch the
  // brow (FACE_RE exclusion in iterate-optimize.ts). A face-total drop after the
  // rung means the brow/eyes/lashes were simplified — fail loudly, do not ship.
  if (after.face < before.face) {
    throw new Error(
      `decimate face regression: face tris ${before.face} -> ${after.face} ` +
        `(brow must be excluded from the fp-r0.4 rung)`,
    );
  }
  return {
    rungId: DECIMATE_RUNG_ID,
    ratio: DECIMATE_RUNG_RATIO,
    error: facePreservingError(),
    trisBefore: before.tris,
    trisAfter: after.tris,
    faceAfter: after.face,
  };
}
