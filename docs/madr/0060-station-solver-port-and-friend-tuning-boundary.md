# 0060 — Station solvers behind the executor, scored by a shared objective

- Status: **proposed**
- Date: 2026-10-05
- Deciders: operator (direction); coordinator (draft); adversarial review by grok-4.7 in two rounds, 2026-10-05
- Relates to: factory station interface and workspace split plan (2026-09-30, operator handoff: authoring vs engineering interfaces enforced by package boundaries; EncounterRecipe -> ResolvedWorldPlan -> ArtifactManifest -> VerificationReport), the public-surface reduction programme (`docs/openclinxr/package-public-surface-reduction/`), the test-import ratchet (`packages/openclinxr-verification/architecture-rules/src/checks/test-import-surface.ts`), MADR 0033, D9 in `agents/rules/PROTO_VERIFY_DELEGATION.md`

## Context

Factory stations are being paired with solvers. The first is the offline staging solver on branch `staging-solver`: it snapshots a room once, then searches clinical slot templates and camera candidates against the render gate. A solver carries many knobs (slot offsets, clearances, camera distances, field of view, grid step, beam width), and they will be retuned as the factory is refined.

Operator direction, 2026-10-05:

- solver knobs and switches must not be known outside the station;
- the station's public interface uses the solver behind the scenes;
- alternative solvers can be swapped in or run alongside;
- agents see the public interface first and reach solver or test internals only when they need them.

## Rejected options

| option | why rejected |
|---|---|
| `./testing` subpath per package pointing at `dist` | every exported symbol is unapproved surface (criterion 5); a declared `exports` target counts as public in `test-import-surface.ts`, so internal test imports stop counting; it tests the last build, not the edited source; `typesVersions` is not read when `exports` is read under NodeNext |
| knobs as optional parameters on the public entry | every knob appears in the signature agents read first |
| one `./solver-port` subpath on the station package (first draft of this MADR) | the 2026-09-30 plan forbids authoring and engineering subpaths in one package; no subpath export ceiling exists (`export-surface-budgets.ts` counts only `src/index.ts`); a public `StationTuning` schema is the knob surface the operator rejected; solver packages importing it would depend on the whole station graph; hand-tagged `arch-index.json` entries fail the derived-index test |
| solver as a resolver inside the world compiler | the world compiler may not import station implementation code |
| solver in the verification sidecar | an executor may not depend on its verifier; verification must not write placements back into the recipe |

## Decision

1. **The default solver is a private module of the station executor.** The executor's entry calls it. That entry takes no solver id, no tuning and no knob. `runStaging`'s `options.placement` (`factory-stations/src/staging/run.ts:18-30`) is removed from the public entry.
2. **The authoring surface does not grow.** Staging's authored fields stay `actorId`, `supportSurface`, `plantOffsetMeters` (`catalog-mod.ts`). Camera, grid, beam, field of view and clearances are never schema fields.
3. **The solved result is persisted, not recomputed at exam time.** It enters the resolved plan as a `ResolvedValue` with `source: "derived"`, solver id, solver version and input-snapshot hash. The exam reads it (D9).
4. **The objective is its own package.** The score function and its thresholds (today's render-gate geometry) live in `@openclinxr/station-staging-objective`. The executor and the verifier both import it. The executor never imports a verifier module.
5. **Alternative solvers are sibling packages.** They depend on a small port contract and on the objective, never on executor files. The executor selects a solver by one id in committed config; it imports no alternative solver package.
6. **Running alongside is harness-only.** The harness runs the configured solver and candidates on the same snapshot. The configured solver's result is persisted; per-case differences go into a verification report, never the recipe.
7. **Tuned values are data with provenance.** The tuning file carries `schemaVersion`, `solverId`, `solverVersion` and `inputHash`, and the loader refuses the file when any of them differs from the running solver.
8. **Governance per migration phase.** New packages move the root-export count and the median and p90, which criterion 6 compares exactly. Each phase adds one sibling exception file (`exceptions/psr-c6-<phase>.json`) covering every metric that moved, written by a reviewer other than the slice author, with `baseline.json` rows and a `public-api.json` in the same commit. The historical `psr-c6-residual.json` (1220) is never edited.
9. **Agent-facing documentation fails closed.** Each public `"."` export gets a one-line JSDoc summary, with `@param` and `@returns` where units or constraints are not obvious. `package-agent-index.ts` derives them into `arch-index.json`, and `board-brief.ts` prints the summaries in worker briefs. A shrink-only ratchet attached to `checkPackageAgentIndexesAreCurrent` counts indexes whose purpose is missing or boilerplate (measured 2026-10-05: 43 of 49), and a second ratchet counts public exports with no summary. The index and brief walkers learn nested package directories before any `stations/*` package is added.
10. **Close the dynamic-import gap separately.** `test-import-surface.ts` parses `import("…")` call literals, and `test-import-source-syntax.test.ts` is updated in the same change. This is its own slice, not part of the solver pilot.
11. **One port contract package arrives with the first solver.** A shared contract for every station waits until a second station has a solver.
12. **Staging is not the first extracted station.** The 2026-09-30 sequence stands: Phase 0 controls, Phase 1 contracts and registry, lighting as the executor and sidecar pilot, then staging.

## Consequences

- Retuning changes data or a solver package; authoring contracts and callers do not move.
- Each migration phase pays one independently reviewed exception file.
- The objective package is the single source of the gate maths for executor, solvers and verifier, so a solver's predicted gate and the verifier's measured gate cannot drift apart.

## Pilot (staging, as the staging slice of the 2026-09-30 Phase 6)

Commit before any solver wiring:

- `packages/openclinxr/factory-stations/src/staging/run-staging.golden.json`: the bytes of `runStaging` on the payload in `the-factory-station-schemas-validate.test.ts` (today `placement: null`);
- `packages/openclinxr/factory-stations/src/staging/solved-placement.golden.json`: the committed solver result for the same payload from the `staging-solver` branch. The pilot does not start without it.

done_when:

- with the solved golden present, the entry's `placement` deep-equals it and the return differs from the unsolved golden; with it absent, the return deep-equals the unsolved golden;
- the staging authoring schema still has exactly three fields; adding a `solverId` or tuning field fails the schema test;
- an architecture fixture importing the verifier package from the executor fails `pnpm architecture`; the same fixture importing `@openclinxr/station-staging-objective` passes; the verifier importing the executor's private solver module fails;
- the station `arch-index.json` purpose is specific, and every `"."` name in its `public-api.json` has a summary; deleting one summary fails the index check;
- `psr-c6-residual.json` still says 1220; the phase's exception file matches a fresh meter on root exports, median and p90, with `reviewedBy` different from `owner`.

## Deferred to the 2026-09-30 phases

Phase 0 dependency controls (including executor-must-not-import-verifier), Phase 1 contracts and registry with the nested index walker, Phase 2 `ResolvedWorldPlan` types, Phase 3 lighting pilot, Phase 7 deletion of `@openclinxr/factory-stations`, a repository-wide `@param` ceiling, and any exam-time solving.
