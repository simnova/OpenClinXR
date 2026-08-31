import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: POST /internal/world-compile reads only scenarioId. Faculty
 * compileEncounterWorld JSON.stringify({ scenarioId }). Edited compile graph,
 * Infinigen prompt, add/remove, overrides never reach the runner.
 *
 * MEASURED 2026-08-29. world-compile-routes.ts:32-36 body.scenarioId only.
 * compile-encounter-world.ts:26 body JSON.stringify({ scenarioId }).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (tsk_53c787f4aae50d5b)
 * POST body type now includes compileNodes and infinigenPrompt next to
 * scenarioId. scenarioId_required and empty-body 400/403 stay.
 *
 * ## FIXED (W14 tsk_c343bebf8236e1a1)
 * Route forwards compileNodes, facultyLocks, removedNodeIds, and infinigenPrompt
 * into compileEncounterMaterialization. Faculty client JSON.stringify includes
 * those fields, not only scenarioId.
 */

const API_SRC = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(join(API_SRC, "world-compile-routes.ts"), "utf8");
const CLIENT = readFileSync(join(API_SRC, "../../ui-admin/src/compile-encounter-world.ts"), "utf8");

describe("the world-compile POST accepts compileNodes and infinigenPrompt", () => {
  it("(1) request body type includes compileNodes next to scenarioId", () => {
    expect(ROUTE).toMatch(/as \{ scenarioId\?: unknown; compileNodes/);
  });

  it("(2) world-compile-routes reads infinigenPrompt from the request body", () => {
    expect(ROUTE).toMatch(/body\.infinigenPrompt|infinigenPrompt\?:/);
  });

  it("(3) COUNTERWEIGHT: route still requires scenarioId", () => {
    expect(ROUTE).toMatch(/scenarioId_required/);
  });

  it("(4) COUNTERWEIGHT: faculty client still POSTs /internal/world-compile", () => {
    expect(CLIENT).toContain("/internal/world-compile");
  });

  it("(5) faculty client JSON body can include compileNodes and facultyLocks", () => {
    expect(CLIENT).toMatch(/compileNodes:/);
    expect(CLIENT).toMatch(/facultyLocks:/);
  });
});

// NOT TESTED: live baker invoke; Quest; #167.
