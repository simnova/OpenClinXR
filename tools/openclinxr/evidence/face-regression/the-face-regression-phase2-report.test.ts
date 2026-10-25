import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  recomputeLargestMover,
  thresholdsFromCalibration,
  verifyPhase2Report,
  type Calibration,
} from "./src/index.js";

/**
 * Phase-2 report test (card tsk_0e618fa5e9ac3e15 STEP 6).
 *
 * Over the TRACKED report + calibration only — no store reads, so this holds
 * on a clean clone. Every number in the report was copied from a check.json /
 * metrics JSON by code (src/report.ts); this test re-derives the verdicts
 * from the recorded numbers, so a hand-edited report fails.
 */

const DIR = fileURLToPath(new URL(".", import.meta.url));

type Phase2Report = {
  phase: number;
  status: string;
  phase2: {
    notes: string[];
    thresholds: Record<string, { maxDE: number; minSsimL: number }>;
    knownGood: { checkJson: string; ok: boolean; regions: Array<{ region: string; view: number; dE: number; threshold: number }> };
    knownBadA: {
      checkJson: string;
      plant: { glb: string; sha256: string };
      ok: boolean;
      failedRegions: string[];
      regions: Array<{ region: string; view: number; dE: number; threshold: number }>;
      rawRanking: string[];
      largestMover: { region: string; view: number; dE: number; threshold: number; ratio: number; margin: number; marginOverThreshold: number };
    };
    knownBadB: Phase2Report["phase2"]["knownBadA"];
    measuredNulls: Array<{
      claim: string;
      plant: { glb: string; sha256: string };
      result: string;
      cause: string;
      checkJson: string;
      ok: boolean;
      failedRegions: string[];
      regions: Array<{ region: string; view: number; dE: number; threshold: number }>;
      rawRanking: string[];
      largestMover: Phase2Report["phase2"]["knownBadA"]["largestMover"];
    }>;
    calibration: { status: string; seed: number; regions: Calibration["regions"] };
  };
};

function load(): { report: Phase2Report; calibration: Calibration } {
  const report = JSON.parse(readFileSync(`${DIR}face-regression-report.json`, "utf8")) as Phase2Report;
  const calibration = JSON.parse(readFileSync(`${DIR}calibration.json`, "utf8")) as Calibration;
  return { report, calibration };
}

describe("the phase-2 face-regression report", () => {
  it("thresholds recompute from calibration.json and equal the report's", () => {
    const { report, calibration } = load();
    expect(calibration.status).toBe("calibrated");
    const recomputed = thresholdsFromCalibration(calibration);
    for (const [region, t] of Object.entries(recomputed)) {
      expect(report.phase2.thresholds[region], `${region} threshold`).toEqual({ maxDE: t.maxDE, minSsimL: t.minSsimL });
    }
  });

  it("largestMover and margin recompute from the recorded per-region numbers", () => {
    const { report, calibration } = load();
    const violations = verifyPhase2Report(report as unknown as Record<string, unknown>, calibration);
    expect(violations, "hand-edited numbers fail the recompute").toEqual([]);
    for (const arm of [report.phase2.knownBadA, report.phase2.knownBadB, ...report.phase2.measuredNulls]) {
      const again = recomputeLargestMover(arm.regions);
      expect(arm.largestMover).toEqual(again);
    }
  });

  it("known-good passes and known-bad A fails on an eye region with margin >= threshold", () => {
    const { report } = load();
    expect(report.phase2.knownGood.ok).toBe(true);
    const a = report.phase2.knownBadA;
    expect(a.ok).toBe(false);
    expect(["eye_L", "eye_R"]).toContain(a.largestMover.region);
    expect(a.largestMover.marginOverThreshold).toBeGreaterThanOrEqual(1);
    expect(a.rawRanking[0]).toBe(a.largestMover.region);
  });

  it("known-bad B is the real double-brow regression (body2 run2), not the aisha plant", () => {
    const { report } = load();
    const b = report.phase2.knownBadB;
    // body2 run2 on top of body2's texture brow: the check fails on both brows
    // against the promoted golden, largest mover brow_L at margin/threshold 4.74.
    expect(b.ok).toBe(false);
    expect(["brow_L", "brow_R"]).toContain(b.largestMover.region);
    expect(b.largestMover.marginOverThreshold).toBeGreaterThanOrEqual(1);
    expect(b.plant.sha256.startsWith("643563fc")).toBe(true);
    expect(b.rawRanking[0]).toBe(b.largestMover.region);
  });

  it("the aisha run2 plant is recorded as a measured null, never a known bad", () => {
    const { report } = load();
    const nulls = report.phase2.measuredNulls;
    expect(nulls.length).toBeGreaterThan(0);
    const aisha = nulls.find((n) => /aisha/.test(n.claim));
    expect(aisha, "the aisha entry is present").toBeTruthy();
    expect(aisha!.plant.sha256.startsWith("0fbaf4c6")).toBe(true);
    // A measured null renders identically to the seed: ok true (or a ratio < 1).
    const ratio = aisha!.largestMover.marginOverThreshold;
    expect(ratio < 1 || aisha!.ok === true).toBe(true);
  });

  it("every calibration region has a non-empty source", () => {
    const { calibration } = load();
    expect(Object.keys(calibration.regions)).toHaveLength(10);
    for (const [region, m] of Object.entries(calibration.regions)) {
      expect(m.dE.source.length, `${region} dE source`).toBeGreaterThan(0);
      expect(m.ssimL.source.length, `${region} ssimL source`).toBeGreaterThan(0);
    }
  });

  it("a planted copy with a known-bad largestMover changed to cheek_L fails the recompute", () => {
    const { report, calibration } = load();
    for (const key of ["knownBadA", "knownBadB"] as const) {
      const planted = JSON.parse(JSON.stringify(report)) as Phase2Report;
      planted.phase2[key].largestMover = { ...planted.phase2[key].largestMover, region: "cheek_L" };
      const violations = verifyPhase2Report(planted as unknown as Record<string, unknown>, calibration);
      expect(violations.length, `the tampered ${key} mover is caught`).toBeGreaterThan(0);
      expect(violations.join(" ")).toMatch(/cheek_L/);
    }
  });
});
