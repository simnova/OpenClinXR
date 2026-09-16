import { InMemoryTraceLedger } from "@cellix/trace-ledger";
import { createEdChestPainPlaceholderManifests, InMemoryAssetRegistry } from "@openclinxr/asset-registry";
import {
  createDefaultModelGateway,
  LocalModelProviderAdapter,
  MockModelProviderAdapter,
} from "@openclinxr/model-gateway";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import {
  createDefaultVoiceGateway,
  LocalVoiceProviderAdapter,
  MockVoiceProviderAdapter,
} from "@openclinxr/voice-gateway";
import { beforeEach, describe, expect, it } from "vitest";
import type { ScenarioRuntimeOptions } from "../runtime-types.js";
import { ScenarioRuntime } from "../scenario-runtime.js";
import {
  BRANCH_SCHEDULER_CLAIM_SCOPE,
  BRANCH_SCHEDULER_NOT_EVIDENCE_FOR,
  type FrozenCaseSeed,
} from "./evaluate.js";

const POLICY = "branch-policy-v1";
const HIDDEN = "hidden-truth:acs-not-disclosed";

type BranchSchedulingPayload = {
  ok: boolean;
  decision?: {
    selectedTransitionId: string | null;
    fromBranchId: string;
    toBranchId: string;
    claimScope: string;
    notEvidenceFor: readonly string[];
  };
  reason?: string;
  detail?: string;
};

function seed(overrides: Partial<FrozenCaseSeed> = {}): FrozenCaseSeed {
  return {
    seedId: "case-seed-ed-chest-pain-v1",
    scenarioId: edChestPainScenario.scenarioId,
    stationRunId: "run_pending",
    caseRevision: "rev-1",
    policyVersion: POLICY,
    initialBranchId: "stem",
    hiddenTruthFingerprint: HIDDEN,
    transitions: [
      {
        transitionId: "t_acs_workup",
        fromBranchId: "stem",
        toBranchId: "acs_workup",
        priority: 1,
        predicates: [
          { predicateId: "p_ecg", kind: "tag_admitted", tag: "ecg_request" },
          { predicateId: "p_order", kind: "event_type_admitted", eventType: "learner.order" },
        ],
        environmentCue: {
          cueId: "monitor_on",
          kind: "environment",
          payload: { prop: "cardiac_monitor" },
        },
        actorCue: {
          cueId: "nurse_alert",
          kind: "actor",
          actorId: "nurse_maria_alvarez_v1",
          payload: { line: "I'll get the ECG." },
        },
        hiddenFromLearner: false,
      },
      {
        transitionId: "t_watchful",
        fromBranchId: "stem",
        toBranchId: "watchful_waiting",
        priority: 2,
        predicates: [{ predicateId: "p_reassurance", kind: "tag_admitted", tag: "reassurance_only" }],
        environmentCue: { cueId: "hold_room", kind: "environment", payload: { prop: "exam_room" } },
        actorCue: {
          cueId: "patient_wait",
          kind: "actor",
          actorId: "patient_robert_hayes_v1",
          payload: { line: "I'll wait." },
        },
        hiddenFromLearner: true,
      },
      {
        transitionId: "t_troponin",
        fromBranchId: "acs_workup",
        toBranchId: "acs_labs",
        priority: 1,
        predicates: [{ predicateId: "p_trop", kind: "tag_admitted", tag: "troponin_order" }],
        environmentCue: { cueId: "lab_draw", kind: "environment", payload: { prop: "phlebotomy_tray" } },
        actorCue: {
          cueId: "nurse_labs",
          kind: "actor",
          actorId: "nurse_maria_alvarez_v1",
          payload: { line: "Labs are drawing." },
        },
        hiddenFromLearner: true,
      },
    ],
    ...overrides,
  };
}

function branchScheduling(
  policyVersion = POLICY,
  seedOverrides: Partial<FrozenCaseSeed> = {},
): NonNullable<ScenarioRuntimeOptions["branchScheduling"]> {
  return {
    policyVersion,
    seedForSession: ({ stationRunId, scenarioId }) => seed({ stationRunId, scenarioId, ...seedOverrides }),
  };
}

