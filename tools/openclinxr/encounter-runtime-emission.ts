/**
 * Encounter runtime emission CLI (Q4).
 *
 * Proves runtime emission of real actor turns + review packet + ledger traces
 * into a durable-store sink and a published replay-safe artifact (not seeds-only).
 *
 * Uses createScenarioRuntimeWithPersistenceHooks so saveActorTurn / saveReviewPacket
 * fire during generateActorResponse + reviewPacketAndPersist.
 *
 * Usage:
 *   pnpm encounter:runtime-emission
 *   pnpm tsx tools/openclinxr/encounter-runtime-emission.ts
 *   pnpm tsx tools/openclinxr/encounter-runtime-emission.ts --output .openclinxr/encounter-publication/encounter-runtime-emission-latest.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { edChestPainScenario } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  createScenarioRuntimeWithPersistenceHooks,
  type DurableStorePersistenceHooks,
  type ScenarioRuntimeActorTurn,
} from "../../packages/openclinxr/scenario-runtime/src/index.js";
import type { ReviewPacket } from "../../packages/openclinxr/shared-schemas/src/index.js";

export type EncounterRuntimeEmissionReviewPacketSummary = {
  stationRunId: string;
  scenarioId: string;
  eventCount: number;
  observedTraceTags: string[];
  missingRequiredTraceTags: string[];
};

/** Review-safe clinical-touch ledger summary (region + kind; no private clinical claims). */
export type EncounterRuntimeEmissionClinicalTouchEvent = {
  atSecond: number;
  eventType: string;
  actorId: string;
  tag: string;
  region: string;
  responseKind: string;
  dialogueLine: string;
  summary: string;
};

export type EncounterRuntimeEmissionArtifact = {
  schemaVersion: "openclinxr.encounter-runtime-emission.v1";
  generatedAt: string;
  stationRunId: string;
  scenarioId: string;
  scenarioVersion: number;
  phase: string;
  learnerId: string;
  /** Real actor turns captured from durable-store saveActorTurn (count ≥1). */
  actorTurns: ScenarioRuntimeActorTurn[];
  /** Compact review packet summary from durable-store / runtime (not seeds). */
  reviewPacket: EncounterRuntimeEmissionReviewPacketSummary;
  /** Distinct eventType values from ledger.replay via runtime.traceEvents. */
  traceEventTypes: string[];
  /**
   * Clinical-touch ledger entries (touch → guard → dialogue) for Q4 faculty review.
   * notEvidenceFor clinical validity / scoring.
   */
  clinicalTouchEvents: EncounterRuntimeEmissionClinicalTouchEvent[];
  durableStoreInvoked: {
    saveActorTurnCount: number;
    saveReviewPacketCount: number;
  };
  wiring: {
    factory: "createScenarioRuntimeWithPersistenceHooks";
    hooksShape: "DurableStorePersistenceHooks";
    emissionPath: "startSession→startEncounter→generateActorResponse→clinicalTouch→submitNote→reviewPacketAndPersist";
  };
  claimBoundary: "encounter_runtime_emission_not_clinical_validity_or_production_readiness";
  notEvidenceFor: readonly [
    "clinical_validity",
    "scoring_validity",
    "quest_readiness",
    "production_readiness",
  ];
};

export type RunEncounterRuntimeEmissionInput = {
  learnerId?: string;
  outputPath?: string;
  generatedAt?: string;
};

export type RunEncounterRuntimeEmissionResult = {
  artifact: EncounterRuntimeEmissionArtifact;
  outputPath: string;
};

const DEFAULT_OUTPUT_PATH =
  ".openclinxr/encounter-publication/encounter-runtime-emission-latest.json";

/**
 * In-memory durable-store sink: captures real turns + packets with invoke counts.
 * Mirrors ApiPersistenceSink review/actor surface without apps/api or Mongo.
 */
export function createInMemoryEmissionSink(): {
  hooks: DurableStorePersistenceHooks;
  actorTurns: ScenarioRuntimeActorTurn[];
  reviewPackets: ReviewPacket[];
  counts: { saveActorTurnCount: number; saveReviewPacketCount: number };
} {
  const actorTurns: ScenarioRuntimeActorTurn[] = [];
  const reviewPackets: ReviewPacket[] = [];
  const counts = { saveActorTurnCount: 0, saveReviewPacketCount: 0 };

  const hooks: DurableStorePersistenceHooks = {
    saveActorTurn(_stationRunId, turn) {
      counts.saveActorTurnCount += 1;
      actorTurns.push({ ...turn, traceContextTags: [...turn.traceContextTags] });
    },
    saveReviewPacket(_stationRunId, packet) {
      counts.saveReviewPacketCount += 1;
      reviewPackets.push(structuredClone(packet));
    },
  };

  return { hooks, actorTurns, reviewPackets, counts };
}

