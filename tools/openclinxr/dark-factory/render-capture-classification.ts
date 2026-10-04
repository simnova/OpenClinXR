export type RenderCaptureClassification = {
  classification: "deterministic" | "error";
  note: string;
};

export function classifyRenderCapture(input: {
  captureExists: boolean;
  containment?: { contained: number; total: number } | undefined;
  meanFacingDeg?: number | undefined;
}): RenderCaptureClassification {
  const contained = input.containment?.contained ?? 0;
  const total = input.containment?.total ?? 0;
  const ratio = `${contained}/${total}`;
  const facing = input.meanFacingDeg;
  const measured = `all-actor containment ${ratio}; mean facing ${facing === undefined ? "unknown" : `${facing.toFixed(1)}deg`}`;
  if (!input.captureExists) {
    return { classification: "error", note: `capture missing; ${measured}` };
  }
  if (total === 0 || contained !== total || facing === undefined || facing > 90) {
    return { classification: "error", note: `capture written; ${measured}` };
  }
  return { classification: "deterministic", note: `capture written; ${measured}` };
}
