/**
 * Issue #396 — the gitignored-proof-target gate, moved from post-work to pre-work.
 *
 * merge-kill's `evaluateGitignoredProofTarget` runs at LAND time, after a worker has spent turns
 * satisfying a brief whose `exists:` / `min-bytes:` proof reads a gitignored target a clean clone
 * will not have (measured 2026-08-14: #392 at 38 turns and #367 at 51 turns, both contract-green
 * and both REFUSED at land). This surface calls the SAME evaluator BEFORE the worker runs, so the
 * verdict the orchestrator sees at dispatch is exactly the verdict merge-kill would deliver at
 * land. A divergent reimplementation is refused by the contract's clause (3): the pre-flight and
 * the land must agree, or the pre-flight teaches trust in a verdict the land overturns.
 *
 * base/head here are "HEAD"/"HEAD". The branch does not exist yet, so "tracked" can only mean
 * "already in the tree a merge would start from". A target that is untracked and gitignored in
 * HEAD is refused at land UNLESS the worker force-adds it or the brief names it in
 * `gitignoredProofTargetsAllowed` — so pre-flight flags it and the orchestrator decides, before
 * any worker token is spent. Pre-flight is strictly MORE conservative than land: anything land
 * would refuse is flagged, and nothing land would accept is flagged (a target tracked in HEAD is
 * tracked in the base of any merge, so `wouldRefuse` can never flip false→true at land).
 *
 * The flag is LOUD but not fatal — see the dispatch() wiring. Refusing outright would break the
 * deliberate machine-local opt-out, and a worker may legitimately force-add the target, which is
 * exactly what the land gate then requires.
 */

import { evaluateGitignoredProofTarget, extractProofTarget } from "./merge-kill.js";

export type ProofTargetPreflightVerdict = {
  target: string;
  rule: string;
  unlandable: boolean;
  reason?: string;
};

/**
 * Pre-dispatch verdict per `exists:` / `min-bytes:` proof target, using the same evaluator
 * merge-kill calls at land (`evaluateGitignoredProofTarget`, merge-kill.ts:696).
 *
 * `allowed` is the resolved `gitignoredProofTargetsAllowed` opt-out — a target listed there is a
 * stated decision that the artifact is deliberately machine-local, and is never flagged.
 */
export function evaluateProofTargetsBeforeDispatch(
  repoRoot: string,
  proofs: readonly string[],
  allowed?: readonly string[],
): ProofTargetPreflightVerdict[] {
  const allowedSet = new Set(allowed ?? []);
  const verdicts: ProofTargetPreflightVerdict[] = [];
  for (const rule of proofs) {
    if (!rule.startsWith("exists:") && !rule.startsWith("min-bytes:")) continue;
    const target = extractProofTarget(rule);
    if (!target) continue;
    if (allowedSet.has(target)) {
      verdicts.push({
        target,
        rule,
        unlandable: false,
        reason: "listed in gitignoredProofTargetsAllowed",
      });
      continue;
    }
    const evaluation = evaluateGitignoredProofTarget(repoRoot, target, "HEAD", "HEAD");
    verdicts.push({
      target,
      rule,
      unlandable: evaluation.wouldRefuse,
      ...(evaluation.wouldRefuse
        ? {
            reason:
              `gitignored and tracked in neither base nor HEAD — a clean clone will not have it, `
              + `yet proof "${rule}" reads it. Force-add the target or name it in the brief's `
              + `gitignoredProofTargetsAllowed before landing.`,
          }
        : {}),
    });
  }
  return verdicts;
}
