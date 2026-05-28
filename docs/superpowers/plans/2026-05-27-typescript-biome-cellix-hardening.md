# TypeScript And Biome Cellix-Aligned Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OpenClinXR toward CellixJS-level TypeScript and Biome discipline without weakening OpenClaw guardrails or breaking generated/evidence workflows.

**Architecture:** Keep OpenClinXR's repo-native guardrail layering: strict root typecheck, relaxed tools typecheck where needed, guardrail checks, package typechecks, and Biome hygiene. Adopt CellixJS's simpler broad Biome policy and stricter rule posture in phases, with generated-source exceptions documented instead of hidden in ad hoc scripts.

**Tech Stack:** TypeScript native preview via `tsgo`, pnpm, Turborepo, Biome 2.4.x, repo guardrail scripts in `tools/agent-factory`, OpenClaw control docs.

---

## Protected Constraints

- Do not weaken `/Volumes/files/src/openclinxr/AGENTS.md`, `/Volumes/files/src/openclinxr/PROJECT_COORDINATION_INDEX.md`, `/Volumes/files/src/openclinxr/AUTONOMOUS_WORK_PLAN.md`, or OpenClaw guardrail docs.
- Do not remove generated-source exceptions unless the generated source is fixed or regenerated.
- Do not make formatter-wide rewrites in the same batch as lint policy changes.
- Do not add cloud, paid, deployment, or external runtime dependencies.
- Do not use generic Codex-autonomy artifacts; update canonical OpenClaw docs/matrices only if policy changes affect agent operation.

## Findings Driving This Plan

- OpenClinXR already extends a local Cellix-style TypeScript config through `/Volumes/files/src/openclinxr/tsconfig.base.json`.
- CellixJS has a stricter TypeScript base: unused checks, implicit return/override checks, index-signature access checks, side-effect import checks, verbatim module syntax, erasable syntax, composite/incremental, and `skipLibCheck: false`.
- OpenClinXR has stronger agentic execution layering: `typecheck:strict`, `typecheck:relaxed`, `typecheck:guardrails`, and package-level Turbo typechecks.
- CellixJS has a cleaner Biome policy: broad includes with explicit excludes, formatter enabled, organize-import assist, and many lint rules promoted to errors.
- OpenClinXR has full TS/TSX Biome coverage, but the script is path-heavy; the next improvement is policy quality and maintainability, not just coverage percentage.

## Batch 1: Biome Policy Baseline And Drift Guard

**Files:**
- Modify: `/Volumes/files/src/openclinxr/biome.json`
- Modify: `/Volumes/files/src/openclinxr/package.json`
- Modify: `/Volumes/files/src/openclinxr/tools/agent-factory/check-typescript-guardrails.ts`
- Test: `/Volumes/files/src/openclinxr/biome.json`

- [ ] **Step 1: Add Biome assist/import organization policy**

Add this block to `/Volumes/files/src/openclinxr/biome.json` if absent:

```json
"assist": {
  "enabled": true,
  "actions": {
    "source": {
      "organizeImports": "on"
    }
  }
}
```

Expected behavior: Biome can enforce import organization without enabling whole-repo formatting.

- [ ] **Step 2: Promote safe TypeScript hygiene rules to errors**

In `/Volumes/files/src/openclinxr/biome.json`, keep `recommended: true`, keep generated GraphQL exceptions, and add phased strict rules:

```json
"style": {
  "useImportType": "error",
  "useConst": "error"
},
"suspicious": {
  "noExplicitAny": "warn",
  "noVar": "error"
}
```

Expected behavior: type-only imports, const preference, and no-var become required; explicit `any` remains warning for generated/provider boundary work.

- [ ] **Step 3: Add guardrail expectation for Biome policy**

Update `/Volumes/files/src/openclinxr/tools/agent-factory/check-typescript-guardrails.ts` to assert:

```ts
const biome = JSON.parse(readFileSync('biome.json', 'utf8')) as Record<string, unknown>;
const assist = biome.assist as { enabled?: boolean; actions?: { source?: { organizeImports?: string } } } | undefined;
assert(assist?.enabled === true, 'biome.json must enable assist');
assert(assist?.actions?.source?.organizeImports === 'on', 'biome.json must enable source.organizeImports');
```

Expected behavior: agents cannot silently drop the import-organization policy.

- [ ] **Step 4: Run focused checks**

Run:

```bash
pnpm exec biome check biome.json package.json tools/agent-factory/check-typescript-guardrails.ts
pnpm typecheck:guardrails
```

Expected: both commands pass, or report only issues in the three touched files.

- [ ] **Step 5: Commit Batch 1**

