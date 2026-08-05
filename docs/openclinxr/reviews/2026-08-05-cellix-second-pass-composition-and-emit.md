# Second-pass review: response audit + uncovered ground (vs cellixjs)

**Date:** 2026-08-05
**Reviewer:** grok-4.5, read-only, write commands denied
**Session:** `019fd430-eb0c-7833-a2be-0d5a8bbaea02` (resumable) · $0.54 / 12 turns
**Predecessor:** `2026-08-05-cellix-typescript-pnpm-second-opinion.md` — this review was given that
report plus our verification notes, and asked to (a) grade our response to it and (b) cover ground
it did not. Verification of THIS review is appended at the end.

---

I'll run a read-only second-pass: first the prior review and your three responses, then the composition/DI, domain, testing, and adapter gaps the first pass left open.Next I'll verify the three response points against both trees and open the composition, domain, and adapter surfaces the first review skipped.# Second-pass review: response audit + uncovered ground (A vs B)

**Scope:** read-only. First review: `docs/openclinxr/reviews/2026-08-05-cellix-typescript-pnpm-second-opinion.md`. Reference tree: `/Volumes/files/src/cellixjs-current`. No edits made.

---

## BOTTOM LINE

**Most important thing the first review missed:** A now has **two layered, Cellix-flavored composition systems** (`ApiApplication` type-state for Hono routes + `OpenClinXrApiStartupBuilder` for infrastructure/handlers in `api-bootstrap.ts`), while the useful lifecycle surface on `ComposedApiApp.start/stop` is **thrown away** by `createApiApp` (returns only `.app`). That is a real composition-architecture gap, not a package-config niggle.

**Verdict on the three responses:**

| Response | Verdict |
|---|---|
| 1. Turbo `typecheck`/`test` → `^build` | **Correct and load-bearing** — right fix for the cold-clone / stale-`dist` problem you verified. Incomplete vs B on cache `outputs` / worktree env; not a regression. |
| 2. GraphQL emit + keep `./resolvers` public | **Emit: correct. `./resolvers` public: half-correct / slightly wrong.** Not a browser leak given the architecture rule, but a zero-consumer public surface B deliberately does not have. |
| 3. Do **not** flip base `noEmit` / wire refs | **Still correct.** GraphQL emit removes one blocker; it does not make a monorepo-wide base flip the right next milestone. |

None of the three was done “badly.” The turbo change is the one you should keep without second-guessing. The resolvers export is the only soft miss.

---

## PART 1 — Audit of the three responses

### 1. `turbo.json`: `typecheck` / `test` → `dependsOn: ["^build"]`

**What A has now**

```69:98:turbo.json
    "typecheck": {
      "dependsOn": [
        "^build"
      ],
      ...
    },
    "lint": {
      "inputs": [
        "$TURBO_DEFAULT$",
        "package.json",
        "$TURBO_ROOT$/biome.json"
      ],
      "outputs": []
    },
    "test": {
      "dependsOn": [
        "^build"
      ],
```

`build` still has `dependsOn: ["^build", "//#gen"]` and `outputs: ["dist/**", "deploy/**"]` (`turbo.json:54-67`).

**What B has**

```10:38:/Volumes/files/src/cellixjs-current/turbo.json
		"build": {
			"dependsOn": ["^build", "//#gen"],
			...
			"outputs": ["dist/**", "build/**", "*.tsbuildinfo"]
		},
		"test": {
			"dependsOn": ["^build", "@cellix/config-vitest#build"],
			"inputs": ["$TURBO_DEFAULT$", "**/*.test.ts", "**/*.stories.tsx", "!coverage/**", "!target/**", "!dist/**", "!build/**", "!deploy/**"]
		},
```

B has **no `typecheck` task** at all; library “typecheck” is largely folded into `build: tsgo --build`. Lint in both trees has **no** `dependsOn` (B `turbo.json:125-128`).

**Did you miss edges B has?**

