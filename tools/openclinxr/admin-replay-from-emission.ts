/**
 * Admin replay from runtime emission CLI (Q4).
 *
 * Loads `.openclinxr/encounter-publication/encounter-runtime-emission-latest.json`
 * (or generates it via runEncounterRuntimeEmission) and projects a
 * replay-safe admin/review packet summary with **real turns** (not seeds-only):
 * actorTurnRefs, timeline entries from emission actorTurns, traceEventTypes.
 *
 * Claim control: admin_replay_from_runtime_emission_not_clinical_validity
 * — no clinical validity / scoring / Quest / production readiness claims.
 *
 * Usage:
 *   pnpm encounter:admin-replay-from-emission
 *   pnpm tsx tools/openclinxr/admin-replay-from-emission.ts
 *   pnpm tsx tools/openclinxr/admin-replay-from-emission.ts --input .openclinxr/encounter-publication/encounter-runtime-emission-latest.json
 *   pnpm tsx tools/openclinxr/admin-replay-from-emission.ts --output .openclinxr/encounter-publication/admin-replay-from-emission-latest.json
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runEncounterRuntimeEmission,
  type EncounterRuntimeEmissionArtifact,
  type EncounterRuntimeEmissionReviewPacketSummary,
} from "./encounter-runtime-emission.js";

/** Minimal actor-turn shape accepted from emission (real durable-store turns). */
export type EmissionActorTurn = {
  turnId: string;
  stationRunId: string;
  actorId: string;
  atSecond: number;
  conversationTurn: number;
  learnerUtterance: string;
  responseText: string;
  responseKind: string;
  traceContextTags: string[];
  durableEventRef: string;
  learnerEventSequence: number;
  actorResponseEventSequence: number;
};

/** Replay-safe timeline entry (summary-only; no private payload). */
export type AdminReplayTimelineEntry = {
  sequence: number;
  atSecond: number;
  eventType: string;
  source: string;
  actorId?: string;
  tag?: string;
  summary: string;
};

export type AdminReplayFromEmissionProjection = {
  schemaVersion: "openclinxr.admin-replay-from-emission.v1";
  generatedAt: string;
  sourceEmissionPath: string;
  sourceEmissionSchemaVersion: EncounterRuntimeEmissionArtifact["schemaVersion"];
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  phase: string;
  learnerId: string;
  /** Refs for real actor turns from emission (not seed fixtures). */
  actorTurnRefs: string[];
  actorTurnCount: number;
  /** Timeline projected from emission actorTurns (learner utterance + actor response pairs). */
  timeline: AdminReplayTimelineEntry[];
  timelineEntryCount: number;
  /** Distinct ledger event types from emission. */
  traceEventTypes: string[];
  /** Compact review packet summary carried from emission. */
  reviewPacket: EncounterRuntimeEmissionReviewPacketSummary;
  /** Private text redacted in projection (only summaries/refs). */
  privatePayloadRedacted: true;
  /** Source marker: runtime emission real turns, not authoring seeds. */
  turnSource: "runtime_emission_real_turns";
  wiring: {
    input: "encounter-runtime-emission.v1";
    projection: "admin_replay_review_packet_summary";
    path: "loadEmission→mapActorTurns→writeAdminReplay";
  };
  claimBoundary: "admin_replay_from_runtime_emission_not_clinical_validity";
  notEvidenceFor: readonly [
    "clinical_validity",
    "scoring_validity",
    "quest_readiness",
    "production_readiness",
  ];
};

export type MapEmissionToAdminReplayInput = {
  emission: EncounterRuntimeEmissionArtifact;
  sourceEmissionPath: string;
  generatedAt?: string;
};

export type RunAdminReplayFromEmissionInput = {
  inputPath?: string;
  outputPath?: string;
  generatedAt?: string;
  /** When emission file missing, generate via runEncounterRuntimeEmission. Default true. */
  generateIfMissing?: boolean;
};

export type RunAdminReplayFromEmissionResult = {
  artifact: AdminReplayFromEmissionProjection;
  outputPath: string;
  inputPath: string;
  generatedEmission: boolean;
};

const DEFAULT_INPUT_PATH =
  ".openclinxr/encounter-publication/encounter-runtime-emission-latest.json";
const DEFAULT_OUTPUT_PATH =
  ".openclinxr/encounter-publication/admin-replay-from-emission-latest.json";

/**
 * Build actorTurnRefs from real emission turns (not seeds).
 * Shape: `actor_turn:<stationRunId>:<turnId>`
 */
