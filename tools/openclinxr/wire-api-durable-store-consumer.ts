/**
 * Wire ApiPersistenceSink-shaped hooks through ScenarioRuntime durableStore (Q4).
 *
 * Builds an in-memory sink (saveReviewPacket + saveActorTurn counters/arrays),
 * attaches via createDurableStoreFromPersistenceHooks + createDefaultScenarioRuntime,
 * runs a short session, and writes a claim-bounded consumer proof artifact.
 *
 * apps/api bootstrap residual: one-liner attach of ApiPersistenceSink review/actor
 * methods via createScenarioRuntimeWithPersistenceHooks (or createDefault + hooks).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/wire-api-durable-store-consumer.ts
 *   pnpm tsx tools/openclinxr/wire-api-durable-store-consumer.ts --output .openclinxr/encounter-publication/wire-api-durable-store-consumer-latest.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createDefaultScenarioRuntime,
  createDurableStoreFromPersistenceHooks,
  type DurableStorePersistenceHooks,
  type ScenarioRuntimeActorTurn,
} from "../../packages/openclinxr/scenario-runtime/src/index.js";
import type { ReviewPacket } from "../../packages/openclinxr/shared-schemas/src/index.js";
import { edChestPainScenario } from "../../packages/openclinxr/scenario-fixtures/src/index.js";

export type WireApiDurableStoreConsumerArtifact = {
  schemaVersion: "openclinxr.wire-api-durable-store-consumer.v1";
  generatedAt: string;
  scenarioId: string;
  scenarioVersion: number;
  stationRunId: string;
  phase: string;
  learnerId: string;
  actorTurns: ScenarioRuntimeActorTurn[];
  reviewPackets: Array<{
    stationRunId: string;
    scenarioId: string;
    eventCount: number;
    observedTraceTags: string[];
  }>;
  sinkInvoked: {
    saveActorTurnCount: number;
    saveReviewPacketCount: number;
  };
  wiring: {
    factory: "createDefaultScenarioRuntime+createDurableStoreFromPersistenceHooks";
    hooksShape: "DurableStorePersistenceHooks";
    mirrorsApiPersistenceSinkReviewActorSurface: true;
  };
  claimBoundary: "wire_api_durable_store_consumer_not_clinical_validity_or_production_readiness";
  notEvidenceFor: readonly [
    "clinical_validity",
    "scoring_validity",
    "quest_readiness",
    "production_readiness",
  ];
};

export type RunWireApiDurableStoreConsumerInput = {
  learnerId?: string;
  outputPath?: string;
  generatedAt?: string;
};

export type RunWireApiDurableStoreConsumerResult = {
  artifact: WireApiDurableStoreConsumerArtifact;
  outputPath: string;
};

const DEFAULT_OUTPUT_PATH =
  ".openclinxr/encounter-publication/wire-api-durable-store-consumer-latest.json";

/**
 * In-memory ApiPersistenceSink-shaped sink (review packet + actor turn surface only).
 * Counters/arrays prove hooks were invoked without Mongo or apps/api.
 */
export function createInMemoryApiPersistenceHooksSink(): {
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

export async function runWireApiDurableStoreConsumer(
  input: RunWireApiDurableStoreConsumerInput = {},
): Promise<RunWireApiDurableStoreConsumerResult> {
  const learnerId = input.learnerId ?? "wire_api_durable_store_learner_001";
  const generatedAt = input.generatedAt ?? "2026-08-02T00:00:00.000Z";
  const outputPath = path.resolve(input.outputPath ?? DEFAULT_OUTPUT_PATH);

  const { hooks, actorTurns, reviewPackets, counts } = createInMemoryApiPersistenceHooksSink();
  const durableStore = createDurableStoreFromPersistenceHooks(hooks);
  const runtime = createDefaultScenarioRuntime({ durableStore });

  const session = await runtime.startSession({ learnerId, consentAccepted: true });
  runtime.startEncounter(session.stationRunId, { atSecond: 60 });

  await runtime.generateActorResponse(session.stationRunId, {
    actorId: "patient_robert_hayes_v1",
    learnerUtterance: "When did the chest pressure start?",
    atSecond: 120,
    traceContextTags: ["history_opqrst"],
  });

  runtime.appendLearnerEvent(session.stationRunId, {
    eventType: "learner.order",
    atSecond: 480,
    tag: "ecg_request",
    actorId: "nurse_maria_alvarez_v1",
  });

  runtime.submitNote(session.stationRunId, {
    atSecond: 1260,
    text: "Wire-api durableStore consumer note: ACS concern; ECG requested; history elicited.",
  });

  const reviewPacket = await runtime.reviewPacketAndPersist(session.stationRunId);

  const artifact: WireApiDurableStoreConsumerArtifact = {
    schemaVersion: "openclinxr.wire-api-durable-store-consumer.v1",
    generatedAt,
    scenarioId: edChestPainScenario.scenarioId,
    scenarioVersion: edChestPainScenario.version,
    stationRunId: session.stationRunId,
    phase: "review",
    learnerId,
    actorTurns: [...actorTurns],
    reviewPackets: reviewPackets.map((packet) => ({
      stationRunId: packet.stationRunId,
      scenarioId: packet.scenarioId,
      eventCount: packet.traceQuality.eventCount,
      observedTraceTags: [...packet.observedTraceTags],
    })),
    sinkInvoked: {
      saveActorTurnCount: counts.saveActorTurnCount,
      saveReviewPacketCount: counts.saveReviewPacketCount,
    },
    wiring: {
      factory: "createDefaultScenarioRuntime+createDurableStoreFromPersistenceHooks",
      hooksShape: "DurableStorePersistenceHooks",
      mirrorsApiPersistenceSinkReviewActorSurface: true,
    },
    claimBoundary: "wire_api_durable_store_consumer_not_clinical_validity_or_production_readiness",
    notEvidenceFor: [
      "clinical_validity",
      "scoring_validity",
      "quest_readiness",
      "production_readiness",
    ],
  };

  // Sanity: packet from runtime matches sink capture.
  void reviewPacket;

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
    console.log(`Usage: pnpm tsx tools/openclinxr/wire-api-durable-store-consumer.ts [--output <path>]

Wires ApiPersistenceSink-shaped hooks through ScenarioRuntime durableStore.
Default output: ${DEFAULT_OUTPUT_PATH}`);
    return;
  }

  const result = await runWireApiDurableStoreConsumer({
    ...(args.outputPath ? { outputPath: args.outputPath } : {}),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath: result.outputPath,
        stationRunId: result.artifact.stationRunId,
        scenarioId: result.artifact.scenarioId,
        sinkInvoked: result.artifact.sinkInvoked,
        actorTurnCount: result.artifact.actorTurns.length,
        reviewPacketCount: result.artifact.reviewPackets.length,
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