```bash
git add biome.json package.json tools/agent-factory/check-typescript-guardrails.ts docs/superpowers/plans/2026-05-27-typescript-biome-cellix-hardening.md
git commit -m "chore: harden biome policy guardrails"
```

## Batch 2: TypeScript Strictness Gap Analysis Without Broad Breakage

**Worker Batch 2 completion note:** OpenClinXR now adopts the bounded CellixJS TypeScript strictness deltas that the current root compiler can satisfy: `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `noPropertyAccessFromIndexSignature`, and `noUncheckedSideEffectImports`. The guardrail script requires these adopted options to remain present in `packages/cellix/config-typescript/tsconfig.base.json`; dynamic compiler option reads remain bracket-based so `noPropertyAccessFromIndexSignature` is satisfied without touching product source. Deferred CellixJS deltas are documented in the strictness gap matrix: unused checks, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `composite` / `incremental`, and `skipLibCheck: false`.

**Files:**
- Modify: `/Volumes/files/src/openclinxr/tools/agent-factory/check-typescript-guardrails.ts`
- Create: `/Volumes/files/src/openclinxr/docs/openclinxr/typescript-strictness-gap-matrix-2026-05-27.md`
- Modify: `/Volumes/files/src/openclinxr/packages/cellix/config-typescript/tsconfig.base.json`

- [ ] **Step 1: Document CellixJS strictness deltas**

Create `/Volumes/files/src/openclinxr/docs/openclinxr/typescript-strictness-gap-matrix-2026-05-27.md` with this table:

```markdown
# TypeScript Strictness Gap Matrix - 2026-05-27

