/**
 * Fixture/unary learner STT adapter (DVA-8 analogue, voice-gateway only).
 *
 * Turns a fixture id or unary UTF-8 transcript bytes into a classifier-ready
 * record. Empty/invalid-UTF-8 finals map to `learner_unclassified`; barge-in
 * maps to `learner_interruption` regardless of text. The adapter never emits
 * `learner_clinical_question` as a default. Unary provenance is a byte digest,
 * never the transcript text.
 *
 * Live Grok STT / WER is out of scope. Production STT still records
 * `stt_medical_vocabulary_wer_evidence_missing` on the gateway gate.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness, HIPAA certification
 */
import { createHash } from "node:crypto";

export type LearnerSttEventKindHint = "learner_interruption" | "learner_unclassified";

export type LearnerSttInput = {
  stationRunId: string;
  streamId: string;
  pcmOrFixtureId: string | Uint8Array;
  isFinal: boolean;
  bargeIn?: boolean;
  /** Canonical turn-clock ms for a barge-in. Omitted barge-in uses 0. */
  atMs?: number;
  turnId?: string;
  interruptionId?: string;
};

export type LearnerSttInterruption = {
  interruptionId: string;
  turnId: string | null;
  clockMs: number;
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
  interruption: LearnerSttInterruption | null;
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
  let interruption: LearnerSttInterruption | null = null;
  if (input.bargeIn === true) {
    eventKindHint = "learner_interruption";
    interruption = mintLearnerSttInterruption(input);
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
    interruption,
  };
}

function mintLearnerSttInterruption(input: LearnerSttInput): LearnerSttInterruption {
  const clockMs = typeof input.atMs === "number" && Number.isFinite(input.atMs)
    ? Math.max(0, Math.trunc(input.atMs))
    : 0;
  const turnId = input.turnId?.trim() ? input.turnId.trim() : null;
  const interruptionId = input.interruptionId?.trim()
    ? input.interruptionId.trim()
    : `${input.stationRunId}:${turnId ?? input.streamId}:${clockMs}:learner_barge_in`;
  return { interruptionId, turnId, clockMs };
}

function resolveTranscript(pcmOrFixtureId: string | Uint8Array): {
  transcript: string;
  fixtureId: string;
  unintelligible: boolean;
} {
  if (pcmOrFixtureId instanceof Uint8Array) {
    return resolveUnaryTranscriptBytes(pcmOrFixtureId);
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

function resolveUnaryTranscriptBytes(bytes: Uint8Array): {
  transcript: string;
  fixtureId: string;
  unintelligible: boolean;
} {
  if (bytes.byteLength === 0) {
    return { transcript: "", fixtureId: "pcm:empty", unintelligible: true };
  }

  try {
    const transcript = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    return {
      transcript,
      fixtureId: unaryUtf8ProvenanceId(bytes),
      unintelligible: transcript.length === 0,
    };
  } catch {
    return { transcript: "", fixtureId: "pcm:unary-invalid-utf8", unintelligible: true };
  }
}

/** SHA-256 prefix of the raw bytes. Does not embed transcript text. */
function unaryUtf8ProvenanceId(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `pcm:unary-utf8:${digest}`;
}
