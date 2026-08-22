---
name: delegator-comms
description: "MANDATORY wire format for EVERY report to the product owner (ox standing thread): the TICK template, the five signals BLOCKED / NEEDS-DECISION / CONTRADICTED / UNABLE / DONE, numbers-inline + paths-for-everything-else evidence policy, and the never-send list. Load BEFORE composing any message to the product owner, including tick reports and harvest summaries."
when-to-use: status report, tick report, report to product owner, report to ox, harvest summary, blocked, needs decision, contradicted, unable, done, what do I send, progress update
---

# Delegator → Product Owner wire format

You decompose and dispatch; the product owner (ox thread) owns direction, priority,
done-criteria, and all visual verdicts. This file is the only accepted shape for
reporting to it. Fill fields mechanically; omit nothing the template requires.

## Template — one block per slice, per tick

```
TICK <n> <UTC-date>
SLICE: #<issue> <slug>
STATE: DONE | RUNNING | BLOCKED | NEEDS-DECISION | CONTRADICTED | UNABLE   (exactly one)
TREE:  <one bullet per fact: <path> <created|modified|deleted>; cite the proof cmd + result>
MEASURE: <numbers only — counts, hashes (8-char), deltas, thresholds vs observed>
VISUAL: <artifact paths ONLY, no verdicts — PO grades>
NEXT: <the single next action you will take>
WAKE: ARMED <time> | NONE <reason>
```

Multi-slice tick = repeated SLICE…WAKE blocks. No prose outside fields.

## Signals (use the keyword, then the required payload)

- **BLOCKED:** measured cause (one line) + the exact unblock condition. Max 3 lines. Blocker ≠ halt; name the pivot slice you are taking instead.
- **NEEDS-DECISION:** options A/B(/C), one line each + the tradeoff, ending `REC: <letter>` — YOUR recommendation is mandatory. Product owner decides; silence ≠ approval.
- **CONTRADICTED:** a measurement contradicts an owner directive. Payload: `<my number> vs <directed expectation>`, source path, then `AWAITING:` on that step. Continue only on work the contradiction does not touch.
- **UNABLE:** worker escalation, verbatim line + tier/model that emitted it + the slice it blocks.
- **DONE:** valid ONLY with proofsOk + TREE facts. A DONE without tree lines is not DONE; send RUNNING.

## Evidence policy

- INLINE: numbers only. Counts, short hashes, deltas, threshold comparisons.
- BY PATH: everything else — artifacts, logs, captures, diffs, reports. Tracked repo paths preferred (`tools/openclinxr/evidence/…`); never gitignored `.openclinxr/evidence/**` for anything a contract references.
- UNKNOWN is a legal value. Write `UNKNOWN` rather than a hedge.

## Never send

Prose narrative or recap · hedges (seems/think/likely) · apologies · restated
constraints, parked lists, or licence bar (owner holds them) · your own visual
verdicts ("looks correct") · >1 NEEDS-DECISION block per tick (bundle) · any
question answerable from AGENTS.md, PROJECT_STATUS.md, or a skill body · inline
images (path + dimensions only).

## Division of labor

YOURS: mechanical verification — contract proofs, hashes, diffs, integration,
worktree hygiene, worker dispatch/resume mechanics. OWNER'S: direction, slice
selection, done-criteria, every pixel/appearance verdict, all NEEDS-DECISION
outcomes. When unsure which side a judgment falls on: it is the owner's — send
NEEDS-DECISION with a REC.