| Rule | CellixJS | OpenClinXR current | Recommended phase |
|---|---:|---:|---|
| noUnusedLocals | true | false/unset | Phase 2 after current unused cleanup |
| noUnusedParameters | true | false/unset | Phase 2 after current unused cleanup |
| noImplicitReturns | true | false/unset | Phase 1 candidate |
| noImplicitOverride | true | false/unset | Phase 1 candidate |
| noPropertyAccessFromIndexSignature | true | false/unset | Phase 2 candidate |
| noUncheckedSideEffectImports | true | false/unset | Phase 2 candidate |
| verbatimModuleSyntax | true | false/unset | Phase 3, may require import/export churn |
| erasableSyntaxOnly | true | false/unset | Phase 3, requires syntax audit |
| composite/incremental | true | false/unset | Phase 3 package-build architecture |
| skipLibCheck | false | true | Phase 4, dependency-health gate |
```

- [x] **Step 2: Guard against weakening current strict flags**

Update `/Volumes/files/src/openclinxr/tools/agent-factory/check-typescript-guardrails.ts` to assert `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` remain true in the inherited local config chain.

- [x] **Step 3: Evaluate Phase 1 TS flags only**

Temporarily test adding these to `/Volumes/files/src/openclinxr/packages/cellix/config-typescript/tsconfig.base.json`:

```json
"noImplicitReturns": true,
"noImplicitOverride": true
```

Run:

```bash
pnpm typecheck:strict
pnpm packages:typecheck:affected
```

Expected: either pass, or produce a bounded list of failures suitable for Batch 3. If failures are broad, revert these two flags and keep only the gap matrix plus guardrails.

Worker Batch 2 additionally evaluated the current candidate strictness flags and adopted the clean bounded set:

```json
"noFallthroughCasesInSwitch": true,
"allowUnreachableCode": false,
"allowUnusedLabels": false,
"noPropertyAccessFromIndexSignature": true,
"noUncheckedSideEffectImports": true
```

- [ ] **Step 4: Commit Batch 2**

```bash
git add tools/agent-factory/check-typescript-guardrails.ts docs/openclinxr/typescript-strictness-gap-matrix-2026-05-27.md packages/cellix/config-typescript/tsconfig.base.json
git commit -m "chore: map typescript strictness gaps"
```

## Batch 3: Fix First Strictness Failures If Phase 1 Is Bounded

**Files:**
- Modify only files reported by `pnpm typecheck:strict` or `pnpm packages:typecheck:affected` after enabling `noImplicitReturns` and `noImplicitOverride`.

- [ ] **Step 1: Group failures by package**

Use package ownership from the compiler output. Assign one worker per package only when write sets are disjoint.

- [ ] **Step 2: Fix `noImplicitReturns` explicitly**

For each failure, choose one:

```ts
return value;
```

or

```ts
throw new Error('specific impossible state message');
```

Expected behavior: no silent fallthrough.

- [ ] **Step 3: Fix `noImplicitOverride` explicitly**

For each subclass method override, add:

```ts
override methodName(...) { ... }
```

Expected behavior: override intent is explicit.

- [ ] **Step 4: Run package-scoped verification**

Run the smallest relevant command first:

```bash
pnpm --filter <package-name> typecheck
```

Then run:

```bash
pnpm packages:typecheck:affected
```

- [ ] **Step 5: Commit Batch 3**

```bash
git add <touched source files> packages/cellix/config-typescript/tsconfig.base.json
git commit -m "chore: satisfy phase one typescript strictness"
```

## Batch 4: Biome Rule Promotion After Current Violations Are Known

**Files:**
- Modify: `/Volumes/files/src/openclinxr/biome.json`
- Modify source files reported by Biome only when changes are mechanical and safe.

- [ ] **Step 1: Dry-run candidate CellixJS rules**

Run:

```bash
pnpm exec biome check apps packages tools --diagnostic-level=warn
```

Expected behavior: gather rule failures without changing files.

- [ ] **Step 2: Promote one safe rule at a time**

Candidate order:

```text
style.useImportType -> error
suspicious.noVar -> error
style.useConst -> error
suspicious.noExplicitAny -> error only outside generated/provider boundary files
style.noNonNullAssertion -> warn first, then error after adoption
```

- [ ] **Step 3: Keep generated exceptions explicit**

Generated GraphQL and provider-boundary exceptions must be represented in `biome.json` overrides, not hidden by excluding whole package trees.

- [ ] **Step 4: Verify Biome policy**

Run:

```bash
pnpm hygiene:biome
pnpm agent:alignment
```

- [ ] **Step 5: Commit Batch 4**

```bash
git add biome.json <mechanically touched source files>
git commit -m "chore: tighten biome rule enforcement"
```

## Batch 5: Simplify Biome Invocation Without Losing Coverage

**Batch 5 completion note:** Keep `pnpm hygiene:biome` as the canonical Biome entrypoint. Worker audit found no stale Biome probe/candidate scripts, and the existing root command is already centralized through `hooks:strict`. A broad simplification probe using `biome ci apps packages tools '*.json' '*.jsonc'` was rejected because Biome treated the quoted root globs as literal paths and emitted internal missing-file diagnostics for `*.json` and `*.jsonc`. The current explicit path-heavy command remains the safer locked implementation because it preserves coverage, generated/provider exceptions, `.gitignore` behavior, and OpenClaw strict hygiene wiring.

**Final Batch 5 decisions:**
- `pnpm hygiene:biome` is the final user-facing command.
- Do not replace the current explicit script until an equivalent broad command is proven without literal-glob internal diagnostics.
- Preserve `biome.json` `vcs.useIgnoreFile: true`.
- Preserve the generated GraphQL override for `packages/openclinxr/graphql/src/generated/**`.
- Preserve `hygiene:biome` inside `hooks:strict`.
- Treat Batch 4 rule probes as historical evidence, not canonical entrypoints.

**Files:**
- Modify: `/Volumes/files/src/openclinxr/package.json`
- Modify: `/Volumes/files/src/openclinxr/biome.json`
- Modify: `/Volumes/files/src/openclinxr/docs/openclinxr/worker-backlog-and-validation-matrix.md`

- [ ] **Step 1: Replace path-heavy script only if equivalent**

Compare current `hygiene:biome` path list to `biome.json` broad include/exclude behavior. If equivalent, replace with:

```json
"hygiene:biome": "biome ci apps packages tools *.json *.jsonc"
```

Expected behavior: the command remains broad, readable, and reproducible.

- [ ] **Step 2: Preserve local/generated ignores**

Keep `vcs.useIgnoreFile: true` and generated-source overrides. Do not copy CellixJS `useIgnoreFile:false` because OpenClinXR intentionally carries local evidence/artifact workflows.

- [ ] **Step 3: Verify coverage**

Run:

```bash
pnpm hygiene:biome
pnpm agent:alignment
```

Expected: Biome still covers all TS/TSX paths previously covered.

- [ ] **Step 4: Commit Batch 5**

```bash
git add package.json biome.json docs/openclinxr/worker-backlog-and-validation-matrix.md
git commit -m "chore: simplify biome hygiene entrypoint"
```

## Orchestration Rules

- Exactly one non-coding orchestrator owns batch sequencing.
- Workers own disjoint files or packages.
- Orchestrator may reject a batch if it creates mass formatting churn or weakens OpenClaw guardrails.
- Workers must not edit protected OpenClaw control docs unless the batch explicitly says so.
- After each batch, close completed/stale agents before starting the next batch.
- If a batch is blocked, record the blocker with a recommended default in `/Volumes/files/src/openclinxr/operator-open-questions.md`, then continue to the next non-blocked batch.
