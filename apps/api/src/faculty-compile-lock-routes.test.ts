import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiApp } from "./index.js";
import { compileLocksPathFor, FACULTY_COMPILE_LOCKS_DIR, readFacultyCompileLocksRecord } from "./faculty-compile-lock-store.js";
import { repoRoot } from "./scenario-promotion-io.js";

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

const TEST_SCENARIO_ID = `compile_lock_route_test_${Date.now()}`;

describe("faculty compile-lock REST route", () => {
  it("POST /internal/faculty-compile-locks writes the per-scenario compile-locks file with claimBoundary metadata", async () => {
    const app = createApiApp();
    try {
      const response = await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: TEST_SCENARIO_ID,
          nodeId: "actor:patient_maya_johnson_v1",
          locked: true,
          overridePath: "/garmentLayers",
        }),
      });

      expect(response.status).toBe(200);
      const record = (await json(response)) as {
        scenarioId: string;
        claimBoundary: string;
        notEvidenceFor: string[];
        locks: Array<{ nodeId: string; locked: boolean; overridePath?: string }>;
      };
      expect(record.scenarioId).toBe(TEST_SCENARIO_ID);
      expect(record.claimBoundary).toBe("faculty_compile_lock_review_metadata_only");
      expect(record.notEvidenceFor).toContain("review_packet_promotion");
      expect(record.locks).toEqual([
        { nodeId: "actor:patient_maya_johnson_v1", locked: true, overridePath: "/garmentLayers" },
      ]);

      // Persist file round-trip: the compile runner reads the same file.
      const onDisk = await readFacultyCompileLocksRecord(TEST_SCENARIO_ID);
      expect(onDisk.locks).toEqual([
        { nodeId: "actor:patient_maya_johnson_v1", locked: true, overridePath: "/garmentLayers" },
      ]);
      const raw = JSON.parse(await readFile(compileLocksPathFor(TEST_SCENARIO_ID), "utf8")) as {
        scenarioId: string;
        claimBoundary: string;
        locks: unknown[];
      };
      expect(raw.scenarioId).toBe(TEST_SCENARIO_ID);
      expect(raw.claimBoundary).toBe("faculty_compile_lock_review_metadata_only");
    } finally {
      await rm(join(repoRoot(), FACULTY_COMPILE_LOCKS_DIR, `${TEST_SCENARIO_ID}.json`), { force: true });
    }
  });

  it("upserts by nodeId: a second POST replaces the prior lock for the same subject", async () => {
    const app = createApiApp();
    try {
      await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: TEST_SCENARIO_ID,
          nodeId: "equip:nebulizer_mask_equipment",
          locked: true,
        }),
      });
      const unlock = await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: TEST_SCENARIO_ID,
          nodeId: "equip:nebulizer_mask_equipment",
          locked: false,
        }),
      });
      expect(unlock.status).toBe(200);
      const record = (await json(unlock)) as { locks: Array<{ nodeId: string; locked: boolean }> };
      expect(record.locks).toEqual([{ nodeId: "equip:nebulizer_mask_equipment", locked: false }]);
    } finally {
      await rm(join(repoRoot(), FACULTY_COMPILE_LOCKS_DIR, `${TEST_SCENARIO_ID}.json`), { force: true });
    }
  });

  it("rejects an overridePath outside the ActorPhenotypeSchema pointers with 400", async () => {
    const app = createApiApp();
    try {
      const response = await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: TEST_SCENARIO_ID,
          nodeId: "actor:patient_maya_johnson_v1",
          locked: true,
          overridePath: "/hairColor",
        }),
      });

      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({
        error: "invalid_override_path",
        reason: "overridePath must be one of /garmentLayers, /clothing_style, /wardrobeRole, /fabricPalette",
      });
    } finally {
      await rm(join(repoRoot(), FACULTY_COMPILE_LOCKS_DIR, `${TEST_SCENARIO_ID}.json`), { force: true });
    }
  });

  it("rejects missing scenarioId/nodeId and non-boolean locked with 400", async () => {
    const app = createApiApp();
    try {
      const missingScenario = await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: "actor:patient_maya_johnson_v1", locked: true }),
      });
      expect(missingScenario.status).toBe(400);
      expect(await json(missingScenario)).toEqual({ error: "invalid_body", reason: "scenarioId_required" });

      const missingNode = await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: TEST_SCENARIO_ID, locked: true }),
      });
      expect(missingNode.status).toBe(400);
      expect(await json(missingNode)).toEqual({ error: "invalid_body", reason: "nodeId_required" });

      const nonBoolean = await app.request("/internal/faculty-compile-locks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: TEST_SCENARIO_ID, nodeId: "actor:patient_maya_johnson_v1", locked: "yes" }),
      });
      expect(nonBoolean.status).toBe(400);
      expect(await json(nonBoolean)).toEqual({ error: "invalid_body", reason: "locked_boolean_required" });
    } finally {
      await rm(join(repoRoot(), FACULTY_COMPILE_LOCKS_DIR, `${TEST_SCENARIO_ID}.json`), { force: true });
    }
  });

  it("rejects a scenarioId that escapes the compile-locks directory", async () => {
    const app = createApiApp();
    const response = await app.request("/internal/faculty-compile-locks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: "../../escape",
        nodeId: "actor:patient_maya_johnson_v1",
        locked: true,
      }),
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({
      error: "compile_lock_persistence_failed",
      reason: expect.stringContaining("invalid scenarioId"),
    });
  });
});
