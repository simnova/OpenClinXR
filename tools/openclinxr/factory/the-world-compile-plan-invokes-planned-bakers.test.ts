import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompilePlanNode } from "./encounter-materialization-compile.js";
import {
  invokePlannedWorldCompileBakers,
  type WorldCompileBakerRunner,
  type WorldCompileBakerRunnerInput,
} from "./invoke-planned-world-compile-bakers.js";

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
 *
 * ## FIXED (#0)
 * 2026-08-29. tools/openclinxr/factory/invoke-planned-world-compile-bakers.ts now exports
 * invokePlannedWorldCompileBakers(nodes, runner, opts): it iterates wouldInvoke === "blender"
 * nodes and invokes the injected baker runner for each; wouldInvoke !== "blender" nodes
 * (locked_skip / cache_hit / locked_stale) stay skipped — lock skip survives invocation.
 * runWorldCompileStage (multi-case-runner.ts) calls it after compileEncounterMaterialization
 * with the chain's real runner (runChainWorldCompileBaker -> orchestrate_character.py
 * --case-actor-preset <case>:<actor>; bake output under stage-world-compile/bakes, never
 * clobbering stage-rig) and writes stage-world-compile/planned-baker-invocations.json.
 * Tests (4)/(5) exercise the invoker with a fake runner (no live Blender).
 */

const ROOT = join(import.meta.dirname, "../../..");
const RUNNER = join(ROOT, "tools/openclinxr/dark-factory/multi-case-runner.ts");
const INVOKER = join(ROOT, "tools/openclinxr/factory/invoke-planned-world-compile-bakers.ts");

describe("the world compile plan invokes planned bakers", () => {
  it("(1) runWorldCompileStage calls invokePlannedWorldCompileBakers after compileEncounterMaterialization", () => {
    const src = readFileSync(RUNNER, "utf8");
    const compileAt = src.indexOf("compileEncounterMaterialization({");
    const invokeAt = src.indexOf("invokePlannedWorldCompileBakers");
    expect(compileAt).toBeGreaterThan(0);
    expect(invokeAt).toBeGreaterThan(compileAt);
  });

  it("(2) invoke-planned-world-compile-bakers.ts exists", () => {
    expect(existsSync(INVOKER)).toBe(true);
  });

  it("(3) COUNTERWEIGHT: world_compile still does not grow FacultyReviewDecisionPanel", () => {
    const src = readFileSync(RUNNER, "utf8");
    expect(src).not.toContain("FacultyReviewDecisionPanel");
  });

  it("(4) invokes the fake baker runner for wouldInvoke === 'blender' nodes only (lock skip stays)", async () => {
    const calls: WorldCompileBakerRunnerInput[] = [];
    const fakeRunner: WorldCompileBakerRunner = (input) => {
      calls.push(input);
    };
    const report = await invokePlannedWorldCompileBakers(
      [
        plannedNode("actor:patient_maya_johnson_v1:wardrobe", "blender", "first_bake"),
        plannedNode("actor:parent_tara_johnson_v1:wardrobe", null, "locked_skip"),
        plannedNode("actor:nurse_kevin_mitchell_v1:wardrobe", null, "cache_hit"),
      ],
      fakeRunner,
      {
        artifactPathsByNodeId: { "actor:patient_maya_johnson_v1:wardrobe": "stage-rig/peds_base.glb" },
        runnerName: "fake-runner",
      },
    );
    expect(calls.map((c) => c.node.nodeId)).toEqual(["actor:patient_maya_johnson_v1:wardrobe"]);
    expect(calls[0]?.artifactPath).toBe("stage-rig/peds_base.glb");
    expect(report.invokedCount).toBe(1);
    expect(report.skippedCount).toBe(2);
    expect(report.skippedNodeIds).toEqual([
      "actor:parent_tara_johnson_v1:wardrobe",
      "actor:nurse_kevin_mitchell_v1:wardrobe",
    ]);
  });

  it("(5) a throwing fake runner is recorded in failures and does not stop the remaining planned nodes", async () => {
    const report = await invokePlannedWorldCompileBakers(
      [
        plannedNode("actor:patient_maya_johnson_v1:wardrobe", "blender", "first_bake"),
        plannedNode("actor:nurse_kevin_mitchell_v1:wardrobe", "blender", "body_changed"),
      ],
      (input) => {
        if (input.node.nodeId.includes("patient")) throw new Error("bake boom");
      },
      { runnerName: "fake-runner" },
    );
    expect(report.failedCount).toBe(1);
    expect(report.invokedCount).toBe(1);
    expect(report.failures[0]?.nodeId).toBe("actor:patient_maya_johnson_v1:wardrobe");
    expect(report.failures[0]?.error).toContain("bake boom");
  });
});

function plannedNode(
  nodeId: string,
  wouldInvoke: "blender" | null,
  bakeReason: "first_bake" | "locked_skip" | "cache_hit" | "body_changed" | "locked_stale",
): CompilePlanNode {
  return {
    nodeId,
    family: "ActorVariant",
    bakerId: "wardrobe_character",
    spec: {
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorId: "patient_maya_johnson_v1",
      variantSemanticKey: "peds",
      sourceBlobName: "base.glb",
    },
    parents: [],
    cacheKey: "recipe-1",
    contentHash: "sha256:wardrobe",
    lock: { locked: false },
    status: "planned_split",
    wouldInvoke,
    bakeDecision: { bake: wouldInvoke === "blender", stale: false, reason: bakeReason },
  } as CompilePlanNode;
}

// NOT TESTED: a live Blender spawn; Mongo; baker split; #167.
