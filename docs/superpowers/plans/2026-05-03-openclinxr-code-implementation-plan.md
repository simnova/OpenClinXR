# OpenClinXR First Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, local-only OpenClinXR first vertical slice for one ED chest pain station with admin review, learner runtime shell, trace replay, mock actor dialogue, and optional local model/voice adapter gates.

**Architecture:** Use a pnpm TypeScript monorepo with pure domain packages, schema-first contracts, Hono API, React/Ant Design admin, Vite WebXR learner app, append-only trace ledger, mock-first provider gateways, and optional local model/voice runtimes. Keep the first slice free of cloud APIs and live generative dependencies.

**Tech Stack:** pnpm, TypeScript, Vitest, AJV, TypeBox, Hono, React, Vite, Ant Design 6, Playwright, Storybook, Three.js/R3F/WebXR after license verification, MongoDB repositories behind optional environment gates.

---

## File Structure

Create these workspaces:

- `apps/api`: Hono API and local server.
- `apps/admin`: React/Ant Design admin workflow.
- `apps/xr`: learner WebXR/non-XR station runtime.
- `packages/shared-schemas`: TypeBox schemas and AJV validators.
- `packages/domain`: pure domain functions.
- `packages/scenario-fixtures`: ED chest pain seed data.
- `packages/scenario-runtime`: station runtime orchestration.
- `packages/trace-ledger`: append-only trace and replay.
- `packages/review-workflow`: review gates and review packet builder.
- `packages/data-mongodb`: MongoDB repository implementations.
- `packages/model-gateway`: mock and local model provider contracts.
- `packages/voice-gateway`: mock and local voice provider contracts.
- `packages/asset-registry`: asset manifest and QA gates.
- `packages/test-harness`: deterministic station simulations and benchmark helpers.

## Phase A: Workspace Bootstrap

