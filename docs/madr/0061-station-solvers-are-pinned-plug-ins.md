# 0061 — Station solvers are pinned plug-ins; mouth is the first station pilot

- Status: **accepted**
- Date: 2026-10-06
- Deciders: operator (direction and approval, 2026-10-06); coordinator (draft); adversarial review by grok-4.7, 2026-10-06
- Amends: MADR 0060 decisions 1, 5, 11 and 12; adds two decisions and role rule R6

## Context

MADR 0060 keeps the default solver as a private module inside the station executor and has the executor select alternatives by id. The operator asked for the solver to be a plug-in: the station owns running the job, and the solver exposes one surface.

Adversarial review found that a plug-in improves swapping (0060 d5 describes selection by id but nothing implements it), receipt provenance and testability, at the cost of two extra packages per station. It also found a back door: any function that accepts a solver lets a caller pass a pre-tuned one while the receipt still names the official solver.

The mouth lane already has a deterministic producer, a headless evaluator validated against browser pixels, and closed-form solves (branch `mouth-solver`, then `lower-arch-fix`), so it is the cheaper first pilot than lighting.

## Decision

1. **The default solver is a package with `stationRole: "solver"`** (replaces 0060 d1). The executor neither contains nor imports it. The executor's public entry still takes no solver id and no tuning value.
2. **Problem, solution and solver-module types live in the objective package** (amends 0060 d11). `solve` has the signature `(problem: Problem) => Solution`. A shared port package across stations still waits for a second station with a solver.
3. **A solver package exports one constant**, `{ id, version, solve }`, and nothing else at runtime. Its tuning values are private to the package and follow 0060 d7 (a tuning file with `schemaVersion`, `solverId`, `solverVersion`, `inputHash`; the loader refuses a mismatch).
4. **A generated registry package resolves the solver** (replaces 0060 d5). It lives at `packages/openclinxr/stations/<station>-registry`, has no `stationRole`, and is the only package allowed to import solver packages. It exports `run(input)`: build the problem with the executor, read the committed pin, check the loaded module against the pin, call `solve`, apply the solution with the executor.
5. **The pin is a committed file with exactly two fields**, `{ solverId, solverVersion }`. Before calling `solve`, the registry requires `module.id === pin.solverId` and `module.version === pin.solverVersion`.
6. **No exported function anywhere takes a solver or a `solve` callback.** Not on the executor, the registry or any CLI. A solver is reachable only through the pin.
7. **Receipt provenance comes from the checked module.** The receipt records solver id and version copied from the module that passed the pin check, and the input hash from the problem (0060 d3). The verifier re-runs the pinned solver and fails when the persisted result differs, so output produced by calling `apply` directly with an unpinned solution is caught.
8. **Running alongside stays harness-only** (0060 d6). The harness is a registry function over candidate solver ids; only the pinned solver's result is persisted.
9. **Mouth is the first station pilot** (replaces the ordering in 0060 d12). Lighting follows; staging after.

## Role rules

- **R6 (new):** an executor must not depend on or import a solver.
- **Solver-importer allowlist (new):** only the station's registry package may import a solver package; the verifier may not.
- **R3 (extended):** a solver's only station dependency is the objective.
- R5's vocabulary stays closed at executor, verifier, objective, solver. The registry declares `station` without a role through an explicit registry marker the check recognises; the exact field name is set by the card that implements it.
- The honest fixture in which the executor depends on its solver is updated to the registry shape.

## Consequences

- Each station with a solver adds two packages: the solver and the registry. The phase's public-surface exception covers all five mouth packages in one file at a single land, reviewed by someone other than the author (0060 d8).
- Swapping a solver is a pin change plus a new solver package; the station and the registry code do not change.
- `solve` is testable with no GLB, and applying a solution is testable with no solver.

## Pilot (mouth station)

Seven cards, in dependency order: objective (with problem, solution and solver types); executor (build problem, apply solution) and verifier and default solver in parallel; registry (pin, generated map, R6, allowlist); live role enforcement; retire the old `tools/` entry points. All packages land together on one integration branch with one reviewed public-surface exception; the evaluator output and the producer's receipt bytes must be reproduced unchanged through the new entry.
