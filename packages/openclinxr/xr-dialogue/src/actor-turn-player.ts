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
  baker: "rhubarb" | "mfa-baked";
  mouthCues: NonNullable<MouthCuesDocument["mouthCues"]>;
  /** Bundle content hash over (spokenTextForTts, voiceId, aligner, cue-map); MADR 0062 decision 2. */
  contentHash?: string;
};

/**
 * ARPABET phone -> player phoneme intake for baker "mfa-baked".
 *
 * Provenance: value table copied from ARPABET_TO_OVR in viseme-cue-track.ts
 * (same commit); the player keeps its own copy so the cue-track module stays
 * out of this module's import closure. A test pins the two texts in sync.
 * Baked values are ARPABET phones (stress digits tolerated, stripped like
 * mapArpabetTrack); unknown values fall back to "sil", the same convention
 * as the Rhubarb shape path in mouthCuesToPhonemeCues.
 */
const MFA_BAKED_ARPABET_TO_PHONEME: Readonly<Record<string, string>> = {
  SIL: "sil", SP: "sil", SPN: "sil",
  P: "PP", B: "PP", M: "PP",
  F: "FF", V: "FF",
  TH: "TH", DH: "TH",
  T: "DD", D: "DD",
  K: "kk", G: "kk", NG: "kk",
  CH: "CH", JH: "CH", SH: "CH", ZH: "CH",
  S: "SS", Z: "SS",
  N: "nn", L: "nn",
  R: "RR", ER: "RR",
  AA: "aa", AE: "aa", AH: "aa", AW: "aa", AY: "aa", HH: "aa",
  EH: "E", EY: "E",
  IH: "I", IY: "I", Y: "I",
  AO: "O", OW: "O", OY: "O",
  UH: "U", UW: "U", W: "U",
};

function mfaBakedMouthCuesToPhonemeCues(doc: MouthCuesDocument): PhonemeCue[] {
  const cues = doc?.mouthCues ?? [];
  const out: PhonemeCue[] = [];
  for (const cue of cues) {
    const start = Number(cue?.start);
    const end = Number(cue?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const key = String(cue?.value ?? "").trim().toUpperCase().replace(/[0-2]$/u, "");
    out.push({
      phoneme: MFA_BAKED_ARPABET_TO_PHONEME[key] ?? "sil",
      atSecond: Math.max(0, Number(start.toFixed(4))),
      durationSeconds: Math.max(0, Number((end - start).toFixed(4))),
    });
  }
  return out;
}

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
  viseme: { startedAtMs: number; baker: "rhubarb" | "mfa-baked"; cues: readonly PhonemeCue[] };
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
  if (artifacts.visemeCues?.baker !== "rhubarb" && artifacts.visemeCues?.baker !== "mfa-baked") {
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

  const cues = artifacts.visemeCues.baker === "mfa-baked"
    ? mfaBakedMouthCuesToPhonemeCues({ mouthCues: artifacts.visemeCues.mouthCues })
    : mouthCuesToPhonemeCues({ mouthCues: artifacts.visemeCues.mouthCues });
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
      baker: artifacts.visemeCues.baker,
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
