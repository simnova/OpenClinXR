/**
 * Promotion IO record validation (moved from apps/api composition root).
 *
 * Validator-only module: the isRecord predicate plus reviewStatesFromRecord,
 * which reads the four review-gate strings off an unknown review payload.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reviewStatesFromRecord(review: unknown): Record<string, string> {
  if (!isRecord(review)) return {};
  const read = (role: string): string =>
    typeof review[role] === "string" ? (review[role] as string) : "";
  return {
    clinical: read("clinical"),
    psychometric: read("psychometric"),
    legal: read("legal"),
    simulationQa: read("simulationQa"),
  };
}
