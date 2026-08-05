# Second-opinion review: TypeScript / pnpm package architecture vs cellixjs

**Date:** 2026-08-05
**Reviewer:** grok-4.5, read-only, write commands denied
**Session:** `019fd3ef-70cb-7543-89ca-79440af551c9` (resumable)
**Cost:** $0.61 / 12 turns
**Prompt:** asked explicitly to challenge rather than confirm, to flag what NOT to copy from
cellix given the domain gap (WebXR/asset monorepo vs business-domain app), and to say which
recommendations to skip.

> Status of each claim is tracked in the "Verification" section appended at the end. Claims
> are the reviewer's; the verification is ours. Where they disagree, the verification wins.

---

I'll treat this as a second-opinion review: read configs and manifests in both trees, challenge your migration choices with file-grounded evidence, and rank what is actually worth changing.Pulling core configs, MADR 0033, and package-layout evidence from both repos in parallel.# Second Opinion: TypeScript / pnpm Package Architecture (A vs B)

## BOTTOM LINE

**Highest-value structural change for A:** Finish the *task graph* for the model you already chose. `exports` point at `dist/`, but `typecheck` / `test` still only depend on `^typecheck` (not `^build`). That is an incomplete Cellix-shaped migration and will produce silent stale-type and “works on my machine because dist is lying around” failures.

**Stop doing this:** Treating “flip base `noEmit` and wire project references” as the migration finish line. Four blocked flip attempts are a signal: the base flip is a big-bang coupling exercise, not the value. B does **not** run a pure project-reference religion either — it uses Turbo + dual package modes. Chasing TS project references before the Turbo/`exports` graph is coherent is the wrong goal.

---

## 1. TypeScript configuration strategy

### What B does
- Shared configs live in `@cellix/config-typescript` with real exports:
  - `./base`, `./node`, `./vitest` → JSON files  
  (`packages/cellix/config-typescript/package.json`)
- Base is **emit-oriented** (no `noEmit`): `declaration`, `composite`, `incremental`, strict suite, test excludes via `${configDir}/**/*.test.ts`, `skipLibCheck: false`  
  (`packages/cellix/config-typescript/tsconfig.base.json`)
- Packages extend **by package name**, depth-independent:
  - `"extends": "@cellix/config-typescript/node"`  
  (e.g. `packages/ocom/domain/tsconfig.json`)
- Vitest tsconfig is a one-liner compose:  
  `"extends": ["./tsconfig.json", "@cellix/config-typescript/vitest"]`  
  (`packages/ocom/domain/tsconfig.vitest.json`)

### What A does
- Has a fork of the same package (`packages/cellix/config-typescript/`), but base still has **`"noEmit": true`** and is much thinner (no `declaration` / `composite` / test excludes / `verbatimModuleSyntax` / etc.)  
  (`packages/cellix/config-typescript/tsconfig.base.json`)
- Root indirection: `tsconfig.base.json` → `./packages/cellix/config-typescript/tsconfig.node.json`
- **Most packages do not extend the package name.** They use relative paths that encode depth:
  - 22× `"extends": "../../../tsconfig.base.json"`
  - 4× `"extends": "../../../../tsconfig.base.json"` (arena depth tax)
  - 1× relative into config package (`config-vitest`)
- Migrated packages **locally override** emit settings (`noEmit: false`, `declaration`, `outDir: dist`) instead of fixing the base.

### Which is better, and why
**B’s composition model is more defensible.** Package-name extends + emit defaults in base + centralized test exclude is the mature pattern. A has the *folder* of a shared config package but not the *usage* of one.

A’s weaker base is not entirely wrong for domain: `skipLibCheck: true` (A) is more appropriate than B’s `false` for a Three.js / WebXR monorepo with heavy `.d.ts` noise. **Do not copy B’s `skipLibCheck: false` or `ts-scope-trimmer-plugin` blindly.**

