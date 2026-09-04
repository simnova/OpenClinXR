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

  it("decodes non-empty UTF-8 unary transcript bytes into a classifier-ready record", () => {
    const text = LEARNER_STT_FIXTURES["fixture:chest-onset"];
    const bytes = new TextEncoder().encode(`  ${text}  `);
    const record = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: bytes,
      isFinal: true,
    });

    expect(record).toMatchObject({
      transcript: text,
      isFinal: true,
      source: "stt",
      eventKindHint: null,
    });
    expect(record.provenance.unintelligible).toBe(false);
    expect(record.provenance.fixtureId).toMatch(/^pcm:unary-utf8:[0-9a-f]{16}$/);
    expect(record.provenance.fixtureId).not.toContain(text);
    expect(record.eventKindHint).not.toBe("learner_clinical_question");
  });

  it("maps invalid UTF-8 unary bytes to learner_unclassified without embedding the payload", () => {
    const invalid = new Uint8Array([0xff, 0xfe, 0xfd]);
    const record = transcribeLearnerAudio({
      ...station,
      pcmOrFixtureId: invalid,
      isFinal: true,
    });

    expect(record.source).toBe("stt");
    expect(record.isFinal).toBe(true);
    expect(record.transcript).toBe("");
    expect(record.eventKindHint).toBe("learner_unclassified");
    expect(record.eventKindHint).not.toBe("learner_clinical_question");
    expect(record.provenance.unintelligible).toBe(true);
    expect(record.provenance.fixtureId).toBe("pcm:unary-invalid-utf8");
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
