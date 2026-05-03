# OpenClinXR Agent Factory Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first repo-native Agent Factory scaffold for OpenClinXR: durable docs, agent charters/memory folders, schemas, templates, and TypeScript tooling for validation, indexing, scoring, and leadership packet generation.

**Architecture:** The scaffold is file-based and intentionally does not build the OpenClinXR product. A typed roster generator creates repeatable agent artifacts, JSON schemas define machine-readable contracts, and CLI scripts validate the workspace, build memory indexes, score iterations, compare scorecards, and surface evidence/risk debt.

**Tech Stack:** Markdown, JSON Schema, TypeScript, Node.js, npm scripts, `tsx`, `ajv`, `fast-glob`, and `gray-matter`.

---

### Task 1: Create Durable Agent Factory Documentation

**Files:**
- Create: `docs/agent-factory/README.md`
- Create: `docs/agent-factory/maturity-model.md`
- Create: `docs/agent-factory/operating-loop.md`
- Create: `docs/agent-factory/rubric.md`
- Create: `docs/agent-factory/source-policy.md`
- Create: `docs/agent-factory/leadership-gates.md`

- [ ] **Step 1: Add docs that extract the approved design into operational references**

Create the files above with concrete operating rules: maturity levels, loop sequence, scoring dimensions, source-use tiers, and senior leadership gates.

- [ ] **Step 2: Verify docs exist**

Run: `find docs/agent-factory -maxdepth 1 -type f | sort`

Expected: the six files listed above.

- [ ] **Step 3: Commit docs**

Run:

```bash
git add docs/agent-factory
git commit -m "Add agent factory operating docs"
```

### Task 2: Add TypeScript Project And Schemas

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `schemas/agent-index.schema.json`
- Create: `schemas/scorecard.schema.json`
- Create: `schemas/source-record.schema.json`
- Create: `schemas/decision-record.schema.json`

- [ ] **Step 1: Add npm package metadata**

Create `package.json` with scripts:

```json
{
  "name": "openclinxr-agent-factory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "agent:generate": "tsx tools/agent-factory/generate-agent-scaffold.ts",
    "agent:validate": "tsx tools/agent-factory/validate-artifacts.ts",
    "agent:index": "tsx tools/agent-factory/build-memory-index.ts",
    "agent:score": "tsx tools/agent-factory/score-iteration.ts",
    "agent:compare": "tsx tools/agent-factory/compare-iterations.ts",
    "agent:leadership": "tsx tools/agent-factory/generate-leadership-packet.ts",
    "agent:risks": "tsx tools/agent-factory/find-stale-risks.ts",
    "agent:evidence": "tsx tools/agent-factory/find-evidence-debt.ts",
    "agent:sources": "tsx tools/agent-factory/check-source-ledger.ts",
    "agent:verify": "npm run agent:validate && npm run agent:index && npm run agent:sources && npm run agent:risks && npm run agent:evidence"
  },
  "dependencies": {
    "ajv": "latest",
    "fast-glob": "latest",
    "gray-matter": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "tsx": "latest",
    "typescript": "latest"
  }
}
```

- [ ] **Step 2: Add TypeScript compiler options**

Create `tsconfig.json` with strict Node ESM settings and no emit.

- [ ] **Step 3: Add JSON schemas**

Create schemas for agent indexes, scorecards, source records, and decision records. Each schema must require IDs, status fields, iteration links, confidence fields where applicable, and arrays for related evidence or risks.

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and `npm` exits 0.

- [ ] **Step 5: Commit TypeScript baseline**

Run:

```bash
git add package.json package-lock.json tsconfig.json schemas
git commit -m "Add agent factory TypeScript baseline"
```

### Task 3: Implement Agent Roster Generator

**Files:**
- Create: `tools/agent-factory/agent-roster.ts`
- Create: `tools/agent-factory/generate-agent-scaffold.ts`

- [ ] **Step 1: Define the roster**

Create `agent-roster.ts` exporting all Coordinator, Core, Physician, Adversarial, Leadership, and Legal agents with fields:

```ts
export type TeamId = "coordinator" | "core" | "physicians" | "adversarial" | "leadership" | "legal";

export type AgentDefinition = {
  id: string;
  name: string;
  team: TeamId;
  mission: string;
  owns: string[];
  outputs: string[];
  escalationTriggers: string[];
  memoryTopics: string[];
  toolPermissions: string[];
  rubricDimensions: string[];
};
```

- [ ] **Step 2: Implement scaffold generation**

Create `generate-agent-scaffold.ts` that writes:

```text
agents/<team>/<agent-id>/charter.md
agents/<team>/<agent-id>/memory.md
agents/<team>/<agent-id>/index.json
agents/<team>/<agent-id>/score-history.json
agents/<team>/<agent-id>/notes/.gitkeep
agents/<team>/<agent-id>/critiques/.gitkeep
agents/<team>/<agent-id>/decisions/.gitkeep
agents/<team>/<agent-id>/sources/.gitkeep
```

