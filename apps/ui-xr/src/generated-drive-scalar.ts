/**
 * Generated drive channels -> scalar intensities (#362).
 *
 * A drive channel value may arrive as:
 *   - a number                                -> that number (finite only)
 *   - a boolean                               -> 1 | 0
 *   - a numeric string                        -> that number
 *   - a `{ value, label }` scalar object      -> `value` (the case-authored number; `label` is a
 *                                               human-readable string beside the number and is
 *                                               never parsed — D9: prose is not the number's source)
 *   - prose                                   -> a keyword level (0.85 / 0.55 / 0.25), or the
 *                                               sane default for prose matching no list
 *   - null | undefined                        -> null (absent channel; the guarded consumer call
 *                                               does not fire)
 *
 * PRE-#362 (measured 2026-08-13): unmatched prose resolved to `null`, which silently killed the
 * channel — `"on family concern from case"` was the one shipped literal of three that resolved
 * null. The contract lives in `generated-drive-scalar.test.ts`: every drive-channel prose string in
 * the tree must resolve non-null, and a synthetic literal outside every keyword list must too.
 *
 * Extracted from `apps/ui-xr/src/main.ts` (was `generatedDriveScalar`, main.ts:8214-8239) — pure
 * move, no behaviour change in the extract step; the D9 fix (scalar objects + sane default) landed
 * on top in the same slice.
 */

export type GeneratedDriveScalarValue = {
  /** Case-authored intensity — the number's source of truth (never prose wording). */
  value: number;
  /** Human-readable label beside the number; never parsed. */
  label?: string | null;
};

export type GeneratedDriveScalarInput =
  | boolean
  | number
  | string
  | GeneratedDriveScalarValue
  | null
  | undefined;

/** Sane default for prose matching no keyword list: an unmatched literal must degrade, not die. */
export const GENERATED_DRIVE_DEFAULT_SCALAR = 0.55;

export function generatedDriveScalar(value: GeneratedDriveScalarInput): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "object") {
    return typeof value.value === "number" && Number.isFinite(value.value)
      ? value.value
      : GENERATED_DRIVE_DEFAULT_SCALAR;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("high") || normalized.includes("urgent") || normalized.includes("escalation")) {
    return 0.85;
  }
  if (normalized.includes("medium") || normalized.includes("moderate") || normalized.includes("anxious")) {
    return 0.55;
  }
  if (normalized.includes("low") || normalized.includes("subtle") || normalized.includes("reassured")) {
    return 0.25;
  }
  return GENERATED_DRIVE_DEFAULT_SCALAR;
}
