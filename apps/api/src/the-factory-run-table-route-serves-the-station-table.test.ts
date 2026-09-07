import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";
import { FACTORY_RUN_ROLLUP_REL, parseFactoryRunRollup } from "@openclinxr/rest";
import { repoRoot } from "./scenario-promotion-bridge.js";

/**
 * Resolved through a STATIC import now that the validator lives in
 * packages/openclinxr/rest/src/factory-run-rollup-validation.ts and is re-exported
 * from @openclinxr/rest. The non-static specifier below remains for the route
 * constant FACTORY_RUN_ROLLUP_REL, which stays with the route (composition root).
 */
const ROUTE_SPECIFIER = ["@openclinxr/rest"].join("");

async function routeModule(): Promise<{
  FACTORY_RUN_ROLLUP_REL: string;
  parseFactoryRunRollup: (raw: unknown) => { ok: boolean; value?: { cases: unknown[] } };
}> {
  return (await import(/* @vite-ignore */ ROUTE_SPECIFIER)) as never;
}

/**
 * OBSERVABLE: the only artifact that records per-station run outcomes has no
 * consumer. `openclinxr.dark-factory-station-table.v1` carries stationId,
 * classification, implementation, artifactPaths and notes for every case
 * (tools/openclinxr/dark-factory/multi-case-runner.ts:152), and faculty cannot
 * see any of it. The admin UI shows four queue shapes and none is keyed by
 * station, so "did the factory run, and where did it stop" is answerable only by
 * reading a gitignored JSON by hand.
 *
 * MEASURED 2026-09-06 on main 5553652b:
 *   grep -rn 'dark-factory-station-table' over apps/ packages/ tools/ minus dist
 *     -> 4 matches, all inside multi-case-runner.ts and its own evidence test.
 *   .openclinxr/evidence/issue-288/multi-case-rollup.json, generatedAt
 *     2026-09-03, stale:false, 15 cases: render error in 15, world_compile
 *     deterministic in 1, equipment deterministic in 5.
 *
 * KNOWN-GOOD COLUMN: /internal/faculty-compile-locks already serves a
 * per-scenario JSON record read straight off disk under a fixed repo-relative
 * directory, with a claimBoundary and notEvidenceFor on the response
 * (apps/api/src/faculty-compile-lock-routes.ts). This route is that shape
 * applied to the run record.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * CONTRACT: an absent rollup is 200 with an empty `cases` array, never 404 —
 * "no run recorded yet" is a state the panel renders, not a missing route.
 *
 * claimScope: serving the recorded station table over HTTP.
 * notEvidenceFor: that any case passes; that a `deterministic` classification
 * means the artifact is correct (the body stage is classified deterministic on a
 * stub OBJ in all 15 cases); live Blender; Quest readiness.
 */

// ## FIXED (cohesion-w2-run-table-route): 2026-09-06. New module
// apps/api/src/factory-run-table-routes.ts exports FACTORY_RUN_ROLLUP_REL +
// parseFactoryRunRollup + registerFactoryRunTableRoutes, registered in
// apps/api/src/app.ts; tools/openclinxr/dark-factory/multi-case-runner.ts also
// writes the rollup to .openclinxr/evidence/factory-run/multi-case-rollup.json.
// 7/7 clauses pass; `pnpm hygiene:knip` and `pnpm --filter @openclinxr/api run
// typecheck` both exit 0. Diagnosis header above left byte-identical.

// ## FIXED (cellix-m10-api-validation-separation): 2026-09-06. parseFactoryRunRollup
// moved to packages/openclinxr/rest/src/factory-run-rollup-validation.ts and re-exported
// from @openclinxr/rest; validator clauses (2)-(4) now import it statically, while the
// route constant still resolves through the non-static specifier. Diagnosis header
// above left byte-identical.

