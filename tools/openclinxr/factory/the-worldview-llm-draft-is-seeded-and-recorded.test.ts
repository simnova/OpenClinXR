import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { draftWorldviewFromCase } from "./draft-worldview-from-case.js";

/**
 * OBSERVABLE: no factory adapter drafts a worldview from a case with a recorded
 * seed. Faculty compile still starts from bank fixtures, not an LLM transfer.
 *
 * MEASURED 2026-08-29. grep of tools/openclinxr/factory for llmDraft / worldview
 * seed / D13 recorded pick: zero product matches. D13 requires random-once
 * seeded into the case; D9 forbids LLM in the baker path.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W2 tsk_f307cb9d501e2569)
 * draft-worldview-from-case.ts records llmDraftStamp + draftSeed. Adapter only.
 */

const FACTORY = dirname(fileURLToPath(import.meta.url));

function factoryTs(): string[] {
  return readdirSync(FACTORY)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => readFileSync(join(FACTORY, name), "utf8"));
}

describe("the worldview LLM draft is seeded and recorded", () => {
  it("(1) a factory module records llmDraftStamp or draftSeed", () => {
    expect(factoryTs().some((src) => /llmDraftStamp|draftSeed/.test(src))).toBe(true);
  });

  it("(2) COUNTERWEIGHT: compileEncounterMaterialization still exists (bakers stay deterministic)", () => {
    expect(existsSync(join(FACTORY, "encounter-materialization-compile.ts"))).toBe(true);
  });

  it("(3) same seed yields the same llmDraftStamp and compileNodes", () => {
    const scenario = {
      scenarioId: "draft_case_v1",
      actors: [{ actorId: "patient_a_v1" }],
      environment: { environmentId: "ed_bay_v1" },
      equipment: ["ecg_cart"],
    };
    const a = draftWorldviewFromCase(scenario, { seed: "seed-1", model: "adapter-v1" });
    const b = draftWorldviewFromCase(scenario, { seed: "seed-1", model: "adapter-v1" });
    expect(a.llmDraftStamp.llmDraftStamp).toBe(b.llmDraftStamp.llmDraftStamp);
    expect(a.llmDraftStamp.draftSeed).toBe("seed-1");
    expect(a.compileNodes.map((n) => n.nodeId)).toEqual(b.compileNodes.map((n) => n.nodeId));
    expect(a.compileNodes.map((n) => n.nodeId).sort()).toEqual([
      "actor:patient_a_v1",
      "equip:ecg_cart",
      "room:ed_bay_v1",
    ]);
  });

  it("(4) unbuildable eye_color is refused", () => {
    expect(() =>
      draftWorldviewFromCase(
        { scenarioId: "draft_case_v1", actors: [{ actorId: "patient_a_v1", phenotype: { eye_color: "hazel" } }] },
        { seed: "seed-1", model: "adapter-v1" },
      ),
    ).toThrow(/unbuildable_eye_color/);
  });
});

// NOT TESTED: live LLM call; clinical quality of drafts; #167.
