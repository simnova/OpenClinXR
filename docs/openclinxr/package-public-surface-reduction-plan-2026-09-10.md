# OpenClinXR Package Public-Surface Reduction Plan

Date: 2026-09-10

Status: Delegation contract

Scope: `packages/openclinxr/**` supported package imports

Reference clone: `/Volumes/files/src/cellixjs-current` at `adf3bc9deb2d0ca006041d9326215996a2b00e12`

## Decision

Reduce OpenClinXR's supported package surface to deliberate, consumer-oriented interfaces without deleting working behavior or hiding the same interface behind file-shaped subpaths.

Every package remains free to contain rich implementation code. The supported interface is only what another package, app, or tool can import through the package root or an explicit `package.json#exports` subpath. All OpenClinXR packages are currently private, so "public" in this plan means supported inside the workspace rather than published to npm.

The CellixJS clone is a directional reference for interface shape, not a feature-equivalence target. OpenClinXR has legitimate XR, scene, motion, evidence, dialogue, and clinical-simulation concepts that CellixJS does not have.

Counts are navigation aids and regression guards, not the definition of success. A namespace object, facade wrapper, package split, or export relocation can lower a raw count without making the contract clearer. Completion therefore depends on an explicit symbol-by-symbol disposition and consumer proof, with numerical targets used as review signals.

## Why this work exists

OpenClinXR adopted Cellix's package vocabulary and conditional-export pattern, but several roots grew into capability namespaces. They expose contracts, implementation helpers, constants, persistence adapters, UI components, evidence formatters, and composition behavior together.

That creates four costs:

1. A private rename becomes a workspace-wide migration because the symbol was published accidentally.
2. Consumers choose low-level helpers instead of a stable use-case facade.
3. Root and subpath exports duplicate the same names, obscuring the supported route.
4. Architecture workers cannot tell whether an export is intentional, transitional, or merely reachable.

Package count is not the problem. A package with one coherent facade is preferable to a smaller number of namespace-like packages.

## Verified baseline

The baseline was measured on OpenClinXR `d4a7a8c28a2985aab284ed0c06b43522588ca220`. Two unrelated working-tree edits were present in `.grok/config.toml` and `packages/openclinxr/agent-loop/src/role-harness-policy.ts`; neither changes a package entrypoint.

The primary measurement uses the TypeScript compiler's module symbol table so it resolves named exports, aliases, `export *`, `export type *`, single-quoted module specifiers, and nested re-export chains.

| Measurement | OpenClinXR | CellixJS + OCOM |
| --- | ---: | ---: |
| Package manifests in compared scope | 46 | 44 |
| TypeScript package roots | 46 | 42 |
| Declared root + subpath entrypoints | 137 | 136 |
| Root-exported symbols | 2,533 | 362 |
| Median root symbols | 38 | 3 |
| Roots above 25 symbols | 33 | 4 |
| Symbol occurrences across resolvable entrypoints | 3,588 | 723 |
| Unique symbols per package across all entrypoints | 3,020 | 536 |
| Names exposed by more than one entrypoint in a package | 550 | 183 |

Five CellixJS entries expose JSON configuration or JavaScript codegen plugins rather than TypeScript symbols. They count as declared entrypoints but are absent from the symbol totals.

### Codebase evidence and lineage

- [`packages/openclinxr-verification/architecture-rules/src/checks/export-surface-budgets.ts`](../../packages/openclinxr-verification/architecture-rules/src/checks/export-surface-budgets.ts) contains the current root-budget scanner and shows why nested packages and some export syntax need compiler-backed coverage.
- [`packages/openclinxr-verification/architecture-rules/src/checks/unused-entrypoint-exports.ts`](../../packages/openclinxr-verification/architecture-rules/src/checks/unused-entrypoint-exports.ts) provides useful identifier-based triage while documenting dynamic-access limitations.
- [`tools/openclinxr/architecture/narrow-entrypoint.ts`](../../tools/openclinxr/architecture/narrow-entrypoint.ts) is a migration helper whose own safeguards and history show why generated narrowing requires review.
- [`.openclinxr/slices`](../../.openclinxr/slices) records earlier export-reduction work. Its measurements are historical inputs, not current acceptance evidence.
- Commits `6ef95b90` and `35765c4f` demonstrate that two broad narrowing campaigns have already landed. New work starts from the compiler-derived baseline above rather than replaying those campaigns.
- The CellixJS comparison uses the local clone pinned in this document. Its package manifests and entrypoints provide structural examples; they do not determine OpenClinXR contracts.

### Existing OpenClinXR measurement debt

