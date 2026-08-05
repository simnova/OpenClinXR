# MADR 0034: `@openclinxr/graphql` Is Build-Emitting

Date: 2026-08-05
Status: **Accepted**
Related: [0033](0033-adopt-build-emitting-packages.md) (build-emitting package model), [0032](0032-source-first-packages-vs-project-references.md) (superseded), issue #18 (reference graph)
Implements: last source-first holdout blocking the project-reference lane

## Context

Twenty-nine packages already resolve `exports` into `dist/`. `@openclinxr/graphql` was still
source-first (`exports` → `./src/*.ts`). When anything builds the TypeScript project-reference
graph, dependents fail with **TS6305** ("output file has not been built from source file"):
graphql codegen emits `.ts` under `src/generated/`, but a source-first package never produces
`.d.ts` for the composite project.

A prior investigation **disproved** the hypothesis that codegen ordering (`//#gen`) fixes this —
`//#gen` produces `.ts` only. That experiment is closed; this MADR does not revisit it.

Upstream cellix (`packages/ocom/graphql`) is build-emitting: `exports` → `dist`,
`build: "tsgo --build"`, `files: ["dist", "src/schema/**/*.graphql"]`, and a `clean` that removes
dist plus generated artifacts. OpenClinXR's MADR 0033 already adopted that model repo-wide; this
package was the last holdout on the reference-graph lane.

Package surface (four subpaths, not cellix's single `.`):

| Subpath | Pre-decision target | Consumers (2026-08-05) |
|---|---|---|
| `.` | `./src/index.ts` | `apps/api`, `packages/openclinxr/data-mongodb` |
| `./client` | `./src/client.ts` | `apps/ui-admin` (Vite/browser) |
| `./documents` | `./src/documents.ts` | `apps/api` smoke script |
| `./resolvers` | `./src/generated/resolvers.generated.ts` | **none** (docs-only mention) |

## Decision Drivers

1. **Unblock the reference graph** — ambiguous module mode is not acceptable; either emit or be
   explicitly excluded under an enforced rule.
2. **MADR 0033 already chose build-emitting** — keep the monorepo model coherent; do not carve a
   permanent special case without strong evidence.
3. **Three runtimes** — Node (`apps/api`, `data-mongodb`) and Vite/browser (`ui-admin`) must keep
   working with the same exports map.
4. **Test typecheck must not go silent** — build tsconfigs exclude `*.test.ts`; without
   `tsconfig.vitest.json` the loss is invisible because `typecheck` still exits 0 (architecture
   rule in `decision-invariants.ts` / MADR 0033).
5. **Do not flip base `noEmit`** — out of scope; this package only.

## Considered Options

### Option A — Make `@openclinxr/graphql` build-emitting (cellix model)

- Migrate via `pnpm exec tsx tools/openclinxr/migrate-package-to-build-emitting.ts packages/openclinxr/graphql`
- Point every subpath export at `dist/` (`types` + `default`)
- `build: tsgo --build`, `files: ["dist"]`, `tsconfig.vitest.json` for tests
- Fix `include` to `src/**/*.ts` only (migration leaves root-level `codegen.ts` / `scripts` in
  include; that breaks `rootDir: "src"`)
- Drop the obsolete `rootDir` exemption for this package in architecture tsconfig conventions

### Option B — Keep permanently source-first, with enforced exclusion

- Leave `exports` on `src/`
- Explicitly exclude the package from the reference graph
- Encode exclusion so a future generator run cannot silently re-include it

### Rejected without choosing A or B

Leaving the package ambiguous (source-first exports while the rest of the monorepo emits) is not
an acceptable outcome.

## Outcome

**Option A — build-emitting.**

Rationale:

- Aligns with MADR 0033 and cellix `packages/ocom/graphql`.
- Directly fixes TS6305 for dependents that need `.d.ts` from this package.
- Consumers already import only `.`, `./client`, and `./documents`; all three map cleanly to
  `dist/` after `tsgo --build`.
- Option B would preserve a permanent exception and more generator/architecture surface for a
  package that has no structural reason to stay source-first (codegen already writes into `src/`;
  emit only needs those `.ts` files present — turbo `build.dependsOn` already includes `//#gen`).

### Decision on `./resolvers`

**Keep `./resolvers` as a public subpath**, mapped to the built generated contract:

```json
"./resolvers": {
  "types": "./dist/generated/resolvers.generated.d.ts",
  "default": "./dist/generated/resolvers.generated.js"
}
```

Why keep (not drop):

- Documented typed-resolver contract surface (`docs/openclinxr/technology-approach-brief.md`).
- Zero current importers is not the same as "internal only" — server packages may consume resolver
  types without the executable admin surface on `.`.
- Architecture already forces UI apps onto `./client` / `./documents` only; keeping `./resolvers`
  does not reopen the browser path to the server surface.
- Emit cost is free once the package builds `src/generated/**`.

Why not re-export-only via `.`:

- Collapsing the subpath would break the documented multi-surface API without a consumer
  migration benefit.

`clean` removes only `dist` and `*.tsbuildinfo`. Generated sources under `src/generated/` remain
committed and are refreshed by `pnpm generate` / turbo `//#gen` (unlike cellix's clean which also
deletes `*.generated.ts`).

## Evidence (verification run 2026-08-05)

| Check | Result |
|---|---|
| `pnpm --filter @openclinxr/graphql build` | exit 0; **11** `.d.ts` under `dist/` including all four export targets |
| Cold clone (delete `dist/` + every `*.tsbuildinfo`, rebuild) | exit 0; same four `.d.ts` targets present |
| `pnpm packages:typecheck:agent` | 67/67 tasks successful |
| `pnpm --filter @openclinxr/graphql test` | 6/6 pass |
| `pnpm --filter @openclinxr/data-mongodb typecheck` | pass (Node consumer of `.`) |
| `pnpm architecture` | 80/80 architecture-rules tests pass |
| `pnpm --filter @openclinxr/ui-admin build` | Vite production build pass (browser / `./client`) |
| `pnpm --filter api build` | Azure bundle pass (Node / `.` + `./documents`) |

Note: one intermittent timeout in `@openclinxr/model-vetting-studio` PipelineAdminApp (unrelated UI
test; re-run 34/34 green). Not caused by this package.

## Consequences

**Gained**

- `@openclinxr/graphql` participates in the build-emitting model; reference-graph dependents can
  resolve real `.d.ts` contracts.
- Four subpaths have stable dist mappings; `./resolvers` decision is recorded (keep, public).
- Test typecheck preserved via `tsconfig.vitest.json` (MADR 0033 invariant).
- Obsolete `rootDir` exemption removed from
  `packages/openclinxr/architecture-rules/src/checks/tsconfig-conventions.ts`.

**Accepted costs**

- Package now requires `build` (or turbo `^build`) before typecheck consumers see fresh emit.
- Stale `*.tsbuildinfo` can suppress emit after deleting `dist/` — use `pnpm --filter @openclinxr/graphql run clean` then rebuild (constraint documented in MADR 0033).

**Out of scope (explicit non-goals)**

- Flipping base `noEmit` for the monorepo.
- Weakening architecture rules, file-size ceilings, or adding suppressions.
- Changing consumer import paths.

`notEvidenceFor`: tooling/module-mode decision only. No runtime, learner, Quest, clinical, or
scoring claim.
