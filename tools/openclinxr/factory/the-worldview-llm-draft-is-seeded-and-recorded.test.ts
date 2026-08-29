import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: no factory adapter drafts a worldview from a case with a recorded
 * seed. Faculty compile still starts from bank fixtures, not an LLM transfer.
 *
 * MEASURED 2026-08-29. grep of tools/openclinxr/factory for llmDraft / worldview
 * seed / D13 recorded pick: zero product matches. D13 requires random-once
 * seeded into the case; D9 forbids LLM in the baker path.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const FACTORY = dirname(fileURLToPath(import.meta.url));

function factoryTs(): string[] {
  return readdirSync(FACTORY)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => readFileSync(join(FACTORY, name), "utf8"));
}

describe("the worldview LLM draft is seeded and recorded", () => {
  it.fails("(1) a factory module records llmDraftStamp or draftSeed", () => {
    expect(factoryTs().some((src) => /llmDraftStamp|draftSeed/.test(src))).toBe(true);
  });

  it("(2) COUNTERWEIGHT: compileEncounterMaterialization still exists (bakers stay deterministic)", () => {
    expect(existsSync(join(FACTORY, "encounter-materialization-compile.ts"))).toBe(true);
  });
});

// NOT TESTED: live LLM call; clinical quality of drafts; #167.