function createRuntime(
  scheduling?: ScenarioRuntimeOptions["branchScheduling"],
): { runtime: ScenarioRuntime; ledger: InMemoryTraceLedger } {
  const assetRegistry = new InMemoryAssetRegistry();
  for (const manifest of createEdChestPainPlaceholderManifests()) {
    assetRegistry.upsert(manifest);
  }
  const ledger = new InMemoryTraceLedger();
  const runtime = new ScenarioRuntime({
    scenario: edChestPainScenario,
    ledger,
    assetRegistry,
    modelGateway: createDefaultModelGateway({
      routeId: "actor-dialogue-offline-v1",
      adapters: [
        new MockModelProviderAdapter(),
        new LocalModelProviderAdapter({ providerId: "local-model" }),
      ],
    }),
    voiceGateway: createDefaultVoiceGateway({
      routeId: "voice-offline-v1",
      adapters: [new MockVoiceProviderAdapter(), new LocalVoiceProviderAdapter({ providerId: "local-voice" })],
    }),
    ...(scheduling ? { branchScheduling: scheduling } : {}),
  });
  return { runtime, ledger };
}

function recordedBranch(event: { payload?: Record<string, unknown> }): BranchSchedulingPayload | undefined {
  const payload = event.payload?.["branchScheduling"];
  if (payload === undefined) {
    return undefined;
  }
  return payload as BranchSchedulingPayload;
}

