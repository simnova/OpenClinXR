import type { ActorTurnExecution, ActorTurnPlan } from "@openclinxr/shared-schemas";
import type { LearnerRuntimeAssetBundle, EncounterRuntimeDialogueTurn } from "@openclinxr/asset-registry/runtime-bundles";
import type { ActorTurnPlayerResult } from "./actor-turn-player.js";
import type { PreparedActorStartContext } from "./actor-audio-types.js";
export type CaseAudioEvidence = NonNullable<EncounterRuntimeDialogueTurn["actorAudio"]>;
export type CaseAudioApprovalRequest = Omit<CaseAudioEvidence, "plan" | "execution" | "artifacts"> & {
  actorId: string; turnId: string; planId: string; planVersion: number; planDigest: string; spokenText: string;
};
export type CaseAudioOptions = {
  fetchBytes?: (uri: string) => Promise<Uint8Array>;
  resolveApproval?: (request: Readonly<CaseAudioApprovalRequest>) => Promise<boolean>;
};
export type CaseAudioPreparation =
  | { kind: "verified"; selection: object }
  | { kind: "absent" }
  | { kind: "stale" }
  | { kind: "refused"; reason: string };
export type CaseAudioOutcome =
  | { kind: "audio_started"; player: ActorTurnPlayerResult }
  | { kind: "refused"; reason: string; player?: ActorTurnPlayerResult };
export type CaseAudioController = {
  select<T extends LearnerRuntimeAssetBundle>(bundle: T): T;
  bindPlan<T extends { plan: ActorTurnPlan; execution: ActorTurnExecution | null }>(consumed: T, traceTag: string): T;
  preload(plan: ActorTurnPlan): Promise<CaseAudioPreparation>;
  markGesture(traceTag?: string): Promise<void>;
  start(plan: ActorTurnPlan, execution: ActorTurnExecution | null, context: Pick<PreparedActorStartContext, "gazeTarget" | "req">): CaseAudioOutcome | null;
  dispose(selection: object): { kind: "disposed" | "stale" } | { kind: "refused"; reason: string };
  snapshot(): { selected: boolean; verifiedCount: number; readyCount: number; reason: string | null };
};
