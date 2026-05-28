# Biome Coverage Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise Biome TypeScript coverage safely toward full source coverage without broad churn, generated-artifact drift, or weakened OpenClaw guardrails.

**Architecture:** Use staged source-root enablement. First remove policy noise from generated code, then address concentrated real lint failures, then expand `hygiene:biome` only when each newly included subtree passes. Avoid docs/evidence/generated artifact files unless they are source TypeScript under `apps`, `packages`, or `tools` and are explicitly selected.

**Tech Stack:** Biome, TypeScript/tsgo, Knip, pnpm scripts, OpenClaw guardrail docs.

---

## Current Baseline

- TypeScript compilation coverage: `100%` of TS/TSX source/config files.
- Knip coverage: `100%` of JS/TS/MJS/CJS source/config files.
- Biome TypeScript coverage after first safe expansion: `179 / 384 = 46.6%`.
- Broad command `pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts apps packages tools` failed with `158 errors`, `200 warnings`, and `13 infos` across `485` files.

## Non-Negotiable Guardrails

- Do not include `docs/**`, generated evidence JSON, `.agent-factory/**`, build outputs, coverage outputs, or runtime caches in Biome hygiene.
- Do not run repo-wide `biome --write` across all roots.
- Do not weaken TypeScript, Knip, OpenClaw, security, or license checks.
- Prefer source fixes for real issues; prefer explicit generated-source policy for generated GraphQL.
- Keep each slice small enough to validate with `pnpm hygiene:biome`, `pnpm typecheck:strict`, and `pnpm hygiene:knip` where relevant.

---

### Task 1: Generated GraphQL Biome Policy

**Files:**
- Modify: `biome.json`
- Optional Modify: `package.json`

- [ ] **Step 1: Determine generated GraphQL policy**

Generated files under `packages/openclinxr/graphql/src/generated/**` currently create noisy `noExplicitAny` and import organization diagnostics. Treat these as generated source, not hand-authored source.

Preferred policy:

```json
{
  "includes": ["packages/openclinxr/graphql/src/generated/**"],
  "linter": {
    "rules": {
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  }
}
```

If Biome does not support the exact override shape already used by the repo, add the smallest supported `overrides` entry that disables `noExplicitAny` only for generated GraphQL.

