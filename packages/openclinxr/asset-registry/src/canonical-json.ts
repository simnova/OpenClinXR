/**
 * Stable JSON bytes for a digest: object keys sorted at every depth.
 *
 * Lives in its own module so the learner client can import
 * `encounter-bundle-admission` without pulling `scene-plan-freeze-mod`
 * (`node:crypto` + `node:fs`). The freeze path re-exports this same function.
 *
 * claimScope: canonical encoding of one JSON value.
 * notEvidenceFor: a particular hash algorithm.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}