| Edge | Miss? | Why |
|---|---|---|
| `test` → `@cellix/config-vitest#build` | **No for A’s current model** | A’s `@cellix/config-vitest` is still source-first (`packages/cellix/config-vitest/package.json` exports `./src/...`, **no `build` script**). Wiring that edge would be dead/wrong until you make config-vitest emit like B. |
| `build.outputs` includes `*.tsbuildinfo` | **Yes — real miss for cache correctness** | B: `outputs: ["dist/**", "build/**", "*.tsbuildinfo"]`. A omits `*.tsbuildinfo`. With emit + incremental, buildinfo is part of the rebuild contract (your own first-review verification + MADR 0033 gotcha). Turbo may treat builds as clean while buildinfo state differs across worktrees/CI. |
| Explicit build `inputs` excluding tests | **Minor gap** | B lists source globs and excludes `!**/*.test.*`, `!vitest*.config.*`. A uses `$TURBO_DEFAULT$` plus a few files. Not wrong; slightly fuzzier cache invalidation. |
| `globalPassThroughEnv: ["WORKTREE_NAME"]` | **Unrelated to the three responses, but real** | B worktree isolation is first-class in turbo; A has openclaw worktree CLIs but no turbo env pass-through for parallel worktrees. |
| `lint` under-specified | **Same as B** | Neither depends on `^build`. Correct for Biome-on-source. Do **not** add `^build` to lint for ceremony. |

**`outputs` / parallel worktrees:** half-done. The `^build` edges fix ordering. They do **not** fix the incidental finding from your verification notes: stale `tsconfig.tsbuildinfo` can make `tsgo --build` exit 0 with empty `dist/`. Repo evidence: **only** `@openclinxr/graphql` declares `clean: "rm -rf dist *.tsbuildinfo"` (`packages/openclinxr/graphql/package.json:33`). Dozens of dist-export packages have **no `clean` script at all** (e.g. `@openclinxr/domain`, `@cellix/provider-contracts`, `@openclinxr/scenario-runtime`, … — enumerated from package.json walk). That is a larger residual than the turbo edge fix alone.

**Verdict on (1):** **Done correctly** for the ranked #1 fix. Not “wrong.” Residual gaps are cache `outputs` + clean/buildinfo hygiene, not a mistaken `dependsOn`.

---

### 2. `@openclinxr/graphql` build-emitting + public `./resolvers`

**Emit decision — correct**

```6:23:packages/openclinxr/graphql/package.json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./client": { ... },
    "./documents": { ... },
    "./resolvers": {
      "types": "./dist/generated/resolvers.generated.d.ts",
      "default": "./dist/generated/resolvers.generated.js"
    }
  },
```

```11:15:/Volumes/files/src/cellixjs-current/packages/ocom/graphql/package.json
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"default": "./dist/index.js"
		}
	},
```

MADR 0034 records Option A (emit), cold-clone verification, and UI-admin + api build evidence (`docs/madr/0034-graphql-package-build-emitting.md:69-122`). That matches first-review rank #2 option (a). Good.

**Keeping `./resolvers` public — half-correct / slightly wrong**

Evidence against “must stay public”:

- **Zero importers** of `@openclinxr/graphql/resolvers` in the tree (workspace grep of `.ts`/`.tsx` consumers: only `.`, `./client`, `./documents`).
- MADR itself admits **none** (`docs/madr/0034-…md:31`).
- Root `.` already pulls types from the generated file:

```6:33:packages/openclinxr/graphql/src/index.ts
import type {
  ...
} from "./generated/resolvers.generated.js";
...
export {
  ReviewDecision as AdminGraphqlReviewDecision,
  ScenarioStatus as AdminGraphqlScenarioStatus,
} from "./generated/resolvers.generated.js";
```

So the public subpath is not required for today’s type surface.

**Is it a browser leak?**

**No — not given the architecture rule.**