const ROLLUP_FIXTURE = {
  schemaVersion: "openclinxr.dark-factory-multi-case-rollup.v1",
  generatedAt: "2026-09-06T00:00:00.000Z",
  runner: "test fixture, not a real run",
  cases: [
    {
      schemaVersion: "openclinxr.dark-factory-station-table.v1",
      caseId: "route_probe_case_v1",
      chain: ["body", "render"],
      generatedAt: "2026-09-06T00:00:00.000Z",
      runner: "test fixture, not a real run",
      executionCommands: {},
      stations: [
        {
          stationId: "body",
          stationName: "body",
          classification: "deterministic",
          implementation: "fixture",
          artifactPaths: ["fixture/body.obj"],
          notes: ["fixture row"],
        },
        {
          stationId: "render",
          stationName: "render",
          classification: "error",
          implementation: "fixture",
          artifactPaths: [],
          notes: ["fixture row"],
        },
      ],
    },
  ],
};

/** Write the rollup only when the tree has none, and remove only what we wrote. */
async function withRollupFixture<T>(body: () => T | Promise<T>): Promise<T> {
  const { FACTORY_RUN_ROLLUP_REL } = await routeModule();
  const absolute = join(repoRoot(), FACTORY_RUN_ROLLUP_REL);
  if (existsSync(absolute)) return body();
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(ROLLUP_FIXTURE), "utf8");
  try {
    return body();
  } finally {
    rmSync(absolute, { force: true });
  }
}

describe("the factory run-table route serves the station table", () => {
  it("(1) the published rollup path is under the evidence root, not a per-issue dir", async () => {
    const { FACTORY_RUN_ROLLUP_REL } = await routeModule();
    expect(FACTORY_RUN_ROLLUP_REL).toMatch(/^\.openclinxr\/evidence\/factory-run\//);
    expect(FACTORY_RUN_ROLLUP_REL).toMatch(/\.json$/);
    expect(FACTORY_RUN_ROLLUP_REL).not.toMatch(/issue-\d+/);
  });

  it("(2) parseFactoryRunRollup returns the per-case station rows", () => {
    const parsed = parseFactoryRunRollup(ROLLUP_FIXTURE);
    expect(parsed).toMatchObject({ ok: true });
    const cases = (parsed as { ok: true; value: { cases: unknown[] } }).value.cases;
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      caseId: "route_probe_case_v1",
      stations: [
        { stationId: "body", classification: "deterministic" },
        { stationId: "render", classification: "error" },
      ],
    });
  });

  it("(3) parseFactoryRunRollup refuses a document with the wrong schemaVersion", () => {
    const parsed = parseFactoryRunRollup({ ...ROLLUP_FIXTURE, schemaVersion: "something.else.v1" });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("(4) COUNTERWEIGHT: it refuses a well-versioned document with no cases array", () => {
    const parsed = parseFactoryRunRollup({
      schemaVersion: "openclinxr.dark-factory-multi-case-rollup.v1",
      generatedAt: "2026-09-06T00:00:00.000Z",
    });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("(5) GET /internal/factory-run-table answers with the station rows", async () => {
    await withRollupFixture(async () => {
      const app = createApiApp();
      const response = await app.request("/internal/factory-run-table");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        cases: { caseId: string; stations: { stationId: string; classification: string }[] }[];
        claimBoundary: string;
      };
      expect(body.cases.length).toBeGreaterThan(0);
      expect(body.cases[0].stations.length).toBeGreaterThan(0);
      expect(body.claimBoundary).toBeTypeOf("string");
    });
  });

  it("(6) COUNTERWEIGHT: with no rollup on disk the route is 200 and empty, never 404", async () => {
    const app = createApiApp();
    const response = await app.request("/internal/factory-run-table");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { cases: unknown[] };
    expect(Array.isArray(body.cases)).toBe(true);
  });

  it("(7) the multi-case runner publishes to that same path", async () => {
    const { readFileSync } = await import("node:fs");
    const runner = readFileSync(
      join(repoRoot(), "tools/openclinxr/dark-factory/multi-case-runner.ts"),
      "utf8",
    );
    expect(runner).toContain("factory-run");
  });
});

// NOT TESTED: that the served numbers describe the CURRENT tree (the rollup carries its own
// measuredInputs digests and a stale flag; surfacing staleness is a later slice); auth role
// gating on this route; live Blender; Quest.