### Concrete change for A
1. Point every package tsconfig at `"extends": "@cellix/config-typescript/node"` (or `/base` for UI/bundler variants).
2. Move emit defaults into base (or a new `tsconfig.emit.json` export); stop 29 near-identical local overrides.
3. Port B’s `${configDir}/**/*.test.ts` exclude into base so you stop hand-excluding tests in every package.
4. Keep A’s `skipLibCheck: true` unless you measure a real need for lib strictness.

---

## 2. Project references / composite builds

### What B does
- Base has `"composite": true` and `"incremental": true`.
- ~21 packages under `packages/` declare real `references` (e.g. `@ocom/domain` → domain-seedwork + event-bus).
- Apps also reference packages (`apps/api/tsconfig.json` has a long `references` list).
- **But B’s “typecheck” is largely `build`**: domain has no `typecheck` script; `build: "tsgo --build"`. UI routes use `build: "tsgo --noEmit"` with source exports (see §3).

### What A does
- `composite: true` is widespread (~34 package tsconfigs).
- **`references` count in packages: 0.**
- Generator exists and is correct in design: `tools/openclinxr/tsconfig-references-sync.ts` (documented in MADR 0032/0033).
- Root IDE solution-style file exists: `tsconfig.ide.json` lists paths (option C from MADR 0032).
- MADR 0032 correctly diagnosed **TS6310** from base `noEmit: true`.
- MADR 0033 reversed to “emit + references”; migration partial.
- Remaining non-emit composites include graphql, config-vitest, physics-touch-contract, architecture-rules, config-rolldown — these still inherit `noEmit: true` from base and cannot be safe project-reference targets.

### Is the flip the right goal?
**No — not as currently framed.**

Evidence against “flip base `noEmit` as the win condition”:

| Fact | Path / evidence |
|---|---|
| Dist exports already give you a `.d.ts` *contract* without project references | e.g. `@openclinxr/domain` `exports.types: ./dist/index.d.ts` |
| Turbo already knows how to order builds | `turbo.json` `build.dependsOn: ["^build", "//#gen"]` |
| Typecheck task still ignores build order | `turbo.json` `typecheck.dependsOn: ["^typecheck"]` only |
| Project refs need every edge to emit `.d.ts` | GraphQL still source-exports `.ts` (`packages/openclinxr/graphql/package.json`) → TS6305 is expected, not a mystery |
| B itself is dual-mode | UI packages: source exports + `tsgo --noEmit` as “build” |

**TS6305 on `@openclinxr/graphql` is not a reason to flip the base.** It is a reason to either:
- (a) emit that package properly (`build` + `types`/`default` → `dist`), like `@ocom/graphql`, or  
- (b) **exclude it from the reference graph** until then (generator should skip non-emit packages).

Chasing a monorepo-wide base flip couples config packages, codegen packages, and half-migrated leaves into one failure mode. That is why you keep hitting “a different pre-existing blocker.”

### Which is better
**B’s *working* incremental system (Turbo `^build` + selective project refs + dual modes) beats A’s *aspirational* composite flags.** A currently has composite without edges — MADR 0032 already called this inert.

### Concrete change for A
1. **Defer project references** until every package that appears as a workspace dep either emits `.d.ts` or is explicitly non-referenced.
2. Fix Turbo first: `typecheck` and `test` should `dependsOn: ["^build"]` (B’s `test` does exactly that).
3. Treat graphql as a **first-class emit package** (or permanently source-first *and* non-referenced) — not as a blocker for a base flip.
4. Keep `tsconfig.ide.json` / IDE sync as the cheap tsserver discovery path; do not require project refs for that.

---

## 3. Source-first vs build-emitting packages

### What B does (verify — **not pure build-emitting**)
- **Libraries / domain / persistence / graphql:** dist exports + `tsgo --build`  
  e.g. `@ocom/domain`, `@ocom/graphql`, `@cellix/domain-seedwork`
- **UI route packages:** **source-first on purpose**  
  - `"exports": { ".": "./src/index.tsx" }`  
  - `"build": "tsgo --noEmit"`  
  (`packages/ocom/ui-community-route-admin/package.json` + `tsconfig.json` with `"noEmit": true`)
