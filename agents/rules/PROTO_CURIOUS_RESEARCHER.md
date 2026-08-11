# Curious Researcher — a standing scout on every turn

**Operator direction, 2026-08-11:** *"make a curious researcher spawn as part of every turn - someone
to compliment current or upcoming work to find things like this so I don't have to."*

## Why this exists

It was created after the operator, twice in one session, handed over a proven tool the orchestrator
should have found:

- **`ExportService.bake_modifiers_remove_helpers()`** existed while the orchestrator hand-rolled a
  *"strip helpers at vertex 13,380"* heuristic — and wrote that magic constant into MADR 0052 as a
  precondition.
- **`HumanService.create_human(feet_on_ground=True, macro_detail_dict=…)`** existed while the
  orchestrator hand-imported `base.obj`, applied macros through a second service, and grounded the mesh
  in post — three steps that are parameters on one documented call.
- Earlier the same day: `anny.Anthropometry` shipped native `waist_circumference` while a mesh-based
  girth instrument was being built and debugged for hours.

Each was a **D1 violation** ("wire proven tools, never hand-author") and each was invisible from inside
the work. That is the point: you cannot grep for an API whose name you do not know. A scout looking
*sideways* at the problem finds what a worker looking *down* at it cannot.

## The rule

**Spawn a curious researcher alongside the work, not after it.** It runs in the background against the
CURRENT and UPCOMING slices while the main work proceeds. It is a complement, never a blocker — no tick
waits on it.

Its brief always carries:

1. **What is being built now, and what is queued next** — concrete enough that it can look ahead. A
   researcher told only about today finds nothing for tomorrow.
2. **The specific question "does this already exist?"** for each upcoming piece — API, asset, tool,
   prior art, upstream implementation.
3. **Licence status for anything acquirable**, with CC0/CC-BY as the bar and *unspecified is a refusal*.
4. **A demand for citations**: URLs, exact service/method names, file paths. No paraphrase.
5. **Explicit permission to return "not found"**, stated as valuable. A confabulated API name costs more
   than an honest blank, and this is precisely the shape §1b warns about — confident detail on
   unexamined premises.
6. **A VERIFIED / INFERRED / NOT FOUND label on every finding.** Verified means it read the source or
   the page; inferred means it reasoned. The distinction is the whole value.
7. **A closing "top 3 things that would save the most work"** so the orchestrator can act without
   re-reading everything.

## What to do with the results

- A **VERIFIED** existing API or asset that replaces planned hand-rolled work **supersedes the plan**.
  Correct the MADR or the brief before the work starts, and say plainly what was going to be
  hand-rolled.
- An **INFERRED** finding is a lead, not a fact. Verify before acting — the researcher is subject to the
  same "surprise is a re-run trigger" rule as any delegate (§1b).
- A **licence** finding goes in `docs/openclinxr/third-party-asset-licence-ledger.md` whether it
  unblocks or refuses. Refusals are recorded so nobody re-litigates them.
- **NOT FOUND is a result.** Record it so the next cycle does not re-search the same ground.

## What it is not

- Not a reviewer. It does not judge the work; it finds things beside it.
- Not a blocker. If it returns after the tick has landed, its findings shape the next one.
- Not a source of truth. Everything it returns is checked against the tree or the source before it
  changes a decision.

## Cadence

One per turn while a multi-slice effort is running, scoped to that effort's next few slices. During
routine single-slice work, one per cycle scoped to the slice's domain. Do not spawn several redundant
researchers on the same question — that is cost without coverage.
