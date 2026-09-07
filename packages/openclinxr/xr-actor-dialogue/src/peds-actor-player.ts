import type { XrActorDialogueStore } from "./store.js";
import type { PedsActorPlayerRuntimeTurn, PedsActorPlayerRuntimeSequenceEvidence, PedsActorPlayerRuntimePlaybackEvidence, PedsAdaptiveDialogueBranchResolution, PedsActorPlayerRuntimePlaybackInput, PedsActorPlayerPlaybackContext } from "./types.js";
import type { HumanoidExpressionEmotion } from "@openclinxr/xr-humanoid-animation";

export function schedulePedsActorPlayerRuntimePlaybackIfReady(store: XrActorDialogueStore): void {
  store.schedulePedsActorPlayerRuntimePlaybackIfReady();
}

export function triggerPedsAdaptiveDialogueBranch(
  store: XrActorDialogueStore,
  branch: PedsAdaptiveDialogueBranchResolution,
  triggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"]
): boolean {
  return store.triggerPedsAdaptiveDialogueBranch(branch, triggerSource);
}

export function triggerPedsActorPlayerRuntimeTurnForTrace(store: XrActorDialogueStore, traceTag: string): boolean {
  return store.triggerPedsActorPlayerRuntimeTurnForTrace(traceTag);
}

export function dedupePedsActorPlayerRuntimeTurns(store: XrActorDialogueStore, turns: PedsActorPlayerRuntimeTurn[]): PedsActorPlayerRuntimeTurn[] {
  return store.dedupePedsActorPlayerRuntimeTurns(turns);
}

export function pedsActorPlayerBundleDialogueTurns(store: XrActorDialogueStore): PedsActorPlayerRuntimeTurn[] {
  return store.pedsActorPlayerBundleDialogueTurns();
}

export function normalizePedsActorPlayerEmotion(store: XrActorDialogueStore, emotion: string): HumanoidExpressionEmotion {
  return store.normalizePedsActorPlayerEmotion(emotion);
}

export function playPedsActorPlayerRuntimeTurn(
  store: XrActorDialogueStore,
  turn: PedsActorPlayerRuntimeTurn,
  input: {
    turns: PedsActorPlayerRuntimeTurn[];
    latestTurnIndex: number;
    latestTriggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"];
    latestTraceTag: string | null;
    latestSequence: PedsActorPlayerRuntimeSequenceEvidence | null;
    latestSequenceStepIndex: number;
  }
): void {
  store.playPedsActorPlayerRuntimeTurn(turn, input);
}

export function applyPedsActorPlayerSequenceListenerCues(
  store: XrActorDialogueStore,
  activeTurn: PedsActorPlayerRuntimeTurn,
  sequence: PedsActorPlayerRuntimeSequenceEvidence | null,
  nowMs: number
): { actorIds: string[]; coupledSignalIds: string[] } {
  return store.applyPedsActorPlayerSequenceListenerCues(activeTurn, sequence, nowMs);
}

export function playPedsActorPlayerRuntimeSequence(
  store: XrActorDialogueStore,
  sequence: PedsActorPlayerRuntimeSequenceEvidence,
  fallbackTurns: PedsActorPlayerRuntimeTurn[]
): void {
  store.playPedsActorPlayerRuntimeSequence(sequence, fallbackTurns);
}

export function pedsActorPlayerRuntimeTurns(store: XrActorDialogueStore): PedsActorPlayerRuntimeTurn[] {
  return store.pedsActorPlayerRuntimeTurns();
}

export function pedsActorPlayerPlaybackPanelContext(store: XrActorDialogueStore): PedsActorPlayerPlaybackContext {
  return store.pedsActorPlayerPlaybackPanelContext();
}

export function recordPedsActorPlayerRuntimePlaybackEvidence(
  store: XrActorDialogueStore,
  input: PedsActorPlayerRuntimePlaybackInput
): void {
  store.recordPedsActorPlayerRuntimePlaybackEvidence(input);
}