- **Verification packages:** often source-first, no build  
  (`@ocom-verification/archunit-tests` exports `./src/...`)
- **config-typescript:** JSON only, no build
- **config-vitest:** *does* emit dist (`files: ["dist"]`, `build: tsgo --build`)

### What A does
- MADR 0033: migrate to dist; pilot on `@cellix/provider-contracts`.
- **~29 packages** export `dist/`; remaining source-ish:
  - `@openclinxr/graphql` → `./src/...`
  - `@cellix/config-vitest` → `./src/...`
  - `@openclinxr/config-rolldown` → `./src/...`
  - `@openclinxr/physics-touch-contract` → `./src/...`
  - `@cellix/config-typescript` (configs)
  - `@openclinxr/architecture-rules` (no exports / no build)
- **`tsconfig.vitest.json` count ~31** — good; pilot lesson is real.
- **A’s UI packages are dist-emitting**, opposite of B’s Vite pattern:
  - `@openclinxr/ui-route-admin` → `dist` + `tsgo --build`

### Faithful or cargo-cult?
**Mostly cargo-cult of the library half of B, missing B’s dual-mode and task-graph half.**

Faithful pieces:
- dist exports shape (`types` + `default`)
- second vitest tsconfig for test typechecking
- config packages not fully bootstrapping themselves as emit products (config-typescript)

Cargo-cult / incomplete:
- UI packages forced through dist when B keeps them source for bundler DX
- Turbo `typecheck` not depending on `^build` while `exports` require `dist`
- Base still `noEmit: true` while packages fight it per-file
- Almost no package uses `@cellix/config-vitest` for shared vitest config (B packages depend on it; A packages mostly use root/`vitest run --root .` with **no per-package `vitest.config.ts`** for most libraries)
- MADR 0033 overstates “the Cellix model” as uniform emit; B is **intentionally mixed**

The vitest second-config finding is **correct and important** — keep it. B encodes the same idea more cleanly via base excludes + vitest extends.

### Concrete change for A
1. Classify packages: **emit libraries** vs **source UI/bundler** vs **tooling/config**.
2. Align UI route packages with B’s source + `tsgo --noEmit` *if* Vite consumes them for HMR; only keep dist if something truly needs a JS publish surface.
3. Make graphql emit like `@ocom/graphql` (codegen → `src` → `dist` + types), **or** accept permanent source-first and keep it out of reference graphs.
4. Wire `typecheck`/`test` → `^build` for emit packages.
5. Optionally build `@cellix/config-vitest` like B once consumers import it; today source-first is fine because almost nothing consumes it.

---

## 4. pnpm workspace layout

### What B does
- Globs: `apps/*`, `packages/cellix/*`, `packages/ocom/*`, `packages/ocom-verification/*`  
  (`pnpm-workspace.yaml`)
- Large **catalog** (Apollo, Azure, Cucumber, Serenity, React, Storybook, TS, Vitest, …)
- Heavy `overrides` / security pins; `allowBuilds` for esbuild, MMS, snyk, etc.
- `verifyDepsBeforeRun: false` (same SIGINT lesson as A)
- Scopes: `@cellix/*`, `@ocom/*`, `@ocom-verification/*`, `@apps/*`
- **Flat package dirs** under each tier (depth 4: `packages/<tier>/<name>/package.json`)

### What A does
- Globs: explicit apps + `apps/arena/*` + `packages/cellix/*` + `packages/openclinxr/*` + `packages/openclinxr/arena/*`  
  (`pnpm-workspace.yaml`)
- Smaller catalog (typescript, vitest, tsx, vite, three, mongodb, typebox, ajv)
- `allowBuilds`: esbuild, mongodb-memory-server, protobufjs, sharp
- Scopes: `@openclinxr/*`, `@cellix/*`
- **3-level nesting** under `packages/openclinxr/arena/*` (4 packages)

### Nesting: is it earning its keep?
**Partially yes for isolation, not for path beauty.**