export function summarizeReviewPacket(
  packet: ReviewPacket,
): EncounterRuntimeEmissionReviewPacketSummary {
  return {
    stationRunId: packet.stationRunId,
    scenarioId: packet.scenarioId,
    eventCount: packet.traceQuality.eventCount,
    observedTraceTags: [...packet.observedTraceTags],
    missingRequiredTraceTags: [...packet.missingRequiredTraceTags],
  };
}

export function uniqueTraceEventTypes(
  events: ReadonlyArray<{ eventType: string }>,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const event of events) {
    if (!seen.has(event.eventType)) {
      seen.add(event.eventType);
      ordered.push(event.eventType);
    }
  }
  return ordered;
}

/**
 * Project review-safe clinical.touch.* ledger events (region + kind + dialogue summary).
 * Private payload text is truncated; notEvidenceFor clinical validity / scoring.
 */
export function summarizeClinicalTouchEvents(
  events: ReadonlyArray<{
    eventType: string;
    atSecond: number;
    actorId?: string;
    tag?: string;
    payload?: Record<string, unknown>;
  }>,
): EncounterRuntimeEmissionClinicalTouchEvent[] {
  const out: EncounterRuntimeEmissionClinicalTouchEvent[] = [];
  for (const event of events) {
    if (!event.eventType.startsWith("clinical.touch.")) continue;
    const payload = event.payload ?? {};
    const region = typeof payload.region === "string" ? payload.region : "region";
    const responseKind =
      typeof payload.responseKind === "string"
        ? payload.responseKind
        : event.eventType.slice("clinical.touch.".length);
    const dialogueLine =
      typeof payload.dialogueLine === "string" ? payload.dialogueLine : "";
    const actorId = event.actorId ?? "unknown_actor";
    const tag = event.tag ?? "";
    const dialogueClip =
      dialogueLine.length > 60 ? `${dialogueLine.slice(0, 57)}...` : dialogueLine;
    out.push({
      atSecond: event.atSecond,
      eventType: event.eventType,
      actorId,
      tag,
      region,
      responseKind,
      dialogueLine,
      summary: [
        `${actorId} physical exam touch: ${responseKind} at ${region}`,
        tag ? `tag ${tag}` : undefined,
        dialogueClip ? `dialogue ${dialogueClip}` : undefined,
        "notEvidenceFor clinical_validity/scoring",
      ]
        .filter(Boolean)
        .join("; "),
    });
  }
  return out;
}

/**
 * Run a short deterministic encounter session and emit a replay-safe artifact
 * proving durable-store capture of ≥1 real actor turn + review packet + ledger traces.
 */
