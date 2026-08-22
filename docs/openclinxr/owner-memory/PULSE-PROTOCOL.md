# Factory pulse — hourly self-review protocol (operator-directed 2026-08-22)

Purpose: distinguish PROGRESS IMPROVING from ACTIVITY INCREASING on measured
factory data, and change the system from what is found. Runs via the wake-hook
chain (`session-start-factory-pulse.json` -> `pnpm openclinxr:factory-pulse`),
throttled to hourly by the script itself. The delegator never interprets pulse
output; it only surfaces REFUSAL-class rows to this thread.

## Review procedure (owner, on consult or bootstrap)

1. Read last ~6 rows of `pulse.jsonl`.
2. Apply the verdict rule below; any ACTIVITY-INCREASING or two consecutive
   DATA-STALE rows forces a directive in decisions.md this consult.
3. Check provider trend: rising empty_response/inference_retry => stage workers
   <300 turns, consider model fallback before dispatching more.

## Metrics computed each run (script)

| field | source | meaning |
|---|---|---|
| completions_1h | worker-sessions.jsonl, phase=completed, at>window | execution throughput |
| pass_rate_1h | proofsOk true/(true+false) same window | contract health |
| rework_1h | distinct slices with >1 dispatched row in window | wasted execution |
| graded_transitions_1h | board 7 Factory field, items whose Factory ∈ {Landed,Graded} modified since last run (compare item id + updated timestamp set against cached previous list) | THE progress metric |
| product_commits_1h | git log --since, paths under apps/ or packages/ | product code movement |
| provider_failures_1h | unified.jsonl counts: empty_response, inference_retry, auth lock | leading failure indicator |

## Verdict rule (mechanical)

SUPERAGENT RULING 2026-08-22 (#573): this section previously specified two branches the code
never implemented, and both were wrong on measurement over 11 rows:

- REMOVED — ACTIVITY_INCREASING "(completions OR product_commits above rolling median while
  graded==0 for 2 consecutive runs)": fires 9/10 transitions in the ledger window (90%) — it is
  background noise wearing an alarm's name, not a signal.
- REJECTED — PROGRESS_IMPROVING "graded >= prior run": evaluates TRUE at a flat zero, calling a
  dead factory improving. Code uses graded > 0 (strictly positive), which is correct.

The code is now the SSOT for the rule; this doc describes it:

- DATA_STALE: any source unreadable (row carries degraded:true + null_fields). Counts toward the
  silence alarm. dispatch() refuses on a freshest-row DATA_STALE until repaired (pulse gate).
- PROGRESS_IMPROVING: graded_transitions_1h > 0 AND pass_rate_1h >= 0.85 AND rework_1h <= 1
- PRODUCING_NOTHING: graded == 0 AND product_commits == 0 AND total_commits >= 3 AND
  completions >= 3 — real execution happened, none of it touched a release lane. Reference
  input is commit VOLUME, which slice selection cannot inflate without landing release bytes.
  Fires on corrected replay of the 2026-08-22 08:51 row (total 15, completions 10, product 0).
- ACTIVITY_INCREASING: rework_1h >= 2 with completions or commits present — wasted execution,
  the delegate-retry smell. (Kept narrow; the broad median branch above was the false alarm.)
- else NUMBERS_ONLY.

product_commits_1h uses the SAME release-lane definition as dispatch()'s product-lane gate
(tools/openclinxr/openclaw/product-lane-gate.ts isProductPath). Capture harness
(apps/arena/model-vetting-studio) and loop machinery (packages/openclinxr/agent-loop,
test-harness) are NOT product; the 2026-08-22 derailment certified 6/1/11/2 "product" commits
through an inline regex before this ruling unified the definition.

Consumption (binding, not aspirational): every tick report cites the last pulse row's verdict
verbatim (R1). PRODUCING_NOTHING or ACTIVITY_INCREASING obliges a NEEDS-DECISION line in that
same tick naming the lane decision — a verdict nobody answers within one tick is the failure
mode this protocol exists to prevent.

## Sampling rule (NOT read hourly)

Claude transcripts (570 MB): never on schedule; only incident-driven.
Grok updates.jsonl per-worker transcripts: only on stalled-slice trigger.
unified.jsonl: grep counters only. Board: single item-list call, cached diff.

## Throttle

Hourly. State file `.openclinxr/openclaw/factory-pulse-last.json` holds
`{lastRun}`; script exits 0 silently if <55 min elapsed. Wake cadence (~15 min)
means most wakes no-op; every ~4th wake does full work inside the 300 s budget.

## Silence alarm

The script APPENDS a row even on partial failure (row carries `degraded:true`
and which metrics are null). Detection of true silence (no row for >90 min):
folded into the docs-hygiene hook that already runs every session start — if
`pulse-last.json` mtime is older than 90 min, it prints
`FACTORY PULSE STALE: last run <ts>` to stdout, which lands in every session's
transcript including the operator's view. No new daemon, no new reader process.

## Escalation path

ACTIVITY_INCREASING verdicts, DATA_STALE strikes, and provider-failure trends
are surfaced by the delegator in its next TICK (one line, numbers only). Owner
directives resulting from them go in decisions.md citing the pulse row.
