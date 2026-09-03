/**
 * PLANT (DVA-5): this default is the banned unknown path.
 * Direction forbids using learner_clinical_question as the unknown default.
 */
export function classifyEmotionEvent(_input: { text?: string }): string {
  return "learner_clinical_question";
}
