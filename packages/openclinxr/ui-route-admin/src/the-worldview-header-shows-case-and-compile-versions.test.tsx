import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: faculty compile panel has no caseDefVersion / compileVersion /
 * llmDraftStamp header. Reviewers cannot see which compile they are accepting.
 *
 * MEASURED 2026-08-29. environment-generation-queue-panel.tsx faculty compile
 * fieldset (aria-label Faculty compile this encounter) has no compileVersion
 * or caseDefVersion. App.tsx wires the compile button (13826a43) without versions.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W1)
 * 2026-08-29. EnvironmentGenerationQueuePanel shows caseDefVersion and compileVersion
 * in the faculty compile fieldset. App wiring of live values is NOT TESTED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PANEL = readFileSync(join(SRC, "environment-generation-queue-panel.tsx"), "utf8");

describe("the worldview header shows case and compile versions", () => {
  it("(1) EnvironmentGenerationQueuePanel mentions compileVersion", () => {
    expect(PANEL).toMatch(/compileVersion/);
  });

  it("(2) EnvironmentGenerationQueuePanel mentions caseDefVersion or Scenario.version", () => {
    expect(PANEL).toMatch(/caseDefVersion/);
  });

  it("(3) COUNTERWEIGHT: the compile button fieldset still exists", () => {
    expect(PANEL).toContain('aria-label="Faculty compile this encounter"');
  });
});

// NOT TESTED: llmDraftStamp UI; live compileVersion from Mongo; #167.
