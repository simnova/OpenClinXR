/**
 * Scenario inspection — builds a plain-object inspection report for evidence.
 *
 * Given a winning engine adapter + scripted InputLogs, this module:
 *   1. Replays each scenario through the adapter
 *   2. Collects checksums, step counts, contact events, guard events
 *   3. Produces an InspectionReport suitable for JSON serialization and evidence recording
 *
 * Garment coherence: metadata-only claim that existing ED real-garment GLB
 * path is out of band. This report does NOT rewrite apps/ui-xr; it records
 * notEvidenceFor garment visual in the arena report.
 */

import type { InputLog, SnapshotChecksum } from "../types.js";
import type { PhysicsAdapter } from "../adapters/stub.js";
import { replayInputLog } from "../replay.js";
import type { ReplayTrace } from "../replay.js";
import type { GuardingThresholdEvent } from "../scenarios/guarding.js";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/**
 * Per-scenario inspection result.
 */
export type ScenarioInspectionResult = {
  /** Scenario identifier (e.g. "passive-rom", "guarding", "positioning"). */
  scenarioId: string;
  /** Engine that replayed the scenario. */
  engineId: string;
  /** Total ticks in the input log. */
  tickCount: number;
  /** Number of checkpoint checksums captured. */
  checkpointCount: number;
  /** All checkpoint checksums. */
  checksums: SnapshotChecksum[];
  /** Count of ticks with a contactRegionId set. */
  contactTickCount: number;
  /** Contact regions observed (unique). */
  contactRegions: string[];
  /** Max pinchStrength observed. */
  maxPinchStrength: number;
  /** Guarding threshold events (guarding scenario only; empty otherwise). */
  guardEvents: GuardingThresholdEvent[];
};

/**
 * Coherence claim for visuals that are out of band.
 */
export type GarmentCoherenceClaim = {
  /** What visual is claimed. */
  claim: string;
  /** Why this report does NOT provide visual evidence. */
  notEvidenceFor: string[];
  /** Where the visual evidence lives if out of band. */
  artifactPath: string;
  /** Whether the claim is verified. */
  verified: boolean;
};

/**
 * Full scenario inspection report.
 */
export type ScenarioInspectionReport = {
  /** Generator metadata. */
  meta: {
    determinismScope: string;
    notEvidenceFor: readonly string[];
    generatorVersion: string;
    engineId: string;
    seed: number;
    fixedDt: number;
  };
  /** Per-scenario results. */
  scenarios: ScenarioInspectionResult[];
  /** Garment coherence claims. */
  garmentCoherence: GarmentCoherenceClaim[];
  /** Summary line. */
  summary: string;
};

// ---------------------------------------------------------------------------
// Inspection builder
// ---------------------------------------------------------------------------

/**
 * Configuration for a scenario to inspect.
 */
export type ScenarioEntry = {
  scenarioId: string;
  log: InputLog;
  guardEvents?: GuardingThresholdEvent[];
};

/**
 * Options for building an inspection report.
 */
export type BuildInspectionReportOptions = {
  /** Adapter to use for replaying scenarios. */
  adapter: PhysicsAdapter;
  /** Scenarios to inspect. */
  scenarios: ScenarioEntry[];
  /** Seed for the adapter. */
  seed?: number;
  /** Checkpoint interval for replay. */
  checkpointInterval?: number;
};

/**
 * Build a scenario inspection report.
 *
 * Replays each scenario through the adapter, collects evidence,
 * and produces a JSON-friendly report.
 */
export function buildScenarioInspectionReport(
  options: BuildInspectionReportOptions,
): ScenarioInspectionReport {
  const {
    adapter,
    scenarios,
    seed = 42,
    checkpointInterval = 30,
  } = options;

  const results: ScenarioInspectionResult[] = [];

  for (const scenario of scenarios) {
    // Reset adapter for this scenario
    adapter.reset(seed);

    // Replay
    const trace = replayInputLog(adapter, scenario.log, checkpointInterval);

    // Build result
    results.push(buildScenarioResult(
      scenario.scenarioId,
      adapter.meta.engineId,
      scenario.log,
      trace,
      scenario.guardEvents ?? [],
    ));
  }

  // Build garment coherence claims
  const garmentClaims = buildGarmentCoherenceClaims();

  // Summary
  const summary = buildSummary(results, garmentClaims);

  return {
    meta: {
      determinismScope: adapter.meta.determinismScope,
      notEvidenceFor: [...adapter.meta.notEvidenceFor],
      generatorVersion: adapter.meta.generatorVersion,
      engineId: adapter.meta.engineId,
      seed,
      fixedDt: adapter.meta.fixedDt,
    },
    scenarios: results,
    garmentCoherence: garmentClaims,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Per-scenario result building
// ---------------------------------------------------------------------------

function buildScenarioResult(
  scenarioId: string,
  engineId: string,
  log: InputLog,
  trace: ReplayTrace,
  guardEvents: GuardingThresholdEvent[],
): ScenarioInspectionResult {
  const contactTicks = log.entries.filter((e) => e.contactRegionId !== null);
  const contactRegions = [
    ...new Set(contactTicks.map((e) => e.contactRegionId!).filter(Boolean)),
  ];
  const maxPinchStrength = Math.max(
    ...log.entries.map((e) => e.pinchStrength),
    0,
  );

  return {
    scenarioId,
    engineId,
    tickCount: log.entries.length,
    checkpointCount: trace.result.checksums.length,
    checksums: trace.result.checksums,
    contactTickCount: contactTicks.length,
    contactRegions,
    maxPinchStrength,
    guardEvents,
  };
}

// ---------------------------------------------------------------------------
// Garment coherence claims
// ---------------------------------------------------------------------------

function buildGarmentCoherenceClaims(): GarmentCoherenceClaim[] {
  return [
    {
      claim: "ED real-garment GLB path provides visual garment evidence for case-def phenotypes",
      notEvidenceFor: [
        "garment_visual_in_physics_scenarios",
        "real-time_cloth_simulation_within_physics_contract",
        "ui-xr_garment_geometry_in_arena_inspection",
      ],
      artifactPath:
        "packages/openclinxr/xr/engine/ed-real-garment/ (out of band)",
      verified: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function buildSummary(
  results: ScenarioInspectionResult[],
  garmentClaims: GarmentCoherenceClaim[],
): string {
  const lines: string[] = [];

  lines.push(
    `Scenario inspection report: ${results.length} scenarios evaluated.`,
  );

  for (const r of results) {
    lines.push(
      `  ${r.scenarioId}: ${r.tickCount} ticks, ${r.checkpointCount} checkpoints, ${r.contactTickCount} contact ticks, guardEvents=${r.guardEvents.length}`,
    );
  }

  // Check for guard events
  const totalGuardEvents = results.reduce(
    (sum, r) => sum + r.guardEvents.length,
    0,
  );
  if (totalGuardEvents > 0) {
    lines.push(`  Total guard threshold events: ${totalGuardEvents}`);
  }

  // Garment note
  if (garmentClaims.length > 0) {
    lines.push(
      `  Garment coherence: ${garmentClaims.length} claims (out of band, notEvidenceFor visual in arena report)`,
    );
  }

  return lines.join("\n");
}
