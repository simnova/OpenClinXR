# Biome Coverage Expansion Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise Biome TypeScript coverage beyond the current `226 / 384 = 58.9%` baseline by enabling additional cohesive source roots without broad repo churn.

**Architecture:** Expand Biome coverage in package/app-root slices that can be validated independently. Workers own disjoint source roots, use focused `biome check`/`biome check --write` only inside their assigned root, and report whether the root is safe to add to `hygiene:biome`. The parent integrates only clean roots into `package.json` and runs global hygiene gates.

**Tech Stack:** Biome, pnpm scripts, TypeScript/tsgo, Knip, Superpowers/OpenClaw-style subagent coordination.

---

## Current Baseline

- Biome TS coverage: `226 / 384 = 58.9%`.
- Remaining uncovered TS/TSX files: `158`.
- Avoid overlapping previous uncommitted batch changes in `apps/api`, `apps/ui-admin`, `packages/openclinxr/graphql`, `packages/openclinxr/shared-schemas`, `packages/openclinxr/voice-gateway`, `tools/openclinxr/gltf-pipeline-smoke.ts`, `biome.json`, `knip.json`, `package.json`, and `tsconfig.json` unless explicitly integrating final clean roots.

## Batch 2 Candidate Roots

### Task 1: Persistence Package Roots

**Files:**
- Modify only under `packages/openclinxr/data-mongodb/src/**`
- Modify only under `packages/openclinxr/data-sources-mongoose-models/src/**`

- [ ] **Step 1: Probe focused roots**

Run:

```bash
pnpm exec biome check packages/openclinxr/data-mongodb/src packages/openclinxr/data-sources-mongoose-models/src
```

Expected: diagnostics are mechanical import/style items or small source fixes. If behavior-sensitive diagnostics appear, fix minimally rather than suppressing.

- [ ] **Step 2: Apply safe fixes only in owned roots**

Run only if diagnostics are safe/mechanical:

```bash
pnpm exec biome check --write packages/openclinxr/data-mongodb/src packages/openclinxr/data-sources-mongoose-models/src
```

Expected: Biome modifies only the two owned roots.

- [ ] **Step 3: Validate focused roots**

Run:

```bash
pnpm exec biome check packages/openclinxr/data-mongodb/src packages/openclinxr/data-sources-mongoose-models/src
pnpm typecheck:strict
```

Expected: both commands pass.

### Task 2: Domain And Scenario Roots

**Files:**
- Modify only under `packages/openclinxr/domain/src/**`
- Modify only under `packages/openclinxr/scenario-fixtures/src/**`
- Modify only under `packages/openclinxr/scenario-runtime/src/**`
- Modify only under `packages/openclinxr/session-state/src/**`

- [ ] **Step 1: Probe focused roots**

Run:

```bash
pnpm exec biome check packages/openclinxr/domain/src packages/openclinxr/scenario-fixtures/src packages/openclinxr/scenario-runtime/src packages/openclinxr/session-state/src
```

Expected: diagnostics are mechanical import/style issues.

- [ ] **Step 2: Apply safe fixes only in owned roots**

```bash
pnpm exec biome check --write packages/openclinxr/domain/src packages/openclinxr/scenario-fixtures/src packages/openclinxr/scenario-runtime/src packages/openclinxr/session-state/src
```

- [ ] **Step 3: Validate focused roots**

```bash
pnpm exec biome check packages/openclinxr/domain/src packages/openclinxr/scenario-fixtures/src packages/openclinxr/scenario-runtime/src packages/openclinxr/session-state/src
pnpm typecheck:strict
```

Expected: both commands pass.

### Task 3: Review And Capability Roots

**Files:**
- Modify only under `packages/openclinxr/review-workflow/src/**`
- Modify only under `packages/openclinxr/capability-gateway/src/**`
- Modify only under `packages/openclinxr/trace-ledger/src/**`

- [ ] **Step 1: Probe focused roots**

```bash
pnpm exec biome check packages/openclinxr/review-workflow/src packages/openclinxr/capability-gateway/src packages/openclinxr/trace-ledger/src
```

- [ ] **Step 2: Apply safe fixes only in owned roots**

```bash
pnpm exec biome check --write packages/openclinxr/review-workflow/src packages/openclinxr/capability-gateway/src packages/openclinxr/trace-ledger/src
```

- [ ] **Step 3: Validate focused roots**

```bash
pnpm exec biome check packages/openclinxr/review-workflow/src packages/openclinxr/capability-gateway/src packages/openclinxr/trace-ledger/src
pnpm typecheck:strict
```

Expected: both commands pass.

### Task 4: Asset Registry And Harness Roots

**Files:**
- Modify only under `packages/openclinxr/asset-registry/src/**`
- Modify only under `packages/openclinxr/test-harness/src/**`

- [ ] **Step 1: Probe focused roots**

```bash
pnpm exec biome check packages/openclinxr/asset-registry/src packages/openclinxr/test-harness/src
```

- [ ] **Step 2: Apply safe fixes only in owned roots**

```bash
pnpm exec biome check --write packages/openclinxr/asset-registry/src packages/openclinxr/test-harness/src
```

- [ ] **Step 3: Validate focused roots**

```bash
pnpm exec biome check packages/openclinxr/asset-registry/src packages/openclinxr/test-harness/src
pnpm typecheck:strict
```

Expected: both commands pass.

## Parent Integration

- [ ] **Step 1: Add only clean roots to `hygiene:biome`**

Append worker-approved roots to `package.json` `scripts.hygiene:biome`. Do not add roots that still require behavior review.

- [ ] **Step 2: Run final validation**

```bash
pnpm hygiene:biome
pnpm typecheck:strict
pnpm hygiene:knip
```

Expected: all commands pass.

- [ ] **Step 3: Recompute coverage**

Use the existing coverage-count Node snippet from the prior plan to report the updated `biomeCoveredTypeScriptFiles` and percentage.
