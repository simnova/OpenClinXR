import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * ## FIXED (#271) — appended dimension-control contracts, below the immutable #234 header.
 *
 * #271 measured whether Infinigen's wall_height is a controllable, deterministic input
 * (MADR 0043 reversal trigger 3, height axis). Evidence lives in
 * `.openclinxr/evidence/issue-271/dimension-control-report.json` (three runs):
 *
 *   run                 wall_height param   room shell height   scene height
 *   clinical_bay        2.65                2.65                3.851
 *   clinical_bay_control 2.65               2.65                3.851
 *   dimctl_h36          3.6                 3.6                 4.391
 *
 * The two baseline runs differ in footprint (25.61x18.00 vs 22.00x18.52) but share the
 * wall_height parameter and measure IDENTICAL scene height (determinism control). The
 * treatment run pins wall_height=3.6 and moves both shell and scene height.
 *
 * These tests read the REPORT (the artifact), so they fail if the measurements drift,
 * the report is missing, or the invariants break. dimctl_h36's triangle count is
 * furniture-inclusive and is deliberately NOT asserted on.
 */

const HERE271 = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT271 = path.resolve(HERE271, "../../..");
const DIMCTL_REPORT_PATH = path.join(
  REPO_ROOT271,
  ".openclinxr/evidence/issue-271/dimension-control-report.json",
);

type DimctlRun = {
  runId: string;
  wallHeightParameterMeters: number;
  sceneHeightMeters: number;
  roomShellHeightMeters: number;
};

type DimctlReport = {
  runs: DimctlRun[];
  verdict?: Record<string, string>;
};

function loadDimctlReport(): DimctlReport {
  if (!existsSync(DIMCTL_REPORT_PATH)) {
    throw new Error(
      `dimension-control-report.json missing at ${DIMCTL_REPORT_PATH} — the #271 cagematch evidence artifact is required`,
    );
  }
  const parsed = JSON.parse(readFileSync(DIMCTL_REPORT_PATH, "utf8")) as DimctlReport;
  if (!Array.isArray(parsed.runs) || parsed.runs.length < 3) {
    throw new Error("dimension-control-report.json must carry at least the 3 documented runs");
  }
  return parsed;
}

describe("Infinigen dimension control (#271)", () => {
  it("two baseline runs at the same wall_height measure identical scene height (DETERMINISM CONTROL)", () => {
    const report = loadDimctlReport();
    const a = report.runs.find((r) => r.runId === "clinical_bay");
    const b = report.runs.find((r) => r.runId === "clinical_bay_control");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Same wall_height parameter, DIFFERENT footprints (25.61x18.00 vs 22.00x18.52) —
    // scene height must not vary with the contour.
    expect(a!.wallHeightParameterMeters).toBe(b!.wallHeightParameterMeters);
    expect(Math.abs(a!.sceneHeightMeters - b!.sceneHeightMeters)).toBeLessThan(0.02);
    expect(Math.abs(a!.roomShellHeightMeters - b!.roomShellHeightMeters)).toBeLessThan(0.02);
  }, 30_000);

  it("pinning wall_height moves shell height by exactly the parameter delta and lifts scene height (HEIGHT IS AN INPUT)", () => {
    const report = loadDimctlReport();
    const baseline = report.runs.find((r) => r.runId === "clinical_bay");
    const pinned = report.runs.find((r) => r.runId === "dimctl_h36");
    expect(baseline).toBeDefined();
    expect(pinned).toBeDefined();
    const paramDelta =
      pinned!.wallHeightParameterMeters - baseline!.wallHeightParameterMeters;
    // The room shell height must track the wall_height parameter exactly.
    expect(
      Math.abs(
        pinned!.roomShellHeightMeters -
          baseline!.roomShellHeightMeters -
          paramDelta,
      ),
    ).toBeLessThan(0.05);
    // The scene height must move materially upward with the pin (measured +0.54, band > +0.4).
    expect(pinned!.sceneHeightMeters).toBeGreaterThan(baseline!.sceneHeightMeters + 0.4);
  }, 30_000);
});
