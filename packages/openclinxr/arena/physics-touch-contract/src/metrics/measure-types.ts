/**
 * measure-types.ts — public types for measured physics metrics.
 *
 * Extracted from measure.ts to keep the orchestrator file under the
 * frozen size ceiling.  All types remain publicly exported through
 * measure.ts so no caller breaks.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single metric measurement with the value and its source. */
export type MeasuredMetric<T> = {
  value: T;
  source: "measured";
  unit: string;
  timestamp: string;
};

/** Complete measured-metrics report for a physics engine run. */
export type MeasuredMetricsReport = {
  /** Report metadata. */
  meta: {
    schemaVersion: "openclinxr.measured-physics-metrics.v1";
    engineId: "rapier";
    determinismScope: "local";
    generatorVersion: string;
    seed: number;
    fixedDt: number;
    generatedAt: string;
  };

  /** Timings in milliseconds. */
  stepCostMs: {
    p50: MeasuredMetric<number>;  // ≤3.0 ms M1 Max
    p95: MeasuredMetric<number>;
    min: MeasuredMetric<number>;
    max: MeasuredMetric<number>;
    sampleCount: number;
  };

  /** Frame budget headroom in ms (16.667 - p95). */
  frameBudgetHeadroom: MeasuredMetric<number>; // ≥4 ms

  /**
   * Contact stability: max residual displacement of the abdomen from rest
   * during the settle phase AFTER the palpation hand has fully retracted.
   * Measured via dedicated press-hold-release-settle cycle (not peak press deflection).
   */
  contactStability: MeasuredMetric<number>; // <2 mm

  /** Pose return error: max angular difference after passive ROM cycle (°). */
  poseReturnError: MeasuredMetric<number>; // <3°

  /** Joint explosion rate: NaN positions or extreme velocities (0 expected). */
  jointExplosionRate: MeasuredMetric<number>;

  /** Replay equivalence: same input → same checksums (C6). */
  replayEquivalence: MeasuredMetric<boolean>;

  /** Snapshot support: restore produces same checksums (C3). */
  snapshotSupport: MeasuredMetric<boolean>;

  /** Garment coherence grade (out-of-band claim). */
  garmentCoherence: {
    grade: "B";
    claim: string;
    notEvidenceFor: readonly string[];
    pngPaths: string[];
  };

  /** Licence clean check. */
  licenceClean: MeasuredMetric<boolean>;

  /** Canonical C7 notEvidenceFor. */
  notEvidenceFor: readonly string[];
};