`pnpm arch:unused-exports` currently reports 42 direct-child packages, 2,121 root symbols, median 34, and 565 names with no identifier reference outside their package. That is useful triage, not the complete public surface.

The current implementation has two coverage gaps:

- It enumerates `packages/openclinxr/<package>/src/index.ts`, so it misses all four `packages/openclinxr/arena/*` workspace packages. Those roots expose 333 symbols through the TypeScript compiler.
- Its regular expressions do not model all TypeScript export syntax. The compiler finds 79 more root symbols in the 42 stable packages, concentrated in `rest` and `ui-route-admin`. `export type *` is also absent from the current star-export count.

Do not erase the historical 2,931-to-2,121 reduction. Preserve it as a same-meter trend while introducing a compiler-resolved baseline. A corrected baseline is measurement migration, not interface growth. The new gate must record both values until every old ceiling can be retired without being raised.

## CellixJS patterns to retain

Use these patterns where they fit:

- A package root represents one facade, composition object, or small set of closely related operations.
- Subpaths represent stable consumer concepts, not the current source-folder layout.
- Domain implementations stay behind a namespace or application service instead of exporting every aggregate helper.
- Persistence roots expose a factory or service; bounded subpaths expose intentional datasource contracts.
- Route packages expose route composition rather than every page, formatter, hook, and transport detail.
- Public behavior is tested through the package name or an explicitly declared subpath.

Do not copy Cellix mechanically. Its current clone still has a few packages above 25 exports and several packages without an `exports` map. OpenClinXR's explicit maps and shrink-only enforcement are stronger foundations.

## Supported-consumer boundary

Because every package in scope is private, this program guarantees compatibility for consumers present in this repository at the integrated revision:

- production and package code in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, and `.cjs` files;
- applications, tools, tests, generated-code entrypoints, and documented command examples;
- static imports, dynamic imports, require calls, package export-map resolution, and reviewed computed access;
- package-name imports resolved from built JavaScript and declarations, not source files alone.

Unknown consumers outside this repository are not discoverable and must remain explicit under `NOT TESTED`. An export may be retained as a deliberate compatibility contract even when no in-repository consumer exists, but the contract inventory must name its purpose and owner.

## Completion contract

This program is complete only when all of the following are true on one integrated revision:

1. **Complete discovery.** Every workspace package under `packages/openclinxr/**`, including nested arena packages, is present in the compiler-resolved report, the shrink ratchet, and the derived package index or an explicitly tested experimental equivalent.
2. **Correct syntax coverage.** Fixture tests prove named exports, aliases, namespace exports, `export *`, `export type *`, single and double quotes, nested chains, and supported JavaScript and TypeScript entrypoint forms are counted.
3. **No wildcard publication.** Supported entrypoints contain zero `export * from` and zero `export type * from` declarations. Namespace exports are permitted only when the namespace itself is the documented facade.
4. **Complete contract inventory.** Every exposed runtime and type symbol is classified as `keep`, `remove`, `migrate`, or `unresolved`, with its supported import route and consumer rationale. Closure requires zero unresolved classifications.
5. **Reviewed execution.** Only dispositions approved by the inventory are implemented. Each removal and migration appears exactly in the before/after manifest; retained compatibility exports name an owner and reason.
6. **Quantitative review targets.** The integrated result aims for at most 1,000 root exports, median at most 15, p90 at most 25, no root above 50, and at most 200 duplicate names. Missing a target requires a checked-in, independently reviewed exception; meeting it cannot override a failed semantic review.
7. **No relocation theater.** Adding a wrapper, namespace, package, or subpath does not count as shrinkage. Each task reports root count, total entrypoint occurrences, unique package symbols, duplicated names, and exact removed and migrated names before and after.
8. **Consumer proof.** Every retained export is referenced by a supported consumer or recorded as a deliberate compatibility contract. Identifier search is only a lead; compiler resolution, declaration use, package builds, and focused runtime tests are the proof.
9. **Import integrity.** There are no undeclared package deep imports. Every declared export-map specifier resolves against built output and declarations, and a consumer fixture imports it through the package name.
10. **Delivery consistency.** Stable packages publish built JavaScript plus declarations. Any source-published experimental package is explicitly documented and checked as experimental.
11. **Behavior preservation.** Workspace typecheck, affected package tests, API tests, UI Admin tests, UI XR tests, architecture surface tests, and Knip pass. Export removal does not delete behavior as part of this program.
12. **Independent closure.** A final verifier recomputes the measurements from the tree, rejects missing packages and empty samples, verifies all approved dispositions, compares the Cellix reference revision, checks exception manifests, and emits machine-readable and human-readable reports. Child-card status, a self-authored success flag, or raw count alone is insufficient.

