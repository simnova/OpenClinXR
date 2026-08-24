# MADR 0057: Model selection is a predicate, not a ladder — and a breaker needs a reason field first

Status: Proposed
Date: 2026-08-24
Issue: #626 (routing conflict), #629 (pre-flight probe), #630 (provider breaker)
Evidence:

- `.openclinxr/openclaw/worker-sessions.jsonl` — 16 deaths since 2026-08-20, measured 2026-08-24
- `packages/openclinxr/agent-loop/src/model-pricing.ts` — rates `asOf: 2026-08-03`
- `packages/openclinxr/agent-loop/src/role-harness-policy.ts:167` — the off-ladder tier
- `.claude/skills/model-routing/SKILL.md` — the operator's ladder as codified
- `tools/openclinxr/openclaw/death-reason.ts` + its contract — step 1, landed `a6b00fae`

## Context

The operator set a cost-ordered model ladder on 2026-08-23:

> ox-alpha (free), deepseek-v4-flash (cheap), deepseek-v4-flash-vision-exp (cheap with vision), grok-4.6 (not cheap)

and asked whether it should be governed by a circuit breaker with a timed reset, or by other patterns.

Three sources currently disagree about which model a worker runs: the ladder (skill), `role-harness-policy.ts:167` (resolves `standard_execution` to `deepseek-v4-pro`, which is **not on the ladder**), and `.openclinxr/openclaw/superagent-loop-prompt.md:16` (hardcodes rung 2, skipping the free rung). See #626.

## What the data says

Deaths since 2026-08-20, **like-for-like on `synthesized` contracts**:

| model | spawns | died | rate |
|---|---:|---:|---|
| ox-alpha | 36 | 7 | **19%** |
| deepseek-v4-pro | 49 | 2 | **4%** |
| deepseek-v4-flash | 19 | 0 | 0% |
| grok-4.5 | 26 | 0 | 0% |

A first pass reported ox-alpha at 26.4% (14/53 over all contract sources). That was **inflated by workload mix** — ox-alpha carries 17 of 18 `brief+dispatch` dispatches, and that contract source dies at 41% regardless of model. The corrected like-for-like gap is ~5x, not ~7x.

Shape of the failures:

- **10 of 14 ox-alpha deaths had `turns: null`** — dead before a single turn. Spawn-time, not mid-work.
- Deaths cluster in **bursts of 0.6–9 minutes**, separated by **1–7 hour quiet periods**.
- Two cross-model pairs — pro then ox 7 minutes apart on issue-585, and **34 seconds apart** on issue-608 — show de-facto rotation already happening.

## Decision

**1. Record the failure reason before building any health logic.** — LANDED (`a6b00fae`)

Death rows carried no reason. A 402, a 429, a 500 and a missing-worktree `ENOENT` were one value: `phase: "died"`. These need opposite handling:

| class | correct response |
|---|---|
| 402 billing / 401 auth | **permanent** — a human must act |
| 429 rate limit | back off, same rung |
| 5xx capacity | **the only class a breaker is for** |
| spawn `ENOENT` | **not the provider** — a harness bug |

A breaker keyed on `phase === "died"` trips identically on all five: it opens on a healthy provider when the dispatcher misfires, and retries a 402 forever. `deathCountsAgainstModel` is the field health logic must key on. Unknown deaths count against nothing — a breaker that opens on unclassified failures is worse than no breaker.

**2. A pre-flight probe before the breaker.**

10 of 14 failures happen before a turn, so they are detectable by a ~1-token completion costing a fraction of a cent, *before* paying for worktree setup, brief construction and prompt tokens. It also makes half-open safe (probe with a ping, not a real slice) and **generates the recovery-time data that does not currently exist** — nothing has ever probed a provider during an outage, so the quiet gaps are confounded by agents giving up.

**3. Circuit breaker — accepted, with three adaptations the textbook version lacks.**

- **File-backed.** Every dispatch is a separate process; an in-memory breaker — what every library provides — resets each invocation and is a no-op. State goes beside the lease and ledger.
- **Keyed on `(model, failure-class)`.** A death at turn 84 is more likely the work than the provider.
- **Single-flight half-open.** With parallel workers, "retry after N minutes" stampedes the recovering provider and re-trips it.

**Reset duration is deliberately not specified here.** It is not derivable from current data, and fitting one now is the failure `PROTO_VERIFY_DELEGATION` §9s warns about. Step 2 produces the measurement.

**4. Fallback must be observable and budgeted.**

A breaker decides when to *stop* calling. In a cost-ordered ladder, "what instead" is *the next rung, which is more expensive* — so an open breaker on the free rung silently converts an availability problem into spend. Emit an event when a rung is skipped; account spend per rung. `model-pricing.ts` has the rates (flash $0.18/1M blended, pro $0.57/1M — **3.17x**).

**5. Replace the ladder-as-list with a predicate.**

The ladder conflates three axes, which is why `role-harness-policy.ts` drifted off it unnoticed: **capability** (the vision rung is a *route*, not a fallback), **cost**, and **health** (unmeasured until now). No ordered list expresses "cheapest healthy model supporting capability X":

```
models.filter(supportsRequiredCapabilities)
      .filter(breakerClosed)
      .filter(withinBudget)
      .sortBy(costPer1M)[0]
```

The operator's ladder becomes the **cost ordering input** — which is what it is — rather than a hardcoded sequence that goes stale.

**6. "Never rotate models" is correct but mis-scoped.**

`superagent-loop-prompt.md:16` states it absolutely. It is right for a **live session** — rotating mid-work loses the transcript and `--resume` is model-bound. It is wrong as a blanket rule, because it also forbids *pre-spawn* selection, where all the value is. Scope it to live sessions. The rule is already violated in practice (the 34-second pro→ox pair above).

## Rejected

- **Hedged / parallel requests.** Duplicate LLM spend, and these are spawn failures, not tail latency.
- **Adaptive or learned routing.** Insufficient data, and unpredictable spend is the opposite of the goal.
- **Setting a breaker threshold now.** See step 2 — the input measurement does not exist.
- **Reclassifying the 16 historical deaths.** Those rows carry no stderr and are permanently unclassifiable. Recorded so nobody attempts it.

## Consequences

- Health becomes measurable per provider without conflating harness defects with provider failures.
- Cost policy gains a place to live that is not a hardcoded list in three disagreeing files.
- Steps 3–5 stay blocked on #626's disposition, because that decision changes what the predicate sorts by. That is deliberate sequencing, not delay.

## claimScope / notEvidenceFor

- **claimScope:** the measured failure rates and shapes above as of `a6b00fae`, and the design position that selection is a predicate over capability/health/budget/cost.
- **notEvidenceFor:** any breaker threshold or reset window; whether ox-alpha should be demoted (a cost/reliability tradeoff that is the operator's call, tracked in #626); why ox-alpha fails more (not diagnosed — could be capacity, auth, or free-tier limits); or that the classifier's end-to-end hop has been exercised (it has not — the probe was correctly refused by the product-lane gate).
