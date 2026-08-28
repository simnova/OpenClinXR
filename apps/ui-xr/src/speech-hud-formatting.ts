/**
 * HUD line formatting for the speech-affect and actor-realism-requirement evidence surfaces.
 *
 * Extracted from main.ts (#710) so the dev-only speak fixture bridge can be wired without
 * growing the frozen god-file (main.ts ceiling 9980, shrink-only). Pure functions over the
 * evidence value — no module state, no main.ts imports; the caller passes the evidence
 * global's value.
 *
 * claimScope: HUD line formatting only. notEvidenceFor: speech quality, animation quality,
 * readiness, clinical affect scoring, Quest.
 */

import type { HumanoidSpeechEvidence } from "./runtime-state.js";

export function formatHumanoidSpeechAffectEvidence(evidence: HumanoidSpeechEvidence | null): string {
  if (!evidence?.activeActorId) {
    return "speech affect pending";
  }
  const weights = evidence.activeExpressionWeights;
  const actorRequirement = evidence.activeActorRuntimeRealismRequirement;
  const weightSummary = weights
    ? `mouth ${weights.mouthOpen ?? 0}; brow ${weights.browConcern ?? 0}; cheek ${weights.cheekTension ?? 0}`
    : "weights pending";
  const actorRequirementSummary = actorRequirement
    ? [
        `actor ${actorRequirement.role}:${actorRequirement.actorId}`,
        `locomotion ${String(actorRequirement.locomotionRequired)}`,
        `expression ${String(actorRequirement.expressionRequired)}`,
        `gaze ${String(actorRequirement.gazeRequired)}`,
        `lip-sync ${String(actorRequirement.lipSyncRequired)}`,
        `interaction ${String(actorRequirement.interactionRequired)}`,
        `cues ${actorRequirement.requiredCueIds.length}`,
      ].join("; ")
    : "actor realism requirement pending";
  return [
    evidence.activeEmotionState ? `emotion ${evidence.activeEmotionState}` : "emotion pending",
    typeof evidence.activeExpressionTransitionMs === "number" ? `transition ${evidence.activeExpressionTransitionMs}ms` : "transition pending",
    weightSummary,
    actorRequirementSummary,
    evidence.activeExpressionCueIds?.includes("emotion_aligned_expression_transition_cue") ? "emotion transition cue present" : "emotion transition cue missing",
  ].join(" | ");
}

export function formatActiveActorRealismRequirementLines(evidence: HumanoidSpeechEvidence | null): string[] {
  const requirement = evidence?.activeActorRuntimeRealismRequirement;
  const launchBadge = evidence?.activeActorRealismLaunchBadge;
  if (!requirement) {
    return [
      "No active dialogue actor requirement yet.",
      "Select a trace action to show case-defined obligations.",
      "Boundary: display only, not readiness proof.",
    ];
  }
  const dimensions = [
    requirement.locomotionRequired ? "locomotion" : "",
    requirement.expressionRequired ? "expression" : "",
    requirement.gazeRequired ? "gaze" : "",
    requirement.lipSyncRequired ? "lip-sync" : "",
    requirement.interactionRequired ? "interaction" : "",
  ].filter(Boolean);
  return [
    `${requirement.role}: ${requirement.actorId}`,
    `Badge: ${launchBadge?.status ?? "realismBlocked"} until actor-specific humanoid gate evidence attaches`,
    `Mood: ${requirement.baselineMood.join(", ") || "not specified"}`,
    `Required: ${dimensions.join(", ") || "metadata pending"}`,
    `Cue IDs: ${requirement.requiredCueIds.slice(0, 3).join(", ")}`,
    requirement.requiredCueIds.length > 3 ? `+${requirement.requiredCueIds.length - 3} more cues in copied evidence` : "All active cues shown",
    "Not Quest/clinical/scoring readiness.",
  ];
}
