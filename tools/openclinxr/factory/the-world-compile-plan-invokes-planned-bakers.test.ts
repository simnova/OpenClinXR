import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: world_compile records wouldInvoke: "blender" and does not invoke
 * a baker. Faculty can drive a compile PLAN from the worldview editor; the
 * plan does not build the world.
 *
 * MEASURED 2026-08-29. runWorldCompileStage (multi-case-runner.ts:1071-1099)
 * calls compileEncounterMaterialization, writes wouldInvokeBlenderCount, and
 * returns. Comment on the row: "No Blender spawned — wouldInvoke is a plan,
 * not an invocation." No invokePlannedWorldCompileBakers symbol in factory/
 * or dark-factory/.
 *
 * claimScope: a production caller iterates wouldInvoke === "blender" and
 * invokes a baker runner for those nodes. notEvidenceFor: a real Blender
 * process in this unit test; Quest; #167; baker split.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

const ROOT = join(import.meta.dirname, "../../..");
const RUNNER = join(ROOT, "tools/openclinxr/dark-factory/multi-case-runner.ts");
const INVOKER = join(ROOT, "tools/openclinxr/factory/invoke-planned-world-compile-bakers.ts");

describe("the world compile plan invokes planned bakers", () => {
  it.fails("(1) runWorldCompileStage calls invokePlannedWorldCompileBakers after compileEncounterMaterialization", () => {
    const src = readFileSync(RUNNER, "utf8");
    const compileAt = src.indexOf("compileEncounterMaterialization({");
    const invokeAt = src.indexOf("invokePlannedWorldCompileBakers");
    expect(compileAt).toBeGreaterThan(0);
    expect(invokeAt).toBeGreaterThan(compileAt);
  });

  it.fails("(2) invoke-planned-world-compile-bakers.ts exists", () => {
    expect(existsSync(INVOKER)).toBe(true);
  });

  it("(3) COUNTERWEIGHT: world_compile still does not grow FacultyReviewDecisionPanel", () => {
    const src = readFileSync(RUNNER, "utf8");
    expect(src).not.toContain("FacultyReviewDecisionPanel");
  });
});

// NOT TESTED: a live Blender spawn; Mongo; baker split; #167.
