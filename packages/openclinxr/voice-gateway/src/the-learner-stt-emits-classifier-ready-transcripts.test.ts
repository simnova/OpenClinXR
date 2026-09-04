import { describe, expect, it } from "vitest";
import { createDefaultVoiceGateway, createRealtimeVoiceGatewayPosture, MockVoiceProviderAdapter } from "./index.js";
import { LEARNER_STT_FIXTURES, transcribeLearnerAudio } from "./learner-stt-adapter.js";

const station = {
  stationRunId: "run_learner_stt_001",
  streamId: "learner-mic-001",
};

describe("learner STT adapter emits classifier-ready transcripts", () => {
  it("emits two fixture utterances as two stt records without a clinical-question default", () => {
    const first = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:chest-onset",
      isFinal: true,
    });
    const second = transcribeLearnerAudio({
      ...station,
      streamId: "learner-mic-002",
      pcmOrFixtureId: "fixture:walking-upstairs",
      isFinal: true,
    });

    expect(first).toMatchObject({
      transcript: LEARNER_STT_FIXTURES["fixture:chest-onset"],
      isFinal: true,
      source: "stt",
      eventKindHint: null,
    });
    expect(second).toMatchObject({
      transcript: LEARNER_STT_FIXTURES["fixture:walking-upstairs"],
      isFinal: true,
      source: "stt",
      eventKindHint: null,
    });
    expect(first.transcript).not.toBe(second.transcript);
    expect([first.eventKindHint, second.eventKindHint]).not.toContain("learner_clinical_question");
  });

  it("maps empty and unintelligible finals to learner_unclassified with provenance", () => {
    const silence = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:silence",
      isFinal: true,
    });
    const emptyBytes = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: new Uint8Array(0),
      isFinal: true,
    });
    const unknown = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:not-in-catalog",
      isFinal: true,
    });

    for (const record of [silence, emptyBytes, unknown]) {
      expect(record.source).toBe("stt");
      expect(record.isFinal).toBe(true);
      expect(record.eventKindHint).toBe("learner_unclassified");
      expect(record.eventKindHint).not.toBe("learner_clinical_question");
      expect(record.transcript.trim()).toBe("");
      expect(record.provenance.adapterId).toBe("learner-stt-adapter");
      expect(record.provenance.profile).toBe("local-fixture");
      expect(record.provenance.fixtureId.length).toBeGreaterThan(0);
      expect(record.provenance.unintelligible).toBe(true);
    }
  });

  it("does not classify empty partial audio as learner_unclassified", () => {
    const partial = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:chest-onset",
      isFinal: false,
    });
    const emptyPartial = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:silence",
      isFinal: false,
    });

    expect(partial).toMatchObject({
      transcript: LEARNER_STT_FIXTURES["fixture:chest-onset"],
      isFinal: false,
      source: "stt",
      eventKindHint: null,
    });
    expect(emptyPartial.eventKindHint).toBeNull();
    expect(emptyPartial.isFinal).toBe(false);
  });

  it("maps barge-in to learner_interruption regardless of transcript text", () => {
    const withText = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:chest-onset",
      isFinal: true,
      bargeIn: true,
    });
    const withSilence = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:silence",
      isFinal: true,
      bargeIn: true,
    });

    expect(withText.eventKindHint).toBe("learner_interruption");
    expect(withSilence.eventKindHint).toBe("learner_interruption");
    expect(withText.transcript).toBe(LEARNER_STT_FIXTURES["fixture:chest-onset"]);
    expect(withText.eventKindHint).not.toBe("learner_unclassified");
  });

  it("registers transcribeLearnerAudio on the gateway without network or cloud credentials", () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [new MockVoiceProviderAdapter()],
      routeId: "voice-offline-v1",
    });

    const record = gateway.transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: "fixture:chest-onset",
      isFinal: true,
    });
    expect(record.source).toBe("stt");
    expect(record.provenance.profile).toBe("local-fixture");

    const local = createRealtimeVoiceGatewayPosture({
      providerProfile: "local-development",
      bunAvailable: true,
      pythonBackendDependenciesInstalled: false,
      pythonInferenceRuntimeInstalled: false,
    });
    const localStt = local.providerGates.find((gate) => gate.gateId === "stt");
    expect(localStt?.blockers).not.toContain("voice_provider_credentials_missing");
    expect(localStt?.blockers).not.toContain("cloud_voice_provider_approval_missing");
    expect(localStt?.credentialEvidencePresent).toBe(false);

    const production = createRealtimeVoiceGatewayPosture({
      providerProfile: "production",
      bunAvailable: true,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: true,
    });
    const productionStt = production.providerGates.find((gate) => gate.gateId === "stt");
    expect(productionStt?.blockers).toEqual(
      expect.arrayContaining([
        "stt_medical_vocabulary_wer_evidence_missing",
        "voice_provider_credentials_missing",
        "cloud_voice_provider_approval_missing",
      ]),
    );
  });
});
