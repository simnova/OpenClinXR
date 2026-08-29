import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: CaseAuthoringWorkbench Form.List already has Add actor. That
 * splice does not emit ActorVariant compile nodes. Worldview add must append
 * Scenario.actors AND proposed compile nodes. Unique actorId. No one-mesh-two-roles.
 *
 * MEASURED 2026-08-29. CaseAuthoringWorkbench.tsx:387-394 add(actorFormFromDraft).
 * EnvironmentGenerationQueuePanel has no Add actor and no compileNodes mutation.
 * createActorDraft (case-authoring-model.ts:124-130) is identity-only.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview add actor creates case and compile nodes", () => {
  it.fails("(1) EnvironmentGenerationQueuePanel can add an actor compile node", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/addActor|onAddActor|ActorVariant/);
  });

  it("(2) COUNTERWEIGHT: CaseAuthoringWorkbench still has Add actor for the case card", () => {
    const bench = readFileSync(join(SRC, "CaseAuthoringWorkbench.tsx"), "utf8");
    expect(bench).toContain("Add actor");
  });
});

// NOT TESTED: one-mesh-two-roles runtime; live bake; #167.
