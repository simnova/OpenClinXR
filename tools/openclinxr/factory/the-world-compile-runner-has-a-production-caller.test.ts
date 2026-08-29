import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: `compileEncounterMaterialization` has no production caller.
 *
 * MEASURED 2026-08-29. Exact-symbol search under apps/, packages/, tools/ finds:
 *   definition  tools/openclinxr/factory/encounter-materialization-compile.ts
 *   tests       tools/openclinxr/factory/encounter-materialization-compile.test.ts
 *   no other file.
 *
 * The World Compile Graph faculty table and canvas already render lock/override
 * metadata. The compile runner already records wouldInvoke / skippedBakers.
 * Nothing in dark-factory or ui-admin invokes the compile, so faculty cannot
 * drive a bake from the worldview editor.
 *
 * claimScope: a production (non-test) file imports or calls compileEncounterMaterialization.
 * notEvidenceFor: that a baker actually spawned; Quest; clinical validity; #167.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (#0)
 * 2026-08-29. `tools/openclinxr/dark-factory/multi-case-runner.ts` is now a non-test
 * production caller: the dark-factory chain (issue-288) gains a terminal `world_compile`
 * station that runs `compileEncounterMaterialization` for a case — newest dated evidence
 * JSON for the case as the prior report, the chain's own stage-body OBJ / stage-rig GLB
 * artifacts as the current-artifact view (`artifactPathsByNodeId`), compiled evidence
 * JSON + station table written under `.openclinxr/evidence/issue-288/cases/<id>/stage-world-compile/`.
 * The compile never spawns Blender: wouldInvoke/skippedBakers are the plan. The compile
 * module's own unit tests remain the only other occurrence.
 */

const ROOT = join(import.meta.dirname, "../../..");
const SYMBOL = "compileEncounterMaterialization";

function productionCallers(): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === "node_modules" || name.name === "dist" || name.name.startsWith(".")) continue;
        walk(p);
      } else if (/\.(ts|tsx|mts|js)$/.test(name.name) && !name.name.includes(".test.")) {
        const text = readFileSync(p, "utf8");
        if (text.includes(SYMBOL)) hits.push(p.slice(ROOT.length + 1));
      }
    }
  };
  for (const root of ["apps", "packages", "tools"]) walk(join(ROOT, root));
  return hits.filter((p) => !p.endsWith("encounter-materialization-compile.ts"));
}

describe("the world compile runner has a production caller", () => {
  it("(1) some production file besides the definition calls compileEncounterMaterialization", () => {
    const callers = productionCallers();
    expect(callers, `callers=${JSON.stringify(callers)}`).not.toHaveLength(0);
  });

  it("(2) COUNTERWEIGHT: the definition still exists", () => {
    expect(
      readFileSync(join(ROOT, "tools/openclinxr/factory/encounter-materialization-compile.ts"), "utf8"),
    ).toContain(`export async function ${SYMBOL}`);
  });

  it("(3) COUNTERWEIGHT: FacultyReviewDecisionPanel is not the caller", () => {
    const callers = productionCallers();
    expect(callers.some((p) => p.includes("FacultyReviewDecisionPanel"))).toBe(false);
  });
});

// NOT TESTED: that wouldInvoke actually spawns Blender; Mongo persist; baker split; #167.
