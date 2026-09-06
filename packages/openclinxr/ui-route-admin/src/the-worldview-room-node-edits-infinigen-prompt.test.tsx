import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: faculty pick environmentId from 14 shells. Infinigen prompt/seed
 * live in PROVENANCE.md, not on the worldview. Faculty cannot redesign the room.
 *
 * MEASURED 2026-08-29. infinigen-environment-assets.ts:1-4: "Seed/predicate
 * facts live in PROVENANCE.md, not here." EncounterEnvironmentPanel +
 * EnvironmentGenerationQueuePanel have no infinigenPrompt textarea.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W6 tsk_cd9d45ca384a368a)
 * EnvironmentGenerationQueuePanel authors infinigenPrompt via a Room textarea.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview room node edits the Infinigen prompt", () => {
  it("(1) EnvironmentGenerationQueuePanel authors infinigenPrompt", () => {
    const panel = readFileSync(join(SRC, "environment-generation-queue-panel.tsx"), "utf8");
    expect(panel).toMatch(/infinigenPrompt/);
  });

  it("(2) COUNTERWEIGHT: environmentId picker still exists on EncounterEnvironmentPanel", () => {
    const env = readFileSync(join(SRC, "encounter-environment-panel.tsx"), "utf8");
    expect(env).toMatch(/environmentId/);
  });
});

// NOT TESTED: live Infinigen bake; clinical room realism; #167.
