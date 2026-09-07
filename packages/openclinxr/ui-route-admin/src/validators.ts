/**
 * Validator-only module: every export is a validator (names starting with
 * parse / validate / assert / is / clamped). No formatters or other functions.
 */

export function clampedScoreFromInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(2, Math.max(0, parsed));
}