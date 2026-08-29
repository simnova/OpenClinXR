import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: communicationProfile is merge-preserved from the imported actor
 * and has no form fields. Faculty cannot change Satir style from the worldview.
 *
 * MEASURED 2026-08-29. ScenarioActorFormValue (case-authoring-model.ts:193-202)
 * has actorId, role, displayName, demeanor, hiddenFacts, habitus, touchResponses,
 * phenotype. actorFromFormValue copies communicationProfile from preserved only
 * (:304-306). CaseAuthoringWorkbench ActorFields has no communicationProfile Input.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview authors communicationProfile", () => {
  it.fails("(1) ScenarioActorFormValue includes communicationProfile", () => {
    const model = readFileSync(join(SRC, "case-authoring-model.ts"), "utf8");
    const slice = model.slice(
      model.indexOf("export type ScenarioActorFormValue"),
      model.indexOf("export function scenarioToFormValues"),
    );
    expect(slice).toMatch(/communicationProfile/);
  });

  it.fails("(2) ActorFields bind a communicationProfile control", () => {
    const bench = readFileSync(join(SRC, "CaseAuthoringWorkbench.tsx"), "utf8");
    expect(bench).toMatch(/communicationProfile/);
  });

  it("(3) COUNTERWEIGHT: merge still copies a preserved profile when present", () => {
    const model = readFileSync(join(SRC, "case-authoring-model.ts"), "utf8");
    expect(model).toMatch(/communicationProfile = preserved/);
  });
});

// NOT TESTED: live dialogue; clinical validity of Satir styles; #167.
