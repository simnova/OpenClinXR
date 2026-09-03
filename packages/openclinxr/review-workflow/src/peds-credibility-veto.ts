export const PEDS_ASTHMA_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";

/** Three roles that can each veto Peds credibility. Draft status still blocks publication. */
export const PEDS_CREDIBILITY_VETO_ROLES = ["pediatrician", "psychometrician", "simulation_qa"] as const;

export function missingPedsCredibilityVetoRoles(
  scenarioId: string,
  approvedRoles: ReadonlySet<string>,
): string[] {
  if (scenarioId !== PEDS_ASTHMA_SCENARIO_ID) {
    return [];
  }
  return PEDS_CREDIBILITY_VETO_ROLES.filter((role) => !approvedRoles.has(role));
}