- Turbo boundaries: `arena` tag cannot be depended on by `production` / `cellix` / `internal` rules in root `turbo.json`.
- Arena packages are spikes/experimental (iwsdk, model-vetting, multi-actor, physics-touch-contract).
- Cost: relative tsconfig extends become `../../../../...`; workspace needs an extra glob.

**Do not flatten just to match B.** Keep arena as a quarantine zone **if** boundaries stay enforced. Flatten only if packages graduate to production and leave the arena tag permanently.

### Which is better
**B’s tier globs (`cellix` / product / verification) are clearer.** A’s product bucket (`openclinxr`) mixes domain libraries, UI, agent-loop tooling, and arena. Catalog in B is denser and better for version consistency; A’s catalog is a good start but underused relative to pin scripts elsewhere.

### Concrete change for A
1. Expand catalog for repeated pins (react, graphql, hono, playwright, etc.) when you touch deps anyway — not a big-bang rewrite.
2. Keep arena nesting **or** replace with a third top-level `packages/openclinxr-arena/*` if you hate depth; either is fine if tags stay.
3. Do **not** adopt B’s massive override wall wholesale — domain-driven Azure/React surface differs.

---

## 5. Package boundary discipline (generic vs product)

### What B does
- **`packages/cellix/*`**: reusable seedwork — domain-seedwork, mongoose-seedwork, graphql-codegen/core, config-*, serenity-framework, mocks, storage clients. Hot-swappable in the sense of “product packages depend inward; seedwork does not know ocom.”
- **`packages/ocom/*`**: product domain, persistence, graphql, UI routes, services.
- **`packages/ocom-verification/*`**: test/verification product tier (not mixed into runtime packages).

### What A does
- README law: cellix = copied shared library code; product-specific → move to `packages/openclinxr/`  
  (`packages/cellix/README.md`)
- Reality: only **5** cellix packages, and two of them are **OpenClinXR inventions**, not Cellix upstream:
  - `@cellix/provider-contracts`
  - `@cellix/trace-ledger`  
  (no matches in B’s tree)
- Turbo `cellix` tag is only applied to `config-typescript` and `config-vitest`.  
  `trace-ledger` is tagged **`internal`**. `provider-contracts` has **no turbo.json**.
- Product packages under `@openclinxr/*` include real product slices **and** agent-loop / architecture-rules (tooling/fitness).

### Real or superficial?
**Superficial as a hot-swap tier.** Naming `@cellix/*` without the seedwork surface (no domain-seedwork, no mongoose-seedwork, no graphql-codegen package, no archunit library package) does not give you B’s boundary. Putting product contracts under `@cellix/` **violates A’s own README**.

MADR 0014 said “influence, not hard dependency” — that was the honest posture. The current layout is a thin brand veneer plus two config packages that *are* legitimate shares.

### Concrete change for A
1. Move `@cellix/provider-contracts` and `@cellix/trace-ledger` to `@openclinxr/*` (or a neutral `@openclinxr/seedwork/*` if you want a reusable tier later).
2. Keep under `@cellix/` only packages you would truly reuse/sync from Cellix (config-typescript, config-vitest, mongodb-memory mock if still aligned).
3. Do **not** import B’s full DDD seedwork stack just to look like Cellix — XR clinical simulation does not need ocom’s community/property aggregates.
4. If you want a real “hot-swap” tier later, invent **`@openclinxr/platform/*`** for XR-agnostic contracts — clearer than borrowing `@cellix`.

---

## 6. Test placement and isolation

### What B does
- **Per-package lanes:** `test`, `test:unit`, `test:integration`, `test:arch`, coverage variants  
  (`package.json` scripts; turbo tasks in root `turbo.json`)
- **Co-located archunit tests** under many packages: `src/archunit-tests/*.test.ts`
- **Shared arch rules library:** `@cellix/archunit-tests` (built to dist)
- **Product arch rules:** `@ocom-verification/archunit-tests` (source exports)
- **Verification tier:** acceptance-api/ui, e2e-tests, verification-shared
- Integration tests live in package trees (e.g. `packages/ocom/domain/tests/integration/...`)