The script must not overwrite existing `memory.md`, `index.json`, or `score-history.json` unless their contents are missing.

- [ ] **Step 3: Run the generator**

Run: `npm run agent:generate`

Expected: all agent folders exist.

- [ ] **Step 4: Verify generated count**

Run: `find agents -name charter.md | wc -l`

Expected: at least 45 charters.

- [ ] **Step 5: Commit generated agent scaffold**

Run:

```bash
git add tools/agent-factory/agent-roster.ts tools/agent-factory/generate-agent-scaffold.ts agents
git commit -m "Add persistent agent scaffold"
```

### Task 4: Add Iteration Templates And Source/Decision Templates

**Files:**
- Create: `iterations/iteration-0001/00-brief.md`
- Create: `iterations/iteration-0001/01-core-plan.md`
- Create: `iterations/iteration-0001/02-core-scorecard.json`
- Create: `iterations/iteration-0001/03-adversarial-counterplan.md`
- Create: `iterations/iteration-0001/04-adversarial-scorecard.json`
- Create: `iterations/iteration-0001/05-core-revision.md`
- Create: `iterations/iteration-0001/06-leadership-review.md`
- Create: `iterations/iteration-0001/07-final-synthesis.md`
- Create: `iterations/iteration-0001/08-memory-update-log.md`
- Create: `templates/source-record.md`
- Create: `templates/decision-record.md`
- Create: `templates/risk-record.md`

- [ ] **Step 1: Create Iteration 1 packet**

Create all iteration files with concrete section headings and explicit instructions for the first OpenClinXR MVP planning pass.

- [ ] **Step 2: Create record templates**

Create source, decision, and risk templates that match the design spec and schemas.

- [ ] **Step 3: Commit iteration templates**

Run:

```bash
git add iterations templates
git commit -m "Add iteration and record templates"
```

### Task 5: Implement Validation, Indexing, And Scoring Scripts

**Files:**
- Create: `tools/agent-factory/lib.ts`
- Create: `tools/agent-factory/validate-artifacts.ts`
- Create: `tools/agent-factory/build-memory-index.ts`
- Create: `tools/agent-factory/score-iteration.ts`
- Create: `tools/agent-factory/compare-iterations.ts`
- Create: `tools/agent-factory/generate-leadership-packet.ts`
- Create: `tools/agent-factory/find-stale-risks.ts`
- Create: `tools/agent-factory/find-evidence-debt.ts`
- Create: `tools/agent-factory/check-source-ledger.ts`

- [ ] **Step 1: Add shared utilities**

Create `lib.ts` with path helpers, JSON reading/writing, schema loading, score weights, scorecard aggregation, and glob helpers.

- [ ] **Step 2: Add validation**

Create `validate-artifacts.ts` to validate all agent `index.json` files, `score-history.json` files, iteration scorecards, source records, and decision records.

- [ ] **Step 3: Add memory indexing**

Create `build-memory-index.ts` to combine all agent index entries into `.agent-factory/memory-index.json`.

- [ ] **Step 4: Add scoring**

Create `score-iteration.ts` to print weighted scores for iteration scorecards and fail if required dimensions are missing.

- [ ] **Step 5: Add comparison**

Create `compare-iterations.ts` to compare two scorecard files and print score deltas.

- [ ] **Step 6: Add leadership packet generation**

Create `generate-leadership-packet.ts` to combine iteration files into `iterations/<id>/leadership-packet.md`.

- [ ] **Step 7: Add risk/evidence/source checks**

Create scripts to find stale critical risks, evidence debt markers, and source records that violate permitted-use rules.

- [ ] **Step 8: Run verification**

Run: `npm run agent:verify`

Expected: command exits 0 and writes `.agent-factory/memory-index.json`.

- [ ] **Step 9: Commit tooling**

Run:

```bash
git add tools/agent-factory .agent-factory iterations package.json package-lock.json
git commit -m "Add agent factory validation tooling"
```

### Task 6: Final Verification

**Files:**
- Verify all files in this plan.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run agent:verify
npm run agent:score -- iterations/iteration-0001
npm run agent:leadership -- iterations/iteration-0001
git diff --check
git status --short --branch
```

Expected:

- `agent:verify` exits 0.
- `agent:score` prints weighted scores for the core and adversarial scorecards.
- `agent:leadership` writes a leadership packet.
- `git diff --check` exits 0.
- `git status` shows no unstaged edits after the final commit, or only intentionally generated files that are then committed.

- [ ] **Step 2: Summarize completion**

Report changed files, commits, verification evidence, and any remaining limitations.