## Package priorities

### Highest-value facade redesign

| Package | Compiler-resolved root | Declared subpaths | Reason |
| --- | ---: | ---: | --- |
| `ui-route-admin` | 277 | 30 | Route composition, components, hooks, formatters, codecs, clients, and models share one root; many names are duplicated by file-shaped subpaths. |
| `asset-registry` | 240 | 24 | Asset policy, lookup, review, runtime bundles, provenance, and low-level resolvers form an aggregation hub. |
| `rest` | 193 | 0 | Route catalogue, transport contracts, app composition, persistence integration, promotion, and protocol posture are published together. |
| `xr-runtime-state` | 131 | 2 | Most names have consumers, indicating an overly granular cross-package contract rather than simple dead exports. |

### High-confidence narrowing candidates

The current marker reports especially high unreferenced ratios in `motion-compiler` (73 of 76), `data-mongodb` (66 of 73), `test-harness` (10 of 10), `physics-touch-artifacts` (6 of 7), and `config-rolldown` (5 of 7). Each result must still be proved by removing publication and running the compiler plus consumers.

### Domain-specific packages without Cellix equivalents

XR, pose, locomotion, scene, motion, capture, trace, factory, conversation, and evidence packages should keep their domain concepts. They still need a clear distinction between supported use cases and package-internal mechanics.

## Per-package migration procedure

Each implementation card follows the same sequence:

1. Record the compiler-resolved root, all-entrypoint, unique, duplicate, wildcard, and external-reference baseline.
2. Identify real consumers by module resolution and typechecking; do not rely on identifier coincidence alone.
3. Name the intended root facade and any stable consumer-oriented subpaths.
4. Replace wildcard publication with explicit names.
5. Remove unconsumed exports from the entrypoint while leaving implementation in place.
6. Move consumers atomically when a better facade is required.
7. Remove duplicate root exports once the supported subpath is adopted.
8. Build the package and verify every declared specifier through its built JavaScript and declarations.
9. Run package tests, affected app tests, workspace typecheck, architecture checks, and Knip.
10. Regenerate shrink-only measurements and write an evidence report containing before/after lists and manifest hashes.

Do not delete source files merely because they become internal. Knip-driven deletion is a separate, explicitly reviewed cleanup.

## Delegation graph

`PSR-P` is a non-executable parent. Workers execute `PSR-00` through `PSR-09`.

```text
PSR-00 trustworthy compiler-resolved meter
  └── PSR-01 supported-consumer and contract inventory
        ├── PSR-02 support and infrastructure leaves ─┐
        ├── PSR-03 persistence/model/motion leaves ───┼── PSR-04 REST facade ─────┐
        └── PSR-05 asset-registry facade ─────────────┘                           ├── PSR-06 Admin UI facade ─┐
                                                        └─────────────────────────┘                          │
PSR-03 + PSR-05 ───────────────────────────────────────────── PSR-07 XR runtime facades ──────────────────────┤
                                                                                                             ├── PSR-08 full tail sweep
                                                                                                             └── PSR-09 independent acceptance
```

The actual board dependency edges are authoritative if this diagram and the board ever disagree.

## Task contracts

### PSR-00 — Make the public-surface meter trustworthy

Replace regex-only measurement with TypeScript module export resolution, discover nested workspace packages, cover all export syntax with positive and negative fixtures, and produce a checked-in baseline without raising the legacy ceilings. Preserve the legacy metric as a transition signal.

Minimum proof:

- The full 46-package tree is discovered.
- `rest` and `ui-route-admin` match TypeScript compiler exports.
- All four arena packages are reported and ratcheted.
- The test fails when a nested package or `export type *` is introduced outside its ceiling.

The meter also emits deterministic JSON containing manifest hashes, runtime and type symbols separately, root and subpath occurrences, unique names, duplicates, and built-output resolution results. The legacy regex meter remains a historical series only. `narrow-entrypoint.ts` may help prepare changes but is never an acceptance oracle.

### PSR-01 — Define supported consumers and classify the contract

Create the reviewable contract inventory before changing package APIs. Enumerate all supported consumers described above, including dynamic and computed access that static symbol search cannot prove. Classify every exposed symbol as `keep`, `remove`, `migrate`, or `unresolved`; name the intended import route, consumer or compatibility purpose, owner, and rationale. The task completes only with zero unresolved entries and a reviewable manifest hash.

### PSR-02 — Narrow support and infrastructure leaves

Narrow `config-rolldown`, `physics-touch-artifacts`, `test-harness`, `auth`, and `telemetry`. Keep their implementations; publish only the consumer-facing factories, types, and operations. Align stable package delivery with built output.

