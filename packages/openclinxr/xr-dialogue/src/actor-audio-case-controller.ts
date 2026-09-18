import type { ActorTurnPlan, ActorTurnExecution } from "@openclinxr/shared-schemas";
import type { CaseAudioController, CaseAudioOptions, CaseAudioEvidence, CaseAudioOutcome } from "./actor-audio-case-types.js";
import { prepareCaseBytes, type VerifiedCaseBytes } from "./actor-audio-case-preparation.js";
import { caseEvidenceMatches } from "./actor-audio-case-admission.js";
import { playIdentityBoundActorTurn } from "./actor-turn-player.js";
import { registerOwnedLiveActorTurn, unregisterOwnedLiveActorTurn } from "./actor-turn-plan-consumption.js";
export type CaseAudioOwner = {
  activate(): Promise<void>;
  install(evidence: CaseAudioEvidence, bytes: VerifiedCaseBytes): object | null;
  remove(handle: object): boolean;
  begin(evidence: CaseAudioEvidence, entryHandle: object, context: Parameters<CaseAudioController["start"]>[2]): { kind: "audio_started"; handle: object } | { kind: "refused"; reason: string };
  inspect(handle: object, evidence: CaseAudioEvidence): boolean;
  compensate(handle: object): boolean;
};
type Entry = { token: object; evidence: CaseAudioEvidence; bytes: VerifiedCaseBytes; epoch: number; registeredPlan: ActorTurnPlan; registration: object | undefined; handle?: object | undefined };
export function createCaseAudioController(options: CaseAudioOptions | undefined, owner: CaseAudioOwner): CaseAudioController {
  let selected: Parameters<CaseAudioController["select"]>[0] | undefined;
  let epoch = 0;
  let reason: string | null = null;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Awaited<ReturnType<CaseAudioController["preload"]>>>>();
  const key = (p: ActorTurnPlan) => `${p.actorId}\0${p.planId}\0${p.turnId}\0${p.voiceId}`;
  const registrations: Array<{ plan: ActorTurnPlan; traceTag: string; handle: object }> = [];
  const bindings = new Map<string, string>();
  function descriptor(plan: ActorTurnPlan) {
    const turns = selected?.sceneManifest.dialogueTurns.filter(t => t.actorId === plan.actorId && t.text === plan.spokenText) ?? [];
    const tag = bindings.get(key(plan));
    return tag ? turns.find(t => t.traceTag === tag) : turns.length === 1 ? turns[0] : undefined;
  }
  async function preload(plan: ActorTurnPlan): Promise<Awaited<ReturnType<CaseAudioController["preload"]>>> {
    const turn = descriptor(plan);
    if (!turn?.actorAudio) return { kind: "absent" };
    const e = structuredClone(turn.actorAudio);
    const currentEpoch = epoch;
    if (!selected || !caseEvidenceMatches(e, plan, selected.scenarioId, turn.traceTag)) return { kind: "refused", reason: "identity_mismatch" };
    const existing = entries.get(key(plan));
    if (existing && existing.epoch === epoch) return { kind: "verified", selection: existing.token };
    const inflight = pending.get(key(plan));
    if (inflight) return inflight;
    const task = (async () => {
      try {
        const bytes = await prepareCaseBytes(e, options);
        if (currentEpoch !== epoch) return { kind: "stale" as const };
        const entry: Entry = { token: Object.freeze({}), evidence: e, bytes, epoch, registeredPlan: turn.actorAudio!.plan, registration: registrations.find(r => r.plan === turn.actorAudio!.plan && r.traceTag === turn.traceTag)?.handle };
        entries.set(key(plan), entry); reason = null;
        return { kind: "verified" as const, selection: entry.token };
      } catch (error) {
        if (currentEpoch !== epoch) return { kind: "stale" as const };
        reason = error instanceof Error ? error.message : "preparation_failed";
        return { kind: "refused" as const, reason };
      } finally { if (currentEpoch === epoch) pending.delete(key(plan)); }
    })();
    pending.set(key(plan), task);
    return task;
  }
  return Object.freeze({
    select: bundle => {
      for (const entry of entries.values()) { if (entry.handle && !owner.remove(entry.handle)) { reason = "owned_stop_refusal"; throw Error(reason); } }
      for (const registration of registrations) unregisterOwnedLiveActorTurn(registration.plan, registration.traceTag, registration.handle);
      registrations.length = 0;
      epoch++; selected = bundle; entries.clear(); pending.clear(); bindings.clear(); reason = null;
      for (const turn of bundle.sceneManifest.dialogueTurns) {
        const e = turn.actorAudio;
        if (e && caseEvidenceMatches(e, e.plan, bundle.scenarioId, turn.traceTag)) {
          const handle = registerOwnedLiveActorTurn(e.plan, e.execution, turn.traceTag);
          registrations.push({ plan: e.plan, traceTag: turn.traceTag, handle });
          bindings.set(key(e.plan), turn.traceTag);
          void preload(e.plan);
        }
      }
      return bundle;
    },
    bindPlan: (consumed, traceTag) => { bindings.set(key(consumed.plan), traceTag); void preload(consumed.plan); return consumed; },
    preload,
    markGesture: async () => {
      if (!selected || entries.size === 0) return;
      if (typeof navigator === "undefined" || navigator.userActivation?.isActive !== true) return;
      const currentEpoch = epoch;
      try { await owner.activate(); } catch { reason = "context_activation_failed"; return; }
      if (currentEpoch !== epoch) return;
      for (const entry of entries.values()) if (!entry.handle) {
        try { entry.handle = owner.install(entry.evidence, entry.bytes) ?? undefined; } catch { reason = "buffer_install_failed"; }
      }
    },
    start: (plan: ActorTurnPlan, execution: ActorTurnExecution | null, context): CaseAudioOutcome | null => {
      if (!selected || !descriptor(plan)?.actorAudio) return null;
      if (execution && (execution.planId !== plan.planId || execution.turnId !== plan.turnId)) return { kind: "refused", reason: "execution_join_mismatch" };
      if (execution?.interruption.kind === "truncated" || execution?.interruption.kind === "replaced") return { kind: "refused", reason: "cancelled" };
      const entry = entries.get(key(plan));
      if (!entry || !entry.handle || !caseEvidenceMatches(entry.evidence, plan, selected.scenarioId, descriptor(plan)!.traceTag)) return { kind: "refused", reason: "not_ready" };
      let handle: object | undefined;
      let refusal = "adapter_failed";
      const player = playIdentityBoundActorTurn(plan, entry.evidence.artifacts, { nowMs: performance.now(), adapters: {
        startAudio: () => { const result = owner.begin(entry.evidence, entry.handle!, context); if (result.kind === "refused") { refusal = result.reason; return false; } handle = result.handle; return true; },
        startViseme: () => Boolean(handle && owner.inspect(handle, entry.evidence)),
        startGaze: () => Boolean(handle && owner.inspect(handle, entry.evidence)),
        startEmotion: () => Boolean(handle && owner.inspect(handle, entry.evidence)),
      } });
      if (player.status !== "playing") { if (handle && !owner.compensate(handle)) refusal = "owned_stop_refusal"; return { kind: "refused", reason: refusal, player }; }
      return { kind: "audio_started", player };
    },
    dispose: selection => {
      for (const [id, entry] of entries) if (entry.token === selection && entry.epoch === epoch) {
        if (entry.handle && !owner.remove(entry.handle)) return { kind: "refused", reason: "owned_stop_refusal" };
        unregisterOwnedLiveActorTurn(entry.registeredPlan, entry.evidence.traceTag, entry.registration);
        entries.delete(id); return { kind: "disposed" };
      }
      return { kind: "stale" };
    },
    snapshot: () => ({ selected: Boolean(selected), verifiedCount: entries.size, readyCount: Array.from(entries.values()).filter(e => e.handle).length, reason }),
  } satisfies CaseAudioController);
}
