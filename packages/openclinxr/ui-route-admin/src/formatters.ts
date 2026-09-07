/**
 * Formatter-only module: every export is a formatter (names starting with
 * format / pluralize / unique). No validators or other functions.
 */

export function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

export function countActorCommunicationProfiles(actors: readonly { communicationProfile?: unknown | null }[]): number {
  return actors.filter((actor) => actor.communicationProfile).length;
}

export function formatActorCommunicationProfileCoverage(actors: readonly { communicationProfile?: unknown | null }[]): string {
  const profileCount = countActorCommunicationProfiles(actors);
  return `${profileCount} of ${actors.length} actors include behavior profiles for faculty review.`;
}

export function formatScenarioGovernanceNotice(scenario: { governance: { scoreUseLabel: string; validationStage: string } }): string {
  const scoreUseCopy: Record<string, string> = {
    formative_local_only: "Formative local practice only.",
    pilot_research_only: "Pilot research use only.",
    validated_summative: "Validated for summative assessment.",
  };
  const validationStageCopy: Record<string, string> = {
    stage_0_synthetic_draft: "Synthetic draft — not reviewed.",
    stage_1_expert_reviewed: "Expert reviewed.",
    stage_2_pilot_ready: "Pilot ready.",
    stage_3_validated: "Validated.",
  };
  const safeUserFacingClaimLanguage = {
    formativeAssessment: "Formative assessment context.",
    humanReview: "Human review required.",
    syntheticScenario: "Synthetic scenario.",
  };
  
  const scoreUseNotice = scoreUseCopy[scenario.governance.scoreUseLabel] ?? safeUserFacingClaimLanguage.formativeAssessment;
  const validationNotice = validationStageCopy[scenario.governance.validationStage] ?? safeUserFacingClaimLanguage.humanReview;

  return `${scoreUseNotice} ${validationNotice} ${safeUserFacingClaimLanguage.syntheticScenario}`;
}

export function capabilityTagColor(tag: string): string {
  const colorByTag = new Map([
    ["GraphQL Codegen", "green"],
    ["Apollo Client", "blue"],
    ["ProComponents v3", "purple"],
    ["React Router", "cyan"],
    ["Ant Design 6", "gold"],
  ]);

  return colorByTag.get(tag) ?? "default";
}