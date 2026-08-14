/**
 * Scenario authoring roundtrip CLI (Q1+Q4).
 *
 * Loads a fixture scenario, runs a short deterministic session
 * (start → encounter → learner utterance → note → review packet),
 * captures actor turns + review packet via optional durableStore hooks,
 * and writes a replay-safe JSON artifact.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/scenario-authoring-roundtrip.ts
 *   pnpm tsx tools/openclinxr/scenario-authoring-roundtrip.ts --output .openclinxr/encounter-publication/scenario-authoring-roundtrip-latest.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { edChestPainScenario } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  createDefaultScenarioRuntime,
  ScenarioRuntime,
  type ScenarioRuntimeActorTurn,
  type ScenarioRuntimeDurableStore,
} from "../../packages/openclinxr/scenario-runtime/src/index.js";
import type { ReviewPacket } from "../../packages/openclinxr/shared-schemas/src/index.js";

export type ScenarioAuthoringRoundtripArtifact = {
  schemaVersion: "openclinxr.scenario-authoring-roundtrip.v1";
  generatedAt: string;
  scenarioId: string;
  scenarioVersion: number;
  stationRunId: string;
  phase: string;
  learnerId: string;
  actorTurns: ScenarioRuntimeActorTurn[];
  timeline: ReviewPacket["timeline"];
  reviewPacket: ReviewPacket;
  durableStoreInvoked: {
    saveActorTurnCount: number;
    saveReviewPacketCount: number;
  };
  claimBoundary: "authoring_roundtrip_replay_artifact_not_clinical_validity_or_production_readiness";
  notEvidenceFor: readonly [
    "clinical_validity",
    "scoring_validity",
    "quest_readiness",
    "production_readiness",
  ];
};

export type RunScenarioAuthoringRoundtripInput = {
  learnerId?: string;
  outputPath?: string;
  generatedAt?: string;
};

export type RunScenarioAuthoringRoundtripResult = {
  artifact: ScenarioAuthoringRoundtripArtifact;
  outputPath: string;
};

const DEFAULT_OUTPUT_PATH = ".openclinxr/encounter-publication/scenario-authoring-roundtrip-latest.json";

export function createInMemoryAuthoringDurableStore(): {
  store: ScenarioRuntimeDurableStore;
  actorTurns: ScenarioRuntimeActorTurn[];
  reviewPackets: ReviewPacket[];
} {
  const actorTurns: ScenarioRuntimeActorTurn[] = [];
  const reviewPackets: ReviewPacket[] = [];
  return {
    actorTurns,
    reviewPackets,
    store: {
      saveActorTurn(_stationRunId, turn) {
        actorTurns.push({ ...turn, traceContextTags: [...turn.traceContextTags] });
      },
      saveReviewPacket(_stationRunId, packet) {
        reviewPackets.push(structuredClone(packet));
      },
    },
  };
}

export function createAuthoringRoundtripRuntime(
  durableStore?: ScenarioRuntimeDurableStore,
): ScenarioRuntime {
  return createDefaultScenarioRuntime({
    scenario: edChestPainScenario,
    ...(durableStore ? { durableStore } : {}),
  });
}

export async function runScenarioAuthoringRoundtrip(
  input: RunScenarioAuthoringRoundtripInput = {},
): Promise<RunScenarioAuthoringRoundtripResult> {
  const learnerId = input.learnerId ?? "authoring_learner_001";
  const generatedAt = input.generatedAt ?? "2026-08-02T00:00:00.000Z";
  const outputPath = path.resolve(input.outputPath ?? DEFAULT_OUTPUT_PATH);

  const { store, actorTurns, reviewPackets } = createInMemoryAuthoringDurableStore();
  const runtime = createAuthoringRoundtripRuntime(store);

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
    text: "Authoring roundtrip note: ACS concern; ECG requested; history elicited.",
  });

  const reviewPacket = await runtime.reviewPacketAndPersist(session.stationRunId);

  const artifact: ScenarioAuthoringRoundtripArtifact = {
    schemaVersion: "openclinxr.scenario-authoring-roundtrip.v1",
    generatedAt,
    scenarioId: edChestPainScenario.scenarioId,
    scenarioVersion: edChestPainScenario.version,
    stationRunId: session.stationRunId,
    phase: "review",
    learnerId,
    actorTurns: [...actorTurns],
    timeline: reviewPacket.timeline.map((entry) => ({ ...entry })),
    reviewPacket,
    durableStoreInvoked: {
      saveActorTurnCount: actorTurns.length,
      saveReviewPacketCount: reviewPackets.length,
    },
    claimBoundary: "authoring_roundtrip_replay_artifact_not_clinical_validity_or_production_readiness",
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
    console.log(`Usage: pnpm tsx tools/openclinxr/scenario-authoring-roundtrip.ts [--output <path>]

Writes a replay-safe authoring artifact with actorTurns + reviewPacket timeline.
Default output: ${DEFAULT_OUTPUT_PATH}`);
    return;
  }

  const result = await runScenarioAuthoringRoundtrip({
    ...(args.outputPath ? { outputPath: args.outputPath } : {}),
  });

  console.log(JSON.stringify({
    ok: true,
    outputPath: result.outputPath,
    stationRunId: result.artifact.stationRunId,
    scenarioId: result.artifact.scenarioId,
    actorTurnCount: result.artifact.actorTurns.length,
    timelineEventCount: result.artifact.timeline.length,
    durableStoreInvoked: result.artifact.durableStoreInvoked,
  }, null, 2));
}

const isDirectRun = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