```1013:1018:packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts
  it("keeps UI app GraphQL imports on generated document subpaths instead of the executable server surface", () => {
    const violations = filesWithContentMatching("apps", /@openclinxr\/graphql(?!\/(?:documents|client)\b)/)
      .filter((filePath) => /^apps\/ui-[^/]+\/src\//.test(filePath));

    expect(violations).toEqual([]);
  });
```

That regex **forbids** UI apps from importing `.` **or** `./resolvers` (only `documents`/`client` allowed). So the separate architecture rule **is sufficient** to stop admin/UI bundling the server barrel.

Also: `resolvers.generated.*` is primarily **codegen types** (Scalars, Actor, inputs, `Resolvers` map types) — not the executable admin GraphQL runner (that lives on `.` via `executeAdminGraphql` / schema SDL). Risk profile is “extra public API,” not “secrets in the browser.”

**Why B only exposes `.`:** `@ocom/graphql` is a server package with domain/application deps (`@ocom/domain`, `@ocom/application-services` in B’s package.json). A’s multi-surface split (client/documents for Vite, `.` for Node) is **domain-appropriate** and better than B for a monorepo with a real admin UI. The mistake is not multi-export in general; it is keeping a **fourth, unused** subpath “for documentation / future servers.”

**Verdict on (2):** Emit **right**. Public `./resolvers` **mild design overshoot**, not a security defect. Prefer later: drop subpath **or** mark package-private and re-export only the few types needed through `.`. Architecture rule alone is enough for browser safety; it is **not** a reason to keep an unused export forever.

---

### 3. Not flipping base `noEmit` / not wiring project references

**Still the right call.**

Base remains:

```1:12:packages/cellix/config-typescript/tsconfig.base.json
{
  "compilerOptions": {
    ...
    "noEmit": true,
    ...
    "skipLibCheck": true,
```

B’s base is emit-oriented (`declaration`, `composite`, `incremental`, no `noEmit`) — `packages/cellix/config-typescript/tsconfig.base.json` in B.

Why the calculus has **not** flipped just because graphql emits:

1. **References still 0** in package tsconfigs (workspace search for `"references"` under packages/apps: none found). Emitting graphql only removes one TS6305 class of blocker; the graph is still inert.
2. **Mixed package modes remain** (correct dual-mode): architecture-rules, config-vitest, config-rolldown, physics-touch-contract, several arena apps are `typecheck` without `build`. A base emit flip still couples those exceptions.
3. First review’s mechanism correction still holds: honesty of **Turbo + dist exports** is the value; project refs are polish.
4. MADR 0033 still *aspires* to references after emit (`docs/madr/0033-…md:22-23,48-49`). That aspiration is fine as a later phase; it is not a reason to flip base now.
5. **Stale buildinfo + missing `clean` across almost all emit packages** makes a refs/`tsgo --build` world *more* footgun-heavy until clean hygiene lands.

**Verdict on (3):** **Correct non-action.** GraphQL emit was necessary; base flip is still the wrong finish line.

---

## PART 2 — Ground the first review did not cover

### 4. Application composition / DI

**A has two composition stories**

| Layer | File | Pattern |
|---|---|---|
| Hono app / middleware / routes | `apps/api/src/api-application.ts` | Type-state stages + `assertPhase` |
| Context bag | `apps/api/src/api-app-context.ts` | Explicit `ApiAppContext` |
| Process/infra / Azure-function-shaped startup | `apps/api/src/api-bootstrap.ts` | `OpenClinXrApiStartupBuilder` (infra → context → app services → handlers → `startUp`) |
| Thin façade | `apps/api/src/app.ts:218-228` | `createApiApp` → `ApiApplication`…`.build().app` |

**B has one**

`Cellix` in `apps/api/src/cellix.ts` (phases: infrastructure → context → app-services → handlers → started) composed in `apps/api/src/index.ts:23-71` with env-selected concrete services (`isProd` blob storage branch at lines 27-32).

**Is A’s type-state builder better, worse, or different?**

**Different, and good for the Hono problem it solves; incomplete as “the” composition root.**

Strengths of A’s `ApiApplication`:

