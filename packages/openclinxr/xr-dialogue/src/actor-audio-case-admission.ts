import type { ActorTurnPlan } from "@openclinxr/shared-schemas";
import type { CaseAudioEvidence } from "./actor-audio-case-types.js";
import { digestActorTurnPlan } from "./actor-turn-player.js";
export function caseEvidenceMatches(e: CaseAudioEvidence, plan: ActorTurnPlan, scenarioId: string, traceTag: string): boolean {
  if (e.version !== 1 || e.scenarioId !== scenarioId || e.traceTag !== traceTag || e.actorId !== plan.actorId || e.spokenText !== plan.spokenText || e.planId !== plan.planId || e.planVersion !== plan.planVersion || e.turnId !== plan.turnId || e.planDigest !== digestActorTurnPlan(plan) || e.voiceId !== plan.voiceId || e.bakeWaveformSha256 !== e.waveformSha256) return false;
  if (e.execution && (e.execution.planId !== plan.planId || e.execution.turnId !== plan.turnId)) return false;
  if (JSON.stringify(e.plan) !== JSON.stringify(plan)) return false;
  const artifacts = e.artifacts;
  if (!artifacts.audio || !artifacts.visemeCues || !artifacts.gaze || !artifacts.emotion || artifacts.visemeCues.baker !== "rhubarb") return false;
  for (const ref of [artifacts.audio, artifacts.visemeCues, artifacts.gaze, artifacts.emotion]) {
    if (ref.actorId !== plan.actorId || ref.turnId !== plan.turnId || ref.planDigest !== e.planDigest) return false;
  }
  return artifacts.audio.audioUri === e.waveformUri && artifacts.audio.durationMs === e.nativeSampleCount / e.nativeSampleRate * 1000 && artifacts.emotion.from === plan.dialogueEmotionFrom && artifacts.emotion.to === plan.dialogueEmotionTo;
}
