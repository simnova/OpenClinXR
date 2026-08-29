import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: apps/api POST spreads compileNodes and infinigenPrompt into
 * compileEncounterMaterialization (world-compile-routes.ts:64-68). The runner
 * options type has neither field. Extra keys are dropped. W14a HTTP accept is
 * mention-vs-invoke at the baker.
 *
 * MEASURED 2026-08-29 after 674d7afe. CompileEncounterMaterializationOptions
 * (encounter-materialization-compile.ts:123-154) ends at compileLocksPath.
 * No compileNodes, no infinigenPrompt.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (tsk_b38cb7080e566c46)
 * Options include compileNodes and infinigenPrompt. Non-empty compileNodes
 * become the copy-prior source; infinigenPrompt stamps Room spec.
 */

const FACTORY = dirname(fileURLToPath(import.meta.url));
const COMPILE = readFileSync(join(FACTORY, "encounter-materialization-compile.ts"), "utf8");

describe("the world-compile runner consumes compileNodes and infinigenPrompt", () => {
  it("(1) CompileEncounterMaterializationOptions includes compileNodes", () => {
    const slice = COMPILE.slice(
      COMPILE.indexOf("export type CompileEncounterMaterializationOptions"),
      COMPILE.indexOf("export type CompilePlanNode"),
    );
    expect(slice).toMatch(/compileNodes\?:/);
  });

  it("(2) CompileEncounterMaterializationOptions includes infinigenPrompt", () => {
    const slice = COMPILE.slice(
      COMPILE.indexOf("export type CompileEncounterMaterializationOptions"),
      COMPILE.indexOf("export type CompilePlanNode"),
    );
    expect(slice).toMatch(/infinigenPrompt\?:/);
  });

  it("(3) COUNTERWEIGHT: facultyLocks option remains", () => {
    expect(COMPILE).toMatch(/facultyLocks\?:/);
  });
});

// NOT TESTED: live baker; ui-admin client body; #167.