- Segregated interfaces make middleware-before-routes a **compile error** (`api-application.ts:32-58`; tests with `@ts-expect-error` at `api-application.test.ts:13-24`).
- Explicit context ends god-file closures (`api-app-context.ts:19-31`).
- Shutdown is **better than B** in one respect: reverse-order, compensating rollback on partial start, idempotent stop (`api-application.ts:151-177`). B’s Cellix uses parallel service start/stop with OTel hooks — different host model (Azure Functions).

Weaknesses / honesty:

1. **`createApiApp` discards lifecycle.**  
   `return ...build().app` (`app.ts:223-228`) throws away `start`/`stop` on `ComposedApiApp`. So the load-bearing lifecycle design is mostly unused by the public factory.
2. **Dual builders.** `OpenClinXrApiStartupBuilder` (`api-bootstrap.ts:171+`, factory at `229-246`) is a second Cellix clone (string-keyed registry, not constructor keys). B does not stack two fluent frameworks.
3. **`app.ts` line count dropped; import surface did not fully.** File is ~320 lines but still re-exports a large DTO surface and pulls many package imports at the top (`app.ts:1-100+`, `export type` block `132-160`). “God-file gone” is directionally true for route registration; residual re-export hub remains.
4. **`withLifecycleServices` has no `assertPhase`** (`api-application.ts:126-129`) while other methods do. Type-state covers TS callers; runtime guard is inconsistent.

**Is `assertPhase` load-bearing or ceremony?**

**Mostly ceremony for in-repo TypeScript callers; mild defence-in-depth for untyped/cast callers — same role as B’s `ensurePhase`.**

- B: `ensurePhase(...allowed)` at `cellix.ts:362-364`, called on every mutating method.
- A: `assertPhase` documented as “Defence in depth for JS callers / package boundaries” (`api-application.ts:98-103`); tested via cast at `api-application.test.ts:27-31`.

Because stages return **narrow interfaces**, a normal TS caller cannot call out of order without a cast. The runtime guard matters if:

- something does `as any` / package-boundary JS, or  
- stage interfaces are ever widened.

It is not load-bearing for the happy path. **Keep it** (cheap, mirrors B, tests exist); do not grow more phase machinery around it.

**Honest comparison:** A’s type-state is a good **Hono-specific** extract of Cellix’s phase idea. B’s composition is deeper where it matters for *their* product: infrastructure service registry, **request-scoped** `forRequest` app services, passport construction, Azure lifecycle. A should not copy Azure Functions ceremony. A **should** notice it now has **two** partial Cellix ports and one discarded lifecycle API.

---

### 5. Domain modelling

**B:** real seedwork — aggregate root, entities, value objects, domain events, repository, UoW, passport/visa (`packages/cellix/domain-seedwork/src/…`), plus a large product domain (`packages/ocom/domain/src/domain/contexts/**` with community/property/case/user aggregates, feature files, event types).

**A `@openclinxr/domain`:** two modules — claim-language + station phase machine:

```24:49:packages/openclinxr/domain/src/station-state.ts
export function createStationRun(scenarioId: string, learnerId: string): StationRun { ... }
export function transitionStation(run: StationRun, command: StationCommand): StationRun {
  if (command.type === "START_ENCOUNTER") {
    if (run.phase !== "doorway") {
      throw new Error(`Cannot start encounter during ${run.phase}`);
    }
```

Real “domain weight” lives elsewhere as **procedural packages**, not aggregates:

- `session-state` (~2k+ LOC of session core/messaging/types)
- `scenario-runtime` (~750 LOC runtime + large tests)
- `shared-schemas` (TypeBox contracts)
- `exam-assembly`, `review-workflow`, `conversation-policy`, `asset-registry`

**Where A would genuinely benefit (narrowly):**

