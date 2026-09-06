/**
 * Learner-visible playback of one frozen ActorTurnPlan bound to its execution
 * artifacts as a single identity. Audio start, Rhubarb viseme cues, gaze
 * target, and emotion transitions must share actorId, turnId, and plan digest.
 * Missing or mismatched artifacts yield an explicit blocked state. Never falls
 * back to per-letter mouth animation.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: Quest readiness, live speech provider, clinical affect.
 */

import type { ActorTurnPlan, DialogueEmotion } from "@openclinxr/shared-schemas";
import { mouthCuesToPhonemeCues, type MouthCuesDocument } from "./viseme-baked-cues.js";
import type { PhonemeCue } from "./viseme-timeline-drive.js";
import { sha1Hex } from "./viseme-utterance-hash.js";

export const ACTOR_TURN_PLAYER_SEAM = "playIdentityBoundActorTurn";

export type ActorTurnPlanIdentity = Pick<
  ActorTurnPlan,
  | "planId"
  | "planVersion"
  | "actorId"
  | "turnId"
  | "spokenText"
  | "dialogueEmotionFrom"
  | "dialogueEmotionTo"
>;

export type IdentityBoundRef = {
  actorId: string;
  turnId: string;
  planDigest: string;
};

export type SynthesizedAudioArtifact = IdentityBoundRef & {
  audioUri: string;
  durationMs: number;
};

export type RhubarbVisemeCueArtifact = IdentityBoundRef & {
  baker: "rhubarb";
  mouthCues: NonNullable<MouthCuesDocument["mouthCues"]>;
};

export type GazeTargetKind = "learner_camera" | "actor";

export type GazeTargetArtifact = IdentityBoundRef & {
  gazeTargetKind: GazeTargetKind;
  gazeTargetActorId: string | null;
};

export type EmotionTransitionArtifact = IdentityBoundRef & {
  from: DialogueEmotion;
  to: DialogueEmotion;
};

export type ActorTurnExecutionArtifacts = {
  audio?: SynthesizedAudioArtifact | null;
  visemeCues?: RhubarbVisemeCueArtifact | null;
  gaze?: GazeTargetArtifact | null;
  emotion?: EmotionTransitionArtifact | null;
};

export type ActorTurnPlayerBlockReason =
  | "missing_audio"
  | "missing_viseme_cues"
  | "missing_gaze"
  | "missing_emotion"
  | "empty_viseme_cues"
  | "identity_mismatch"
  | "adapter_missing"
  | "adapter_failed"
  | "adapter_threw";

export type ActorTurnPlayerAdapterContext = IdentityBoundRef & {
  timelineOriginMs: number;
  audio: SynthesizedAudioArtifact;
  visemeCues: RhubarbVisemeCueArtifact;
  visemePhonemeCues: readonly PhonemeCue[];
  gaze: GazeTargetArtifact;
  emotion: EmotionTransitionArtifact;
};

export type ActorTurnPlayerAdapter = (ctx: ActorTurnPlayerAdapterContext) => boolean;

export type ActorTurnPlayerAdapters = {
  startAudio?: ActorTurnPlayerAdapter;
  startViseme?: ActorTurnPlayerAdapter;
  startGaze?: ActorTurnPlayerAdapter;
  startEmotion?: ActorTurnPlayerAdapter;
};

export type ActorTurnArtifactName = "audio" | "visemeCues" | "gaze" | "emotion";

export type ActorTurnIdentityField = "actorId" | "turnId" | "planDigest";

const NOT_EVIDENCE_FOR = [
  "quest_readiness",
  "live_speech_provider",
  "clinical_affect_inference",
] as const;

