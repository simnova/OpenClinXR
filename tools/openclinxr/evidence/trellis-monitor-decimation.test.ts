import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#250). Equipment decimation decision — bedside monitor.
 *
 * #239 ran ONE instrument (global meshopt `simplify` + lockBorder, chained ratio
 * rungs) and flattened at 106,025 tris. This slice measures the untried MADR 0050
 * steps 2–4 paths (interior strip, position weld, per-part simplify) plus
 * simplifySloppy and Blender DECIMATE, and records a BINARY decision:
 *   under 60,000 with exterior preserved → consume, no budget exception
 *   still over, or only over-mangled results → exception grounded in measured floor
 *
 * The report shape (not the decision) is what this test guards — either conclusion
 * is a successful outcome per the issue. See decimation-report.json on disk.
 *
 * Header IMMUTABLE — append `## FIXED (#250)` below rather than rewriting it.
 */

const PRE_FIX_PATH = ".openclinxr/evidence/issue-250/pre-fix.json";
const REPORT_PATH = ".openclinxr/evidence/issue-250/decimation-report.json";

describe("TRELLIS monitor decimation decision (#250)", () => {
  it("pre-fix.json records the monitor's current count and interior/exterior split", () => {
    expect(existsSync(PRE_FIX_PATH), PRE_FIX_PATH).toBe(true);
    const pre = JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as {
      measuredAgainstCommit: string;
      currentState: { triangleCount: number };
      interiorExteriorSplit: {
        primary: { viewCount: number; exteriorTris: number; interiorTris: number; interiorFraction: number };
        sensitivity: { viewCounts: number[]; interiorFractions: number[] };
      };
    };
    expect(pre.measuredAgainstCommit).toBeTypeOf("string");
    expect(pre.currentState.triangleCount).toBe(106025);
    expect(pre.interiorExteriorSplit.primary.viewCount).toBeGreaterThanOrEqual(64);
    expect(pre.interiorExteriorSplit.primary.exteriorTris + pre.interiorExteriorSplit.primary.interiorTris)
      .toBe(pre.currentState.triangleCount);
    expect(pre.interiorExteriorSplit.sensitivity.interiorFractions.length).toBeGreaterThanOrEqual(3);
    // interior fraction must be a true measurement of a hidden subset — never ≥ 1
    for (const f of pre.interiorExteriorSplit.sensitivity.interiorFractions) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("decimation-report.json records per-path counts and exterior-alteration verdicts", () => {
    expect(existsSync(REPORT_PATH), REPORT_PATH).toBe(true);
    const r = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as {
      softTarget: number;
      paths: Array<{
        id: string;
        inputTris: number;
        outputTris: number;
        under60000: boolean;
        exteriorAltered: boolean;
        minSilhouetteIoU: number;
        exteriorAreaRetained: number;
      }>;
      decision: { conclusion: string; anyPathUnder60000WithExteriorPreserved: boolean };
      notEvidenceFor: string[];
    };
    expect(r.softTarget).toBe(60000);
    // the five named paths from the issue must all be present
    const ids = r.paths.map((p) => p.id);
    for (const required of [
      "strip_interior",
      "strip_weld",
      "strip_weld_simplify_per_part",
      "simplify_sloppy",
      "blender_decimate_0_65",
    ]) {
      expect(ids).toContain(required);
    }
    for (const p of r.paths) {
      expect(typeof p.outputTris).toBe("number");
      expect(typeof p.exteriorAltered).toBe("boolean");
      expect(p.minSilhouetteIoU).toBeGreaterThanOrEqual(0);
      expect(p.minSilhouetteIoU).toBeLessThanOrEqual(1);
      // a path cannot claim "under budget" while reporting more triangles than the input
      if (p.outputTris > 0 && p.inputTris > 0) {
        expect(p.outputTris).toBeLessThanOrEqual(Math.ceil(p.inputTris * 1.05) + 1);
      }
    }
    // decision must be one of the two honest binary outcomes
    expect(r.decision.conclusion).toMatch(/consume_no_exception|exception_grounded_measured_floor/);
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical/i);
  });
});
