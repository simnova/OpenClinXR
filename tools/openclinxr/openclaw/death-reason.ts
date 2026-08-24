/**
 * Why a dispatch died — classified from the child's exit code and stderr.
 *
 * WHY THIS EXISTS. Death rows carried `at, contractSource, model, phase, role, sessionId, slice,
 * turns, worktree` and NO failure reason. Measured 2026-08-24 over the 16 deaths since 2026-08-20:
 * every one was indistinguishable from every other. That makes provider health unmeasurable, because
 * these five need opposite handling and all present as `phase: "died"`:
 *
 *   402 billing      -> PERMANENT. A human must act. Retrying spends nothing and fixes nothing.
 *   401 auth         -> PERMANENT. Same.
 *   429 rate limit   -> TRANSIENT, self-clearing. Back off on the SAME rung.
 *   5xx capacity     -> TRANSIENT, correlated. This is the only class a circuit breaker is for.
 *   spawn ENOENT     -> NOT THE PROVIDER AT ALL. A harness bug — `dispatch({worktree: <missing>})`
 *                       reports a missing cwd by naming the COMMAND, so it reads as a dead binary.
 *                       PROTO_VERIFY_DELEGATION records that exact trap.
 *
 * A breaker keyed on "died" trips identically on all five, and would open on a healthy provider
 * because of a harness defect. So this classification is the PREREQUISITE for provider health, not
 * a nicety — it is step 1 of the ladder review, and steps 2-5 are unbuildable without it.
 *
 * DELIBERATELY NOT A BREAKER. This module only labels. It holds no state, makes no routing decision,
 * and does not decide what is retryable — `retryability` is a property of the CLASS, reported here
 * so a caller can act, but the acting belongs elsewhere. Keeping the labeller pure is what lets it
 * be tested against real stderr without a provider.
 */

export type DeathClass =
  | "billing"        // 402 / insufficient balance — permanent until a human pays
  | "auth"           // 401 / 403 / bad key — permanent until a human fixes credentials
  | "rate_limit"     // 429 — transient, self-clearing, back off on the same rung
  | "provider_error" // 5xx / upstream — transient and correlated; breaker territory
  | "harness"        // spawn/ENOENT/cwd — not the provider; never counts against a model
  | "timeout"        // no output within the harness window
  | "cancelled"      // killed by a human or a reaper
  | "unknown";       // classified honestly rather than guessed

export type Retryability = "permanent" | "transient" | "not_provider" | "unknown";

export type DeathReason = {
  deathClass: DeathClass;
  retryability: Retryability;
  /** Whether this death may count against the MODEL's health. False for harness and cancellation. */
  countsAgainstModel: boolean;
  exitCode: number | null;
  /** The stderr line the classification came from, trimmed. Empty when nothing matched. */
  evidence: string;
};

const RULES: Array<{ cls: DeathClass; retry: Retryability; counts: boolean; re: RegExp }> = [
  // Harness first: a missing cwd is reported by naming the COMMAND, so it looks like a dead binary
  // and would otherwise be misread as a provider failure.
  { cls: "harness", retry: "not_provider", counts: false, re: /\bENOENT\b|spawn \S+ ENOENT|no such file or directory|not a git repository/iu },
  { cls: "billing", retry: "permanent", counts: true, re: /\b402\b|insufficient (?:balance|credit|funds)|payment required|quota exceeded/iu },
  { cls: "auth", retry: "permanent", counts: true, re: /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|authentication/iu },
  { cls: "rate_limit", retry: "transient", counts: true, re: /\b429\b|rate limit|too many requests/iu },
  { cls: "provider_error", retry: "transient", counts: true, re: /\b5\d\d\b|internal server error|bad gateway|service unavailable|upstream|overloaded/iu },
  { cls: "timeout", retry: "transient", counts: true, re: /\btimed? ?out\b|ETIMEDOUT|deadline exceeded/iu },
  { cls: "cancelled", retry: "not_provider", counts: false, re: /\bSIGTERM\b|\bSIGKILL\b|killed|cancell?ed by user/iu },
];

/**
 * Classifies one death. `stderr` is the child's captured stderr; `exitCode` its close code.
 *
 * Order matters and is asserted by the contract: `harness` is tested BEFORE provider classes, so a
 * missing worktree never reads as a dead provider. Within provider classes the first match wins, and
 * a message carrying two signals (a 402 delivered inside a 500 envelope) is reported as the more
 * actionable one — billing, because retrying it is pure waste.
 */
export function classifyDeath(stderr: string, exitCode: number | null): DeathReason {
  const text = (stderr ?? "").slice(0, 4000);
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const line = text.split(/\r?\n/u).find((l) => rule.re.test(l))?.trim() ?? m[0];
    return {
      deathClass: rule.cls,
      retryability: rule.retry,
      countsAgainstModel: rule.counts,
      exitCode,
      evidence: line.slice(0, 200),
    };
  }
  // SIGTERM/SIGKILL arrive as a null or 143/137 exit with no stderr at all when a reaper takes the
  // process — the mass-reap case PROTO_VERIFY_DELEGATION §7i calls an ordinary event here.
  if (exitCode === 143 || exitCode === 137) {
    return { deathClass: "cancelled", retryability: "not_provider", countsAgainstModel: false, exitCode, evidence: `exit ${exitCode}` };
  }
  return { deathClass: "unknown", retryability: "unknown", countsAgainstModel: false, exitCode, evidence: "" };
}
