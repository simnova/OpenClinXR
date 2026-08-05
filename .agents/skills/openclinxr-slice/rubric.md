# OpenClinXR Slice Evaluator Rubric

The evaluator scores **work-slice artifacts** against the checks below. It is intentionally artifact-first: it looks at the slice record, packages under the slice tree, cited evidence files, and guardrail sources — not at agent claims alone.

## Scoring

- Total available score: `18`
- Passing score: `15`
- Any failed **critical** check is an overall fail even if the numeric threshold is met

## Checks

| Check ID | Weight | Critical | Pass Condition | Why |
| --- | ---: | :---: | --- | --- |
| `required_slice_sections` | 3 | yes | Record has What changed / Evidence passed / Remaining risk / Validation performed with ≥30 non-boilerplate chars each. | Agents otherwise ship empty scaffolds; anti-boilerplate prevents template generation from scoring. |
| `evidence_refs_exist` | 4 | yes | Paths cited under Evidence passed / Validation performed exist on disk under the slice root. | Stops “I verified it” without an artifact; scores the filesystem, not the claim. |
| `touched_packages_tested` | 4 | yes | Each code package under `packages/` has tests; public exports discovered via **TypeScript AST** appear in those suites. | Slice work that lands untested exports is incomplete for a factory monorepo. |
| `no_guardrail_weakening` | 4 | yes | `SIZE_FREEZE` maxLines not raised vs baseline (AST-parsed); no architecture exemption surfaces added. | Raising a freeze ceiling is the classic anti-pattern vs splitting a file; must fail the rubric. |
| `claim_safety_language` | 3 | yes | No unfenced clinical-validity / exam-equivalence / licensure / board-scoring / Quest-ready language (negations allowed). | OpenClinXR must not assert exam-equivalence or clinical validity from slice work. |

## TypeScript parsing

Public exports and `SIZE_FREEZE` tables are read with the **TypeScript compiler API** (`typescript` → `createSourceFile` + AST walk). Regex-over-source is not used for export discovery (upstream cellix-tdd admitted multi-line / overload / re-export mis-parses).

## Fixture corpus

The rubric is regression-tested. Each fixture under `fixtures/*/expected-report.json` locks overall status + failed check ids. Changing a heuristic immediately shows whether a known-bad case stopped failing.
