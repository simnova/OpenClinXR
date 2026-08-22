---
name: owner-memory
description: "Product owner memory protocol: the durable store at .openclinxr/owner-memory/ replaces thread-transcript memory - ledger.jsonl (append-only events), decisions.md (rulings with reasons), measurements.md (what was measured, verdicts, dead premises), calibration.md (grade strikes and vision reliability). Read on every re-open; append after every ruling or measurement. Load BEFORE answering any consult that needs prior state, and on any new-thread bootstrap."
when-to-use: "owner memory, memory store, what did we decide, prior measurement, dead premise, withdrawn claim, calibration strike, thread re-open, fresh thread bootstrap, consult history, do we already know this"
---

# Owner memory (durable, outside the thread)

The standing thread is volatile (ox-alpha empty_response ceiling) and dies with
its session id. This directory is the SSOT for owner knowledge. A fresh thread
bootstraps from here, not from a delegator-written summary.

## Layout (.openclinxr/owner-memory/, tracked in git)

| file | holds | shape |
|---|---|---|
| `ledger.jsonl` | every event: rulings, measurements, refusals, write-failures | one JSON per line: `{ts, kind, subject, verdict, refs[]}` |
| `decisions.md` | standing rulings + the reason each binds | newest first, one block per decision |
| `measurements.md` | what was measured, the number, the verdict, and DEAD premises (withdrawn claims stay visible with their correction) | one row per fact |
| `calibration.md` | pixel-grade strikes per artifact class, probe outcomes, instrument reliability notes | running table |

Rules:
- APPEND-ONLY. Never rewrite history; corrections are new rows referencing old ones.
- Every entry cites its evidence path (`tools/openclinxr/evidence/...`, commit,
  board card). An entry without a ref is INFERRED and labelled as such.
- Dead premises are first-class data: `<claim> WITHDRAWN <date> because <evidence>`.
  Re-deriving a dead premise is the failure this prevents.

## Write path

The OWNER writes via direct tool calls during a consult, immediately after the
ruling/measurement lands — not batched, not delegated. Self-check before claiming
written: read-back or listing confirmation stated in the same message
(`WRITTEN AND VERIFIED:` / `WRITE FAILED:`). The delegator NEVER authors these
files; it may run `git add` on them like any tracked artifact.

## Read path (bootstrap of any fresh thread)

1. Read all four files (~2 KB total today; grows slowly).
2. Verify against tree: last ledger line's refs resolve.
3. Then accept consults. No compressed-summary handoff from the delegator.

## Parallelism link

Before authoring any board card: grep measurements.md for the surface — if the
measurement exists, the card cites it instead of re-measuring (shared measurement
cache). Before dispatching: check ledger for open write-scopes to keep lanes
disjoint (collision avoidance). Worker outcome rows (turns, proofsOk, model) go in
ledger so N-gate decisions cite pooled evidence across workers.

## Escalation trigger (to a real database)

Move to MongoDB only when: (a) measurements.md exceeds ~500 rows making flat
grep slow, OR (b) cross-referencing requires queries grep cannot express
(multi-hop: which measurements used which worker's outputs under which model).
Until then: zero daemons, zero new infrastructure.
