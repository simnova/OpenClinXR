import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#236). Extract one clinical room from multi-room Infinigen shell.
 *
 * #234: solve_max_rooms=1 did not collapse floorplan (still 20 walls). Residual: cut one
 * room from the multi-room export (mesh/graph post-process), not the slow enable_open trap.
 *
 * Header IMMUTABLE — append ## FIXED (#236).
 */

type Measure = {
  verdict: "single_room_extracted" | "extract_failed_measured" | "inconclusive_blocked";
  verdictReason: string;
  sourceWallCount: number;
  extractedWallCount: number | null;
  rawTriangleCount: number | null;
  hasFloor: boolean;
  hasCeiling: boolean;
  doorOpeningSurvives: boolean | null;
  exportPath: string | null;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Measure>;
const load = () =>
  import("./infinigen-extract-single-room.js") as Promise<Record<string, unknown>>;

describe("Infinigen extract single room from multi-room shell (#236)", () => {
  it("extract path reached a named verdict", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenExtractSingleRoom"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(["single_room_extracted", "extract_failed_measured", "inconclusive_blocked"]).toContain(
      r.verdict,
    );
    expect(r.verdictReason.length).toBeGreaterThan(20);
    expect(r.notEvidenceFor.join(" ")).toMatch(/adopt|quest|ui-xr/i);
  }, 3_600_000);

  it("a claimed extract is fewer walls than source with structure (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenExtractSingleRoom"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "single_room_extracted") return;
    expect(r.extractedWallCount).not.toBeNull();
    expect(r.extractedWallCount!).toBeLessThan(r.sourceWallCount);
    expect(r.extractedWallCount!).toBeLessThanOrEqual(8);
    expect(r.hasFloor).toBe(true);
    expect(r.hasCeiling).toBe(true);
    expect(r.exportPath && existsSync(r.exportPath)).toBe(true);
  }, 3_600_000);
});
