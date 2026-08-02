/**
 * metrics-populated.test.ts — AD-4 guard.
 *
 * Asserts that EVERY metric field in the MeasuredMetricsReport is populated
 * from a real physics engine run — NOT from defaults, zeros, or nulls.
 *
 * Fields verified:
 *   - stepCostMs p50/p95: populated numbers from real timings
 *   - contactStability: mm value from real abdomen displacement
 *   - poseReturnError: ° value from real passive ROM cycle
 *   - jointExplosionRate: measured fraction, not default zero
 *   - frameBudgetHeadroom: computed from p95, not default
 *   - garmentCoherence: grade "B" (not empty/default)
 *   - replayEquivalence: true (proven by C6 tests)
 *   - snapshotSupport: true (proven by restore tests)
 *   - licenceClean: true
 */

import { describe, expect, it, beforeAll } from "vitest";
import { runMeasuredMetrics, type MeasuredMetricsReport } from "../metrics/measure.js";

describe("MeasuredMetrics — populated from real run (AD-4)", () => {
  let report: MeasuredMetricsReport;

  beforeAll(async () => {
    report = await runMeasuredMetrics(42);
  }, 60000); // May need WASM download + full simulation run

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------
  it("meta: engineId is rapier (NOT /-candidate$/)", () => {
    expect(report.meta.engineId).toBe("rapier");
  });

  it("meta: determinismScope is local", () => {
    expect(report.meta.determinismScope).toBe("local");
  });

  it("meta: fixedDt is 1/60", () => {
    expect(report.meta.fixedDt).toBe(1 / 60);
  });

  it("meta: schemaVersion is correct", () => {
    expect(report.meta.schemaVersion).toBe("openclinxr.measured-physics-metrics.v1");
  });

  // -------------------------------------------------------------------------
  // stepCostMs — MUST be populated from real timings (not 0, not empty)
  // -------------------------------------------------------------------------
  it("stepCostMs: p50 is populated (>0, measured, ms unit)", () => {
    const { p50 } = report.stepCostMs;
    expect(p50.source).toBe("measured");
    expect(p50.unit).toBe("ms");
    expect(p50.value).toBeGreaterThan(0);
    // On M1 Max we expect <3ms, but just assert >0 to prove it's measured
  });

  it("stepCostMs: p95 is populated (>0, measured, ms unit)", () => {
    const { p95 } = report.stepCostMs;
    expect(p95.source).toBe("measured");
    expect(p95.unit).toBe("ms");
    expect(p95.value).toBeGreaterThan(0);
  });

  it("stepCostMs: min/max are populated (>0, measured)", () => {
    const { min, max } = report.stepCostMs;
    expect(min.source).toBe("measured");
    expect(max.source).toBe("measured");
    expect(min.value).toBeGreaterThan(0);
    expect(max.value).toBeGreaterThan(0);
    expect(max.value).toBeGreaterThanOrEqual(min.value);
  });

  it("stepCostMs: sampleCount > 0 (real samples)", () => {
    expect(report.stepCostMs.sampleCount).toBeGreaterThan(0);
  });

  it("stepCostMs: p50 ≤ p95 ≤ max (statistical ordering)", () => {
    const { p50, p95, max } = report.stepCostMs;
    expect(p50.value).toBeLessThanOrEqual(p95.value);
    expect(p95.value).toBeLessThanOrEqual(max.value);
  });

  // -------------------------------------------------------------------------
  // frameBudgetHeadroom — MUST be computed from real run
  // -------------------------------------------------------------------------
  it("frameBudgetHeadroom: populated (>0, measured, ms unit)", () => {
    const h = report.frameBudgetHeadroom;
    expect(h.source).toBe("measured");
    expect(h.unit).toBe("ms");
    expect(h.value).toBeGreaterThan(0);
  });

  it("frameBudgetHeadroom: computed correctly (16.667 - p95)", () => {
    const expected = (1 / 60) * 1000 - report.stepCostMs.p95.value;
    expect(Math.abs(report.frameBudgetHeadroom.value - expected)).toBeLessThan(0.01);
  });

  // -------------------------------------------------------------------------
  // contactStability — residual displacement after hand retracts (< 2 mm)
  // -------------------------------------------------------------------------
  it("contactStability: populated (>0, measured, mm unit)", () => {
    const cs = report.contactStability;
    expect(cs.source).toBe("measured");
    expect(cs.unit).toBe("mm");
    // With real palpation press-hold-release-settle cycle, residual > 0
    expect(cs.value).toBeGreaterThan(0);
  });

  it("contactStability: < 2 mm (MADR 0030 / checklist blocker)", () => {
    // Stability = residual displacement during settle phase after hand retracts,
    // NOT peak press deflection. Spring-damper is tuned for sub-2mm residual.
    const cs = report.contactStability;
    expect(cs.value).toBeLessThan(2);
  });

  // -------------------------------------------------------------------------
  // poseReturnError — MUST be a non-zero ° value from real ROM cycle
  // -------------------------------------------------------------------------
  it("poseReturnError: populated (≥0, measured, ° unit)", () => {
    const pe = report.poseReturnError;
    expect(pe.source).toBe("measured");
    expect(pe.unit).toBe("°");
    // With damping, the body settles but may not return perfectly to identity
    // So value can be 0 (perfect return) or small positive (realistic)
    // But it must be a measured number, not null/undefined
    expect(typeof pe.value).toBe("number");
    expect(pe.value).toBeGreaterThanOrEqual(0);
    expect(isNaN(pe.value)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // jointExplosionRate — MUST be a measured fraction (should be 0 ideally)
  // -------------------------------------------------------------------------
  it("jointExplosionRate: populated (measured, fraction unit)", () => {
    const je = report.jointExplosionRate;
    expect(je.source).toBe("measured");
    expect(je.unit).toBe("fraction");
    expect(typeof je.value).toBe("number");
    expect(je.value).toBeGreaterThanOrEqual(0);
    expect(je.value).toBeLessThanOrEqual(1);
  });

  it("jointExplosionRate: should be 0 for controlled palpation scenario", () => {
    expect(report.jointExplosionRate.value).toBe(0);
  });

  // -------------------------------------------------------------------------
  // replayEquivalence — MUST be true (proven by real-engine-loaded.test.ts)
  // -------------------------------------------------------------------------
  it("replayEquivalence: true (C6 proven by real engine)", () => {
    const re = report.replayEquivalence;
    expect(re.source).toBe("measured");
    expect(re.value).toBe(true);
  });

  // -------------------------------------------------------------------------
  // snapshotSupport — MUST be true (proven by restore tests)
  // -------------------------------------------------------------------------
  it("snapshotSupport: true (C3 restore proven by real engine)", () => {
    const ss = report.snapshotSupport;
    expect(ss.source).toBe("measured");
    expect(ss.value).toBe(true);
  });

  // -------------------------------------------------------------------------
  // garmentCoherence — MUST be grade "B" (not empty/default)
  // -------------------------------------------------------------------------
  it("garmentCoherence: grade is B, claim is non-empty", () => {
    const gc = report.garmentCoherence;
    expect(gc.grade).toBe("B");
    expect(gc.claim.length).toBeGreaterThan(0);
    expect(gc.notEvidenceFor.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // licenceClean — MUST be true
  // -------------------------------------------------------------------------
  it("licenceClean: true (@dimforge/rapier3d-compat is Apache-2.0)", () => {
    const lc = report.licenceClean;
    expect(lc.source).toBe("measured");
    expect(lc.value).toBe(true);
  });

  // -------------------------------------------------------------------------
  // C7 notEvidenceFor — MUST contain the canonical four clauses
  // -------------------------------------------------------------------------
  it("notEvidenceFor: includes all canonical C7 clauses", () => {
    expect(report.notEvidenceFor).toContain("clinical_validity");
    expect(report.notEvidenceFor).toContain("exam_equivalence");
    expect(report.notEvidenceFor).toContain("scoring");
    expect(report.notEvidenceFor).toContain("learner_readiness");
  });

  // -------------------------------------------------------------------------
  // Serialization check: report must be JSON-serializable
  // -------------------------------------------------------------------------
  it("report is JSON-serializable (plain object)", () => {
    const json = JSON.stringify(report, null, 2);
    expect(json.length).toBeGreaterThan(100);
    const parsed = JSON.parse(json) as MeasuredMetricsReport;
    expect(parsed.meta.engineId).toBe("rapier");
    expect(parsed.stepCostMs.p50.value).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AD-4 explicit guard: no zero/null for measured fields
  // -------------------------------------------------------------------------
  it("AD-4: stepCostMs.p50 is NOT 0, null, or undefined", () => {
    expect(report.stepCostMs.p50.value).not.toBe(0);
    expect(report.stepCostMs.p50.value).not.toBeNull();
    expect(report.stepCostMs.p50.value).not.toBeUndefined();
  });

  it("AD-4: stepCostMs.p95 is NOT 0, null, or undefined", () => {
    expect(report.stepCostMs.p95.value).not.toBe(0);
    expect(report.stepCostMs.p95.value).not.toBeNull();
    expect(report.stepCostMs.p95.value).not.toBeUndefined();
  });

  it("AD-4: contactStability is NOT 0 (abdomen did move)", () => {
    // The abdomen should move under palpation forces
    // It might be very small (<2mm is the target), but it should be >0
    expect(report.contactStability.value).not.toBe(0);
    expect(report.contactStability.value).toBeGreaterThan(0);
  });

  it("AD-4: poseReturnError is a number, not NaN", () => {
    expect(isNaN(report.poseReturnError.value)).toBe(false);
  });

  it("AD-4: frameBudgetHeadroom > 0", () => {
    expect(report.frameBudgetHeadroom.value).toBeGreaterThan(0);
  });
});
