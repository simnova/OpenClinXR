import { appendFileSync } from "node:fs";
import { createDefaultScenarioRuntime, type ScenarioRuntime } from "@openclinxr/scenario-runtime";
import type { Scenario } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";

/**
 * Taken from the production method's own signature rather than a re-exported name.
 * `@openclinxr/scenario-runtime`'s root entrypoint sits at a shrink-only ceiling of 34 symbols and
 * this card may not raise it, so the test reads the type off the surface it is testing — which is
 * also the stricter binding: a change to the method changes the type this file compiles against.
 */
type SceneRequirementObservation = Parameters<ScenarioRuntime["recordRequirementObservation"]>[1];

/**
 * SC-02 — observed requirements control actual API/UI encounter entry and due-zero effects.
 *
 * A02: actual runtime-owned requirements govern acceptance.
 * A03: the runtime lifecycle owns entry and scheduled effects.
 *
 * THE MEASURED RED, taken on `1da9ce04` before any product change in this card:
 *
 *   $ pnpm exec vitest run apps/api/src/the-observed-scene-gates-entry-and-due-zero-effects.test.ts
 *   MEASURED start-encounter status: 200 body:
 *     {"stationRunId":"run_scene_closure_supine_bedside_v1_sc02_learner",
 *      "scenarioId":"scene_closure_supine_bedside_v1","phase":"encounter"}
 *   AssertionError: expected 200 to be 400
 *
 * A case declaring a runtime-owned required starting predicate (`vitals_monitor_powered`) that NO
 * consumer had observed was admitted through the real `POST /sessions/:id/start-encounter` route
 * and the phase advanced to `encounter`. `initialSceneSpecPermitsPromotion` could report that
 * refusal, and nothing on the entry path read it — the pure helper was the only thing that knew.
 *
 * WHERE THE FIX LIVES. `ScenarioRuntime.startEncounter` (the EXISTING transition owner) evaluates
 * admission before `transitionStation` and throws on refusal. The API route already funnels a
 * throw through `sessionErrorResponse`, so the route refuses with no edit to
 * `packages/openclinxr/rest`. The UI-XR entry caller consumes `admitRemoteTraceSession`.
 */

/**
 * READ-ONLY INSTRUMENT. When `OPENCLINXR_SC02_OBSERVATIONS` names a file, each clause appends the
 * value it actually observed, keyed by the contract check id the SC-02 evidence report indexes.
 * It writes nothing into the product and changes no assertion; with the variable unset the test is
 * byte-for-byte the same run. The verifier re-hashes the emitted file and refuses any check whose
 * id does not appear in it, so a report cannot claim an outcome this run never produced.
 */
const OBSERVATION_SINK = process.env["OPENCLINXR_SC02_OBSERVATIONS"];

function observed(checkId: string, metric: string, unit: string, value: unknown): void {
  if (!OBSERVATION_SINK) return;
  appendFileSync(
    OBSERVATION_SINK,
    `${JSON.stringify({ checkId, metric, unit, value, observedAtMs: Date.now() })}\n`,
  );
}

const CASE_VERSION = 1;
const SCENARIO_ID = "scene_closure_supine_bedside_v1";
const CASE_REVISION = `${SCENARIO_ID}@${CASE_VERSION}`;
/** Fixed clock, so freshness is a measured comparison rather than a race against real time. */
const NOW_MS = 1_760_000_000_000;
const FRESHNESS_MS = 30_000;

const MONITOR_INSTANCE = "vitals_monitor_equipment#1";
const SUPPORT_INSTANCE = "stretcher_support#1";

const MONITOR_POWERED = {
  requirementId: "vitals_monitor_powered",
  ownedBy: "runtime",
  capability: "equipment.power",
  instanceId: MONITOR_INSTANCE,
  expectedInitialValue: true,
  requirementRevision: "r1",
} as const;

const SUPPORT_MOUNTED = {
  requirementId: "stretcher_support_mounted",
  ownedBy: "runtime",
  capability: "support.mounted",
  instanceId: SUPPORT_INSTANCE,
  expectedInitialValue: true,
  requirementRevision: "r1",
} as const;

/**
 * The learner task. It is authored `connected=false` at START with `goalValue: true`, which is the
 * distinction acceptance-v2.md insists on: "observed `connected=false` can satisfy the initial
 * requirement while the later goal `connected=true` remains incomplete".
 */