### What A does
- Most packages: single `test: vitest run --root .`
- Integration lane is **thin**: root `test:integration` → only `@openclinxr/data-mongodb test:integration`  
  (`package.json` ~line 348); three `*.integration.test.ts` files under data-mongodb
- Architecture fitness centralized in **`@openclinxr/architecture-rules`** (workspace-wide scanners: tsconfig conventions, file-size budgets, decision invariants) — good, different shape than B
- No `ocom-verification`-style tier; tools/agent-factory and evidence scripts absorb a lot of “verification” outside packages
- Almost no per-package `vitest.config.ts` for libraries (root vitest for tools; packages rely on CLI flags)

### Which is better
**Different domains, different right answers.**

- B’s verification tier is excellent for a mature multi-app business product with e2e/acceptance/Serenity.  
- A’s **central architecture-rules package** is a good fit for monorepo convention enforcement and is *not* inferior — B spreads arch tests more, which costs more package ceremony.
- A’s unit/integration split is **under-built**: one package does not make a “lane.”
- **Do not adopt Serenity/Cucumber/ocom-verification wholesale** for XR asset pipelines — that is domain mismatch and toil.

### Concrete change for A
1. Keep centralized `@openclinxr/architecture-rules`; optionally later extract *generic* checkers if a second product appears (not now).
2. Grow integration as a **real turbo task** only when more packages need MMS/API boot — don’t clone B’s five verification packages early.
3. Add `test:unit` / `test:integration` scripts **only** on packages that actually have both; avoid empty lane theater.
4. When packages mature, co-locate package-specific arch rules (B style) for domain import directions; keep global tsconfig/file-budget rules central (A style).

---

## Ranked recommendations (value ÷ effort)

| Rank | Change | Why | Effort |
|---|---|---|---|
| **1** | **`typecheck` + `test` depend on `^build` for emit packages** | Makes dist exports truthful; biggest silent-bug fix | Low–medium |
| **2** | **Decide graphql’s mode (emit *or* permanent source + non-ref)** | Unblocks references later; removes TS6305 class of pain | Medium |
| **3** | **Package-name `extends` + emit defaults in config-typescript** | Removes 29 override clones + depth-relative extends | Medium |
| **4** | **Relocate product packages out of `@cellix/`** | Makes boundary real; matches your README | Low |
| **5** | **Central `${configDir}` test excludes in base** | Removes per-package exclude drift; preserves test typecheck via vitest tsconfig | Low |
| **6** | **UI packages: consider source-first like B if Vite is the consumer** | Better HMR; matches proven dual-mode | Medium (measure first) |
| **7** | **Wire project references via existing generator *after* 1–3** | Incremental tsserver / `tsgo --build` graph | Medium–high |
| **8** | **Expand pnpm catalog** | Consistency, less pin drift | Ongoing low |
| **9** | **Grow integration turbo task / verification tier** | Only when ≥2 packages need heavy integration | High later |

### Explicitly NOT worth doing (now)

| Skip | Why |
|---|---|
| **Base `noEmit` flip as a standalone milestone** | Couples unfinished packages; value is elsewhere |
| **Full B-style `@ocom-verification` tree** | Domain mismatch; A’s evidence/tooling already owns much of “verification” |
| **Importing B domain-seedwork / mongoose-seedwork / Serenity stack** | Wrong product; MADR 0014 was right |
| **`skipLibCheck: false`** | Expensive with three/WebXR typings; B’s choice is for a different dep surface |
| **Flattening arena nesting “because depth is ugly”** | Nesting pays for turbo quarantine; leave it |
| **Making *every* package emit dist “for consistency”** | B itself does not; dual-mode is the mature pattern |
| **Project references purely for LSP `findReferences`** | MADR 0032 was right: tail-wagging-dog; fix Turbo/contracts first |
| **Forcing `ts-scope-trimmer-plugin`** | Optional in B; not installed/needed in A |

---

## Skeptical summary of *your* recent decisions

