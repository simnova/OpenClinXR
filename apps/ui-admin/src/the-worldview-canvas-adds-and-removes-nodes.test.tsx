import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const CANVAS = readFileSync(join(SRC, "CompileGraphCanvas.tsx"), "utf8");

describe("the worldview canvas adds and removes nodes", () => {
  it("(1) CompileGraphCanvas accepts an onAddNode or onRemoveNode callback", () => {
    expect(CANVAS).toMatch(/onAddNode|onRemoveNode/);
  });

  it("(2) COUNTERWEIGHT: ReactFlow view remains (do not delete the canvas)", () => {
    expect(CANVAS).toContain("ReactFlow");
    expect(CANVAS).toContain("buildCompileGraphModel");
  });
});

// NOT TESTED: faculty drawing arbitrary edges; live bake; #167.