export function mapActorTurnsToRefs(
  turns: ReadonlyArray<Pick<EmissionActorTurn, "turnId" | "stationRunId">>,
): string[] {
  return turns.map((turn) => `actor_turn:${turn.stationRunId}:${turn.turnId}`);
}

/**
 * Project timeline entries from emission actorTurns (learner utterance + actor response).
 * Summary-only; response text truncated for private-payload redaction posture.
 */
export function mapActorTurnsToTimeline(
  turns: ReadonlyArray<EmissionActorTurn>,
): AdminReplayTimelineEntry[] {
  const entries: AdminReplayTimelineEntry[] = [];
  let sequence = 0;
  for (const turn of turns) {
    const tag = turn.traceContextTags[0];
    entries.push({
      sequence,
      atSecond: turn.atSecond,
      eventType: "learner.utterance",
      source: "learner",
      actorId: turn.actorId,
      ...(tag ? { tag } : {}),
      summary: summarizeUtterance(turn.learnerUtterance),
    });
    sequence += 1;
    entries.push({
      sequence,
      atSecond: turn.atSecond,
      eventType: "actor.response.generated",
      source: "runtime_emission",
      actorId: turn.actorId,
      ...(tag ? { tag } : {}),
      summary: summarizeActorResponse(turn.responseText, turn.responseKind),
    });
    sequence += 1;
  }
  return entries;
}

function summarizeUtterance(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "Learner utterance (empty).";
  }
  const clipped = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  return `Learner utterance: ${clipped}`;
}

function summarizeActorResponse(responseText: string, responseKind: string): string {
  const trimmed = responseText.trim();
  const clipped =
    trimmed.length === 0
      ? "(empty response)"
      : trimmed.length > 80
        ? `${trimmed.slice(0, 77)}...`
        : trimmed;
  return `Actor response (${responseKind}): ${clipped}`;
}

/**
 * Pure mapper: emission artifact → admin/review replay projection with real turns.
 */
export function mapEmissionToAdminReplayProjection(
  input: MapEmissionToAdminReplayInput,
): AdminReplayFromEmissionProjection {
  const { emission, sourceEmissionPath } = input;
  const generatedAt = input.generatedAt ?? "2026-08-02T00:00:00.000Z";
  const actorTurns = emission.actorTurns as EmissionActorTurn[];

  if (!Array.isArray(actorTurns) || actorTurns.length < 1) {
    throw new Error(
      "Admin replay projection failed: emission has no actorTurns (expected ≥1 real turn, not seeds-only)",
    );
  }

  const actorTurnRefs = mapActorTurnsToRefs(actorTurns);
  const timeline = mapActorTurnsToTimeline(actorTurns);

  return {
    schemaVersion: "openclinxr.admin-replay-from-emission.v1",
    generatedAt,
    sourceEmissionPath,
    sourceEmissionSchemaVersion: emission.schemaVersion,
    stationRunId: emission.stationRunId,
    scenarioId: emission.scenarioId,
    scenarioVersion: emission.scenarioVersion,
    phase: emission.phase,
    learnerId: emission.learnerId,
    actorTurnRefs,
    actorTurnCount: actorTurns.length,
    timeline,
    timelineEntryCount: timeline.length,
    traceEventTypes: [...emission.traceEventTypes],
    reviewPacket: { ...emission.reviewPacket },
    privatePayloadRedacted: true,
    turnSource: "runtime_emission_real_turns",
    wiring: {
      input: "encounter-runtime-emission.v1",
      projection: "admin_replay_review_packet_summary",
      path: "loadEmission→mapActorTurns→writeAdminReplay",
    },
    claimBoundary: "admin_replay_from_runtime_emission_not_clinical_validity",
    notEvidenceFor: [
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "production_readiness",
    ],
  };
}

/**
 * Map emission → admin-facing replay props (pure; usable by ui-admin seed/load without UI rewrite).
 * Aligns with AdminReviewReplayEvidenceHandoff-ish fields (actorTurnRefs, counts, redaction).
 */
