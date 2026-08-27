import { describe, expect, it } from "vitest";
import { createStep2CsStyleSeedBlueprint } from "../../../packages/openclinxr/exam-assembly/src/index.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { decideActorRoute } from "../../../packages/openclinxr/session-state/src/internal.js";
import { createDefaultVoiceGateway } from "../../../packages/openclinxr/voice-gateway/src/index.js";
import { MockVoiceProviderAdapter } from "../../../packages/openclinxr/voice-gateway/src/adapters.js";
import { buildBlueprintVoiceSimulationSpikeReport } from "./blueprint-voice-simulation-spike.js";

/**
 * OBSERVABLE: the voice-loop harness calls `gateway.transcribe()`, finds the final transcript, and
 * then routes something else. The inbound seam is decorative.
 *
 * MEASURED 2026-08-27 in `blueprint-voice-simulation-spike.ts`:
 *
 *   :480  inferPrimaryTraceTag(input.learnerUtterance, ...)      trace tag from the CLI string
 *   :632  const finalTranscript = ...find(e => e.eventType === "final_transcript")
 *   :636  routeActorInteractionTurn(..., { learnerUtterance: input.learnerUtterance })
 *
 * The transcript is produced, extracted, and discarded. TWO leaks, not one.
 *
 * `MockVoiceProviderAdapter` compounds it: `adapters.ts:43` yields a hardcoded partial `"When did"`
 * for every stream, so substituting `finalTranscript.text` alone would make the harness's own
 * `--learner-utterance` control inert. The bounded repair is a configurable-but-optional transcript
 * fixture, the gateway's final transcript as the sole downstream utterance, and a fail-closed path
 * when no final transcript exists.
 *
 * THE COUNTERFACTUAL IS REAL, and clause (0) proves it rather than assuming it. Measured through
 * `decideActorRoute` on the ED cast:
 *
 *   "When did the chest pressure start?"                  -> patient_robert_hayes_v1 / single_patient_default
 *   "Maria, please get an ECG and repeat the vitals."      -> nurse_maria_alvarez_v1  / addressed_actor_name
 *   "Anna, can you tell me exactly when his pain started?" -> spouse_anna_hayes_v1    / addressed_actor_name
 *
 * Three strings, three actors. Without that, "the routed utterance differs from the transcript" would
 * be a string comparison rather than an observable product difference.
 *
 * ELEVEN CONSTRUCTION SITES of `new MockVoiceProviderAdapter()` exist, including the default runtime
 * at `default-runtime-factory.ts:50`. Clause (3) is the compatibility net: the no-argument constructor
 * must keep emitting its current two events byte for byte, so the fixture has to be OPTIONAL.
 *
 * claimScope: which utterance the harness routes, and whether the mock's default transcript survives.
 * notEvidenceFor: microphone capture, speech-recognition quality, audible playback, conversation-policy
 *   or model-generated actor dialogue, UI-XR or IWSDK behaviour, or Quest readiness. `reject_measured`
 *   is NOT an honest outcome here: either the routed utterance comes from the transcript or it does not.
 *
 * ## FIXED (#708)
 *
 * Clauses (1) and (2) flipped from `it.fails` to `it` on 2026-08-27, and clause (5) was appended.
 * `MockVoiceProviderAdapter` gained an optional per-instance `transcript` fixture
 * (`{ partialText?, finalText }`); the no-argument constructor still emits its original two events
 * byte for byte (clauses (3)/(4) pin this, and the eleven construction sites including
 * `default-runtime-factory.ts:50` are untouched). The report builder routes the GATEWAY's final
 * transcript as the sole downstream utterance: `buildBlueprintVoiceSimulationSpikeReport` now takes
 * `voiceGateway?` and, when absent, configures the deterministic mock with `input.learnerUtterance`
 * as the fixture finalText, so the CLI `--learner-utterance` control stays live by configuring what
 * the mock transcribes. The trace tag derives from the final transcript text, not the CLI string;
 * `buildRuntimeRoutingEvidence` derives the routed utterance from the transcript internally and
 * throws via `requireFinalTranscript` when no final transcript exists — no CLI fallback anywhere.
 * Clause (5) asserts the observable invariant: same injected provider transcript, two different
 * unused CLI decoys, same selected actor, same routing reason, same trace tag, same synthesized
 * actor — which catches the :480 trace-tag leak as well as the :636 routing leak. The latency
 * field is additive: `firstAudioEventLatencyMs` and `audiblePlaybackObserved: false` publish beside
 * the legacy `firstAudiblePlaybackLatencyMs`, which is now `null` (provider provenance latency is
 * not an audible-playback measurement).
 */

