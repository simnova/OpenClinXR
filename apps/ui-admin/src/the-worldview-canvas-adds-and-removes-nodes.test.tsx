import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
// Warm the React.lazy canvas chunk before the timed findByRole below.
import "@openclinxr/ui-shared/admin-compile-graph-canvas";
import { SeedWorldviewQueue } from "@openclinxr/ui-route-admin/seed-worldview-queue";
import { installWorldviewQueueTestDom } from "./worldview-queue-test-dom.js";

installWorldviewQueueTestDom();

/**
 * OBSERVABLE: CompileGraphCanvas is a read-only @xyflow view. onNodesChange and
 * onEdgesChange are no-ops. nodesConnectable/draggable/focusable false.
 * Faculty cannot create or delete a node on the graph they are reviewing.
 *
 * MEASURED 2026-08-29. CompileGraphCanvas.tsx:120-140. Writes stay on the lock
 * Table. W4/W5 own case+compile events; this card is the canvas mutation.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (W18 tsk_ba937af8ca3f6040)
 * CompileGraphCanvas accepts onAddNode and onRemoveNode. ReactFlow view and
 * buildCompileGraphModel remain; xyflow onNodesChange stays a no-op.
 *
 * ## FIXED (skeptic: SeedWorldviewQueue merge mutates compileEdges)
 *
 * ## FIXED (load flake, 2026-09-11): the lazy canvas renders in 1.2-1.8 s inside the suite; the one
 * findByRole that waits for it carries a measured 5 s budget. No assertion changed.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const CANVAS = readFileSync(join(SRC, "../../../packages/openclinxr/ui-shared/src/admin-compile-graph-canvas-mod.tsx"), "utf8");

describe("the worldview canvas adds and removes nodes", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) SeedWorldviewQueue add/remove node changes compile edge count", async () => {
    render(
      <SeedWorldviewQueue
        environmentGenerationQueue={{
          packetCount: 0,
          packets: [],
          blockedScenarioIds: [],
          readyForGenerationReviewScenarioIds: [],
          nextReviewGateCounts: {},
        } as never}
      />,
    );
    expect(screen.getByText(/0 compile dependency edges/)).toBeInTheDocument();
    // The canvas is React.lazy (xyflow) and renders in 1,178-1,752 ms inside the full ui-admin suite
    // (measured 2026-09-11, 2 runs each on origin/main 26d5aab5 and the PSR-05 tree), above Testing
    // Library's 1,000 ms findBy default even with the chunk preloaded. 5,000 ms is ~3x the slowest run.
    fireEvent.click(await screen.findByRole("button", { name: /add compile graph node/i }, { timeout: 5_000 }));
    expect(screen.getByText(/1 compile dependency edge/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove compile graph node/i }));
    expect(screen.getByText(/0 compile dependency edges/)).toBeInTheDocument();
    expect(CANVAS).toMatch(/onAddNode|onRemoveNode/);
  });

  it("(2) COUNTERWEIGHT: ReactFlow view remains (do not delete the canvas)", () => {
    expect(CANVAS).toContain("ReactFlow");
    expect(CANVAS).toContain("buildCompileGraphModel");
  });
});

// NOT TESTED: faculty drawing arbitrary edges; live bake; #167.
