export type RenderCaptureClassification = {
  classification: "deterministic" | "error";
  note: string;
};

export function classifyRenderCapture(input: {
  captureExists: boolean;
  containment?: { contained: number; total: number } | undefined;
}): RenderCaptureClassification {
  const contained = input.containment?.contained ?? 0;
  const total = input.containment?.total ?? 0;
  const ratio = `${contained}/${total}`;
  if (!input.captureExists) {
    return { classification: "error", note: `capture missing; standing actor containment ${ratio}` };
  }
  if (total === 0 || contained !== total) {
    return { classification: "error", note: `capture written; standing actor containment ${ratio}` };
  }
  return { classification: "deterministic", note: `capture written; standing actor containment ${ratio}` };
}