### Task 1: Create pnpm Monorepo Skeleton

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.npmrc`

- [ ] **Step 1: Write workspace files**

Use these contents:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

```json
{
  "name": "openclinxr",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run",
    "verify": "pnpm typecheck && pnpm test",
    "dev:api": "pnpm --filter @openclinxr/api dev",
    "dev:admin": "pnpm --filter @openclinxr/admin dev",
    "dev:xr": "pnpm --filter @openclinxr/xr dev",
    "bench:mock": "pnpm --filter @openclinxr/test-harness bench:mock"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
```

```text
engine-strict=false
strict-peer-dependencies=false
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: install completes without cloud API keys or model downloads.

- [ ] **Step 3: Verify empty workspace**

Run:

```bash
pnpm verify
```

Expected: typecheck may report no projects until package tasks are added; after Task 2 it must pass.

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json vitest.config.ts .npmrc pnpm-lock.yaml
git commit -m "chore: create OpenClinXR pnpm workspace"
```

### Task 2: Add Shared Package Template

**Files:**
- Create: `packages/shared-schemas/package.json`
- Create: `packages/shared-schemas/tsconfig.json`
- Create: `packages/shared-schemas/src/index.ts`
- Create: `packages/shared-schemas/src/smoke.test.ts`

- [ ] **Step 1: Create package manifest**

```json
{
  "name": "@openclinxr/shared-schemas",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run"
  },
  "dependencies": {
    "@sinclair/typebox": "^0.34.0",
    "ajv": "^8.17.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 2: Create TypeScript project**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Add smoke export**

```ts
// packages/shared-schemas/src/index.ts
export const schemaPackageName = "@openclinxr/shared-schemas";
```

```ts
// packages/shared-schemas/src/smoke.test.ts
import { describe, expect, it } from "vitest";
import { schemaPackageName } from "./index.js";

describe("shared schema package", () => {
  it("exports the package marker", () => {
    expect(schemaPackageName).toBe("@openclinxr/shared-schemas");
  });
});
```

- [ ] **Step 4: Run package test**

Run:

```bash
pnpm --filter @openclinxr/shared-schemas test
```

Expected: one passing test.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-schemas
git commit -m "test: add shared schema package scaffold"
```

## Phase B: Schemas And Domain

### Task 3: Define Core Schemas

**Files:**
- Modify: `packages/shared-schemas/src/index.ts`
- Create: `packages/shared-schemas/src/schemas.ts`
- Create: `packages/shared-schemas/src/validators.ts`
- Create: `packages/shared-schemas/src/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
// packages/shared-schemas/src/schemas.test.ts
import { describe, expect, it } from "vitest";
import { validateScenario, validateTraceEvent } from "./validators.js";

describe("OpenClinXR schemas", () => {
  it("accepts a minimal reviewed ED scenario", () => {
    const result = validateScenario({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
      actors: [],
      traceTags: ["ecg_request"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects trace events without sequence numbers", () => {
    const result = validateTraceEvent({
      stationRunId: "run_001",
      eventType: "station.started",
      occurredAt: "2026-05-03T00:00:00.000Z",
      source: "system",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to see failure**

Run:

```bash
pnpm --filter @openclinxr/shared-schemas test -- schemas.test.ts
```

Expected: import failure because schemas do not exist.

- [ ] **Step 3: Implement schemas**

```ts
// packages/shared-schemas/src/schemas.ts
import { Type, type Static } from "@sinclair/typebox";

export const ReviewStateSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("in_review"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
]);

export const ScenarioSchema = Type.Object({
  scenarioId: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1 }),
  status: ReviewStateSchema,
  review: Type.Object({
    clinical: ReviewStateSchema,
    psychometric: ReviewStateSchema,
    legal: ReviewStateSchema,
    simulationQa: ReviewStateSchema,
  }),
  actors: Type.Array(Type.Object({
    actorId: Type.String({ minLength: 1 }),
    role: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
  })),
  traceTags: Type.Array(Type.String({ minLength: 1 })),
});

export const TraceEventSchema = Type.Object({
  stationRunId: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 0 }),
  eventType: Type.String({ minLength: 1 }),
  occurredAt: Type.String({ format: "date-time" }),
  source: Type.String({ minLength: 1 }),
  payload: Type.Record(Type.String(), Type.Unknown()),
});

export type Scenario = Static<typeof ScenarioSchema>;
export type TraceEvent = Static<typeof TraceEventSchema>;
```

```ts
// packages/shared-schemas/src/validators.ts
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ScenarioSchema, TraceEventSchema } from "./schemas.js";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const scenarioValidator = ajv.compile(ScenarioSchema);
const traceEventValidator = ajv.compile(TraceEventSchema);

function toResult(valid: boolean, errors: typeof scenarioValidator.errors): ValidationResult {
  if (valid) return { ok: true };
  return { ok: false, errors: (errors ?? []).map((error) => `${error.instancePath} ${error.message}`.trim()) };
}

export function validateScenario(value: unknown): ValidationResult {
  return toResult(scenarioValidator(value), scenarioValidator.errors);
}

export function validateTraceEvent(value: unknown): ValidationResult {
  return toResult(traceEventValidator(value), traceEventValidator.errors);
}
```

```ts
// packages/shared-schemas/src/index.ts
export * from "./schemas.js";
export * from "./validators.js";
```

- [ ] **Step 4: Add missing dependency**

Run:

```bash
pnpm --filter @openclinxr/shared-schemas add ajv-formats
```

Expected: dependency added to lockfile.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @openclinxr/shared-schemas test
```

Expected: schema tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-schemas package.json pnpm-lock.yaml
git commit -m "feat: add core OpenClinXR schemas"
```

### Task 4: Implement Pure Station Domain

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/station-state.ts`
- Create: `packages/domain/src/station-state.test.ts`
- Create: `packages/domain/src/index.ts`

- [ ] **Step 1: Write station transition tests**

```ts
// packages/domain/src/station-state.test.ts
import { describe, expect, it } from "vitest";
import { createStationRun, transitionStation } from "./station-state.js";

describe("station state", () => {
  it("moves from doorway to encounter to note to review", () => {
    let run = createStationRun("station_ed_chest_pain", "learner_001");
    run = transitionStation(run, { type: "START_ENCOUNTER", atSecond: 60 });
    run = transitionStation(run, { type: "END_ENCOUNTER", atSecond: 960 });
    run = transitionStation(run, { type: "SUBMIT_NOTE", atSecond: 1500, noteText: "ACS concern. ECG requested." });
    expect(run.phase).toBe("review");
    expect(run.noteText).toContain("ECG");
  });

  it("blocks submitting a note before encounter ends", () => {
    const run = createStationRun("station_ed_chest_pain", "learner_001");
    expect(() => transitionStation(run, { type: "SUBMIT_NOTE", atSecond: 10, noteText: "Early note" })).toThrow(
      "Cannot submit note during doorway",
    );
  });
});
```

- [ ] **Step 2: Implement station state**

```ts
// packages/domain/src/station-state.ts
export type StationPhase = "doorway" | "encounter" | "note" | "review";

export type StationRun = {
  stationRunId: string;
  stationId: string;
  learnerId: string;
  phase: StationPhase;
  startedAtSecond: number;
  noteText?: string;
};

export type StationCommand =
  | { type: "START_ENCOUNTER"; atSecond: number }
  | { type: "END_ENCOUNTER"; atSecond: number }
  | { type: "SUBMIT_NOTE"; atSecond: number; noteText: string };

export function createStationRun(stationId: string, learnerId: string): StationRun {
  return {
    stationRunId: `run_${stationId}_${learnerId}`,
    stationId,
    learnerId,
    phase: "doorway",
    startedAtSecond: 0,
  };
}

export function transitionStation(run: StationRun, command: StationCommand): StationRun {
  if (command.type === "START_ENCOUNTER") {
    if (run.phase !== "doorway") throw new Error(`Cannot start encounter during ${run.phase}`);
    return { ...run, phase: "encounter" };
  }

  if (command.type === "END_ENCOUNTER") {
    if (run.phase !== "encounter") throw new Error(`Cannot end encounter during ${run.phase}`);
    return { ...run, phase: "note" };
  }

  if (run.phase !== "note") throw new Error(`Cannot submit note during ${run.phase}`);
  return { ...run, phase: "review", noteText: command.noteText };
}
```

```ts
// packages/domain/src/index.ts
export * from "./station-state.js";
```

- [ ] **Step 3: Add package config**

```json
{
  "name": "@openclinxr/domain",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^4.1.0"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @openclinxr/domain test
```

Expected: station state tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat: add pure station state domain"
```

## Phase C: Fixture, Trace, Review

### Task 5: Add ED Chest Pain Fixture

**Files:**
- Create: `packages/scenario-fixtures/package.json`
- Create: `packages/scenario-fixtures/tsconfig.json`
- Create: `packages/scenario-fixtures/src/ed-chest-pain.ts`
- Create: `packages/scenario-fixtures/src/index.ts`
- Create: `packages/scenario-fixtures/src/ed-chest-pain.test.ts`

- [ ] **Step 1: Write fixture validation test**

```ts
import { describe, expect, it } from "vitest";
import { validateScenario } from "@openclinxr/shared-schemas";
import { edChestPainScenario } from "./ed-chest-pain.js";

describe("ED chest pain fixture", () => {
  it("validates as an approved scenario fixture", () => {
    expect(validateScenario(edChestPainScenario).ok).toBe(true);
    expect(edChestPainScenario.traceTags).toContain("ecg_request");
  });
});
```

- [ ] **Step 2: Implement fixture**

```ts
import type { Scenario } from "@openclinxr/shared-schemas";

export const edChestPainScenario: Scenario = {
  scenarioId: "ed_chest_pain_priority_v1",
  version: 1,
  title: "ED Chest Pain With Nurse Interruption And Family Pressure",
  status: "approved",
  review: {
    clinical: "approved",
    psychometric: "approved",
    legal: "approved",
    simulationQa: "approved",
  },
  actors: [
    { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes" },
    { actorId: "spouse_anna_hayes_v1", role: "family", displayName: "Anna Hayes" },
    { actorId: "nurse_maria_alvarez_v1", role: "nurse", displayName: "Maria Alvarez" }
  ],
  traceTags: [
    "history_opqrst",
    "risk_factor_question",
    "associated_symptom_question",
    "vitals_review",
    "ecg_request",
    "urgent_escalation",
    "team_communication",
    "family_communication",
    "empathy_statement",
    "patient_note_submitted"
  ],
};
```

```ts
// packages/scenario-fixtures/src/index.ts
export * from "./ed-chest-pain.js";
```

- [ ] **Step 3: Add package config**

Use package name `@openclinxr/scenario-fixtures`, add dependency on `@openclinxr/shared-schemas`, and use the same TypeScript project shape as prior packages.

- [ ] **Step 4: Run test**

```bash
pnpm --filter @openclinxr/scenario-fixtures test
```

Expected: fixture test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/scenario-fixtures package.json pnpm-lock.yaml
git commit -m "feat: add ED chest pain scenario fixture"
```

### Task 6: Implement In-Memory Trace Ledger

**Files:**
- Create: `packages/trace-ledger/package.json`
- Create: `packages/trace-ledger/tsconfig.json`
- Create: `packages/trace-ledger/src/in-memory-trace-ledger.ts`
- Create: `packages/trace-ledger/src/index.ts`
- Create: `packages/trace-ledger/src/in-memory-trace-ledger.test.ts`

- [ ] **Step 1: Write trace replay test**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryTraceLedger } from "./in-memory-trace-ledger.js";

describe("in-memory trace ledger", () => {
  it("appends and replays events in sequence order", async () => {
    const ledger = new InMemoryTraceLedger();
    await ledger.append({ stationRunId: "run_1", sequence: 1, eventType: "learner.utterance", occurredAt: "2026-05-03T00:00:01.000Z", source: "learner", payload: { text: "Do you have chest pain?" } });
    await ledger.append({ stationRunId: "run_1", sequence: 0, eventType: "station.started", occurredAt: "2026-05-03T00:00:00.000Z", source: "system", payload: {} });
    const replay = await ledger.replay("run_1");
    expect(replay.map((event) => event.sequence)).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Implement ledger**

```ts
import type { TraceEvent } from "@openclinxr/shared-schemas";
import { validateTraceEvent } from "@openclinxr/shared-schemas";

export class InMemoryTraceLedger {
  private readonly events: TraceEvent[] = [];

  async append(event: TraceEvent): Promise<void> {
    const validation = validateTraceEvent(event);
    if (!validation.ok) throw new Error(`Invalid trace event: ${validation.errors.join("; ")}`);
    this.events.push(event);
  }

  async replay(stationRunId: string): Promise<TraceEvent[]> {
    return this.events
      .filter((event) => event.stationRunId === stationRunId)
      .sort((a, b) => a.sequence - b.sequence);
  }
}
```

```ts
export * from "./in-memory-trace-ledger.js";
```

- [ ] **Step 3: Add package config**

Use package name `@openclinxr/trace-ledger`, add dependency on `@openclinxr/shared-schemas`, and use the same TypeScript project shape as prior packages.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @openclinxr/trace-ledger test
```

Expected: replay test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/trace-ledger package.json pnpm-lock.yaml
git commit -m "feat: add in-memory trace ledger"
```

### Task 7: Build Review Packet

**Files:**
- Create: `packages/review-workflow/package.json`
- Create: `packages/review-workflow/tsconfig.json`
- Create: `packages/review-workflow/src/review-packet.ts`
- Create: `packages/review-workflow/src/index.ts`
- Create: `packages/review-workflow/src/review-packet.test.ts`

- [ ] **Step 1: Write review packet test**

```ts
import { describe, expect, it } from "vitest";
import { buildReviewPacket } from "./review-packet.js";

describe("review packet", () => {
  it("marks required trace tags as observed or missing", () => {
    const packet = buildReviewPacket({
      stationRunId: "run_1",
      requiredTags: ["ecg_request", "empathy_statement"],
      observedTraceTags: ["ecg_request"],
      noteText: "ECG requested. Need urgent escalation.",
    });
    expect(packet.requiredEvents).toEqual([
      { tag: "ecg_request", status: "observed" },
      { tag: "empathy_statement", status: "missing" },
    ]);
  });
});
```

- [ ] **Step 2: Implement review packet builder**

```ts
export type ReviewPacketInput = {
  stationRunId: string;
  requiredTags: string[];
  observedTraceTags: string[];
  noteText: string;
};

export type ReviewPacket = {
  stationRunId: string;
  requiredEvents: Array<{ tag: string; status: "observed" | "missing" }>;
  noteText: string;
};

export function buildReviewPacket(input: ReviewPacketInput): ReviewPacket {
  const observed = new Set(input.observedTraceTags);
  return {
    stationRunId: input.stationRunId,
    noteText: input.noteText,
    requiredEvents: input.requiredTags.map((tag) => ({
      tag,
      status: observed.has(tag) ? "observed" : "missing",
    })),
  };
}
```

```ts
export * from "./review-packet.js";
```

- [ ] **Step 3: Add package config and run test**

Run:

```bash
pnpm --filter @openclinxr/review-workflow test
```

Expected: review packet test passes.

- [ ] **Step 4: Commit**

```bash
git add packages/review-workflow
git commit -m "feat: add faculty review packet builder"
```

## Phase D: API And Runtime

### Task 8: Add Hono API With In-Memory Repositories

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write API contract test**

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("OpenClinXR API", () => {
  it("serves health and ED scenario", async () => {
    const app = createApp();
    const health = await app.request("/health");
    expect(await health.json()).toEqual({ ok: true });

    const scenario = await app.request("/scenarios/ed_chest_pain_priority_v1");
    expect(scenario.status).toBe(200);
    expect((await scenario.json()).scenarioId).toBe("ed_chest_pain_priority_v1");
  });
});
```

- [ ] **Step 2: Implement API**

```ts
import { Hono } from "hono";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (context) => context.json({ ok: true }));

  app.get("/scenarios/:scenarioId", (context) => {
    if (context.req.param("scenarioId") !== edChestPainScenario.scenarioId) {
      return context.json({ error: "scenario_not_found" }, 404);
    }
    return context.json(edChestPainScenario);
  });

  return app;
}
```

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: createApp().fetch, port });
console.log(`OpenClinXR API listening on http://localhost:${port}`);
```

- [ ] **Step 3: Add package manifest**

Use dependencies `hono`, `@hono/node-server`, `@openclinxr/scenario-fixtures`, and dev dependencies `vitest`, `typescript`.

- [ ] **Step 4: Run API tests**

```bash
pnpm --filter @openclinxr/api test
```

Expected: API contract test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat: add local Hono API skeleton"
```

### Task 9: Add Mock Actor Provider

**Files:**
- Create: `packages/model-gateway/package.json`
- Create: `packages/model-gateway/tsconfig.json`
- Create: `packages/model-gateway/src/model-provider.ts`
- Create: `packages/model-gateway/src/mock-model-provider.ts`
- Create: `packages/model-gateway/src/mock-model-provider.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write provider test**

```ts
import { describe, expect, it } from "vitest";
import { MockModelProvider } from "./mock-model-provider.js";

describe("mock model provider", () => {
  it("returns grounded fixture response for chest pain onset", async () => {
    const provider = new MockModelProvider();
    const result = await provider.generateActorResponse({
      actorId: "patient_robert_hayes_v1",
      learnerText: "When did the pain start?",
      stationRunId: "run_1",
    });
    expect(result.responseText).toContain("45 minutes");
    expect(result.grounding).toBe("explicit_case_fact");
  });
});
```

- [ ] **Step 2: Implement provider contract and mock**

```ts
export type ActorResponseRequest = {
  stationRunId: string;
  actorId: string;
  learnerText: string;
};

export type ActorResponseResult = {
  responseText: string;
  grounding: "explicit_case_fact" | "implicit_case_inference" | "fictional_or_unverified" | "blocked";
  traceTags: string[];
  latencyMs: number;
  providerAudit: {
    providerId: string;
    modelId: string;
    localOnly: boolean;
  };
};

export interface ModelProvider {
  generateActorResponse(request: ActorResponseRequest): Promise<ActorResponseResult>;
}
```

```ts
import type { ActorResponseRequest, ActorResponseResult, ModelProvider } from "./model-provider.js";

export class MockModelProvider implements ModelProvider {
  async generateActorResponse(request: ActorResponseRequest): Promise<ActorResponseResult> {
    const lower = request.learnerText.toLowerCase();
    const responseText = lower.includes("when") || lower.includes("start")
      ? "It started about 45 minutes ago while I was carrying boxes."
      : "I feel a heavy pressure in the middle of my chest.";

    return {
      responseText,
      grounding: "explicit_case_fact",
      traceTags: lower.includes("when") ? ["history_opqrst"] : ["learner_question"],
      latencyMs: 0,
      providerAudit: { providerId: "mock", modelId: "fixture-ed-chest-pain-v1", localOnly: true },
    };
  }
}
```

- [ ] **Step 3: Add API route**

Add `POST /station-runs/:stationRunId/actors/:actorId/respond` that calls `MockModelProvider` and returns `ActorResponseResult`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @openclinxr/model-gateway test
pnpm --filter @openclinxr/api test
```

Expected: provider and API tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/model-gateway apps/api package.json pnpm-lock.yaml
git commit -m "feat: add mock actor model provider"
```

## Phase E: Admin And XR Apps

### Task 10: Add Admin App Shell

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/index.html`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/src/App.tsx`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/App.test.tsx`

- [ ] **Step 1: Create React admin shell**

```tsx
import { Layout, Menu, Typography } from "antd";

const { Header, Content, Sider } = Layout;

export function App() {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={["scenarios"]}
          items={[{ key: "scenarios", label: "Scenarios" }, { key: "reviews", label: "Reviews" }, { key: "traces", label: "Trace Replay" }]}
        />
      </Sider>
      <Layout>
        <Header style={{ color: "white" }}>OpenClinXR Admin</Header>
        <Content style={{ padding: 24 }}>
          <Typography.Title level={2}>ED Chest Pain Station</Typography.Title>
          <Typography.Paragraph>Review-gated deterministic first station.</Typography.Paragraph>
        </Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 2: Add Vite entry**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "antd/dist/reset.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Add test**

Use React Testing Library to assert `OpenClinXR Admin` renders.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @openclinxr/admin test
```

Expected: admin shell test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/admin package.json pnpm-lock.yaml
git commit -m "feat: add admin app shell"
```

### Task 11: Add Learner XR Shell With Desktop Fallback

**Files:**
- Create: `apps/xr/package.json`
- Create: `apps/xr/index.html`
- Create: `apps/xr/tsconfig.json`
- Create: `apps/xr/src/App.tsx`
- Create: `apps/xr/src/main.tsx`
- Create: `apps/xr/src/App.test.tsx`

- [ ] **Step 1: Implement fallback-first XR shell**

```tsx
export function App() {
  const webxrAvailable = typeof navigator !== "undefined" && "xr" in navigator;
  return (
    <main style={{ minHeight: "100vh", background: "#101418", color: "white", padding: 24 }}>
      <h1>ED Chest Pain Station</h1>
      <p>Doorway: Evaluate chest pain, communicate with patient, spouse, and nurse, then submit a patient note.</p>
      <p data-testid="xr-capability">{webxrAvailable ? "WebXR available" : "Desktop fallback active"}</p>
      <section aria-label="station timer">Encounter timer: 15:00</section>
      <section aria-label="mock dialogue">Patient: I feel a heavy pressure in the middle of my chest.</section>
    </main>
  );
}
```

- [ ] **Step 2: Add test**

Assert the fallback text and station title render.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @openclinxr/xr test
```

Expected: XR shell fallback test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/xr package.json pnpm-lock.yaml
git commit -m "feat: add learner XR shell fallback"
```

## Phase F: Optional Local AI And Voice Gates

### Task 12: Add Local Runtime Health Contracts

**Files:**
- Create: `packages/voice-gateway/package.json`
- Create: `packages/voice-gateway/tsconfig.json`
- Create: `packages/voice-gateway/src/voice-provider.ts`
- Create: `packages/voice-gateway/src/mock-voice-provider.ts`
- Create: `packages/voice-gateway/src/mock-voice-provider.test.ts`
- Modify: `packages/model-gateway/src/model-provider.ts`

- [ ] **Step 1: Implement voice contract**

```ts
export type VoiceHealth = {
  runtimeId: string;
  configured: boolean;
  localOnly: boolean;
  detail: string;
};

export type SpeechSynthesisRequest = {
  voiceId: string;
  text: string;
};

export type AudioChunk = {
  mimeType: "audio/wav" | "audio/mpeg";
  bytes: Uint8Array;
  isFinal: boolean;
};

export interface VoiceProvider {
  health(): Promise<VoiceHealth>;
  synthesize(request: SpeechSynthesisRequest): AsyncIterable<AudioChunk>;
}
```

- [ ] **Step 2: Implement mock provider**

```ts
import type { AudioChunk, SpeechSynthesisRequest, VoiceHealth, VoiceProvider } from "./voice-provider.js";

export class MockVoiceProvider implements VoiceProvider {
  async health(): Promise<VoiceHealth> {
    return { runtimeId: "mock", configured: true, localOnly: true, detail: "Deterministic silent audio chunks" };
  }

  async *synthesize(_request: SpeechSynthesisRequest): AsyncIterable<AudioChunk> {
    yield { mimeType: "audio/wav", bytes: new Uint8Array([82, 73, 70, 70]), isFinal: true };
  }
}
```

- [ ] **Step 3: Add model runtime health type**

Extend `ModelProvider` with a `health()` method returning runtime ID, configured status, local-only status, and detail.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @openclinxr/voice-gateway test
pnpm --filter @openclinxr/model-gateway test
```

Expected: mock local providers pass.

- [ ] **Step 5: Commit**

```bash
git add packages/voice-gateway packages/model-gateway
git commit -m "feat: add local model and voice health contracts"
```

### Task 13: Add Mock Benchmark Harness

**Files:**
- Create: `packages/test-harness/package.json`
- Create: `packages/test-harness/tsconfig.json`
- Create: `packages/test-harness/src/mock-benchmark.ts`
- Create: `packages/test-harness/src/mock-benchmark.test.ts`

- [ ] **Step 1: Implement mock benchmark**

```ts
export type BenchmarkResult = {
  runtimeId: string;
  iterations: number;
  elapsedMs: number;
  averageMs: number;
};

export async function runMockBenchmark(iterations: number): Promise<BenchmarkResult> {
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    JSON.stringify({ index, text: "mock actor response" });
  }
  const elapsedMs = performance.now() - started;
  return {
    runtimeId: "mock",
    iterations,
    elapsedMs,
    averageMs: elapsedMs / iterations,
  };
}
```

- [ ] **Step 2: Add test**

```ts
import { describe, expect, it } from "vitest";
import { runMockBenchmark } from "./mock-benchmark.js";

describe("mock benchmark", () => {
  it("returns local-only benchmark metrics", async () => {
    const result = await runMockBenchmark(100);
    expect(result.runtimeId).toBe("mock");
    expect(result.iterations).toBe(100);
    expect(result.averageMs).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3: Add script**

Add package script:

```json
{
  "scripts": {
    "bench:mock": "tsx src/mock-benchmark-cli.ts",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false"
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @openclinxr/test-harness test
pnpm bench:mock
```

Expected: benchmark runs without model downloads.

- [ ] **Step 5: Commit**

```bash
git add packages/test-harness package.json pnpm-lock.yaml
git commit -m "feat: add local mock benchmark harness"
```

## Phase G: Asset Registry

### Task 14: Add Asset Manifest Gate

**Files:**
- Create: `packages/asset-registry/package.json`
- Create: `packages/asset-registry/tsconfig.json`
- Create: `packages/asset-registry/src/asset-manifest.ts`
- Create: `packages/asset-registry/src/asset-manifest.test.ts`

- [ ] **Step 1: Write asset gate test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateAssetManifest } from "./asset-manifest.js";

describe("asset manifest gate", () => {
  it("blocks simulation QA when license is missing", () => {
    const result = evaluateAssetManifest({
      scenarioId: "ed_chest_pain_priority_v1",
      assets: [{ assetId: "patient_robert", assetType: "character", licenseId: "" }],
      questSmoke: "not_run",
    });
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain("asset patient_robert missing license");
  });
});
```

- [ ] **Step 2: Implement gate**

```ts
export type AssetManifest = {
  scenarioId: string;
  assets: Array<{ assetId: string; assetType: string; licenseId: string }>;
  questSmoke: "not_run" | "passed" | "failed";
};

export type AssetManifestEvaluation = {
  approved: boolean;
  reasons: string[];
};

export function evaluateAssetManifest(manifest: AssetManifest): AssetManifestEvaluation {
  const reasons: string[] = [];
  for (const asset of manifest.assets) {
    if (asset.licenseId.trim().length === 0) reasons.push(`asset ${asset.assetId} missing license`);
  }
  if (manifest.questSmoke !== "passed") reasons.push("quest smoke test has not passed");
  return { approved: reasons.length === 0, reasons };
}
```

- [ ] **Step 3: Run tests and commit**

```bash
pnpm --filter @openclinxr/asset-registry test
git add packages/asset-registry
git commit -m "feat: add asset manifest approval gate"
```

## Phase H: End-To-End Verification

### Task 15: Add Local Verification Script

**Files:**
- Modify: `package.json`
- Create: `docs/openclinxr/implementation-verification.md`

- [ ] **Step 1: Add root scripts**

```json
{
  "scripts": {
    "typecheck": "tsc -b apps/* packages/*",
    "test": "vitest run",
    "verify": "pnpm typecheck && pnpm test",
    "verify:local-only": "pnpm verify && pnpm bench:mock"
  }
}
```

- [ ] **Step 2: Add verification document**

```md
# Implementation Verification

Run:

```bash
pnpm verify:local-only
```

Expected:

- TypeScript project references compile.
- Vitest suites pass.
- Mock benchmark runs.
- No cloud model API key is required.
- No local model weight download is required.
```

- [ ] **Step 3: Run verification**

```bash
pnpm verify:local-only
```

Expected: command succeeds locally without cloud services.

- [ ] **Step 4: Commit**

```bash
git add package.json docs/openclinxr/implementation-verification.md
git commit -m "chore: add local-only verification command"
```

## Phase I: Optional Spikes After First Slice

### Task 16: Bun/Hono WebSocket Spike

**Files:**
- Create: `docs/openclinxr/spikes/bun-hono-websocket-spike.md`

- [ ] **Step 1: Install Bun manually**

Run the official Bun install command from Bun documentation. Record the exact installed version in the spike doc.

- [ ] **Step 2: Run a local WebSocket echo**

Create a temporary Bun script outside committed source or in a spike branch. Measure connect, echo, and close latency for 1,000 local messages.

- [ ] **Step 3: Record result**

Document whether Bun becomes the default local API runner or remains a deployment-only target.

### Task 17: MLX/llama.cpp Local LLM Spike

**Files:**
- Create: `docs/openclinxr/spikes/local-llm-qwen-deepseek-spike.md`

- [ ] **Step 1: Install one runtime**

Choose one:

```bash
pip install mlx-lm
```

or:

```bash
brew install llama.cpp
```

- [ ] **Step 2: Run one small model**

Use Qwen3-4B or a comparable small local model. Record model ID, license, quantization, disk size, time to first token, tokens per second, peak memory, and whether JSON schema output can be enforced.

- [ ] **Step 3: Update model strategy**

Update `docs/openclinxr/local-ai-voice-model-strategy.md` with benchmark results and recommended next model tier.

### Task 18: VibeVoice Local Voice Spike

**Files:**
- Create: `docs/openclinxr/spikes/vibevoice-local-voice-spike.md`

- [ ] **Step 1: Review license and model card**

Record repository license, model terms, model size, and safety warnings.

- [ ] **Step 2: Install only after review**

Install VibeVoice into an isolated Python environment. Do not wire it into the runtime until the spike doc records install and uninstall commands.

- [ ] **Step 3: Benchmark one phrase**

Use a synthetic phrase: "I feel a heavy pressure in the middle of my chest." Record first audio latency, real-time factor, memory use, and audio quality notes.

- [ ] **Step 4: Decide adapter state**

Mark VibeVoice as `disabled`, `dev_only`, or `eligible_for_pilot_review`.

## Self-Review

Spec coverage:

- Local-only development: covered in Tasks 8, 12, 13, 15, 17, and 18.
- Deterministic first station: covered in Tasks 4, 5, 6, 7, 8, 9, and 11.
- Admin workflow: covered in Task 10.
- WebXR shell: covered in Task 11.
- Asset gates: covered in Task 14.
- Provider and voice adapters: covered in Tasks 9 and 12.
- Testing: covered across all tasks and Task 15.

Placeholder scan:

- The plan avoids incomplete implementation markers and assigns concrete files, commands, and expected outcomes.

Type consistency:

- `Scenario`, `TraceEvent`, `StationRun`, provider result, voice health, and asset manifest names are defined before use.