export function mapEmissionToAdminReplayProps(
  emission: EncounterRuntimeEmissionArtifact,
): {
  stationRunId: string;
  scenarioId: string;
  actorTurnRefs: string[];
  actorTurnCount: number;
  timeline: AdminReplayTimelineEntry[];
  timelineEntryCount: number;
  traceEventTypes: string[];
  reviewPacket: EncounterRuntimeEmissionReviewPacketSummary;
  privatePayloadRedacted: true;
  turnSource: "runtime_emission_real_turns";
  claimBoundary: "admin_replay_from_runtime_emission_not_clinical_validity";
} {
  const projection = mapEmissionToAdminReplayProjection({
    emission,
    sourceEmissionPath: "(in-memory)",
  });
  return {
    stationRunId: projection.stationRunId,
    scenarioId: projection.scenarioId,
    actorTurnRefs: projection.actorTurnRefs,
    actorTurnCount: projection.actorTurnCount,
    timeline: projection.timeline,
    timelineEntryCount: projection.timelineEntryCount,
    traceEventTypes: projection.traceEventTypes,
    reviewPacket: projection.reviewPacket,
    privatePayloadRedacted: true,
    turnSource: "runtime_emission_real_turns",
    claimBoundary: "admin_replay_from_runtime_emission_not_clinical_validity",
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertEmissionArtifact(value: unknown): asserts value is EncounterRuntimeEmissionArtifact {
  if (!value || typeof value !== "object") {
    throw new Error("Emission artifact is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "openclinxr.encounter-runtime-emission.v1") {
    throw new Error(
      `Unexpected emission schemaVersion: ${String(record.schemaVersion)} (expected openclinxr.encounter-runtime-emission.v1)`,
    );
  }
  if (!Array.isArray(record.actorTurns)) {
    throw new Error("Emission artifact missing actorTurns[]");
  }
  if (!Array.isArray(record.traceEventTypes)) {
    throw new Error("Emission artifact missing traceEventTypes[]");
  }
  if (!record.reviewPacket || typeof record.reviewPacket !== "object") {
    throw new Error("Emission artifact missing reviewPacket");
  }
}

/**
 * Load emission (or generate), project admin-replay artifact, write JSON.
 */
export async function runAdminReplayFromEmission(
  input: RunAdminReplayFromEmissionInput = {},
): Promise<RunAdminReplayFromEmissionResult> {
  const inputPath = path.resolve(input.inputPath ?? DEFAULT_INPUT_PATH);
  const outputPath = path.resolve(input.outputPath ?? DEFAULT_OUTPUT_PATH);
  const generatedAt = input.generatedAt ?? "2026-08-02T00:00:00.000Z";
  const generateIfMissing = input.generateIfMissing !== false;

  let generatedEmission = false;
  if (!(await fileExists(inputPath))) {
    if (!generateIfMissing) {
      throw new Error(`Emission artifact not found: ${inputPath}`);
    }
    await runEncounterRuntimeEmission({ outputPath: inputPath, generatedAt });
    generatedEmission = true;
  }

  const raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  assertEmissionArtifact(raw);

  const artifact = mapEmissionToAdminReplayProjection({
    emission: raw,
    sourceEmissionPath: inputPath,
    generatedAt,
  });

  if (artifact.actorTurnCount < 1) {
    throw new Error("Admin replay artifact requires actorTurnCount ≥ 1 (real turns, not seeds)");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return { artifact, outputPath, inputPath, generatedEmission };
}

function parseArgs(argv: string[]): {
  inputPath?: string;
  outputPath?: string;
  help: boolean;
  noGenerate: boolean;
} {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let help = false;
  let noGenerate = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--no-generate") {
      noGenerate = true;
      continue;
    }
    if (arg === "--input" || arg === "-i") {
      inputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--input=")) {
      inputPath = arg.slice("--input=".length);
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return {
    ...(inputPath ? { inputPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    help,
    noGenerate,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: pnpm encounter:admin-replay-from-emission [options]
       pnpm tsx tools/openclinxr/admin-replay-from-emission.ts [options]

Options:
  --input, -i <path>   Emission artifact (default: ${DEFAULT_INPUT_PATH})
  --output, -o <path>  Admin replay projection (default: ${DEFAULT_OUTPUT_PATH})
  --no-generate        Fail if emission missing (do not run encounter:runtime-emission)
  --help, -h           Show this help

Projects real actor turns from runtime emission into admin/review replay
(not seeds-only). claimBoundary: admin_replay_from_runtime_emission_not_clinical_validity`);
    return;
  }

  const result = await runAdminReplayFromEmission({
    ...(args.inputPath ? { inputPath: args.inputPath } : {}),
    ...(args.outputPath ? { outputPath: args.outputPath } : {}),
    generateIfMissing: !args.noGenerate,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath: result.outputPath,
        inputPath: result.inputPath,
        generatedEmission: result.generatedEmission,
        stationRunId: result.artifact.stationRunId,
        scenarioId: result.artifact.scenarioId,
        actorTurnCount: result.artifact.actorTurnCount,
        actorTurnRefs: result.artifact.actorTurnRefs,
        timelineEntryCount: result.artifact.timelineEntryCount,
        traceEventTypes: result.artifact.traceEventTypes,
        turnSource: result.artifact.turnSource,
        claimBoundary: result.artifact.claimBoundary,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
