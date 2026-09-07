/**
 * Formatter-only module: every export is a formatter. No validators.
 *
 * Six of these already existed in @openclinxr/ui-shared under *Workbench* names
 * (admin-workbench-format.ts). The composition-root migration re-created them here
 * byte-for-byte before that was noticed, so they are re-exported rather than
 * redefined: one implementation, the name the workbenches call it by.
 */

import { safeUserFacingClaimLanguage, scoreUseCopy, validationStageCopy } from "@openclinxr/domain/claim-language";
import {
  capabilityTagColor,
  countActorCommunicationProfiles,
  formatActorCommunicationProfileCoverage,
  formatDuration,
  pluralizeWorkbenchCount,
  uniqueWorkbenchValues,
} from "@openclinxr/ui-shared";

export { capabilityTagColor, countActorCommunicationProfiles, formatActorCommunicationProfileCoverage, formatDuration };

export const pluralize = pluralizeWorkbenchCount;
export const uniqueValues = uniqueWorkbenchValues;

export function formatScenarioGovernanceNotice(scenario: { governance: { scoreUseLabel: string; validationStage: string } }): string {
  const scoreUseNotice = (scoreUseCopy as Record<string, string>)[scenario.governance.scoreUseLabel]
    ?? safeUserFacingClaimLanguage.formativeAssessment;
  const validationNotice = (validationStageCopy as Record<string, string>)[scenario.governance.validationStage]
    ?? safeUserFacingClaimLanguage.humanReview;

  return `${scoreUseNotice} ${validationNotice} ${safeUserFacingClaimLanguage.syntheticScenario}`;
}