- [ ] **Step 2: Validate generated GraphQL subtree**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts packages/openclinxr/graphql/src
```

Expected: no `noExplicitAny` failures from `packages/openclinxr/graphql/src/generated/**`. If import organization remains, report it for Task 3 rather than broad-fixing now.

- [ ] **Step 3: Add passing subtree to hygiene script if clean**

If the GraphQL subtree passes after the generated policy, add `packages/openclinxr/graphql/src` to `hygiene:biome` in `package.json`.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm hygiene:biome
pnpm typecheck:strict
pnpm hygiene:knip
```

Expected: all pass.

---

### Task 2: Behavior-Sensitive Lint Fixes

**Files:**
- Modify: `tools/openclinxr/gltf-pipeline-smoke.ts`
- Modify: `packages/openclinxr/voice-gateway/src/index.ts`
- Modify: `packages/openclinxr/voice-gateway/src/voice-gateway.test.ts`
- Modify: `apps/ui-xr/src/static-assets.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/api-bootstrap.ts`
- Modify: `packages/openclinxr/shared-schemas/src/validators.ts`

- [ ] **Step 1: Run focused Biome probe**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts tools/openclinxr/gltf-pipeline-smoke.ts packages/openclinxr/voice-gateway/src apps/ui-xr/src/static-assets.test.ts apps/api/src packages/openclinxr/shared-schemas/src/validators.ts
```

Expected: diagnostics include the behavior-sensitive rules previously found: `useIterableCallbackReturn`, `useYield`, `noTemplateCurlyInString`, `noPrototypeBuiltins`, unused imports/variables/parameters, and `noConfusingVoidType`.

- [ ] **Step 2: Fix only real issues**

Apply minimal code changes only. Examples:

```ts
Object.prototype.hasOwnProperty.call(value, key)
```

Use this instead of direct `.hasOwnProperty(...)` calls.

```ts
const values: SomeType[] = [];
```

Use this instead of misleading `new Array<SomeType>()` patterns.

- [ ] **Step 3: Validate focused files**

Run the same focused Biome command from Step 1.

Expected: no errors for the targeted behavior-sensitive diagnostics.

- [ ] **Step 4: Add passing target paths to hygiene script**

If the focused paths pass cleanly, add the passing paths to `hygiene:biome` in `package.json`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm hygiene:biome
pnpm typecheck:strict
pnpm hygiene:knip
```

Expected: all pass.

---

### Task 3: Import Organization Mechanical Slice

**Files:**
- Modify only files selected by the focused command.
- Do not include `docs/**`, generated evidence JSON, `.agent-factory/**`, or broad repo roots.

- [ ] **Step 1: Select one subtree**

Start with a cohesive low-risk source subtree, preferably one package `src` directory. Do not mix apps, packages, and tools in the same write slice.

- [ ] **Step 2: Run import-only check**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts <selected-subtree>
```

Expected: diagnostics are limited mostly to `assist/source/organizeImports` and safe style warnings.

- [ ] **Step 3: Apply safe import organization only for selected subtree**

Run:

```bash
pnpm exec biome check --write <selected-subtree>
```

Stop if this tries to modify unrelated files.

- [ ] **Step 4: Validate selected subtree and global hygiene**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts <selected-subtree>
pnpm hygiene:biome
pnpm typecheck:strict
```

Expected: all pass.

---

### Task 4: UI Admin Accessibility Slice

**Files:**
- Modify: `apps/ui-admin/src/App.tsx`
- Modify: `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`
- Modify: `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`
- Modify: `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`
- Modify: `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`
- Modify: `apps/ui-admin/src/ReviewReplaySafetyPanel.tsx`
- Modify: `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`
- Modify: `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`

- [ ] **Step 1: Run focused UI admin Biome probe**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts apps/ui-admin/src
```

Expected: a11y diagnostics concentrate around invalid `aria-label` on unsupported roles and labels without controls.

- [ ] **Step 2: Fix semantic accessibility issues**

Use real semantic changes, not suppressions. Examples:

```tsx
<section aria-label="Review replay readiness metrics">
  ...
</section>
```

Use `section`, `aside`, `nav`, or `button` where the ARIA attribute is semantically valid. For labels, ensure every `<label>` has a real `htmlFor` and matching control or replace the label with descriptive text.

- [ ] **Step 3: Validate UI admin subtree**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts apps/ui-admin/src
pnpm typecheck:strict
```

Expected: no a11y errors from the targeted files.

- [ ] **Step 4: Add passing subtree or specific files to hygiene script**

If the whole subtree passes, add `apps/ui-admin/src`. If not, add only passing files and leave a follow-up note.

---

### Task 5: Evidence/Test Non-Null Policy Slice

**Files:**
- Modify: `biome.json`
- Optional Modify: `package.json`

- [ ] **Step 1: Decide evidence-test policy**

Evidence-heavy tests under `tools/openclinxr/*evidence*.test.ts` use many non-null assertions against fixture-shaped data. Decide whether to refactor or apply a test-only override.

Preferred default:

```json
{
  "includes": ["tools/openclinxr/*evidence*.test.ts"],
  "linter": {
    "rules": {
      "style": {
        "noNonNullAssertion": "warn"
      }
    }
  }
}
```

- [ ] **Step 2: Validate evidence tests**

Run:

```bash
pnpm exec biome ci biome.json package.json tsconfig.json tsconfig.tools-relaxed.json vitest.config.ts tools/openclinxr/*evidence*.test.ts
```

Expected: no error-level failures. If warnings remain, keep them visible but non-blocking.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm hygiene:biome
pnpm typecheck:strict
pnpm hygiene:knip
```

Expected: all pass.

---

## Final Acceptance

- [ ] Run:

```bash
pnpm hygiene:biome
pnpm typecheck:strict
pnpm hygiene:knip
```

- [ ] Recompute Biome TS coverage:

```bash
node - <<'NODE'
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const args = pkg.scripts['hygiene:biome'].replace(/^biome\s+ci\s+/, '');
const expanded = execFileSync('zsh', ['-lc', `for x in ${args}; do print -r -- "$x"; done`], { encoding: 'utf8' }).split('\n').filter(Boolean);
function walk(p, acc = []) {
  if (!fs.existsSync(p)) return acc;
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const name of fs.readdirSync(p)) walk(path.join(p, name), acc);
  else acc.push(p);
  return acc;
}
const allTs = execSync(`find . \\( -path './node_modules' -o -path './.git' -o -path './.openclinxr' -o -path './.agent-factory' -o -path './dist' -o -path './build' \\) -prune -o -type f \\( -name '*.ts' -o -name '*.tsx' \\) -print`, { encoding: 'utf8' }).split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
const allTsSet = new Set(allTs);
const covered = new Set();
for (const item of expanded) for (const f of walk(item)) { const rel = f.replace(/^\.\//, ''); if (/\.tsx?$/.test(rel) && allTsSet.has(rel)) covered.add(rel); }
console.log({ total: allTs.length, covered: covered.size, percent: `${((covered.size / allTs.length) * 100).toFixed(1)}%` });
NODE
```

Expected: coverage increases beyond `46.6%` while all checks remain green.
