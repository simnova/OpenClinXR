import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: faculty cannot see what the LLM proposed versus what they accepted
 * per compile node. Confidence that the case transferred into a world is missing.
 *
 * MEASURED 2026-08-29. EnvironmentGenerationQueuePanel has lock table + compile
 * button, no proposed/accepted diff columns.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview shows LLM proposed vs faculty accepted", () => {
  it.fails("(1) EnvironmentGenerationQueuePanel mentions proposed vs accepted", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/llmProposed|facultyAccepted|proposedVsAccepted/);
  });

  it("(2) COUNTERWEIGHT: faculty compile lock table still exists", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/facultyCompileLockRows/);
  });
});

// NOT TESTED: live LLM; clinical quality of the transfer; #167.
