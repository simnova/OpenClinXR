---
name: contract-design
description: "Clause-design gate for writing or reviewing any done_when block, planted RED, proof line, threshold, enum, or test fixture - before the brief is sent, not after it fails green. Known-good column, counterweight against the cheapest pass, thresholds derived not fitted (cite the source beside every number), quantity-vs-shape bounding, proof shapes that go green about nothing (it.fails, exists plus min-bytes, vacuous floors), escape values, fixtures that exhibit the defect. Dispatch MECHANICS live in orchestrator-dispatch-loop; slice SELECTION lives in pre-dispatch-alignment."
when-to-use: plant a RED, write a contract, done_when, counterweight, known-good column, threshold, it.fails, destructive probe, vacuous proof, why did a green contract ship a defect
---

# Designing a contract that can actually fail

Distilled from ~50 KB of measured incidents. Every rule here cost a slice.

## The four parts

1. **The RED** - fails today, for the real defect.
2. **The known-good column** - something in-tree that already has the property. Without it your
   threshold is invented. If nothing is known-good, SAY SO: that absence is itself a finding.
3. **The counterweight** - refuses the cheapest way to make the RED pass.
4. **The destructive probe** - plant a violation, prove it fails, revert, prove it passes.
   **Confirm the substitution actually matched** (print the before/after) or you have tested nothing.

## The failure that recurs most: bounding a QUANTITY when the defect is a SHAPE

Four contracts went green while the pixels stayed wrong. Ask of every clause:

> Can this pass on geometry that is **in the wrong place**, or that has the right **extremes** and the
> wrong **distribution between them**?

| you bounded | it passes anyway when | fix |
|---|---|---|
| PRESENCE (a count of parts/vertices) | the thing exists in the wrong place | pair with a relationship to a landmark |
| an EXTREME (`min`/`max`/"no worse than X") | a sawtooth whose teeth all clear the line | bound the SPREAD (sd/span) |
| a DELETION ("no X where Y exists") | Y does not cover what X covered | state what takes over the job |

## Thresholds

- **A number in a contract becomes the design target.** If the cheapest way to clear it distorts the
  thing being measured, that is what you bought.
- **Every numeric threshold carries its provenance inline, in parentheses**, e.g.
  `<= 0.08 (IV pole, known-good, declared-equipment-mounted.ts:41)` or
  `(median bone-tip motion / 2, pre-fix.json)`. **A number with an empty source fails self-review -
  no source, no dispatch.**
- **Derived, not fitted.** A self-calibrated threshold is meaningless if its reference depends on the
  effect. Sound references: ambient variation measured BEFORE any edit; an external floor; **the INPUT
  of the causal chain**. The tell: you can cancel a term and get a constant ratio.
- **The margin is the audit.** Subtract measured from threshold. Clearing by 1 cm on a 20 cm allowance
  means the number was written after the measurement.
- **When a value is genuinely uncertain, do not pick it** - assert the mechanism and require a sweep
  you grade. That removes your invented number from the contract entirely.
- **A number in a planted FIXTURE is read as a specification too.** Use obviously-non-spec values, or
  say in the header that fixture values are illustrative.

## Proof shapes that go green about nothing

- **`run:` on a file whose RED is `it.fails` passes ONLY while the defect stands.** Fixing it makes
  `it.fails` error. So contract-green can mean nothing was fixed. **Require the conversion to `it(`
  in the same change**, and pair with an `exists:` artifact that records the result.
- **`exists:` + `min-bytes:` on an image proves a renderer ran.** It teaches the worker its obligation
  is discharged. Always pair with a closed per-artifact checklist, and grade the pixels yourself.
- **A byte floor also RESHAPES the artifact** - a worker will enlarge a layout to clear it. Set it
  where a legitimate minimal result already passes, or use `exists:` alone.
- **Vacuous is as bad as broken.** Ask the worker to flag any proof that cannot pass as written, OR
  passes trivially against the ambient range, OR asserts the opposite direction from the defect.
- **The proof TARGET is the other half, and it fails in two ways I committed on one card in one hour.**
  - *A directory `changed:` target cannot detect its own fix.* It means "some descendant changed"
    (`done-when-rules.ts:273`). A worker can edit an unrelated file in the tree and pass. Name the
    fix-bearing file, or a glob narrow enough to justify in one sentence.
  - *A proof value is SYNTAX ONLY.* No parentheses, commentary, quotes or markdown inside the rule -
    a waiver written as `changed:path/x.glb (WAIVED if ...)` makes the target a literal string no file
    matches, and the gate refuses it (`board-brief.ts:175`; measured, 24 of 62 ledger proof failures
    were `changed:`-only). Waivers and conditions go in prose beside the block.
  - **And a `changed:` rule silently forbids an honest stop.** A card that says both "land product
    bytes" and "if the premise is false, report and stop" cannot carry an unconditional `changed:` -
    the stop becomes unsatisfiable. Waive it in prose or the contract has banned the outcome it asked
    for.
