---
name: dense-agent-protocol
description: >
  Format for AGENT-TO-AGENT text only - worker briefs, handbacks, consult prompts, result
  envelopes, and BothyBoard card fields (objective / knownGood / outOfScope / notTested), which
  have strict length limits. Keyed dense records (KEY::value), numbered ids, constraint
  predicates, sourced WHY lines. Load BEFORE writing a brief, a handback, a consult prompt or a
  board card. NOT for operator-facing prose (operator-prose governs that), commits or code comments.
---

# Dense agent protocol (DENSE_v1)

Operator direction 2026-10-13: agent-to-agent prose uses the keyed dense form "if it yields more
accurate, precise and terse communications", and it may be used for what is written to the board.
Source document: `OpenClinXR_GA_Swarm_Exploration_Brief.md` (FORMAT::DENSE_PROTOCOL_v0.1).
Merged with the 2026-10-05 approved brief keys (GOAL / PREM / GATE / SCOPE / STOP / OUT + sourced WHY).

## What was measured, and what was not

A/B 2026-10-13, one brief (Imagine scalp task), prose 5,252 chars vs dense 4,240 chars (-19%),
muse-spark-1-go, single turn, 12 recall questions, 2 runs per arm:

| arm | correct of 12 | note |
|---|---|---|
| prose | 12, 12 | |
| dense | 11, 11 | both runs dropped one of two stop conditions |

The miss is the format's characteristic failure: the dense brief had a `STOP::` key holding one stop
condition and a second stop condition nested inside another record. A labelled key reads as the
COMPLETE answer for its concept. Recall was otherwise equal. NOT TESTED: execution accuracy over a
full worker run, other models, total token cost (system prompt dominates a single call: 12-19k
input tokens against ~250 saved).

So the measured gain is size and addressable ids, not accuracy. Use it; obey rule 1.

## Rules

1. **One key holds the whole set for its concept.** Every stop condition under STOP, every forbidden
   thing under FORBID, every write path under SCOPE. A condition placed anywhere else is lost.
2. **Keep the operator in the value.** `feather >= 96 texels`, never `feather 96`. Units always.
3. **Every non-obvious claim carries its source**: `WHY::<claim> ∵ <cause> [<kind>:<source>]`,
   kind in {op, meas, inv, ref} = operator said / measured / invariant / reference. No source, no WHY.
   A threshold is `metric op value [src]`; an unsourced number is rejected (contract-design).
4. **State UNKNOWN as UNKNOWN.** `CAUSE::UNKNOWN (candidates: a | b | c)`. Never compress a guess
   into a fact; a confident wrong diagnosis costs more than none.
5. **Ids are stable and referenced by id** (R1, F2, M4, X3, Q1). A handback cites the id it corrects.
6. **Failed treatments are records, not prose**: `F<n>::<treatment> → <what it produced> [src]`.
7. **Paths, commands and identifiers verbatim**, in backticks when they contain spaces or flags.
8. **No invented symbols.** Allowed: `::` `→` `⇒` `∧` `∨` `∵` `|` `≥` `≤` `=` `≠` `∥`. Anything else is a word.
9. **Human-facing text is exempt.** Operator reports stay plain prose. A board TITLE stays readable.

## Brief skeleton

```
# BRIEF::<slug> | FORMAT::DENSE_v1 | ROLE::<worker|reviewer|scout>
S::<scratch root>                      # path aliases first
## RULES      R<n>::...                # environment, prefixes, tool rules
## SCOPE      write = <paths> ; read = <paths>
## FORBID     <complete list>
## DEFECT     D<n>::<what is wrong> [meas:<file>]   GOAL::...   WHY::...
## PREM       P<n>::<premise> (probe: `<cmd>`)      # premises the worker must verify first
## FAILED     F<n>::<treatment> → <produced>
## METHOD     M<n>::...                # only where the method is constrained; else METHOD::OPEN
## GATE       G<n>::<metric> <op> <value> [src]     # shape clauses bound regions, not one line
## MEASURE    X<n>::...                # descriptive numbers; say GRADE = <sheet>
## OUT        O<n>::<file> = <content/layout>
## STOP       <complete list of stop-and-report conditions>
END_BRIEF
```

## Result envelope

JSON or keyed lines, never narrative unless something failed:
`RESULT::<slug>` / `G<n>::<before> | <after> | <goal> PASS|MISS` / `CAUSE::...` / `COMMIT::<sha>|none` /
`STILL::...` / `BRIEF_MISSING::...` / `HARM::<anything written or destroyed outside scope>|none`.

## Board card fields

`objective`, `knownGood`, `outOfScope`, `notTested` are regenerated into the card body and are the
only load-bearing text (free `body` prose is discarded). Write them as dense records:

```
objective:  RED::<what fails today> [meas] | BUILD::<deliverable> | SRC::<scratch path / commit> |
            DELIVER::<closed checklist> | Direction::<D#> | Prior art::... | Collision::... | Size::S|M|L
knownGood:  KG::<path:line> = <property>      (or KG::NONE)
outOfScope: OOS::<a> | <b> ; FALSIFIER::<minimal measurement that permits stop-and-report>
notTested:  NT::<residual>
```

`doneWhen` rules are board syntax and are never compressed or annotated.