const LEADS_CONNECTED = {
  requirementId: "monitor_leads_connected",
  ownedBy: "learner",
  capability: "equipment.connection",
  instanceId: MONITOR_INSTANCE,
  expectedInitialValue: false,
  goalValue: true,
  requirementRevision: "r1",
} as const;

const BASE_SCENARIO: Scenario = {
  scenarioId: SCENARIO_ID,
  version: CASE_VERSION,
  title: "Scene closure supine bedside",
  status: "approved",
  review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
  clinicalObjectives: ["bounded bedside admission and due-zero effect ordering"],
  actors: [{
    actorId: "patient_margaret_ellis_v1",
    role: "patient",
    displayName: "Margaret Ellis",
    demeanor: "neutral",
    openingUtterance: "Hello.",
    communicationProfile: {
      styleFamily: "satir",
      style: "congruent",
      intensity: 0.5,
      baselineMood: ["neutral"],
      communicativeness: "Responds normally.",
      topicsToAvoid: [],
      adverseResponse: "",
      deescalationTriggers: [],
      escalationTriggers: [],
      culturalLanguageNotes: [],
    },
    hiddenFacts: [],
  }],
  requiredTraceTags: [],
  eventSchedule: [{
    eventId: "supine_baseline_vitals",
    atSecond: 0,
    actorId: "patient_margaret_ellis_v1",
    tag: "scene_closure_due_zero",
  }],
  reviewRubric: [],
  governance: {
    scoreUseLabel: "formative_local_only",
    syntheticCaseDisclosure: "Synthetic scene-closure case; no real patient data.",
    validationStage: "stage_1_expert_reviewed",
    validationLimitations: ["qualified clinical review pending"],
    requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
    sourceIds: [],
    safetyCriticalTraceTags: [],
    hiddenFactPolicy: { learnerView: "redact_hidden_facts", disclosureRequiresTrigger: true },
  },
  environment: { environmentId: "ward_bay_v1", name: "Ward bay", description: "Ward bay." },
  equipment: ["vitals_monitor_equipment"],
  assetNeeds: [
    { assetId: "vitals_monitor_equipment", assetType: "equipment", description: "Required monitor", licenseStatus: "approved" },
    { assetId: "iv_pole_equipment", assetType: "equipment", description: "Optional second instance", licenseStatus: "approved" },
  ],
  startingRequirements: [MONITOR_POWERED, SUPPORT_MOUNTED, LEADS_CONNECTED],
};

function scenarioWith(overrides: Partial<Scenario>): Scenario {
  return { ...BASE_SCENARIO, ...overrides };
}

function observation(
  requirement: { requirementId: string; capability: string; instanceId: string; requirementRevision: string },
  observedValue: string | number | boolean,
  outcome: SceneRequirementObservation["outcome"],
  stationRunId: string,
  overrides: Partial<SceneRequirementObservation> = {},
): SceneRequirementObservation {
  return {
    requirementId: requirement.requirementId,
    capability: requirement.capability,
    instanceId: requirement.instanceId,
    instanceVersion: "v1",
    observedValue,
    outcome,
    observedAtMs: NOW_MS - 1_000,
    stationRunId,
    caseRevision: CASE_REVISION,
    requirementRevision: requirement.requirementRevision,
    source: "runtime_consumer_observation",
    ...overrides,
  };
}

type Harness = {
  runtime: ScenarioRuntime;
  app: ReturnType<typeof createApiApp>;
  applied: Array<{ eventId: string; attempt: number }>;
  failEventIdsOnAttempt: Map<string, number>;
};

function harness(scenario: Scenario = BASE_SCENARIO): Harness {
  const applied: Array<{ eventId: string; attempt: number }> = [];
  const failEventIdsOnAttempt = new Map<string, number>();
  const scheduledEffectConsumer = {
    applyEffect: ({ event, attempt }: { event: { eventId: string }; attempt: number }) => {
      if (failEventIdsOnAttempt.get(event.eventId) === attempt) {
        throw new Error(`effect consumer refused ${event.eventId} on attempt ${attempt}`);
      }
      applied.push({ eventId: event.eventId, attempt });
      return { acknowledgmentId: `ack_${event.eventId}_${attempt}` };
    },
  };
  const runtime = createDefaultScenarioRuntime({
    scenario,
    encounterAdmission: {
      observationFreshnessMs: FRESHNESS_MS,
      now: () => NOW_MS,
      scheduledEffectConsumer,
    },
  });
  return { runtime, app: createApiApp(runtime, {}), applied, failEventIdsOnAttempt };
}

