/**
 * Three-way cagematch: Havok vs Rapier vs Jolt.
 *
 * Runs all three candidate adapters against the same InputLog,
 * compares replay equivalence (C6), checksum uniqueness across engines,
 * and produces a winner/eliminated report.
 */

import type { InputLog, Sha256Hex } from "../types.js";
import { replayFromSnapshot, replayInputLog } from "../replay.js";
import { buildPhysicsCagematchReport } from "../metrics/report.js";
import type { PhysicsCagematchReport } from "../metrics/report.js";
import type { PhysicsAdapter } from "../adapters/stub.js";
import { HavokCandidateAdapter } from "../adapters/havok.js";
import { RapierCandidateAdapter } from "../adapters/rapier.js";
import { JoltCandidateAdapter } from "../adapters/jolt.js";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/**
 * Per-engine result in the three-way comparison.
 */
export type EngineResult = {
  engineId: string;
  replayEquivalence: boolean;
  snapshotSupport: boolean;
  checkpointCount: number;
  /** First-checkpoint checksum for cross-engine comparison. */
  firstChecksum: Sha256Hex | null;
  /** All checkpoint checksums. */
  checksums: Sha256Hex[];
};

/**
 * Winner/eliminated classification from the three-way cagematch.
 */
export type ThreeWayVerdict = {
  /** Engine(s) that passed all C6 checks and have unique checksums. */
  winners: string[];
  /** Engine(s) that failed C6 replay equivalence or had non-unique checksums. */
  eliminated: string[];
  /** Reason for each eliminated engine. */
  eliminationReasons: Record<string, string>;
};

/**
 * Full three-way cagematch report.
 */
