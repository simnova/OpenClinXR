/**
 * Region -> one-shot response-clip naming rule for guarding touch responses.
 *
 * The clip token is DERIVED from the compliance region, never transcribed: the
 * naming rule must answer for every vocabulary region, including the four with
 * no authored touch row, so a lookup copied out of the 24 shipped rows cannot
 * satisfy it. `abdomen_rlq` -> `rlq` keeps the one clip that has actually been
 * produced (`openclinxr_role_patient_guard_withdraw_rlq`).
 */
const GUARD_WITHDRAW_PREFIX = "openclinxr_role_patient_guard_withdraw";

/**
 * The response clip a guarding touch on `region` resolves to.
 *
 * The token follows the trace/emotion convention (`guard_chest_r_v1`,
 * `clinical_touch_guard_rlq`): the `abdomen_` prefix is dropped for quadrant
 * tokens, chest/neck keep their prefix, and sides are lowercased. Total over
 * the schema vocabulary and injective on it — every region gets its own clip.
 */
export function responseClipForBodyRegion(region: string): string {
  const trimmed = region.trim();
  if (trimmed.length === 0) {
    throw new Error("responseClipForBodyRegion: region must be a non-empty string");
  }
  const token = trimmed.replace(/^abdomen_/, "").toLowerCase();
  return `${GUARD_WITHDRAW_PREFIX}_${token}`;
}