const PROVIDER_FINAL = "When did the chest pressure start?";
const MARIA_DECOY = "Maria, please get an ECG and repeat the vitals.";
const ANNA_DECOY = "Anna, can you tell me exactly when his pain started?";

/** The ED cast, shaped as `decideActorRoute` reads it. Only the fields it inspects are populated. */
const ACTORS = [
  { actorId: "patient_robert_hayes_v1", displayName: "Robert Hayes", role: "patient", conversationTurn: 0 },
  { actorId: "nurse_maria_alvarez_v1", displayName: "Maria Alvarez", role: "nurse", conversationTurn: 0 },
  { actorId: "spouse_anna_hayes_v1", displayName: "Anna Hayes", role: "family", conversationTurn: 0 },
] as never;

const routeOf = (utterance: string) => {
  const d = decideActorRoute(ACTORS, utterance) as unknown as { actor: { actorId: string }; reason: string };
  return { actorId: d.actor.actorId, reason: d.reason };
};

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const SPEECH_INPUT = {
  stationRunId: "blueprint_voice_simulation_mock_run_001",
  streamId: "learner-mic-mock-001",
  language: "en-US",
  audioFormat: "mock/pcm",
  policy: { requestPolicyId: "test-policy-v1", safetyPolicyVersion: "clinical-simulation-safety-v1" },
} as never;