export type ThreeWayCagematchReport = {
  /** Individual per-engine cagematch reports. */
  engines: PhysicsCagematchReport[];
  /** Cross-engine comparison verdict. */
  verdict: ThreeWayVerdict;
  /** Seed used for all engines. */
  seed: number;
  /** Number of ticks in the input log. */
  tickCount: number;
  /** Summary line for human consumption. */
  summary: string;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
const DEFAULT_CAGEMATCH_SEED = 42;
const DEFAULT_CHECKPOINT_INTERVAL = 30;

/**
 * Run the three-way cagematch: Havok, Rapier, Jolt against the same log.
 *
 * Each engine replays the input log twice (primary + verification),
 * verifies C6 replay equivalence, confirms snapshot restore support,
 * and produces a unique checksum distinct from the other two engines.
 */
export function runThreeWayCagematch(
  log: InputLog,
  seed: number = DEFAULT_CAGEMATCH_SEED,
  checkpointInterval: number = DEFAULT_CHECKPOINT_INTERVAL,
): ThreeWayCagematchReport {
  // -----------------------------------------------------------------------
  // Run each engine
  // -----------------------------------------------------------------------

  const havokResult = evaluateEngine(
    "havok-candidate",
    () => new HavokCandidateAdapter(seed),
    log,
    seed,
    checkpointInterval,
  );

  const rapierResult = evaluateEngine(
    "rapier-candidate",
    () => new RapierCandidateAdapter(seed),
    log,
    seed,
    checkpointInterval,
  );

  const joltResult = evaluateEngine(
    "jolt-candidate",
    () => new JoltCandidateAdapter(seed),
    log,
    seed,
    checkpointInterval,
  );

  const engineResults = [havokResult, rapierResult, joltResult];

  // -----------------------------------------------------------------------
  // Cross-engine comparison
  // -----------------------------------------------------------------------
  const verdict = buildVerdict(engineResults);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const summary = buildSummary(verdict, engineResults);

  return {
    engines: engineResults.map((r) => r.report),
    verdict,
    seed,
    tickCount: log.entries.length,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Engine evaluation
// ---------------------------------------------------------------------------

type EngineEvaluation = {
  report: PhysicsCagematchReport;
  checksums: Sha256Hex[];
  replayEquivalence: boolean;
  snapshotSupport: boolean;
};

function evaluateEngine(
  engineId: string,
  factory: () => PhysicsAdapter,
  log: InputLog,
  seed: number,
  checkpointInterval: number,
): EngineEvaluation {
  // Run 1: primary replay
  const adapter1 = factory();
  adapter1.reset(seed);
  const trace1 = replayInputLog(adapter1, log, checkpointInterval);
  const checksums1 = trace1.result.checksums.map((c) => c.sha256);

  // Run 2: verification replay (fresh adapter, same seed)
  const adapter2 = factory();
  adapter2.reset(seed);
  const trace2 = replayInputLog(adapter2, log, checkpointInterval);
  const checksums2 = trace2.result.checksums.map((c) => c.sha256);

  // C6: replay equivalence check
  let replayEquivalence = checksums1.length === checksums2.length;
  if (replayEquivalence) {
    for (let i = 0; i < checksums1.length; i++) {
      if (checksums1[i] !== checksums2[i]) {
        replayEquivalence = false;
        break;
      }
    }
  }

  // Snapshot restore test: restore at a mid checkpoint that still has later ticks
  // (C6). Prefer tick 60 when the log continues past it; otherwise use the first
  // checkpoint with remaining steps (avoids false-fail on short logs ending at 60).
  let snapshotSupport = false;
  const checkpointTicks = [...trace1.snapshots.keys()].sort((a, b) => a - b);
  const lastTick = log.entries[log.entries.length - 1]?.tick ?? 0;
  const midCheckpoint =
    checkpointTicks.find((t) => t > 0 && t < lastTick) ??
    checkpointTicks.find((t) => t === 0 && lastTick > 0) ??
    null;
  const snapshot = midCheckpoint !== null ? trace1.snapshots.get(midCheckpoint) : undefined;
  if (snapshot !== undefined && midCheckpoint !== null) {
    const adapter3 = factory();
    adapter3.reset(seed);
    const restoreChecksums = replayFromSnapshot(
      adapter3,
      snapshot,
      log,
      midCheckpoint,
      checkpointInterval,
    ).checksums;

    const postRestore1 = checksums1
      .map((cs, i) => ({ cs, tick: trace1.result.checksums[i]!.tick }))
      .filter((c) => c.tick > midCheckpoint);

    if (
      restoreChecksums.length === postRestore1.length &&
      restoreChecksums.length > 0
    ) {
      snapshotSupport = true;
      for (let i = 0; i < restoreChecksums.length; i++) {
        if (restoreChecksums[i]!.sha256 !== postRestore1[i]!.cs) {
          snapshotSupport = false;
          break;
        }
      }
    }
  }

  const report = buildPhysicsCagematchReport({
    engineId,
    checksums: checksums1,
    replayEquivalence,
    snapshotSupport,
  });

  return {
    report,
    checksums: checksums1,
    replayEquivalence,
    snapshotSupport,
  };
}

// ---------------------------------------------------------------------------
// Verdict logic
// ---------------------------------------------------------------------------

function buildVerdict(engineResults: EngineEvaluation[]): ThreeWayVerdict {
  const winners: string[] = [];
  const eliminated: string[] = [];
  const eliminationReasons: Record<string, string> = {};

  // Check uniqueness of first checksums across engines
  const firstChecksums = new Map<string, string[]>();
  for (const result of engineResults) {
    const firstCs = result.checksums[0] ?? null;
    if (firstCs) {
      const existing = firstChecksums.get(firstCs) ?? [];
      existing.push(result.report.engineId);
      firstChecksums.set(firstCs, existing);
    }
  }

  for (const result of engineResults) {
    const engineId = result.report.engineId;
    const reasons: string[] = [];

    // Must pass C6 replay equivalence
    if (!result.replayEquivalence) {
      reasons.push("C6 replay equivalence FAILED");
    }

    // Must pass snapshot support
    if (!result.snapshotSupport) {
      reasons.push("snapshot restore NOT verified");
    }

    // First checksum must be unique from other engines
    const firstCs = result.checksums[0] ?? null;
    if (firstCs) {
      const enginesWithSame = firstChecksums.get(firstCs) ?? [];
      if (enginesWithSame.length > 1) {
        reasons.push(
          `first checksum NOT unique (collision with: ${enginesWithSame.filter((e) => e !== engineId).join(", ")})`,
        );
      }
    } else {
      reasons.push("no checksums produced");
    }

    if (reasons.length === 0) {
      winners.push(engineId);
    } else {
      eliminated.push(engineId);
      eliminationReasons[engineId] = reasons.join("; ");
    }
  }

  return { winners, eliminated, eliminationReasons };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function buildSummary(
  verdict: ThreeWayVerdict,
  engineResults: EngineEvaluation[],
): string {
  const lines: string[] = [];

  lines.push(
    `Three-way cagematch: ${engineResults.length} engines evaluated.`,
  );

  if (verdict.winners.length > 0) {
    lines.push(
      `Winners (${verdict.winners.length}): ${verdict.winners.join(", ")}`,
    );
  }

  if (verdict.eliminated.length > 0) {
    lines.push(
      `Eliminated (${verdict.eliminated.length}): ${verdict.eliminated.join(", ")}`,
    );
    for (const eng of verdict.eliminated) {
      lines.push(`  ${eng}: ${verdict.eliminationReasons[eng] ?? "unknown"}`);
    }
  }

  // Engine divergence check
  const checksumSets = engineResults.map((r) => r.checksums[0] ?? "none");
  const uniqueChecksums = new Set(checksumSets);
  lines.push(
    `Engine divergence: ${uniqueChecksums.size}/${engineResults.length} distinct first checksums`,
  );

  return lines.join("\n");
}