The telemetry portion waits for active telemetry/review-workflow work to land. Every change must match an approved PSR-01 disposition.

### PSR-03 — Narrow persistence, model, conversation, GraphQL, and motion leaves

Narrow `data-mongodb`, `motion-compiler`, `conversation-policy`, `model-gateway`, and `graphql`. Use consumer-oriented subpaths only where a real consumer grouping exists. This task must not interfere with the semantics of active motion-factory cards; write-root overlap defers it until safe.

This task waits for both active motion-compiler cards to land. One-package commits are preferred where the packages do not require an atomic consumer migration.

### PSR-04 — Turn REST into an adapter facade

Separate route matching and outward application composition from internal promotion, persistence, protocol-evidence, and fixture helpers. The root should offer the supported HTTP adapter and stable route contract. Tests and apps migrate atomically; no endpoint behavior changes.

### PSR-05 — Turn asset-registry into bounded consumer facades

Define a small root for normal runtime asset selection and a few stable subpaths for authoring/review, provenance, and factory integration. Remove root/subpath duplication and keep low-level asset resolvers internal unless a named consumer requires them.

### PSR-06 — Turn Admin UI into route composition

Make the package root describe the Admin route/workbench composition. Replace file-shaped component subpaths with a small number of documented groupings where cross-package consumers truly exist. Keep page-local components, hooks, validators, formatters, and codecs internal.

### PSR-07 — Narrow XR runtime boundaries

Narrow `xr-runtime-state`, `xr-station`, `xr-scene`, `xr-dialogue`, `xr-locomotion`, `xr-pose`, `xr-humanoid-animation`, and closely coupled XR support packages around runtime use cases. Preserve actor placement, replay, admission, motion, and evidence behavior. Prefer facade objects and cohesive contracts over dozens of primitive cross-package imports.

### PSR-08 — Complete the full-tree tail sweep

Apply the same procedure to every remaining package, remove all wildcard publication, add or update intentional-exception manifests, eliminate obsolete compatibility duplicates, bring arena packages under derived indexes, and align stable output packaging.

### PSR-09 — Independently verify closure

Recompute the complete surface from the integrated tree and enforce every completion criterion. Rerun typecheck, architecture surface tests, Knip, and the affected application/package suites. Produce JSON and Markdown reports that list exact residual exceptions and refuse success if any criterion is missing, self-declared, or measured from an empty sample.

## Concurrency and active-board safety

- BothyBoard write-root overlap is the concurrency gate. A planted card remains unavailable while an in-flight task owns an overlapping path.
- PSR-01 runs after the meter and gates every implementation card.
- PSR-02, PSR-03, and PSR-05 may run after PSR-01 when their roots are disjoint from active work and their named active-board dependencies have landed.
- REST follows the leaf migrations because it consumes many of those packages.
- Admin UI follows REST and asset-registry because it consumes both boundaries.
- XR facade work follows motion/model and asset-registry work.
- Final sweep and acceptance are serial integration tasks.
- Every worker uses its own worktree, branch, job-local temporary paths, and board-bound session.

## Required evidence report fields

Every child writes `docs/openclinxr/package-public-surface-reduction/evidence/psr-XX.{md,json}` with:

- source revision and task id;
- compiler-derived before and after manifest hashes;
- measured-before and measured-after values;
- exact removed exports;
- exact migrated and retained exports with their contract-inventory dispositions;
- exact retained exceptions and named consumers;
- wildcard declarations removed;
- root/subpath duplicates removed and remaining;
- consumer files migrated;
- commands and outcomes;
- claim;
- limitations and `NOT TESTED`.

The final report additionally records the Cellix reference revision and explains why remaining OpenClinXR differences are domain-driven.

## Non-goals

- Removing working product behavior.
- Reducing package count merely to improve a metric.
- Publishing packages to npm.
- Changing HTTP, GraphQL, persistence, XR, motion, review, or authoring behavior except where an atomic import migration is required.
- Creating file-per-source-module subpaths.
- Treating a green identifier search as proof.
- Claiming clinical validity, Quest readiness, runtime performance, or public deployment from architecture tests.

## Review standard

A reviewer should reject a card that only moves names from root to subpaths, raises a ceiling without a compiler-proven measurement migration, deletes implementation to satisfy Knip, changes product behavior without a behavior test, or reports success without recomputing the integrated tree.

A reviewer should also reject numerical improvement produced by namespace wrapping, facade indirection, package splitting, or incomplete consumer discovery. Raw counts never override the contract inventory.

The desired result is a package system where a new contributor can identify the supported use cases from `package.json`, the root entrypoint, and one short contract manifest without reading the implementation tree.
