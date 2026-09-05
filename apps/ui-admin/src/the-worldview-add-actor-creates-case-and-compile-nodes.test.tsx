import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeedWorldviewQueue } from "./seed-worldview-queue.js";
import { installWorldviewQueueTestDom } from "./worldview-queue-test-dom.js";

installWorldviewQueueTestDom();

/**
 * OBSERVABLE: CaseAuthoringWorkbench Form.List already has Add actor. That
 * splice does not emit ActorVariant compile nodes. Worldview add must append
 * Scenario.actors AND proposed compile nodes. Unique actorId. No one-mesh-two-roles.
 *
 * MEASURED 2026-08-29. case-authoring-workbench.tsx:387-394 add(actorFormFromDraft).
 * EnvironmentGenerationQueuePanel has no Add actor and no compileNodes mutation.
 * createActorDraft (case-authoring-model.ts:124-130) is identity-only.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W4 tsk_768fefd39524bf2e)
 * EnvironmentGenerationQueuePanel Add actor compile node emits unique actorId
 * plus compileNodeKind ActorVariant via onAddActor.
 *
 * ## FIXED (skeptic: SeedWorldviewQueue wires onAddActor into lock+compile graph)
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const EMPTY_QUEUE = {
  packetCount: 0,
  packets: [],
  blockedScenarioIds: [],
  readyForGenerationReviewScenarioIds: [],
  nextReviewGateCounts: {},
} as never;

describe("the worldview add actor creates case and compile nodes", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) SeedWorldviewQueue add actor appends ActorVariant lock+compile rows", () => {
    render(<SeedWorldviewQueue environmentGenerationQueue={EMPTY_QUEUE} />);
    fireEvent.click(screen.getByRole("button", { name: /add actor compile node/i }));
    expect(within(screen.getByLabelText("proposedVsAccepted")).getByText(/llmProposed ActorVariant vs facultyAccepted proposed/)).toBeInTheDocument();
    expect(screen.getByText(/1 compile dependency edge/)).toBeInTheDocument();
    expect(readFileSync(join(SRC, "app.tsx"), "utf8")).toContain("SeedWorldviewQueue");
  });

  it("(2) COUNTERWEIGHT: CaseAuthoringWorkbench still has Add actor for the case card", () => {
    const bench = readFileSync(join(SRC, "case-authoring-workbench.tsx"), "utf8");
    expect(bench).toContain("Add actor");
  });
});

// NOT TESTED: one-mesh-two-roles runtime; live bake; #167.