async function startSession(app: Harness["app"], learnerId = "sc02_learner"): Promise<string> {
  const response = await app.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ learnerId, consentAccepted: true }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { stationRunId: string }).stationRunId;
}

async function postStartEncounter(app: Harness["app"], stationRunId: string, atSecond = 60): Promise<Response> {
  return app.request(`/sessions/${stationRunId}/start-encounter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ atSecond }),
  });
}

/** Every runtime-owned predicate observed exactly as the case authored it. */
function observeAllRuntimeRequirements(runtime: ScenarioRuntime, stationRunId: string): void {
  runtime.recordRequirementObservation(stationRunId, observation(MONITOR_POWERED, true, "satisfied", stationRunId));
  runtime.recordRequirementObservation(stationRunId, observation(SUPPORT_MOUNTED, true, "satisfied", stationRunId));
}

function encounterStartedCount(runtime: ScenarioRuntime, stationRunId: string): number {
  return runtime.traceEvents(stationRunId).filter((event) => event.eventType === "encounter.started").length;
}

describe("the observed scene gates entry and due-zero effects", () => {
  it("SC-02-required-behavior", async () => {
    const { runtime, app, applied } = harness();
    const stationRunId = await startSession(app);

    // (a) A02 — the reproduced hole. Both required assets are PRESENT; the runtime-owned
    // `vitals_monitor_powered` predicate has no consumer observation, which is `unknown`, and
    // unknown refuses. This is the exact call that returned 200 at the baseline.
    const unobserved = await postStartEncounter(app, stationRunId);
    expect(unobserved.status).toBe(400);
    observed("required-unknown-blocks-admission", "POST start-encounter status, no observation recorded", "httpStatus", unobserved.status);
    expect(await unobserved.json()).toEqual({ error: "station_command_invalid" });
    expect(encounterStartedCount(runtime, stationRunId)).toBe(0);
    expect(runtime.encounterAdmissionSnapshot(stationRunId)).toBeUndefined();

    // (b) A02 — an observed but UNSATISFIED runtime predicate still refuses. The observation now
    // exists and is well-bound, so this is the outcome doing the refusing, not the absence.
    runtime.recordRequirementObservation(
      stationRunId,
      observation(MONITOR_POWERED, false, "unsatisfied", stationRunId),
    );
    const unsatisfied = await postStartEncounter(app, stationRunId);
    expect(unsatisfied.status).toBe(400);
    observed("required-unsatisfied-blocks-admission", "POST start-encounter status, monitor observed unsatisfied", "httpStatus", unsatisfied.status);
    observed("present-asset-with-unsatisfied-requirement-refuses", "encounter.started trace count with both assets present", "count", encounterStartedCount(runtime, stationRunId));
    expect(encounterStartedCount(runtime, stationRunId)).toBe(0);

    // (c) A02 — a client cannot author its own success. Rejected at intake, so it never reaches
    // the admission decision at all.
    expect(() => runtime.recordRequirementObservation(
      stationRunId,
      observation(MONITOR_POWERED, true, "satisfied", stationRunId, { source: "client_supplied" }),
    )).toThrow(/client_supplied/u);
    observed("client-authored-success-refuses", "recordRequirementObservation refused a client_supplied record", "boolean", true);

    // (d) A02 — delayed readiness. The consumers report, and the SAME endpoint now admits: one
    // later transition, not a new phase and not a second START_ENCOUNTER.
    observeAllRuntimeRequirements(runtime, stationRunId);
    runtime.recordRequirementObservation(
      stationRunId,
      observation(LEADS_CONNECTED, false, "satisfied", stationRunId),
    );
    const admitted = await postStartEncounter(app, stationRunId, 60);
    expect(admitted.status).toBe(200);
    observed("ordinary-satisfied-transition-still-succeeds", "POST start-encounter status once every predicate is observed", "httpStatus", admitted.status);
    expect(await admitted.json()).toMatchObject({ phase: "encounter" });
    expect(encounterStartedCount(runtime, stationRunId)).toBe(1);

    const snapshot = runtime.encounterAdmissionSnapshot(stationRunId);
    observed("one-transition-with-actual-domain-time", "encounter.started count and accepted domain second", "count/second", {
      encounterStarted: encounterStartedCount(runtime, stationRunId),
      acceptedAtDomainSecond: snapshot?.acceptedAtDomainSecond,
    });
    observed("observation-bound-to-active-run", "station run id every accepted observation was bound to", "identifier", [
      ...new Set((snapshot?.observedAtAcceptance ?? []).map((entry) => entry.stationRunId)),
    ]);
    // "Empty/missing requirements cannot pass this nonempty case": the count proves three
    // predicates were considered, not that none were declared.
    expect(snapshot?.requirementCount).toBe(3);
    expect(snapshot?.status).toBe("accepted");
    expect(snapshot?.acceptedRequirementIds).toEqual([
      "vitals_monitor_powered",
      "stretcher_support_mounted",
      "monitor_leads_connected",
    ]);
    // A03 — the learner task exists and begins INCOMPLETE. `connected=false` satisfied the
    // initial predicate without completing the goal.
    expect(snapshot?.learnerGoalsIncomplete).toEqual([
      { requirementId: "monitor_leads_connected", observed: false },
    ]);
    observed("learner-goal-remains-incomplete", "learner goals still incomplete at acceptance", "records", snapshot?.learnerGoalsIncomplete);
    observed("initial-disconnected-satisfies-initial-predicate", "observed value of monitor_leads_connected at admission", "boolean", false);
    // A03 — one transition carrying the ACTUAL domain time that was posted.
    expect(snapshot?.acceptedAtDomainSecond).toBe(60);

    // (e) A03 — the accepted snapshot PRECEDES the due-zero effect. Both facts are ledger
    // sequences from the one ledger, so the ordering is observed rather than asserted.
    expect(applied).toEqual([]);
    const tick = runtime.applyScheduledEffects(stationRunId, 0);
    expect(tick.stopped).toBe(false);
    expect(tick.executions.map((execution) => execution.status)).toEqual(["acknowledged"]);
    expect(applied).toEqual([{ eventId: "supine_baseline_vitals", attempt: 1 }]);
    expect(snapshot!.acceptedAtLedgerSequence).toBeLessThan(tick.executions[0]!.ledgerSequence);
    observed("snapshot-precedes-due-zero-effect", "accepted snapshot ledger sequence vs first effect ledger sequence", "sequence", {
      acceptedAtLedgerSequence: snapshot!.acceptedAtLedgerSequence,
      firstEffectLedgerSequence: tick.executions[0]!.ledgerSequence,
    });
    observed("scheduled-effect-acknowledged-by-consumer", "acknowledgment id returned by the effect consumer", "identifier", tick.executions[0]?.acknowledgmentId);
    // The acknowledgment is the consumer's, not a flag the runtime wrote for itself.
    expect(tick.executions[0]?.acknowledgmentId).toBe("ack_supine_baseline_vitals_1");

    // (f) A03 — a repeated tick at the same second applies nothing further.
    expect(runtime.applyScheduledEffects(stationRunId, 0).executions).toEqual([]);
    expect(applied).toHaveLength(1);
    observed("duplicate-tick-does-not-duplicate-effect", "applied effects after two ticks at second 0", "count", applied.length);

    // (g) A03 — no duplicate START_ENCOUNTER through the same endpoint.
    expect((await postStartEncounter(app, stationRunId, 61)).status).toBe(400);
    expect(encounterStartedCount(runtime, stationRunId)).toBe(1);
  });

  it("a required runtime predicate observed PENDING refuses admission through the API route", async () => {
    const { runtime, app } = harness();
    const stationRunId = await startSession(app);
    observeAllRuntimeRequirements(runtime, stationRunId);
    runtime.recordRequirementObservation(stationRunId, observation(MONITOR_POWERED, true, "pending", stationRunId));
    const pending = await postStartEncounter(app, stationRunId);
    observed("required-pending-blocks-admission", "POST start-encounter status, monitor observed pending", "httpStatus", pending.status);
    expect(pending.status).toBe(400);
    expect(encounterStartedCount(runtime, stationRunId)).toBe(0);
  });

  it("a required runtime predicate observed UNKNOWN refuses admission through the API route", async () => {
    const { runtime, app } = harness();
    const stationRunId = await startSession(app);
    observeAllRuntimeRequirements(runtime, stationRunId);
    runtime.recordRequirementObservation(stationRunId, observation(SUPPORT_MOUNTED, true, "unknown", stationRunId));
    const unknown = await postStartEncounter(app, stationRunId);
    observed("direct-api-bypass-refuses", "POST start-encounter status on a direct API call with an unknown predicate", "httpStatus", unknown.status);
    expect(unknown.status).toBe(400);
    expect(encounterStartedCount(runtime, stationRunId)).toBe(0);
  });

  it("a STALE observation refuses even though its outcome says satisfied", async () => {
    const { runtime, app } = harness();
    const stationRunId = await startSession(app);
    observeAllRuntimeRequirements(runtime, stationRunId);
    runtime.recordRequirementObservation(
      stationRunId,
      // One millisecond past the freshness window, so the refusal is the window and not a
      // comfortable margin chosen to make the clause pass.
      observation(MONITOR_POWERED, true, "satisfied", stationRunId, { observedAtMs: NOW_MS - FRESHNESS_MS - 1 }),
    );
    const stale = await postStartEncounter(app, stationRunId);
    observed("stale-observation-refuses", "POST start-encounter status with an observation 1 ms past the freshness window", "httpStatus", stale.status);
    expect(stale.status).toBe(400);

    // Known-good control on the same window: exactly at the boundary it is still fresh, so the
    // refusal above is about age and not about the field being present.
    runtime.recordRequirementObservation(
      stationRunId,
      observation(MONITOR_POWERED, true, "satisfied", stationRunId, { observedAtMs: NOW_MS - FRESHNESS_MS }),
    );
    runtime.recordRequirementObservation(stationRunId, observation(LEADS_CONNECTED, false, "satisfied", stationRunId));
    expect((await postStartEncounter(app, stationRunId)).status).toBe(200);
  });

  it("REPLAYING another session's acknowledgment refuses", async () => {
    const { runtime, app } = harness();
    const firstRun = await startSession(app, "sc02_learner_one");
    observeAllRuntimeRequirements(runtime, firstRun);
    const secondRun = await startSession(app, "sc02_learner_two");
    expect(secondRun).not.toBe(firstRun);

    // The record that admitted the first run, replayed verbatim into the second.
    const replayed = observation(MONITOR_POWERED, true, "satisfied", firstRun);
    expect(() => runtime.recordRequirementObservation(secondRun, replayed)).toThrow(/belongs to run/u);
    observed("replayed-session-acknowledgment-refuses", "runs involved in the replay attempt", "identifier", { recordedFor: firstRun, replayedInto: secondRun });
    observed("wrong-run-observation-refuses", "recordRequirementObservation threw on a foreign run id", "boolean", true);

    // And it does not admit: the second run has no admissible observation of its own.
    expect((await postStartEncounter(app, secondRun)).status).toBe(400);
  });

  it("an observation of a REPLACED instance refuses, and invalidates acceptance after entry", async () => {
    const { runtime, app } = harness();
    const stationRunId = await startSession(app);
    observeAllRuntimeRequirements(runtime, stationRunId);
    runtime.recordRequirementObservation(stationRunId, observation(LEADS_CONNECTED, false, "satisfied", stationRunId));
    expect((await postStartEncounter(app, stationRunId)).status).toBe(200);
    expect(runtime.encounterAdmissionSnapshot(stationRunId)?.status).toBe("accepted");

    // The monitor is swapped for a different instance after entry. acceptance-v2.md: "After
    // acceptance, asset removal/replacement or changed requirements invalidate the acknowledgment
    // and accepted plan; stop/refuse approach until the new state is accepted."
    runtime.recordRequirementObservation(
      stationRunId,
      observation(MONITOR_POWERED, true, "satisfied", stationRunId, { instanceId: "vitals_monitor_equipment#2" }),
    );
    const snapshot = runtime.encounterAdmissionSnapshot(stationRunId);
    expect(snapshot?.status).toBe("invalidated");
    expect(snapshot?.invalidation?.reason).toBe("observation_instance_replaced");
    observed("post-admission-removal-invalidates-acceptance", "snapshot status and invalidation reason after the instance was replaced", "enum", {
      status: snapshot?.status,
      reason: snapshot?.invalidation?.reason,
    });

    // The stop signal SC-05 consumes: no further effect runs.
    const stopped = runtime.applyScheduledEffects(stationRunId, 0);
    expect(stopped.stopped).toBe(true);
    expect(stopped.executions).toEqual([]);
  });

  it("a case revised after the observation refuses (wrong source revision)", async () => {
    const { runtime, app } = harness(scenarioWith({ version: 2 }));
    const stationRunId = await startSession(app);
    // Recorded against revision 1 while the runtime now serves revision 2.
    runtime.recordRequirementObservation(stationRunId, observation(MONITOR_POWERED, true, "satisfied", stationRunId));
    runtime.recordRequirementObservation(stationRunId, observation(SUPPORT_MOUNTED, true, "satisfied", stationRunId));
    expect((await postStartEncounter(app, stationRunId)).status).toBe(400);
  });

  it("a satisfied learner GOAL before start refuses, while an observed initial connected=false succeeds", async () => {
    // The discriminator. Both runs observe the SAME requirement through the SAME consumer; only
    // the observed VALUE differs, so a rule that refused every learner requirement would fail the
    // second half and a rule that refused none would fail the first.
    const refused = harness();
    const refusedRun = await startSession(refused.app);
    observeAllRuntimeRequirements(refused.runtime, refusedRun);
    refused.runtime.recordRequirementObservation(
      refusedRun,
      observation(LEADS_CONNECTED, true, "satisfied", refusedRun),
    );
    const goalAlreadyDone = await postStartEncounter(refused.app, refusedRun);
    observed("satisfied-goal-before-start-refuses", "POST start-encounter status with the learner goal already reached", "httpStatus", goalAlreadyDone.status);
    expect(goalAlreadyDone.status).toBe(400);
    expect(encounterStartedCount(refused.runtime, refusedRun)).toBe(0);

    const admitted = harness();
    const admittedRun = await startSession(admitted.app);
    observeAllRuntimeRequirements(admitted.runtime, admittedRun);
    admitted.runtime.recordRequirementObservation(
      admittedRun,
      observation(LEADS_CONNECTED, false, "satisfied", admittedRun),
    );
    expect((await postStartEncounter(admitted.app, admittedRun)).status).toBe(200);
    expect(admitted.runtime.encounterAdmissionSnapshot(admittedRun)?.learnerGoalsIncomplete).toEqual([
      { requirementId: "monitor_leads_connected", observed: false },
    ]);
  });

  it("a FAILED effect retries without a duplicate successful effect and without resetting the clock", async () => {
    const { runtime, app, applied, failEventIdsOnAttempt } = harness();
    const stationRunId = await startSession(app);
    observeAllRuntimeRequirements(runtime, stationRunId);
    runtime.recordRequirementObservation(stationRunId, observation(LEADS_CONNECTED, false, "satisfied", stationRunId));
    expect((await postStartEncounter(app, stationRunId, 60)).status).toBe(200);
    const acceptedAt = runtime.encounterAdmissionSnapshot(stationRunId)!.acceptedAtDomainSecond;

    failEventIdsOnAttempt.set("supine_baseline_vitals", 1);
    const firstTick = runtime.applyScheduledEffects(stationRunId, 0);
    expect(firstTick.executions.map((execution) => execution.status)).toEqual(["failed"]);
    // The consumer never applied it, so nothing may have been recorded as applied.
    expect(applied).toEqual([]);

    // A later tick RETRIES it: the event was not marked emitted, which is exactly what the old
    // `advanceScheduledEvents` destroyed by adding ids to the emitted set before returning.
    const secondTick = runtime.applyScheduledEffects(stationRunId, 1);
    expect(secondTick.executions.map((execution) => execution.status)).toEqual(["acknowledged"]);
    expect(secondTick.executions[0]?.attempt).toBe(2);
    expect(applied).toEqual([{ eventId: "supine_baseline_vitals", attempt: 2 }]);
    observed("failed-effect-retries-without-loss", "attempt numbers and statuses across the failure and the retry", "records", {
      firstTick: firstTick.executions.map((execution) => ({ attempt: execution.attempt, status: execution.status })),
      secondTick: secondTick.executions.map((execution) => ({ attempt: execution.attempt, status: execution.status })),
      appliedTotal: applied.length,
    });

    // Exactly one successful effect across the whole retry, and no duplicate on a third tick.
    expect(runtime.applyScheduledEffects(stationRunId, 2).executions).toEqual([]);
    expect(applied).toHaveLength(1);
    // The domain clock was not reset by the failure or the retry.
    expect(runtime.encounterAdmissionSnapshot(stationRunId)?.acceptedAtDomainSecond).toBe(acceptedAt);
    expect(encounterStartedCount(runtime, stationRunId)).toBe(1);
  });

  it("no scheduled effect may run before admission", async () => {
    const { runtime, app, applied } = harness();
    const stationRunId = await startSession(app);
    expect(() => runtime.applyScheduledEffects(stationRunId, 0)).toThrow(/no accepted encounter snapshot/u);
    expect(applied).toEqual([]);
  });

  it("REORDERING the assets does not move the monitor's consumer binding", async () => {
    const { buildInitialSceneSpec } = await import("@openclinxr/scenario-runtime");
    const assetNeeds = BASE_SCENARIO.assetNeeds ?? [];
    const forward = buildInitialSceneSpec({
      scenario: { scenarioId: SCENARIO_ID, assetNeeds: [...assetNeeds] },
      presentAssetIds: ["vitals_monitor_equipment", "iv_pole_equipment"],
    });
    const reversed = buildInitialSceneSpec({
      scenario: { scenarioId: SCENARIO_ID, assetNeeds: [...assetNeeds].reverse() },
      presentAssetIds: ["vitals_monitor_equipment", "iv_pole_equipment"],
    });
    const consumerOf = (report: typeof forward, assetId: string): string =>
      report.requiredAssets.find((asset) => asset.assetId === assetId)!.consumer;
    // The two orders are genuinely different, or this clause proves nothing.
    expect(forward.requiredAssets.map((asset) => asset.assetId))
      .not.toEqual(reversed.requiredAssets.map((asset) => asset.assetId));
    for (const assetId of ["vitals_monitor_equipment", "iv_pole_equipment"]) {
      expect(consumerOf(reversed, assetId)).toBe(consumerOf(forward, assetId));
    }
    observed("reordered-monitor-retains-consumer", "monitor consumer binding in forward and reversed asset order", "identifier", {
      forward: consumerOf(forward, "vitals_monitor_equipment"),
      reversed: consumerOf(reversed, "vitals_monitor_equipment"),
    });
    // And the binding is a real consumer name, not an empty string that would pass trivially.
    expect(["spatialState.objectTransforms", "StationRunOptions.doorway"])
      .toContain(consumerOf(forward, "vitals_monitor_equipment"));
  });

  it("the API refusal reaches the UI-XR transport as a rejected call, not a usable session", async () => {
    // The UI half of "prevent API bypass as well as UI entry bypass". `initializeRemoteTraceSession`
    // (apps/ui-xr/src/main.ts) starts a session and then calls startEncounter; before this card it
    // assigned `remoteStationRunId` BEFORE that call, so a refused encounter left the id in place
    // and every later recordRemoteTraceAction posted learner trace against an unadmitted run.
    //
    // NOT TESTED HERE: the assignment order inside main.ts. `apps/ui-xr` is held at an exact,
    // shrink-only composition-root budget (10 files / 6,069 lines), so this card could not add an
    // importable module to that app without raising a ratchet, and did not. What IS tested is the
    // fact the fixed caller depends on: the session start SUCCEEDS and the encounter call then
    // REFUSES, which is precisely the sequence the old code mishandled.
    const { runtime, app } = harness();
    const stationRunId = await startSession(app);
    expect(stationRunId).toBeTruthy();
    const refused = await postStartEncounter(app, stationRunId, 60);
    expect(refused.ok).toBe(false);
    expect(refused.status).toBe(400);
    expect(encounterStartedCount(runtime, stationRunId)).toBe(0);
  });

  it("KNOWN-GOOD: a case with no declared starting requirements still admits ordinarily", async () => {
    // The baseline behaviour every other scenario in the repo depends on. Without this clause the
    // gate could refuse everything and every clause above would still be green.
    const { runtime, app } = harness(scenarioWith({ startingRequirements: [] }));
    const stationRunId = await startSession(app);
    const response = await postStartEncounter(app, stationRunId, 60);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ phase: "encounter" });
    // ...and the snapshot says plainly that NOTHING was required, so a reader cannot mistake this
    // for "everything required was verified".
    expect(runtime.encounterAdmissionSnapshot(stationRunId)?.requirementCount).toBe(0);
  });
});