export type BlockedActorTurnPlayback = {
  status: "blocked";
  seam: typeof ACTOR_TURN_PLAYER_SEAM;
  reason: ActorTurnPlayerBlockReason;
  mismatchedField?: ActorTurnIdentityField;
  mismatchedArtifact?: ActorTurnArtifactName;
  fallbackToPerLetterVisemes: false;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

export type PlayingActorTurnPlayback = {
  status: "playing";
  seam: typeof ACTOR_TURN_PLAYER_SEAM;
  actorId: string;
  turnId: string;
  planId: string;
  planDigest: string;
  spokenText: string;
  timelineOriginMs: number;
  audio: { startedAtMs: number; audioUri: string; durationMs: number };
  viseme: { startedAtMs: number; baker: "rhubarb"; cues: readonly PhonemeCue[] };
  gaze: {
    startedAtMs: number;
    gazeTargetKind: GazeTargetKind;
    gazeTargetActorId: string | null;
  };
  emotion: { startedAtMs: number; from: DialogueEmotion; to: DialogueEmotion };
  fallbackToPerLetterVisemes: false;
  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};

export type ActorTurnPlayerResult = PlayingActorTurnPlayback | BlockedActorTurnPlayback;

export function digestActorTurnPlan(plan: ActorTurnPlanIdentity): string {
  const canonical = [
    plan.planId,
    String(plan.planVersion),
    plan.actorId,
    plan.turnId,
    plan.spokenText,
    plan.dialogueEmotionFrom,
    plan.dialogueEmotionTo,
  ].join("\n");
  return sha1Hex(canonical).slice(0, 16);
}

export function playIdentityBoundActorTurn(
  plan: ActorTurnPlan,
  artifacts: ActorTurnExecutionArtifacts,
  options: { nowMs?: number; adapters?: ActorTurnPlayerAdapters } = {},
): ActorTurnPlayerResult {
  const planDigest = digestActorTurnPlan(plan);
  const expected: IdentityBoundRef = {
    actorId: plan.actorId,
    turnId: plan.turnId,
    planDigest,
  };

  if (!artifacts.audio) {
    return blocked("missing_audio");
  }
  if (artifacts.visemeCues?.baker !== "rhubarb") {
    return blocked("missing_viseme_cues");
  }
  if (!artifacts.gaze) {
    return blocked("missing_gaze");
  }
  if (!artifacts.emotion) {
    return blocked("missing_emotion");
  }

  const identityChecks: Array<[ActorTurnArtifactName, IdentityBoundRef]> = [
    ["audio", artifacts.audio],
    ["visemeCues", artifacts.visemeCues],
    ["gaze", artifacts.gaze],
    ["emotion", artifacts.emotion],
  ];
  for (const [name, artifact] of identityChecks) {
    const mismatch = identityMismatch(expected, name, artifact);
    if (mismatch) {
      return mismatch;
    }
  }

  const cues = mouthCuesToPhonemeCues({ mouthCues: artifacts.visemeCues.mouthCues });
  if (cues.length === 0) {
    return blocked("empty_viseme_cues");
  }

  const startAudio = options.adapters?.startAudio;
  const startViseme = options.adapters?.startViseme;
  const startGaze = options.adapters?.startGaze;
  const startEmotion = options.adapters?.startEmotion;
  if (!startAudio) {
    return blocked("adapter_missing", { mismatchedArtifact: "audio" });
  }
  if (!startViseme) {
    return blocked("adapter_missing", { mismatchedArtifact: "visemeCues" });
  }
  if (!startGaze) {
    return blocked("adapter_missing", { mismatchedArtifact: "gaze" });
  }
  if (!startEmotion) {
    return blocked("adapter_missing", { mismatchedArtifact: "emotion" });
  }

  const timelineOriginMs = options.nowMs ?? 0;
  const ctx: ActorTurnPlayerAdapterContext = {
    actorId: plan.actorId,
    turnId: plan.turnId,
    planDigest,
    timelineOriginMs,
    audio: artifacts.audio,
    visemeCues: artifacts.visemeCues,
    visemePhonemeCues: cues,
    gaze: artifacts.gaze,
    emotion: artifacts.emotion,
  };

  const invoked: Array<[ActorTurnArtifactName, ActorTurnPlayerAdapter]> = [
    ["audio", startAudio],
    ["visemeCues", startViseme],
    ["gaze", startGaze],
    ["emotion", startEmotion],
  ];
  let threw: ActorTurnArtifactName | undefined;
  let failed: ActorTurnArtifactName | undefined;
  for (const [name, adapter] of invoked) {
    try {
      if (adapter(ctx) !== true) {
        failed ??= name;
      }
    } catch {
      threw ??= name;
    }
  }
  if (threw) {
    return blocked("adapter_threw", { mismatchedArtifact: threw });
  }
  if (failed) {
    return blocked("adapter_failed", { mismatchedArtifact: failed });
  }

  const result: PlayingActorTurnPlayback = {
    status: "playing",
    seam: ACTOR_TURN_PLAYER_SEAM,
    actorId: plan.actorId,
    turnId: plan.turnId,
    planId: plan.planId,
    planDigest,
    spokenText: plan.spokenText,
    timelineOriginMs,
    audio: {
      startedAtMs: timelineOriginMs,
      audioUri: artifacts.audio.audioUri,
      durationMs: artifacts.audio.durationMs,
    },
    viseme: {
      startedAtMs: timelineOriginMs,
      baker: "rhubarb",
      cues,
    },
    gaze: {
      startedAtMs: timelineOriginMs,
      gazeTargetKind: artifacts.gaze.gazeTargetKind,
      gazeTargetActorId: artifacts.gaze.gazeTargetActorId,
    },
    emotion: {
      startedAtMs: timelineOriginMs,
      from: artifacts.emotion.from,
      to: artifacts.emotion.to,
    },
    fallbackToPerLetterVisemes: false,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...NOT_EVIDENCE_FOR, ...plan.notEvidenceFor],
  };
  publishActorTurnPlayer(result);
  return result;
}

function identityMismatch(
  expected: IdentityBoundRef,
  artifact: ActorTurnArtifactName,
  actual: IdentityBoundRef,
): BlockedActorTurnPlayback | null {
  if (actual.actorId !== expected.actorId) {
    return blocked("identity_mismatch", { mismatchedField: "actorId", mismatchedArtifact: artifact });
  }
  if (actual.turnId !== expected.turnId) {
    return blocked("identity_mismatch", { mismatchedField: "turnId", mismatchedArtifact: artifact });
  }
  if (actual.planDigest !== expected.planDigest) {
    return blocked("identity_mismatch", { mismatchedField: "planDigest", mismatchedArtifact: artifact });
  }
  return null;
}

function blocked(
  reason: ActorTurnPlayerBlockReason,
  extra: {
    mismatchedField?: ActorTurnIdentityField;
    mismatchedArtifact?: ActorTurnArtifactName;
  } = {},
): BlockedActorTurnPlayback {
  const result: BlockedActorTurnPlayback = {
    status: "blocked",
    seam: ACTOR_TURN_PLAYER_SEAM,
    reason,
    fallbackToPerLetterVisemes: false,
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
    ...extra,
  };
  publishActorTurnPlayer(result);
  return result;
}

function publishActorTurnPlayer(result: ActorTurnPlayerResult): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__openClinXrActorTurnPlayer = result;
}

declare global {
  interface Window {
    __openClinXrActorTurnPlayer?: ActorTurnPlayerResult;
  }
}
