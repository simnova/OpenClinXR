import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#234). Infinigen single-room empty shell — residual from #229.
 *
 * #229: no_objects + trim-off → 10,984 tris, door apertures survive, but roomScope was
 * multi_room (20 wall meshes). singleroom.gin with enable_open=False was slow (~12+ min) and
 * deferred. This slice measures single-room restriction WITHOUT that trap:
 *   -p restrict_solving.solve_max_rooms=1  (or equivalent)
 * without BlueprintSolidifier.enable_open=False if that is what stalls.
 *
 * Header IMMUTABLE — append ## FIXED (#234).
 *
 * Verdict: single_room_under_ceiling | multi_room_still | inconclusive_blocked | reject_measured
 * All close successfully.
 */

type Measure = {
  verdict:
    | "single_room_under_ceiling"
    | "multi_room_still"
    | "inconclusive_blocked"
    | "reject_measured";
  verdictReason: string;
  roomScope: "single_room" | "multi_room" | "unknown";
  wallCount: number;
  rawTriangleCount: number;
  postOptTriangleCount: number | null;
  triangleCeiling: number;
  doorOpeningSurvives: boolean | null;
  hasFloor: boolean;
  hasCeiling: boolean;
  generateSeconds: number | null;
  ginOverrides: string[];
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Measure>;
const load = () =>
  import("./infinigen-single-room-shell.js") as Promise<Record<string, unknown>>;

describe("Infinigen single-room empty shell (#234)", () => {
  it("single-room generate reached a named verdict with measured scope", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenSingleRoomShell"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect([
      "single_room_under_ceiling",
      "multi_room_still",
      "inconclusive_blocked",
      "reject_measured",
    ]).toContain(r.verdict);
    expect(r.verdictReason.length).toBeGreaterThan(20);
    expect(r.notEvidenceFor.join(" ")).toMatch(/adopt|quest|clinical|ui-xr/i);
    if (r.verdict === "inconclusive_blocked") return;
    expect(r.ginOverrides.length).toBeGreaterThan(0);
    expect(r.rawTriangleCount).toBeGreaterThan(0);
  }, 3_600_000);

  it("a claimed single_room_under_ceiling is one room under budget with structure (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenSingleRoomShell"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "single_room_under_ceiling") return;
    expect(r.roomScope).toBe("single_room");
    expect(r.wallCount).toBeLessThan(12); // multi-room #229 had 20; single should be far fewer
    expect(r.rawTriangleCount).toBeLessThan(r.triangleCeiling);
    expect(r.hasFloor).toBe(true);
    expect(r.hasCeiling).toBe(true);
    expect(r.doorOpeningSurvives).not.toBe(false);
  }, 3_600_000);
});
