import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
/** Portable producer evidence, never an independent voice-approval grant. */
export type RuntimeActorAudioEvidence = {
  version: 1;
  scenarioId: string;
  traceTag: string;
  actorId: string;
  spokenText: string;
  planId: string;
  planVersion: number;
  turnId: string;
  planDigest: string;
  plan: ActorTurnPlan;
  execution: ActorTurnExecution | null;
  voiceId: string;
  approvalId: string;
  waveformUri: string;
  waveformSha256: string;
  waveformByteLength: number;
  cueUri: string;
  cueSha256: string;
  cueByteLength: number;
  bakeWaveformSha256: string;
  nativeSampleRate: number;
  nativeSampleCount: number;
  artifacts: {
    audio?: ({ actorId: string; turnId: string; planDigest: string; audioUri: string; durationMs: number }) | null;
    visemeCues?: ({ actorId: string; turnId: string; planDigest: string; baker: "rhubarb"; mouthCues: Array<{ start: number; end: number; value: string }> }) | null;
    gaze?: ({ actorId: string; turnId: string; planDigest: string; gazeTargetKind: "learner_camera" | "actor"; gazeTargetActorId: string | null }) | null;
    emotion?: ({ actorId: string; turnId: string; planDigest: string; from: ActorTurnPlan["dialogueEmotionFrom"]; to: ActorTurnPlan["dialogueEmotionTo"] }) | null;
  };
};
