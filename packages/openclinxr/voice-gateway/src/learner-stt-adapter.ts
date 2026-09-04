/**
 * Fixture/unary learner STT adapter (DVA-8 analogue, voice-gateway only).
 *
 * Turns a fixture id or unary PCM bytes into a classifier-ready transcript
 * record. Unknown/empty final audio maps to `learner_unclassified`; barge-in
 * maps to `learner_interruption` regardless of text. The adapter never emits
 * `learner_clinical_question` as a default.
 *
 * Live Grok STT / WER is out of scope. Production STT still records
 * `stt_medical_vocabulary_wer_evidence_missing` on the gateway gate.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness, HIPAA certification
 */

export type LearnerSttEventKindHint = "learner_interruption" | "learner_unclassified";

export type LearnerSttInput = {
  stationRunId: string;
  streamId: string;
  pcmOrFixtureId: string | Uint8Array;
  isFinal: boolean;
  bargeIn?: boolean;
};

export type LearnerSttProvenance = {
  adapterId: "learner-stt-adapter";
  profile: "local-fixture";
  fixtureId: string;
  unintelligible: boolean;
};

export type LearnerSttRecord = {
  transcript: string;
  isFinal: boolean;
  source: "stt";
  eventKindHint: LearnerSttEventKindHint | null;
  stationRunId: string;
  streamId: string;
  provenance: LearnerSttProvenance;
};

/** Deterministic fixture catalog. Two utterances for skeptic-visible dual transcripts. */
export const LEARNER_STT_FIXTURES = {
  "fixture:chest-onset": "When did the chest pressure start?",
  "fixture:walking-upstairs": "It started while I was walking upstairs.",
  "fixture:silence": "",
  "fixture:unintelligible": "",
} as const;

export type LearnerSttFixtureId = keyof typeof LEARNER_STT_FIXTURES;

const UNINTELLIGIBLE_FIXTURE_IDS = new Set<string>(["fixture:unintelligible"]);

export function transcribeLearnerAudio(input: LearnerSttInput): LearnerSttRecord {
  const resolved = resolveTranscript(input.pcmOrFixtureId);
  const emptyOrUnintelligible = resolved.unintelligible || resolved.transcript.trim().length === 0;

  let eventKindHint: LearnerSttEventKindHint | null = null;
  if (input.bargeIn === true) {
    eventKindHint = "learner_interruption";
  } else if (input.isFinal && emptyOrUnintelligible) {
    eventKindHint = "learner_unclassified";
  }

  return {
    transcript: resolved.transcript,
    isFinal: input.isFinal,
    source: "stt",
    eventKindHint,
    stationRunId: input.stationRunId,
    streamId: input.streamId,
    provenance: {
      adapterId: "learner-stt-adapter",
      profile: "local-fixture",
      fixtureId: resolved.fixtureId,
      unintelligible: emptyOrUnintelligible,
    },
  };
}

function resolveTranscript(pcmOrFixtureId: string | Uint8Array): {
  transcript: string;
  fixtureId: string;
  unintelligible: boolean;
} {
  if (pcmOrFixtureId instanceof Uint8Array) {
    if (pcmOrFixtureId.byteLength === 0) {
      return { transcript: "", fixtureId: "pcm:empty", unintelligible: true };
    }
    return { transcript: "", fixtureId: "pcm:unary-unmapped", unintelligible: true };
  }

  const fixtureId = pcmOrFixtureId.trim();
  if (fixtureId.length === 0) {
    return { transcript: "", fixtureId: "fixture:empty", unintelligible: true };
  }

  if (fixtureId in LEARNER_STT_FIXTURES) {
    const transcript = LEARNER_STT_FIXTURES[fixtureId as LearnerSttFixtureId];
    return {
      transcript,
      fixtureId,
      unintelligible: UNINTELLIGIBLE_FIXTURE_IDS.has(fixtureId) || transcript.trim().length === 0,
    };
  }

  return { transcript: "", fixtureId, unintelligible: true };
}
