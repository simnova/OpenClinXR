import { stepEmotionStateFromCaseMachine } from "./runtime-state.js";

export type PedsAdaptiveDialogueBranchType = "escalation" | "deescalation";

export type PedsAdaptiveDialogueBranchResolution = {
  policyTrigger: "ignored_breathing" | "breathing_effort_acknowledged";
  branchType: PedsAdaptiveDialogueBranchType;
  requestedTraceTag: string;
  adaptiveTraceTags: string[];
  emotionTransition: {
    from: string;
    to: string;
  };
  mappingMode: "deterministic_case_escalation_policy";
  reviewSafeMetadata: {
    source: "bundle_dialogue_adaptive_branch";
    notEvidenceFor: string[];
  };
};

const PEDS_ASTHMA_EMOTION_MACHINE = {
  initialEmotion: "frightened",
  escalationTriggers: ["ignored_breathing", "rapid_questioning"],
  deescalationTriggers: ["breathing_effort_acknowledged", "simple_next_step"],
};

export function resolvePedsAdaptiveDialogueBranch(
  traceTag: string,
  completedTraceTags: readonly string[],
  scenarioId: string,
): PedsAdaptiveDialogueBranchResolution | null {
  if (scenarioId !== "peds_asthma_parent_anxiety_v1") {
    return null;
  }

  const skippedBreathingAssessment = !completedTraceTags.includes("work_of_breathing_assessment")
    && (traceTag === "inhaler_history" || traceTag === "trigger_history");
  if (skippedBreathingAssessment) {
    const nextEmotion = stepEmotionStateFromCaseMachine(
      PEDS_ASTHMA_EMOTION_MACHINE,
      PEDS_ASTHMA_EMOTION_MACHINE.initialEmotion,
      "ignored_breathing",
    );
    return {
      policyTrigger: "ignored_breathing",
      branchType: "escalation",
      requestedTraceTag: traceTag,
      adaptiveTraceTags: ["urgent_escalation", "parent_communication"],
      emotionTransition: {
        from: PEDS_ASTHMA_EMOTION_MACHINE.initialEmotion,
        to: nextEmotion,
      },
      mappingMode: "deterministic_case_escalation_policy",
      reviewSafeMetadata: {
        source: "bundle_dialogue_adaptive_branch",
        notEvidenceFor: [
          "clinical_validity",
          "scoring_validity",
          "production_dialogue_policy",
          "validated_adaptive_branching",
        ],
      },
    };
  }

  if (traceTag === "oxygen_request" && completedTraceTags.includes("work_of_breathing_assessment")) {
    const nextEmotion = stepEmotionStateFromCaseMachine(
      PEDS_ASTHMA_EMOTION_MACHINE,
      "anxious",
      "breathing_effort_acknowledged",
    );
    return {
      policyTrigger: "breathing_effort_acknowledged",
      branchType: "deescalation",
      requestedTraceTag: traceTag,
      adaptiveTraceTags: ["empathy_statement"],
      emotionTransition: {
        from: "anxious",
        to: nextEmotion,
      },
      mappingMode: "deterministic_case_escalation_policy",
      reviewSafeMetadata: {
        source: "bundle_dialogue_adaptive_branch",
        notEvidenceFor: [
          "clinical_validity",
          "scoring_validity",
          "production_dialogue_policy",
          "validated_adaptive_branching",
        ],
      },
    };
  }

  return null;
}