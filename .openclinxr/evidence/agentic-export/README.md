# Agentic export — read this before analysing the ledger

Redacted extract of the delegation record. 374 credential substrings replaced with `[REDACTED]`;
verified zero remaining hits for `sk-`, `Bearer`, `xai-`, `ghp_`, `*_KEY=`, `*_TOKEN=`.

| file | contents |
|---|---|
| `dispatch-ledger.json` | 1,156 rows = **584 unique sessions**, not 1,156 dispatches |
| `transcripts/` | 567 files, worker text + tool-call order, ledger fields attached, 600-event cap |
| `grok-session-metrics.json` | 2,362 sessions, derived counts only |

## THE TRAP — `proofsOk` is NOT on the row you expect

Measured 2026-08-23. An expert analyst read the FINAL row per session, found `proofsOk` on 12 of
584, and concluded the contract model's value **could not be determined**. That undercounts by 36x.

```
rows carrying proofsOk .................. 452
sessions with a value ................... 440 of 584  (75.3%)
sessions where two rows disagree .........   0
distribution ............................ True 378 | False 62   -> 14.1% proof-failure rate
phase of the rows carrying it ........... None 342 | "completed" 110
```

**Two historical formats.** All 342 null-phase rows predate 2026-08-23; every one of today's 20
carries `phase: "completed"` (fixed by #439). And in 330 sessions the verdict exists ONLY on a
null-phase row, with zero sessions carrying it on both.

**So: merge non-null fields across all rows sharing a `sessionId`.** Do not filter on
`phase == "completed"`, and do not take the last row.

```python
sess = {}
for r in rows:
    if r.get("sessionId"):
        sess.setdefault(r["sessionId"], {}).update({k: v for k, v in r.items() if v is not None})
```

## Other shape facts that have already misled a reader

- **Rows are lifecycle records.** 122 sessions have 1 row, 352 have 2, 110 have 3.
- **Turn caps are not a field.** A cap shows as `stopReason: "cancelled"` at exactly 50, 80, 150,
  200 or 250 turns. 45 of 584 sessions hit one.
- **`stopReason: null` with 0 turns** (25 sessions) is a death before the first turn. With turns
  (4 sessions) it is a session that never got a terminal state.
- **A clean `end_turn` proves protocol, not product.** 497 of 584 returned clean; 62 of those with
  a known verdict still failed their proofs.

## Retry storms are in here and they are the largest measurable waste

`issue-341` consumed **18 distinct sessions** including repeated 150-turn caps. `issue-436` consumed
**15**, with 24 one-turn cancellations. Both are orchestrator behaviour, not task difficulty.

NOT TESTED: whether the 62 proof failures cluster on anything the orchestrator controls. That is the
open question as of 2026-08-23 20:50 EDT.
