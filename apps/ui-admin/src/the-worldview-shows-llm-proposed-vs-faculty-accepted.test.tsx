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
 * OBSERVABLE: faculty cannot see what the LLM proposed versus what they accepted
 * per compile node. Confidence that the case transferred into a world is missing.
 *
 * MEASURED 2026-08-29. EnvironmentGenerationQueuePanel has lock table + compile
 * button, no proposed/accepted diff columns.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W13 tsk_fb63e92813a8944a)
 * EnvironmentGenerationQueuePanel surfaces proposedVsAccepted (llmProposed vs facultyAccepted).
 *
 * ## FIXED (skeptic: per-node llmProposed/facultyAccepted computed from lock rows)
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the worldview shows LLM proposed vs faculty accepted", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) per-node llmProposed vs facultyAccepted is computed, not a static slogan", () => {
    render(
      <SeedWorldviewQueue
        environmentGenerationQueue={{
          packetCount: 0,
          packets: [],
          blockedScenarioIds: [],
          readyForGenerationReviewScenarioIds: [],
          nextReviewGateCounts: {},
        } as never}
        facultyCompileLockRows={[
          {
            rowId: "lock:actor:patient_maya_johnson_v1",
            kind: "actor",
            compileSubject: "patient_maya_johnson_v1",
            locked: true,
            stale: false,
            overrideValue: "accepted_short_sleeve",
          },
        ]}
      />,
    );
    const diff = screen.getByLabelText("proposedVsAccepted");
    expect(within(diff).getByText(/patient_maya_johnson_v1: llmProposed patient_maya_johnson_v1 vs facultyAccepted accepted_short_sleeve/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add actor compile node/i }));
    expect(within(diff).getByText(/llmProposed ActorVariant vs facultyAccepted proposed/)).toBeInTheDocument();
    expect(readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8")).not.toMatch(
      /proposedVsAccepted: llmProposed vs facultyAccepted per node/,
    );
  });

  it("(2) COUNTERWEIGHT: faculty compile lock table still exists", () => {
    const panel = readFileSync(join(SRC, "EnvironmentGenerationQueuePanel.tsx"), "utf8");
    expect(panel).toMatch(/facultyCompileLockRows/);
  });
});

// NOT TESTED: live LLM; clinical quality of the transfer; #167.