| Decision | Verdict |
|---|---|
| MADR 0033 reverse source-first → emit | **Directionally ok for libraries**, but implemented as a half-migration. Incomplete task graph makes it riskier than source-first was. |
| Keep config packages source-first | **Correct** for config-typescript; config-vitest can stay until something imports its built surface. |
| “Flip noEmit / enable references next” | **Wrong next goal.** Finish emit + Turbo edges; references are optional polish. |
| Cellix-shaped package tree | **Branding > boundary.** Fix names/placement or the tier is theater. |
| Dual `tsconfig` + `tsconfig.vitest.json` | **Keep.** One of the few clearly correct pilot lessons. |
| Arena nesting | **Keep.** Earns quarantine; not cargo-cult. |

---

## B things A should **not** adopt

1. Azure-centric service package sprawl and Azure pipeline complexity as a monorepo template.  
2. Serenity/Cucumber acceptance stack as default verification.  
3. `skipLibCheck: false` + scope-trimmer plugin as strictness fashion.  
4. Publishing-style multi-export maps like `@ocom/persistence`’s deep export surface — fine for their domain; don’t prebuild that for XR packages.  
5. Treating “Cellix maturity” as proof that *uniform* dist emit is always better — B’s own UI packages disprove that.

---

### One-line restate

**Make the dist model honest (Turbo `^build` + finish graphql/mode classification + shared emit config), stop worshipping the project-reference flip, and make `@cellix` mean seedwork or stop using the name.**
---

## Verification (ours, 2026-08-05)

Every load-bearing claim was checked against the tree before acting on any of it.

| Claim | Verdict | Evidence |
|---|---|---|
| `typecheck`/`test` depend on `^typecheck`, not `^build`, while exports resolve to `dist/` | **CONFIRMED** | `turbo.json`; cellixjs uses `test.dependsOn: ["^build", "@cellix/config-vitest#build"]` |
| Zero `references` in package tsconfigs despite widespread `composite: true` | **CONFIRMED** | 0 tsconfigs contain `"references"` |
| `@cellix/provider-contracts` and `@cellix/trace-ledger` are OpenClinXR inventions, absent from cellix | **CONFIRMED** | neither exists under `cellixjs-current/packages/cellix/` |
| The consequence is "silent stale-type failures" | **REFINED — the framing is wrong** | see below |

### Where the review overstated the failure mode

The reviewer characterised the missing `^build` edge as causing *silent stale-type* failures.
Probing it showed the failure is **loud, not silent** — and the real exposure is narrower:

- Delete a dependency's `dist/` → the consumer's typecheck **fails hard** (exit 2). It does not
  silently pass with stale types.
- Introduce a type error in a dependency's source → `^typecheck` (the OLD edge) **still caught it**,
  because the dependency's own typecheck ran first.

So the actual bug is **"works on my machine because `dist/` is lying around from an earlier build."**
A fresh clone, or any cold CI runner, cannot typecheck at all. Proven by deleting every `dist/` and
`*.tsbuildinfo` under `packages/cellix/` and running typecheck: `@cellix/trace-ledger#typecheck`
failed. After changing both edges to `^build`: 6/6 successful from the same clean state.

The fix is the one the reviewer ranked #1, and the reasoning behind it holds even though the
predicted symptom did not. Worth recording that distinction: a correct recommendation supported by
a wrong mechanism is still worth adopting, but only once you know which part was right.

### Guarding against weakening

Replacing `^typecheck` with `^build` could have removed the dependency-source-error guarantee.
Probed: a type error introduced into `@cellix/provider-contracts` still blocks
`@cellix/trace-ledger#typecheck`, because the dependency's `build` fails first. `^build` is
strictly stronger here than `^typecheck` was for emit packages.

### Incidental finding: stale `.tsbuildinfo` silently suppresses emit

Deleting `dist/` without deleting `tsconfig.tsbuildinfo` makes `tsgo --build` exit 0 and emit
NOTHING — build mode trusts the buildinfo and believes the output is current. A package can
therefore declare `exports → dist/` and have a `build` script that produces nothing, with no error.
Any "clean" script must remove both, and any dist-restoration must too.
