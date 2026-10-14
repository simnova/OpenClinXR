/**
 * Claim-scope denials published on every bedside-approach evidence object.
 * Split out of `station-bedside-approach-mod.ts` to clear that file's 500-line
 * budget; the list is unchanged, only the module boundary moved.
 */
export const BEDSIDE_APPROACH_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "worn_headset_readiness",
  "public_deployment",
  "gait_realism",
  "scoring_validity",
] as const;