| Need | Borrow idea, not stack |
|---|---|
| Invariants on station/exam lifecycle that are currently free functions | Keep pure functions / small types; optional explicit “aggregate” module only if multiple writers appear |
| Authorization that must not leak into UI | Lightweight policy objects (you already have claim-language + auth helpers) — **not** B’s passport/visa matrix |
| Durable domain events for review/replay (Q4) | Append-only trace/event records you already model via provider-contracts / telemetry / session traces — not full event-bus seedwork + handler registration |

**Where importing B’s DDD machinery would be over-engineering:**

- Aggregate roots + UoW + mongoose-seedwork for **WebXR actor pose, garment geometry, physics probes, Anny pipeline** — wrong abstraction (spatial/asset pipelines ≠ community property aggregates).
- Passport/visa IAM model sized for multi-tenant community portals — A’s learner/faculty/dev-auth is far smaller.
- Cucumber `.feature` domain specs as default — toil for simulation runtime.
- Domain events bus as a mandatory layer for every state change — A’s station run is short-lived and often in-memory; over-sync.

**MADR 0014 rejection still holds.** “Influence, not hard dependency” (`docs/madr/0014-…md:12`) was right in May and still right after Cellix package-config adoption. The valuable influence is **package boundaries + composition + emit**, not **ocom’s aggregate catalog**.

---

### 6. Testing strategy

First review covered lanes at high level; deeper cut:

| B | A | Worth adopting? |
|---|---|---|
| Per-package `test` / `test:unit` / `test:integration` / `test:arch` + turbo tasks | Mostly single `test`; root `test:integration` → **only** `@openclinxr/data-mongodb` (`package.json:348`); architecture is a **separate turbo task** on `@openclinxr/architecture-rules` | **Partial:** add `test:integration` only on packages that truly need MMS/network; avoid empty lane theater (first review was right) |
| Co-located `src/archunit-tests/` | Central scanners in architecture-rules (`workspace-architecture.test.ts` etc.) | **Keep A’s central model** for monorepo conventions; optionally add **one** package-local arch test when a domain import rule is package-specific |
| `@ocom-verification/*` tier | tools/ + evidence scripts + architecture-rules | **Do not clone** verification tier |
| Serenity/Cucumber acceptance | Not present as default | **Do not adopt** (domain mismatch; first review) |
| `test:arch` depends on `@cellix/archunit-tests#build` | architecture depends on `^typecheck` (`turbo.json:99-108`) | Fine for A; don’t invent archunit package until central rules hurt |

**Worth doing (high value/effort):** grow integration only when a second package truly needs it; keep architecture-rules central; ensure emit packages’ tests run under `tsconfig.vitest.json` (already MADR 0033 invariant).

**Not worth doing:** five verification packages, Serenity default, per-package empty `test:unit` scripts, co-locating every arch rule.

---

### 7. Runtime / composition boundaries (providers)

**A already has a stronger *package-level* adapter model than B’s typical infra services for this concern:**

- Port: `ModelProviderAdapter` + `firstReadyAdapter` health gate (`packages/openclinxr/model-gateway/src/index.ts:142-175`)
- Mock + Local `not_configured` adapters (tests at `model-gateway.test.ts:239-249`)
- Voice: same pattern + `selectRealtimeVoiceProtocol` (`voice-gateway/src/gateway.ts`, `adapters.ts`)
- Shared contracts: `@cellix/provider-contracts` `ProviderHealth` (`ready` \| `not_configured` \| `blocked`) (`provider-contracts/src/index.ts:52-67`)
- Capability matrix readiness: `evaluateRuntimeProviderReadinessSurface` in capability-gateway
- Persistence selection at process edge: `OPENCLINXR_PERSISTENCE` + dynamic import of mongo boot (`apps/api/src/server.ts:10-26`) — good composition-root binding

**What B does at composition time that A only partially mirrors:**

B wires **concrete services at the single composition root** with env branching (`apps/api/src/index.ts:20-44`: prod vs client blob storage, mongoose connection from `service-config/*`). Services validate on `startUp()` (e.g. mongoose service).

**Gap in A (important):**