describe("runtime branch composition", () => {
  beforeEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["OPENCLINXR_LOCAL_LLAMA_BASE_URL"];
  });

  it("folds two successive admitted transitions from recorded decisions without extra sequence events", async () => {
    const { runtime } = createRuntime(branchScheduling());
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });

    const first = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
      actorId: "nurse_maria_alvarez_v1",
    });
    expect(first.sequence).toBe(3);
    expect(first.eventType).toBe("learner.order");
    const firstDecision = recordedBranch(first);
    expect(firstDecision).toMatchObject({
      ok: true,
      decision: {
        selectedTransitionId: "t_acs_workup",
        fromBranchId: "stem",
        toBranchId: "acs_workup",
        claimScope: BRANCH_SCHEDULER_CLAIM_SCOPE,
        notEvidenceFor: [...BRANCH_SCHEDULER_NOT_EVIDENCE_FOR],
      },
    });

    const second = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 600,
      tag: "troponin_order",
    });
    expect(second.sequence).toBe(4);
    const secondDecision = recordedBranch(second);
    expect(secondDecision).toMatchObject({
      ok: true,
      decision: {
        selectedTransitionId: "t_troponin",
        fromBranchId: "acs_workup",
        toBranchId: "acs_labs",
      },
    });

    expect(runtime.traceEvents(session.stationRunId).map((event) => event.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
      "learner.order",
      "learner.order",
    ]);
    expect(runtime.traceEvents(session.stationRunId).map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps independent sessions from consuming each other's recorded branch decisions", async () => {
    const { runtime } = createRuntime(branchScheduling());
    const sessionA = await runtime.startSession({ learnerId: "learner_a", consentAccepted: true });
    const sessionB = await runtime.startSession({ learnerId: "learner_b", consentAccepted: true });
    runtime.startEncounter(sessionA.stationRunId, { atSecond: 60 });
    runtime.startEncounter(sessionB.stationRunId, { atSecond: 60 });

    const moved = runtime.appendLearnerEvent(sessionA.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
    });
    const held = runtime.appendLearnerEvent(sessionB.stationRunId, {
      eventType: "learner.utterance",
      atSecond: 120,
      tag: "small_talk",
    });

    expect(recordedBranch(moved)?.decision?.toBranchId).toBe("acs_workup");
    expect(recordedBranch(held)?.decision).toMatchObject({
      selectedTransitionId: null,
      fromBranchId: "stem",
      toBranchId: "stem",
    });
    expect(sessionA.stationRunId).not.toBe(sessionB.stationRunId);
  });

  it("preserves the legacy learner-event shape when branchScheduling is absent", async () => {
    const { runtime } = createRuntime();
    const session = await runtime.startSession({ learnerId: "learner_001", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    const event = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
    });
    expect(event.sequence).toBe(3);
    expect(event.payload?.["branchScheduling"]).toBeUndefined();
    expect(runtime.traceEvents(session.stationRunId).map((row) => row.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
      "learner.order",
    ]);
  });

  it("records stale-policy and reordered-time refusals on the learner event and does not advance state or prefix", async () => {
    const stale = createRuntime(branchScheduling("branch-policy-v0"));
    const staleSession = await stale.runtime.startSession({ learnerId: "stale_learner", consentAccepted: true });
    stale.runtime.startEncounter(staleSession.stationRunId, { atSecond: 60 });
    const staleFirst = stale.runtime.appendLearnerEvent(staleSession.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
    });
    const staleSecond = stale.runtime.appendLearnerEvent(staleSession.stationRunId, {
      eventType: "learner.order",
      atSecond: 600,
      tag: "troponin_order",
    });
    expect(recordedBranch(staleFirst)).toMatchObject({ ok: false, reason: "stale_policy" });
    expect(recordedBranch(staleSecond)).toMatchObject({ ok: false, reason: "stale_policy" });
    expect(staleFirst.sequence).toBe(3);
    expect(staleSecond.sequence).toBe(4);
    expect(stale.runtime.traceEvents(staleSession.stationRunId).map((row) => row.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
      "learner.order",
      "learner.order",
    ]);

    const { runtime } = createRuntime(branchScheduling());
    const session = await runtime.startSession({ learnerId: "reorder_learner", consentAccepted: true });
    runtime.startEncounter(session.stationRunId, { atSecond: 60 });
    const committed = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
    });
    const refused = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 100,
      tag: "troponin_order",
    });
    const recovered = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 600,
      tag: "troponin_order",
    });
    expect(recordedBranch(committed)?.decision?.toBranchId).toBe("acs_workup");
    expect(recordedBranch(refused)).toMatchObject({ ok: false, reason: "reordered_events" });
    expect(refused.sequence).toBe(4);
    expect(recordedBranch(recovered)).toMatchObject({
      ok: true,
      decision: {
        selectedTransitionId: "t_troponin",
        fromBranchId: "acs_workup",
        toBranchId: "acs_labs",
      },
    });
    expect(recovered.sequence).toBe(5);
  });

  it("does not fold during doorway or after a refused/unadmitted encounter", async () => {
    const { runtime } = createRuntime(branchScheduling());
    const session = await runtime.startSession({
      learnerId: "doorway_learner",
      consentAccepted: true,
      assembledStation: {
        examRunId: "exam_branch_refusal",
        scenarioId: edChestPainScenario.scenarioId,
        stationOrder: 1,
        formTiming: {
          doorway: { startsAtSecond: 0, endsAtSecond: 60 },
          encounter: { startsAtSecond: 60, endsAtSecond: 960 },
          note: { startsAtSecond: 960, endsAtSecond: 1560 },
        },
      },
    });
    expect(session.phase).toBe("doorway");
    expect(() => runtime.startEncounter(session.stationRunId, { atSecond: 0 })).toThrow(/outside window/);
    expect(runtime.traceEvents(session.stationRunId).some((event) => event.eventType === "encounter.started")).toBe(false);
    const doorwayEvent = runtime.appendLearnerEvent(session.stationRunId, {
      eventType: "learner.order",
      atSecond: 480,
      tag: "ecg_request",
    });
    expect(session.phase).toBe("doorway");
    expect(doorwayEvent.sequence).toBe(2);
    expect(recordedBranch(doorwayEvent)).toBeUndefined();

    const admitted = await runtime.startSession({ learnerId: "ended_learner", consentAccepted: true });
    runtime.startEncounter(admitted.stationRunId, { atSecond: 60 });
    runtime.endEncounter(admitted.stationRunId, { atSecond: 900 });
    const afterEncounter = runtime.appendLearnerEvent(admitted.stationRunId, {
      eventType: "learner.order",
      atSecond: 910,
      tag: "ecg_request",
    });
    expect(recordedBranch(afterEncounter)).toBeUndefined();
    expect(runtime.traceEvents(admitted.stationRunId).map((row) => row.eventType)).toEqual([
      "station.started",
      "consent.accepted",
      "encounter.started",
      "encounter.ended",
      "learner.order",
    ]);
  });

  it("rejects seed station/scenario identity mismatches before writing startup ledger events", async () => {
    const wrongStation = createRuntime({
      policyVersion: POLICY,
      seedForSession: ({ scenarioId }) => seed({ stationRunId: "run_other_station", scenarioId }),
    });
    await expect(
      wrongStation.runtime.startSession({ learnerId: "learner_001", consentAccepted: true }),
    ).rejects.toThrow(/FrozenCaseSeed stationRunId run_other_station/);
    expect(wrongStation.ledger.replay("run_ed_chest_pain_priority_v1_learner_001")).toEqual([]);

    const wrongScenario = createRuntime({
      policyVersion: POLICY,
      seedForSession: ({ stationRunId }) => seed({ stationRunId, scenarioId: "not_this_scenario" }),
    });
    await expect(
      wrongScenario.runtime.startSession({ learnerId: "learner_001", consentAccepted: true }),
    ).rejects.toThrow(/FrozenCaseSeed scenarioId not_this_scenario/);
    expect(wrongScenario.ledger.replay("run_ed_chest_pain_priority_v1_learner_001")).toEqual([]);
  });
});
