---
name: openclinxr-slice
description: >
  Rubric-scored evaluator for completed OpenClinXR work slices. Scores filesystem
  artifacts (slice record, evidence paths, package tests, guardrail deltas), not
  agent claims. Use when finishing a slice, verifying slice quality, or running
  skill:slice:check / test:skill:slice.
---

# OpenClinXR Slice Skill (Rubric Evaluator)

## BLUF

After a work slice, produce a **slice record** and run the evaluator. Pass requires weighted checks against **artifacts on disk**. Scaffold TODOs, fabricated evidence paths, raised `SIZE_FREEZE` ceilings, and unfenced claim-safety language fail.

## Commands (opt-in; not in default `test` / `verify`)

```bash
# Scaffold or re-evaluate a slice record
pnpm skill:slice:check -- --slice <slice-root> [--output <slice-record.md>] [--init-only] [--force-init] [--json]

# Direct evaluate
node --experimental-strip-types .agents/skills/openclinxr-slice/evaluator/evaluate-slice.ts \
  --slice <slice-root> --output <slice-record.md> [--json]

# Rubric regression suite (fixture corpus)
pnpm test:skill:slice
pnpm test:skill:slice:unit
pnpm test:skill:slice:integration
```

## Required slice record sections

1. **What changed** — concrete packages/files/behaviors
2. **Evidence passed** — cite real paths under the slice tree
3. **Remaining risk** — residual risks; no clinical/exam claims
4. **Validation performed** — commands + outcomes + evidence paths

Template: `templates/slice-record-template.md`. Full scoring table: `rubric.md`.

## Checks (weights / critical)

See `rubric.md`. Summary:

| id | w | critical |
| --- | ---: | --- |
| required_slice_sections | 3 | yes |
| evidence_refs_exist | 4 | yes |
| touched_packages_tested | 4 | yes |
| no_guardrail_weakening | 4 | yes |
| claim_safety_language | 3 | yes |

Pass: score ≥ 15 / 18 and no critical failure.

## Fixture corpus

| Fixture | Expected |
| --- | --- |
| `passing-slice` | pass |
| `freeze-ceiling-raised` | fail `no_guardrail_weakening` |
| `fabricated-evidence` | fail `evidence_refs_exist` |
| `scaffold-boilerplate` | fail sections + evidence + packages tested |

## AST note

Export and `SIZE_FREEZE` parsing uses `typescript` `createSourceFile` + node walk (`evaluator/ts-ast.ts`). Do not reintroduce regex export scanners.