`ModelGateway` is **not** composed into `apps/api`. Workspace usage is tests + `tools/openclinxr/scenario-authoring-roundtrip.ts`. API bootstrap registers scenarioRuntime, persistence, telemetry, assetGenerationFacade — **not** a model/voice provider gateway instance (`api-bootstrap.ts:230-235`). Voice is mostly **posture/config**, not a selected adapter list at composition.

So: **ports-and-adapters exist; composition-time selection is incomplete.** B’s lesson worth copying is not Azure — it is:

1. **One place** lists which adapters/services are live for this process.
2. **Env/config modules** next to the app (`service-config/`) rather than scattered defaults.
3. **Fail at start** when required infra is misconfigured (A’s Local adapters correctly report `not_configured`; nothing at API start fails closed on “we expected a ready model provider”).

A’s health-gated `firstReadyAdapter` is already better than silent null providers. What to copy: **wire gateway instances in the startup builder**, with explicit Mock-for-dev / blocked-for-prod policy — not B’s Azure service zoo.

---

### 8. Free-form: B things A has not really noticed

1. **`@cellix/local-dev` + worktree port/hostname isolation**  
   B: `packages/cellix/local-dev` exports `./worktree`, port offsets, Azurite/Mongo ports; turbo `globalPassThroughEnv: ["WORKTREE_NAME"]`; tasks `dev:worktree`, e2e depends on local-dev builds.  
   A: openclaw worktree promote CLIs and `dev:portless` on UIs — **not** a shared local-dev package integrated into turbo. High value if multi-agent worktrees collide on ports/Mongo.

2. **Request-scoped application services + passport**  
   B: `buildApplicationServicesFactory` → `forRequest(authHeader)` builds per-request services with domain passport (`application-services` index).  
   A: Hono middleware sets auth identity; no equivalent request-scoped service host. Fine at current size; becomes valuable if many routes need the same principal-resolved deps.

3. **Dual Cellix ports in A (see §4)** — the biggest “you didn’t notice you did this twice.”

4. **Standard `clean` + buildinfo as package hygiene** — B packages routinely `rimraf dist`; A almost never. Interacts with emit model risk.

5. **Precise turbo build inputs** (exclude tests/coverage from build cache keys) — small correctness win.

6. **`prebuild: lint` on many B packages** — optional; can fight agent velocity; **not** recommended as default for A.

7. **Domain event registration at context build** — B `RegisterEventHandlers(domainDataSource)` in `setContext`. A’s Q4 path is traces/review packets; if you need handlers, keep them explicit and few — don’t import full event-bus seedwork.

8. **Deep export maps** (e.g. `@ocom/persistence` many subpaths) — first review said skip; **agree**. A’s graphql multi-export is the only justified multi-surface case.

9. **UI source-first packages** — first review covered; still open and still worth measuring for Vite HMR, not re-litigated here beyond: B proves dual-mode is mature.

10. **Service packages as startable units** (`ServiceMongoose.startUp`, etc.) vs A’s optional `ApiLifecycleService` that is never used by `createApiApp` — composition maturity gap.

---

## Ranked recommendations (value ÷ effort)

