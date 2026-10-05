export type RenderCaptureClassification = {
  classification: "deterministic" | "error";
  note: string;
};

/**
 * Largest fraction of the 16x9 viewport ray grid allowed to hit geometry within 1 m.
 * Set 2026-10-04 from docs/openclinxr/render-framing/after.json and the coordinator's
 * native-pixel grade: the 8 frames graded good measured 0.0000-0.0625 (max: OB); the two
 * frames that passed k==N while a lying patient filled the foreground with the head
 * cropped measured 0.2847 (stepdown) and 0.3542 (psych).
 */
export const MAX_RENDER_NEAR_OCCLUSION = 0.1;

export function classifyRenderCapture(input: {
  captureExists: boolean;
  containment?: { contained: number; total: number } | undefined;
  meanFacingDeg?: number | undefined;
  nearOcclusionFraction?: number | undefined;
}): RenderCaptureClassification {
  const contained = input.containment?.contained ?? 0;
  const total = input.containment?.total ?? 0;
  const ratio = `${contained}/${total}`;
  const facing = input.meanFacingDeg;
  const near = input.nearOcclusionFraction;
  const measured = `all-actor containment ${ratio}; mean facing ${facing === undefined ? "unknown" : `${facing.toFixed(1)}deg`}; near occlusion ${near === undefined ? "unknown" : near.toFixed(4)}`;
  if (!input.captureExists) {
    return { classification: "error", note: `capture missing; ${measured}` };
  }
  if (total === 0 || contained !== total || facing === undefined || facing > 90
    || near === undefined || near > MAX_RENDER_NEAR_OCCLUSION) {
    return { classification: "error", note: `capture written; ${measured}` };
  }
  return { classification: "deterministic", note: `capture written; ${measured}` };
}