describe("the blueprint voice loop routes the transcript it received", () => {
  it("(0) COUNTERWEIGHT: the transcript and both decoys independently select three different actors", () => {
    const provider = routeOf(PROVIDER_FINAL);
    const maria = routeOf(MARIA_DECOY);
    const anna = routeOf(ANNA_DECOY);
    expect(provider).toEqual({ actorId: "patient_robert_hayes_v1", reason: "single_patient_default" });
    expect(maria).toEqual({ actorId: "nurse_maria_alvarez_v1", reason: "addressed_actor_name" });
    expect(anna).toEqual({ actorId: "spouse_anna_hayes_v1", reason: "addressed_actor_name" });
    expect(
      new Set([provider.actorId, maria.actorId, anna.actorId]).size,
      "if these ever collapse to one actor the counterfactual is gone and clauses (1) and (2) would "
        + "pass without discriminating anything",
    ).toBe(3);
  });

  it("(1) the mock adapter accepts a transcript fixture so the harness's own control is not inert", async () => {
    const Ctor = MockVoiceProviderAdapter as unknown as new (o?: unknown) => {
      transcribe(i: unknown): AsyncIterable<{ eventType: string; text: string }>;
    };
    const adapter = new Ctor({ transcript: { partialText: "Maria,", finalText: MARIA_DECOY } });
    const events = await collect(adapter.transcribe(SPEECH_INPUT));
    const final = events.find((e) => e.eventType === "final_transcript");
    expect(
      final?.text,
      "adapters.ts:43 yields a hardcoded partial for every stream, so routing finalTranscript.text "
        + "without a configurable fixture makes --learner-utterance decoration",
    ).toBe(MARIA_DECOY);
  });

  it("(2) a fixture transcript routes to ITS actor, not to the default", async () => {
    const Ctor = MockVoiceProviderAdapter as unknown as new (o?: unknown) => {
      transcribe(i: unknown): AsyncIterable<{ eventType: string; text: string }>;
    };
    const adapter = new Ctor({ transcript: { partialText: "Anna,", finalText: ANNA_DECOY } });
    const events = await collect(adapter.transcribe(SPEECH_INPUT));
    const final = events.find((e) => e.eventType === "final_transcript");
    expect(final?.text, "no final transcript to route").toBeTruthy();
    expect(
      routeOf(String(final?.text)),
      "the whole point of the repair: what the provider transcribed is what gets routed",
    ).toEqual({ actorId: "spouse_anna_hayes_v1", reason: "addressed_actor_name" });
  });

  it("(3) COUNTERWEIGHT: the no-argument constructor still emits its current two events", async () => {
    const adapter = new MockVoiceProviderAdapter();
    const events = await collect(adapter.transcribe(SPEECH_INPUT) as never) as Array<{ eventType: string; text: string; confidence: number; atMs: number }>;
    expect(
      events.map((e) => e.eventType),
      "eleven construction sites use the no-argument form, including default-runtime-factory.ts:50; "
        + "the fixture must be OPTIONAL",
    ).toEqual(["partial_transcript", "final_transcript"]);
    expect(events[0]?.text, "the shipped partial").toBe("When did");
    expect(events[0]?.confidence).toBe(0.75);
    expect(events[0]?.atMs).toBe(120);
  });

  it("(4) COUNTERWEIGHT: the fixture cannot silently become the default", async () => {
    const a = await collect(new MockVoiceProviderAdapter().transcribe(SPEECH_INPUT) as never) as Array<{ text: string }>;
    const b = await collect(new MockVoiceProviderAdapter().transcribe(SPEECH_INPUT) as never) as Array<{ text: string }>;
    expect(
      a.map((e) => e.text),
      "two no-argument instances must agree; a fixture leaking into shared state would make the "
        + "default depend on construction order across the eleven sites",
    ).toEqual(b.map((e) => e.text));
  });

  it("(5) the report builder routes the GATEWAY's final transcript, never the unused CLI decoy", async () => {
    const gateway = createDefaultVoiceGateway({
      routeId: "blueprint-voice-simulation-spike-v1",
      adapters: [new MockVoiceProviderAdapter({ transcript: { partialText: "When did", finalText: PROVIDER_FINAL } })],
    });
    const reportFor = (decoy: string) => buildBlueprintVoiceSimulationSpikeReport({
      generatedAt: "2026-08-27T00:00:00.000Z",
      blueprint: createStep2CsStyleSeedBlueprint(scenarioBank),
      scenarios: scenarioBank,
      scenarioId: "ed_chest_pain_priority_v1",
      learnerUtterance: decoy,
      atSecond: 135,
      voiceGateway: gateway,
    });

    const withMariaDecoy = await reportFor(MARIA_DECOY);
    const withAnnaDecoy = await reportFor(ANNA_DECOY);

    // The provider transcript selects the patient no matter which decoy the CLI would have routed.
    expect(withMariaDecoy.mockLoop.selectedActorId).toBe("patient_robert_hayes_v1");
    expect(withMariaDecoy.mockLoop.routingReason).toBe("single_patient_default");
    expect(withAnnaDecoy.mockLoop.selectedActorId).toBe("patient_robert_hayes_v1");
    expect(withAnnaDecoy.mockLoop.routingReason).toBe("single_patient_default");
    expect(withMariaDecoy.runtimeRouting.selectedActorId).toBe("patient_robert_hayes_v1");
    expect(withMariaDecoy.runtimeRouting.routingReason).toBe("single_patient_default");
    expect(withAnnaDecoy.runtimeRouting.selectedActorId).toBe("patient_robert_hayes_v1");
    expect(withAnnaDecoy.runtimeRouting.routingReason).toBe("single_patient_default");

    // The trace tag derives from the transcript text ("When did the chest pressure start?" matches no
    // prioritized term, so it falls back to the scenario's first required trace tag), not from the decoy.
    const expectedTraceTag = "history_opqrst";
    expect(withMariaDecoy.mockLoop.traceEvents.map((event) => event.tag)).toEqual([expectedTraceTag, expectedTraceTag]);
    expect(withAnnaDecoy.mockLoop.traceEvents.map((event) => event.tag)).toEqual([expectedTraceTag, expectedTraceTag]);
    const projectedTag = (report: Awaited<ReturnType<typeof buildBlueprintVoiceSimulationSpikeReport>>) =>
      report.runtimeRouting.traceProjection.events.find((event) => event.eventType === "actor.interaction.routed")?.tag;
    expect(projectedTag(withMariaDecoy)).toBe(expectedTraceTag);
    expect(projectedTag(withAnnaDecoy)).toBe(expectedTraceTag);

    // The decoys are unused: they must not appear anywhere in either report.
    const serializedMaria = JSON.stringify(withMariaDecoy);
    const serializedAnna = JSON.stringify(withAnnaDecoy);
    expect(serializedMaria).not.toContain(MARIA_DECOY);
    expect(serializedMaria).not.toContain(ANNA_DECOY);
    expect(serializedAnna).not.toContain(MARIA_DECOY);
    expect(serializedAnna).not.toContain(ANNA_DECOY);
  });
});

// NOT TESTED: that the report builder routes the transcript. That needs the `voiceGateway?` seam this
// card adds, and asserting it here would test a signature that does not exist yet. Clauses (1) and (2)
// pin the adapter half, which is what makes the report-side repair possible at all.
// SUPERSEDED (#708): clause (5) now exercises the report builder with an injected `voiceGateway?` and
// asserts the observable invariant, so this residual is covered.
