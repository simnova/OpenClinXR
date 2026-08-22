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

- PROGRESS_IMPROVING: graded_transitions_1h >= prior run AND pass_rate_1h >= 0.85 AND rework_1h <= 1
- ACTIVITY_INCREASING: (completions_1h OR product_commits_1h) above rolling median while graded_transitions_1h == 0 for 2 consecutive runs, OR rework_1h >= 2
- else: NUMBERS_ONLY (report, no verdict)
- DATA_STALE: board query failed or ledger unreadable — counts as one strike toward the silence alarm

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