export async function runEncounterRuntimeEmission(
  input: RunEncounterRuntimeEmissionInput = {},
): Promise<RunEncounterRuntimeEmissionResult> {
  const learnerId = input.learnerId ?? "runtime_emission_learner_001";
  const generatedAt = input.generatedAt ?? "2026-08-02T00:00:00.000Z";
  const outputPath = path.resolve(input.outputPath ?? DEFAULT_OUTPUT_PATH);

  const { hooks, actorTurns, reviewPackets, counts } = createInMemoryEmissionSink();
  const runtime = createScenarioRuntimeWithPersistenceHooks(hooks);

  const session = await runtime.startSession({ learnerId, consentAccepted: true });
  runtime.startEncounter(session.stationRunId, { atSecond: 60 });

  await runtime.generateActorResponse(session.stationRunId, {
    actorId: "patient_robert_hayes_v1",
    learnerUtterance: "When did the chest pressure start?",
    atSecond: 120,
    traceContextTags: ["history_opqrst"],
  });

  // Q4 clinical-touch turn: ledger clinical.touch.guarding + real actor-turn dialogue.
  // Region from case bodyMechanics (RLQ maximal guarding); notEvidenceFor clinical validity.
  const patient = edChestPainScenario.actors.find((a) => a.actorId === "patient_robert_hayes_v1");
  const rlqTouch =
    patient?.bodyMechanics?.touchResponses.find((r) => r.region === "abdomen_rlq") ??
    patient?.bodyMechanics?.touchResponses[0];
  const touchRegion = rlqTouch?.region ?? "abdomen_rlq";
  const touchTag = rlqTouch?.traceTag ?? "clinical_touch_guard_rlq";
  const touchDialogue =
    rlqTouch?.dialogueLine ?? "Ow— that hurts a lot, please don't push there.";
  const touchKind = rlqTouch?.responseKind ?? "guarding";
  const touchAtSecond = 210;

  runtime.appendLearnerEvent(session.stationRunId, {
    eventType: `clinical.touch.${touchKind}`,
    atSecond: touchAtSecond,
    tag: touchTag,
    actorId: "patient_robert_hayes_v1",
    payload: {
      region: touchRegion,
      responseKind: touchKind,
      dialogueLine: touchDialogue,
      emotion: rlqTouch?.emotion ?? "pain",
      responseClip: rlqTouch?.responseClip ?? "openclinxr_role_patient_guard_withdraw_rlq",
      notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
    },
  });

  await runtime.generateActorResponse(session.stationRunId, {
    actorId: "patient_robert_hayes_v1",
    learnerUtterance: `[physical exam palpation at ${touchRegion}]`,
    atSecond: touchAtSecond,
    traceContextTags: [touchTag],
  });

  runtime.appendLearnerEvent(session.stationRunId, {
    eventType: "learner.order",
    atSecond: 480,
    tag: "ecg_request",
    actorId: "nurse_maria_alvarez_v1",
  });

  runtime.submitNote(session.stationRunId, {
    atSecond: 1260,
    text: "Runtime emission note: ACS concern; ECG requested; history elicited; multi-region palpation including RLQ guarding response.",
  });

  const reviewPacket = await runtime.reviewPacketAndPersist(session.stationRunId);
  const ledgerEvents = runtime.traceEvents(session.stationRunId);
  const phase = "review";

  if (actorTurns.length < 1) {
    throw new Error(
      "Runtime emission failed: expected ≥1 actor turn in durable store (saveActorTurn never fired)",
    );
  }
  if (reviewPackets.length < 1) {
    throw new Error(
      "Runtime emission failed: expected ≥1 review packet in durable store (saveReviewPacket never fired)",
    );
  }

  const clinicalTouchEvents = summarizeClinicalTouchEvents(ledgerEvents);
  if (clinicalTouchEvents.length < 1) {
    throw new Error(
      "Runtime emission failed: expected ≥1 clinical.touch.* ledger event for Q4 faculty review",
    );
  }

  const artifact: EncounterRuntimeEmissionArtifact = {
    schemaVersion: "openclinxr.encounter-runtime-emission.v1",
    generatedAt,
    stationRunId: session.stationRunId,
    scenarioId: edChestPainScenario.scenarioId,
    scenarioVersion: edChestPainScenario.version,
    phase,
    learnerId,
    actorTurns: [...actorTurns],
    reviewPacket: summarizeReviewPacket(reviewPacket),
    traceEventTypes: uniqueTraceEventTypes(ledgerEvents),
    clinicalTouchEvents,
    durableStoreInvoked: {
      saveActorTurnCount: counts.saveActorTurnCount,
      saveReviewPacketCount: counts.saveReviewPacketCount,
    },
    wiring: {
      factory: "createScenarioRuntimeWithPersistenceHooks",
      hooksShape: "DurableStorePersistenceHooks",
      emissionPath:
        "startSession→startEncounter→generateActorResponse→clinicalTouch→submitNote→reviewPacketAndPersist",
    },
    claimBoundary: "encounter_runtime_emission_not_clinical_validity_or_production_readiness",
    notEvidenceFor: [
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "production_readiness",
    ],
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return { artifact, outputPath };
}

function parseArgs(argv: string[]): { outputPath?: string; help: boolean } {
  let outputPath: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
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
  return { ...(outputPath ? { outputPath } : {}), help };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: pnpm encounter:runtime-emission [--output <path>]
       pnpm tsx tools/openclinxr/encounter-runtime-emission.ts [--output <path>]

Proves runtime emission of actor turns + review packet + ledger traces into durable store.
Default output: ${DEFAULT_OUTPUT_PATH}`);
    return;
  }

  const result = await runEncounterRuntimeEmission({
    ...(args.outputPath ? { outputPath: args.outputPath } : {}),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath: result.outputPath,
        stationRunId: result.artifact.stationRunId,
        scenarioId: result.artifact.scenarioId,
        phase: result.artifact.phase,
        actorTurnCount: result.artifact.actorTurns.length,
        reviewPacket: result.artifact.reviewPacket,
        traceEventTypes: result.artifact.traceEventTypes,
        durableStoreInvoked: result.artifact.durableStoreInvoked,
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