| Rank | Action | Value/effort | Notes |
|---|---|---|---|
| **1** | Keep turbo `^build` on typecheck/test | Already done | Do not revert |
| **2** | Repo-wide `clean` = `dist` + `*.tsbuildinfo`; add `*.tsbuildinfo` to turbo `build.outputs` | **High / low** | Closes the real residual of the emit migration |
| **3** | Unify or clearly layer the two composition builders; make `createApiApp` return `ComposedApiApp` **or** drop unused lifecycle API | **High / medium** | First-review miss |
| **4** | Wire `ModelGateway` (and voice adapters) at API startup with explicit Mock vs blocked policy | **High / medium** | Ports exist; composition doesn’t use them |
| **5** | Drop or internalize `@openclinxr/graphql/resolvers` subpath | **Med / low** | Zero consumers; architecture already protects UI |
| **6** | Package-name `extends` + emit defaults in config-typescript (first review #3) | **Med / med** | Still open; not redone |
| **7** | Relocate product packages out of `@cellix/` (first review #4) | **Med / low** | Still open |
| **8** | Shared local-dev/worktree helpers (B-inspired, XR-sized) | **Med / med** | Only if worktree collisions hurt |
| **9** | Project references via generator | **Low–med / high** | After 2–3–6, not before |
| **10** | Integration lane growth | **Low now / grows later** | When ≥2 packages need it |

### Explicitly NOT worth doing

| Skip | Why |
|---|---|
| Base `noEmit` flip as a milestone | Still couples mixed modes; turbo honesty first |
| Full domain-seedwork / mongoose-seedwork / passport matrix | MADR 0014 still right; XR sim ≠ ocom |
| Serenity/Cucumber / `@ocom-verification` tree | Domain + toil |
| `skipLibCheck: false` | Three.js/WebXR `.d.ts` tax |
| Deep persistence-style export maps | Pre-building package surface |
| Empty `test:unit` / `test:arch` scripts on every package | Ceremony |
| Azure service package sprawl | Wrong host |
| Making `lint` depend on `^build` | No benefit |
| Copying B’s `test` → `config-vitest#build` before config-vitest emits | Wrong edge for A today |

---

## Skeptical summary of *your* three responses

| Response | Adversarial score |
|---|---|
| Turbo `^build` | **Right fix, right reasoning after you corrected the “silent stale types” framing.** Residual: outputs/clean/buildinfo. |
| GraphQL emit | **Right.** |
| Keep `./resolvers` public | **Slightly wrong / speculative.** Safe for browsers via architecture rule; still unnecessary API surface. |
| Defer base `noEmit` / refs | **Right non-action.** GraphQL did not change that. |

**Single sentence for the record:** You fixed the incomplete dist-migration task graph correctly; the larger unreviewed problem is **composition maturity** (dual Cellix ports, unused lifecycle, gateways not bound at the API root) and **emit hygiene** (clean + buildinfo), not TypeScript project references.
---

## Verification (ours)

| Claim | Verdict | Evidence |
|---|---|---|
| turbo `build.outputs` omits `*.tsbuildinfo`; cellix includes it | **CONFIRMED** | A: `["dist/**","deploy/**"]` · B: `["dist/**","build/**","*.tsbuildinfo"]` |
| Almost no emit package has a `clean` script | **CONFIRMED, and worse than stated** | 30 build-emitting packages, **29** without `clean` — only `@openclinxr/graphql` had one |
| Consequence is a cache/hygiene residual | **CONFIRMED — and it is a silent-failure bug, not just hygiene** | see below |

### The failure mode, reproduced

With `dist/` removed but `tsconfig.tsbuildinfo` retained — exactly the state a turbo cache restore
can produce, since `dist/**` was a cached output and the buildinfo was not — `tsgo --build` exits
**0 and emits nothing**:

```
dist files: 6
rm -rf dist            # keep buildinfo
tsgo --build           # exits 0
dist files after: 0    # silent no-emit
```

A package whose `exports` resolve to `dist/` then has no `dist/` at all, and the build reports
success. This is the same trap that made the MADR 0033 pilot package look broken earlier today.

Fixed both halves, because either alone leaves the hole open:
- `*.tsbuildinfo` added to `build.outputs`, so the buildinfo travels with the dist it describes.
- `clean` added to all 29 packages that lacked it, removing `dist` **and** `*.tsbuildinfo` together.

Verified after the fix: `clean` leaves 0 buildinfo + 0 dist, and the subsequent build emits 6 files.
Full gate green — 67/67 tasks, 80/80 architecture.

### Not yet acted on

The review's rank 3 and 4 (dual composition builders; `createApiApp` discarding
`ComposedApiApp.start/stop`; ModelGateway not bound at the API composition root) are real and
unverified by us so far. They are direction changes rather than defect fixes, so they are queued
rather than executed.
