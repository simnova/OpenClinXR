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

/**
 * ## FIXED (#236)
 *
 * Implemented `inspectInfinigenExtractSingleRoom` in `infinigen-extract-single-room.ts`.
 *
 * Extracts the largest room (bedroom, 2,968 tris across all parts) from #229's multi-room
 * trimmed shell via mesh-name pattern selection (`bedroom_0/0.*`) + Blender export with
 * `use_selection=True`. No re-generate — uses #229's cached `scene.blend`.
 *
 * Measured: 2 walls, 1,580 tris (0.9% of 180k Quest station ceiling), 8 meshes,
 * 79 KB GLB, floor=true, ceiling=true, door apertures survive (bedroom_0/0.wall has Euler=-6
 * = holes from boolean portal_cutters). Extraction ~1.0 s in Blender 5.1.1.
 *
 * Door opening confirmed by wall mesh Euler characteristic (bedroom_0/0.wall: V-E+F=-6 < 2)
 * AND portal_cutter proximity (cutters within room AABB margin). Both wall meshes carry
 * negative or high Euler — the wall meshes are per-room shells with boolean-difference
 * apertures baked during solidifier stage.
 *
 * Source: 10 wall meshes across 7 rooms (balcony, bathroom, bedroom, closet, dining-room,
 * kitchen, living-room). Extracted: 2 walls (bedroom_0/0.wall + bedroom_0/1.wall) with
 * floor, ceiling, and exterior shell parts.
 *
 * Artifacts: `.openclinxr/evidence/issue-236/extract-measure.json`,
 * `extracted-single-room.glb`. MADR 0043 Decision unchanged; dated #236 section appended.
 * No ui-xr wiring; no singleroom.gin; no re-generate.
 *
 * CLAIM: a single enclosed room can be deterministically extracted from a multi-room
 * Infinigen shell via mesh-name post-processing, producing a 2-wall bedroom at ~1,580 tris
 * with floor, ceiling, and door apertures intact — in ~1 second, with no re-generation.
 *
 * NOT TESTED: clinical room semantics (bedroom ≠ exam bay); ui-xr placement/scale;
 * /tmp re-home; decimation LOD; batch extraction of all rooms.
 */