- **A large margin is not automatically vacuous** - if a known failure mode sits on the far side, it
  is a regression net. Name that failure mode in the contract, or delete the clause.

## Closed vocabularies

Every enum needs an escape value (`other` / `inconclusive` / `control_only`) plus a required free-text
field - and **read the escape values first**, that is where real findings hide. If two values could
describe the same run, state the discriminator in one sentence beside the enum.

## Fixtures

**The fixture must actually exhibit the defect.** A contract about ignored paths uses an ignored path;
about a detached mesh, a detached mesh. A nearby healthy stand-in tests nothing. The tell: you picked
it because it was easy to name.

## Aggregation and derived fields

Any field the report introduces that is not read directly off an existing API needs one line saying
where it comes from - **an expression, not a sentence**. If a measurement collapses N objects into one
number, state the aggregation (min/max/mean/per-item). The tell: the subject is plural.

## Superseding, never deleting

Merge-kill fires on `deleted-test` with no opt-out. A superseded clause becomes an **inverted guard**
that records the absence, and **its failure message must name the restoration** - what to reinstate,
against which artifact, and that widening or deleting it is wrong. Otherwise the next engineer to hit
that red deletes it.

## Before dispatch

**Mechanics live in `orchestrator-dispatch-loop`** - signatures, the commit-the-plant-first rule, the
`factory_step:` colon, gitignored `exists:` targets. Two copies of a mechanical fact WILL drift; that
skill is the single source.


## A breadth requirement defeats an instrument-artifact stop

If a brief offers "if this red is an instrument artifact rather than a product defect, say so and
stop", read every `done_when` rule and ask whether a report of "no defect found" satisfies it.

Two rule shapes silently revoke the permission:

- **`changed:<source file>`** cannot be satisfied by a report. It compels an edit, so the contract
  requires a product change at the same moment the prose permits stopping without one — and the
  contract wins. Either drop the rule or mark it `(WAIVED if you report the red as an instrument
  artifact)`.
- **A breadth clause** — "enumerate dynamically", `stations.length > 1` — compels a full sweep before
  the worker may report. The stop stays legal but becomes expensive, and a worker that knows at
  station 6 of 14 will finish all 14 first.

**Name the MINIMAL FALSIFIER and say satisfying it is enough to stop:** measure the motivating
instance and ONE known-good control, write that as the pre-fix artifact, and if the instance measures
clean, stop and report. The breadth clause then applies only on the branch where a defect is found.

`exists:` on a measurement artifact is the compatible shape — it is satisfied by reporting.

Incidents: `§11j` and `§11n` in
`docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md`.


## Pre-fix ordering is a RULE KIND, not prose — use `measured-before:`

`measured-before:<artifact>:<product>` reads a trusted spawn-state baseline
(`SLICE_BASELINE_SCHEMA = "openclinxr.slice-baseline.v1"`, `done-when-tree.js`, #177). Use it when a
brief needs a measurement taken BEFORE any product edit.

It proves ORDERING ONLY. It says nothing about whether a plant was flipped — only `live:` does that —
and nothing about whether a cached measurement is still valid (next section).

`exists:` on a pre-fix artifact is the weaker shape that six workers complained about: it proves the
file is present, never that it was written before the edit, which is how "reconstructed after the
fact" calibration records passed as before-columns.

## A cached measurement must name the tree it measured

A measure-once-to-disk contract is green about NOTHING on every later run, and RED about nothing just
as easily — a stale artifact fabricates a regression that consumes a worker.

Any contract whose measurement caches to disk records the tree state it measured — a commit sha, or
the hashes of its inputs — and REFUSES the cache when that has moved. Until it does, treat a
suspiciously fast pass as unverified: compare the run duration against the honest cost of the
measurement, and clear the artifact before trusting a re-run in either direction.

Distinct from `measured-before:`. That proves artifact ordering; this proves cache validity.

## A regression handback carries the same obligations as a brief

"Fix the red" is a `done_when` with one rule in it, and it buys exactly one rule's worth of evidence.

Name the proofs. If the change can alter APPEARANCE, name the renderer and the framing for a FRESH
capture and require the decomposed checklist — an existing image from before the fix is not evidence
about the fix, however recent. Measured: a hem-geometry repair landed with the only image in the
slice framed on the lower legs, byte-identical to the pre-fix capture.

Incidents `§7s`, `§11i` in
`docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md`.
