# MADR 0033: Adopt Build-Emitting Packages (Cellix Model)

Date: 2026-08-05
Status: **Accepted — supersedes MADR 0032**
Supersedes: [0032](0032-source-first-packages-vs-project-references.md)
Related: #18 (reference generator), #12 (cellix adoption)

## Context

MADR 0032 (same day) affirmed source-first packages and declined project references, on the grounds
that migrating 44 packages to fix an LSP ergonomics problem was disproportionate.

That reasoning was **scoped too narrowly**. Direction from Patrick: the cellix model is more mature,
and the migration work pays off over the life of the repo. This MADR supersedes 0032 on strategic
grounds — not because 0032's analysis was wrong, but because it optimised for near-term cost when
the decision is a long-horizon one.

0032's factual findings still stand and are the basis for the plan below.

## Decision

**Migrate to build-emitting packages**: each package compiles to `dist/`, exports built artifacts,
and declares TypeScript project references derived from its workspace dependencies.

## Evidence — a pilot was run before committing (not a paper decision)

`@cellix/provider-contracts` (a leaf package) was migrated end-to-end:

| Check | Result |
|---|---|
| `tsgo --build` emits | `index.d.ts`, `index.d.ts.map`, `index.js` |
| Test artifacts in `dist` | **0** (after adding the exclude, below) |
| Package's own tests still run | 13/13 pass |
| Test files still typechecked | 0 errors, via a second tsconfig |
| Direct consumer (`@cellix/trace-ledger`) | typecheck PASS, 4/4 tests |
| Transitive consumer (`@openclinxr/scenario-runtime`) | typecheck PASS |
| `dist/` gitignored | yes — no artifacts committed |

## The per-package pattern (validated by the pilot)

1. `tsconfig.json` — build config: `noEmit: false`, `declaration: true`, `declarationMap: true`,
   `outDir: dist`, `rootDir: src`, and **`exclude: ["**/*.test.ts", ...]`**.
2. `tsconfig.vitest.json` — extends the above, re-includes tests, `noEmit: true`. **This is not
   optional.** Excluding tests from the build config removes them from typechecking; without this
   second config the migration would silently lose test typechecking across 33 packages.
3. `package.json` — `exports` → `{ types: ./dist/index.d.ts, default: ./dist/index.js }`,
   `files: ["dist"]`, `build: tsgo --build`, `typecheck` pointed at `tsconfig.vitest.json`.
4. `references` — generated from `workspace:*` deps by the #18 generator (84 edges, 0 cycles,
   already written and `--check`-gated; it was blocked only by `noEmit`, which this decision removes).

## Gotchas found during the pilot (carry into rollout)

- **`tsgo --build` takes the project positionally**, not `-p`. `tsgo --build -p tsconfig.json` fails.
- **Stale `tsconfig.tsbuildinfo` silently suppresses rebuilds.** A clean build needs it removed. CI
  and any "why didn't my change appear" triage must account for this — it is the classic staleness
  failure that source-first avoided, and we are now accepting it deliberately.
- Test artifacts land in `dist` unless explicitly excluded. Upstream cellix solves this in its base
  config with `${configDir}/**/*.test.ts`; our pilot excluded per-package.

## Consequences

**Gained:** real `.d.ts` contracts between packages · incremental builds via the reference graph ·
`composite: true` (currently inert on 40 packages) becomes meaningful · publishable packages ·
better tsserver project discovery, which is a candidate fix for cross-package `findReferences`.

**Accepted costs:** a build step now exists · staleness is possible (mitigated by `turbo watch`,
which upstream relies on and which our turbo `build` task already supports — it is defined with
`dependsOn: ["^build"]` and `outputs: ["dist/**"]` and is currently unused) · every package needs
two tsconfigs · dev loop must build dependencies before consuming them.

**Rollout:** leaf-first (16 packages have no workspace deps), then by dependency depth. Each wave
must keep the full gate green before the next. The base-config `noEmit` flip is the point of no
return and should land only once enough leaves are proven.

`notEvidenceFor`: build/tooling decision only. No runtime, learner, Quest, clinical, or scoring claim.
