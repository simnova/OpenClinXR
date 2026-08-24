import { describe, expect, it } from "vitest";
import { classifyDeath } from "./death-reason.js";

/**
 * OBSERVABLE: a dispatch death records no reason, so provider health is unmeasurable.
 *
 * MEASURED 2026-08-24 over the 16 deaths in `.openclinxr/openclaw/worker-sessions.jsonl` since
 * 2026-08-20. Every death row carries exactly:
 *   at, contractSource, model, phase, role, sessionId, slice, turns, worktree
 * and nothing about WHY. A 402, a 429, a 500 and a missing-worktree ENOENT are one value:
 * `phase: "died"`.
 *
 * WHY IT MATTERS RIGHT NOW. The measured failure split by model, on like-for-like `synthesized`
 * contracts, is ox-alpha 7/36 (19%) against deepseek-v4-pro 2/49 (4%). That is the evidence being
 * used to weigh the operator's cost-ordered model ladder (#626) — and it cannot distinguish "this
 * provider is unreliable" from "the harness handed it a worktree that did not exist". The repo's own
 * PROTO_VERIFY_DELEGATION records that `dispatch({worktree: <missing path>})` dies as
 * `spawn <grok binary> ENOENT`, naming the COMMAND rather than the directory — a harness bug that
 * reads exactly like a dead provider.
 *
 * A circuit breaker keyed on `phase === "died"` would therefore open on a HEALTHY provider because
 * of a harness defect, and would retry a 402 forever. This classification is the prerequisite for
 * every later step of that review, not a convenience.
 *
 * SCOPE. This contract covers the LABELLER only. It asserts nothing about breaker thresholds, reset
 * windows, retry policy, or routing — those need recovery-time data that does not exist yet,
 * precisely because nothing has ever probed a provider during an outage.
 *
 * claimScope: that a death is classified into an actionable class, and that harness failures and
 *   cancellations never count against a model's health.
 * notEvidenceFor: any breaker threshold, whether ox-alpha should be demoted, retry policy, or
 *   whether the classification of any historical death can be recovered (it cannot — those rows have
 *   no stderr and are permanently unclassifiable).
 */

describe("a death without a reason cannot measure a provider", () => {
  it("(1) RED: a missing worktree is a HARNESS failure and must not count against the model", () => {
    // The exact shape PROTO_VERIFY_DELEGATION documents. Node reports a missing cwd by naming the
    // command, so this is the single most misleading death in the corpus.
    const r = classifyDeath("Error: spawn /Users/patrick/.grok/bin/grok ENOENT", 1);
    expect(r.deathClass).toBe("harness");
    expect(r.retryability).toBe("not_provider");
    expect(
      r.countsAgainstModel,
      "a harness bug scored against a provider is how a breaker opens on a healthy model",
    ).toBe(false);
  });

  it("(2) RED: billing is permanent — retrying a 402 spends nothing and fixes nothing", () => {
    const r = classifyDeath("API error 402: Insufficient balance for this request", 1);
    expect(r.deathClass).toBe("billing");
    expect(r.retryability).toBe("permanent");
    expect(r.countsAgainstModel).toBe(true);
  });

  it("(3) RED: 429 and 5xx are both transient but are DIFFERENT classes", () => {
    // They need different responses — back off on the same rung vs. treat the provider as sick —
    // so collapsing them into one "transient" label loses the distinction that matters.
    expect(classifyDeath("429 Too Many Requests", 1).deathClass).toBe("rate_limit");
    expect(classifyDeath("503 Service Unavailable: upstream overloaded", 1).deathClass).toBe("provider_error");
    expect(classifyDeath("429 Too Many Requests", 1).retryability).toBe("transient");
    expect(classifyDeath("503 Service Unavailable", 1).retryability).toBe("transient");
  });

  it("(4) COUNTERWEIGHT: a reaped process is not a provider failure", () => {
    // PROTO_VERIFY_DELEGATION §7i: background dispatches get reaped and it is an ordinary event in
    // this environment. Four kill events were measured in one session. Scoring those against a model
    // would make the most-used model look the worst purely by exposure.
    const sig = classifyDeath("", 143);
    expect(sig.deathClass).toBe("cancelled");
    expect(sig.countsAgainstModel).toBe(false);
    expect(classifyDeath("child killed by SIGKILL", null).countsAgainstModel).toBe(false);
  });

  it("(5) COUNTERWEIGHT: an unrecognised death is 'unknown' and counts against NOTHING", () => {
    // The conservative direction is deliberate. An unclassified death might be a harness bug, so
    // counting it against a model would reintroduce the exact defect this module removes. A breaker
    // that opens on unknowns is worse than no breaker.
    const r = classifyDeath("something nobody has seen before", 1);
    expect(r.deathClass).toBe("unknown");
    expect(r.retryability).toBe("unknown");
    expect(r.countsAgainstModel).toBe(false);
    expect(r.evidence, "no evidence is honest; a fabricated match is not").toBe("");
  });

  it("(6) COUNTERWEIGHT: harness is tested BEFORE provider classes, and evidence is carried", () => {
    // Order is load-bearing, not incidental. A harness message that happens to contain a number in
    // the 5xx range must still classify as harness.
    const r = classifyDeath("spawn grok ENOENT after 500 attempts", 1);
    expect(r.deathClass, "harness must win over an incidental 5xx-looking token").toBe("harness");
    expect(r.evidence, "the classifying line is carried so a human can check the call").toContain("ENOENT");
    expect(r.exitCode).toBe(1);
  });

  it("(7) COUNTERWEIGHT: a 402 delivered inside a 500 envelope reports the ACTIONABLE class", () => {
    // Real providers wrap billing refusals in server errors. Reporting this as transient would send
    // a breaker into a retry loop against a wall that only a human can remove.
    const r = classifyDeath("500 Internal Server Error: upstream said 402 insufficient balance", 1);
    expect(r.deathClass).toBe("billing");
    expect(r.retryability).toBe("permanent");
  });
});
