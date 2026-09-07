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
  historyTakingDomainIds?: string[];
};
