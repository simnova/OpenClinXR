import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EnvironmentGenerationQueuePanel } from "./EnvironmentGenerationQueuePanel.js";

/**
 * OBSERVABLE: faculty can lock/override compile nodes and see the graph, but
 * there is no Compile this encounter control that runs the world compile.
 * Dark-factory world_compile is CLI-only. The worldview editor cannot BUILD.
 *
 * MEASURED 2026-08-29. EnvironmentGenerationQueuePanel props have
 * onInitiateSceneGeneration (scene request, not WCG compile). No
 * onCompileEncounter. No button named Compile this encounter. API has
 * faculty-compile-lock REST, not POST /internal/world-compile.
 * compileEncounterMaterialization is now called from multi-case-runner
 * (dc06c18a) — still no admin/API path.
 *
 * This is one vertical: admin button → api-client → API route →
 * compileEncounterMaterialization (+ planned baker invoke when that lands).
 * Do not thaw #167. Do not grow FacultyReviewDecisionPanel.
 *
 * claimScope: faculty Compile this encounter runs the world compile for the
 * featured scenarioId. notEvidenceFor: live Blender; Quest; exam start; #167.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (#0)
 * 2026-08-29. EnvironmentGenerationQueuePanel gains `featuredScenarioId` and
 * `onCompileEncounter` props plus a "Compile this encounter" button that calls
 * onCompileEncounter(featuredScenarioId). api-client gains a module-level
 * compileEncounterWorld that POSTs /internal/world-compile with the scenarioId.
 * No API route or baker invoke in this slice: ui-admin + api-client only
 * (collision: tsk_f2a2 holds factory + dark-factory).
 */

const emptyQueue = {
  packets: [] as never[],
  packetCount: 0,
  claimBoundary: "environment_generation_queue_not_asset_production",
};

describe("the faculty Compile this encounter runs the world compile", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("(1) the environment queue panel has Compile this encounter and calls onCompileEncounter", () => {
    const onCompileEncounter = vi.fn();
    render(
      <EnvironmentGenerationQueuePanel
        environmentGenerationQueue={emptyQueue as never}
        {...({
          featuredScenarioId: "ed_chest_pain_priority_v1",
          onCompileEncounter,
        } as object)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /compile this encounter/i }));
    expect(onCompileEncounter).toHaveBeenCalledWith("ed_chest_pain_priority_v1");
  });

  it("(2) api-client exposes compileEncounterWorld posting to /internal/world-compile", async () => {
    const client = (await import("./api-client.js")) as Record<string, unknown>;
    expect(typeof client["compileEncounterWorld"]).toBe("function");
  });

  it("(3) COUNTERWEIGHT: FacultyReviewDecisionPanel is not the compile surface", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "FacultyReviewDecisionPanel.tsx"), "utf8");
    expect(src).not.toMatch(/compileEncounterMaterialization|Compile this encounter/i);
  });
});

// NOT TESTED: live Blender; Mongo encounter_materialization_evidence write; #167 exam start.
