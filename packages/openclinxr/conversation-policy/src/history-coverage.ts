import type { Scenario } from "@openclinxr/shared-schemas";
import {
  CONVERSATION_CLAIM_SCOPE,
  CONVERSATION_NOT_EVIDENCE_FOR,
  type HistoryTakingCoverageSpec,
  type HistoryTakingCoverageState,
  type HistoryTakingCoverageUpdateInput,
  type HistoryTakingCoverageUpdateResult,
  type HistoryTakingDomain,
} from "./types.js";

const PEDS_ASTHMA_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";

const PEDS_ASTHMA_HISTORY_DOMAINS: HistoryTakingDomain[] = [
  {
    domainId: "work_of_breathing_assessment",
    label: "Work of breathing assessment",
    matchesTraceTags: ["work_of_breathing_assessment"],
    matchesKeywords: ["work of breathing", "breathing effort", "how hard is she breathing", "retractions"],
  },
  {
    domainId: "inhaler_history",
    label: "Inhaler / medication history",
    matchesTraceTags: ["inhaler_history"],
    matchesKeywords: ["inhaler", "albuterol", "rescue med", "puff"],
  },
  {
    domainId: "trigger_history",
    label: "Trigger history",
    matchesTraceTags: ["trigger_history"],
    matchesKeywords: ["trigger", "cat", "allergy", "what started", "exposure"],
  },
  {
    domainId: "oxygen_request",
    label: "Oxygen request",
    matchesTraceTags: ["oxygen_request"],
    matchesKeywords: ["oxygen", "o2", "start o2"],
  },
  {
    domainId: "bronchodilator_plan",
    label: "Bronchodilator plan",
    matchesTraceTags: ["bronchodilator_plan"],
    matchesKeywords: ["bronchodilator", "nebulizer", "neb", "duoneb"],
  },
  {
    domainId: "urgent_escalation",
    label: "Urgent escalation",
    matchesTraceTags: ["urgent_escalation"],
    matchesKeywords: ["escalate", "rapid response", "call for help", "respiratory therapy"],
  },
  {
    domainId: "parent_communication",
    label: "Parent communication",
    matchesTraceTags: ["parent_communication", "family_communication"],
    matchesKeywords: ["parent", "mom", "dad", "caregiver"],
  },
  {
    domainId: "empathy_statement",
    label: "Empathy statement",
    matchesTraceTags: ["empathy_statement"],
    matchesKeywords: ["i understand", "that sounds scary", "i can see you're worried"],
  },
  {
    domainId: "patient_note_submitted",
    label: "Patient note submitted",
    matchesTraceTags: ["patient_note_submitted"],
    matchesKeywords: ["submit note", "document", "patient note"],
  },
];

/**
 * Build a per-scenario history-taking coverage spec.
 * Peds asthma uses an explicit domain list aligned to requiredTraceTags;
 * other scenarios get a generic one-domain-per-requiredTraceTag fallback.
 */
export function buildHistoryTakingCoverageSpec(
  scenario: Pick<Scenario, "scenarioId" | "requiredTraceTags">,
): HistoryTakingCoverageSpec {
  if (scenario.scenarioId === PEDS_ASTHMA_SCENARIO_ID) {
    return {
      scenarioId: scenario.scenarioId,
      domains: PEDS_ASTHMA_HISTORY_DOMAINS.map((domain) => ({
        ...domain,
        matchesTraceTags: [...domain.matchesTraceTags],
        ...(domain.matchesKeywords ? { matchesKeywords: [...domain.matchesKeywords] } : {}),
      })),
    };
  }

  return {
    scenarioId: scenario.scenarioId,
    domains: scenario.requiredTraceTags.map((tag) => domainFromTraceTag(tag)),
  };
}

export function initialHistoryTakingCoverageState(
  spec: HistoryTakingCoverageSpec,
): HistoryTakingCoverageState {
  const domainIds = spec.domains.map((domain) => domain.domainId);
  return finalizeCoverageState(spec.scenarioId, [], domainIds, []);
}

/**
 * Deterministically update coverage from observed trace tags and/or learner utterance keywords.
 * Emits coverageTraceTags (e.g. history_coverage:inhaler_history) when a domain FIRST becomes covered.
 */
export function updateHistoryTakingCoverage(
  prevState: HistoryTakingCoverageState,
  input: HistoryTakingCoverageUpdateInput,
  spec?: HistoryTakingCoverageSpec,
): HistoryTakingCoverageUpdateResult {
  const coverageSpec =
    spec
    ?? {
      scenarioId: prevState.scenarioId,
      domains: [
        ...prevState.coveredDomainIds.map((domainId) => domainFromTraceTag(domainId)),
        ...prevState.missingDomainIds.map((domainId) => domainFromTraceTag(domainId)),
      ],
    };

  const covered = new Set(prevState.coveredDomainIds);
  const newlyCoveredDomainIds: string[] = [];
  const coverageTraceTags = [...prevState.coverageTraceTags];
  const observedTags = new Set(input.traceTags ?? []);
  const utteranceLower = (input.learnerUtterance ?? "").toLowerCase();

  for (const domain of coverageSpec.domains) {
    if (covered.has(domain.domainId)) {
      continue;
    }
    const tagMatch = domain.matchesTraceTags.some((tag) => observedTags.has(tag));
    const keywordMatch =
      utteranceLower.length > 0
      && (domain.matchesKeywords ?? []).some((keyword) => utteranceLower.includes(keyword.toLowerCase()));
    if (tagMatch || keywordMatch) {
      covered.add(domain.domainId);
      newlyCoveredDomainIds.push(domain.domainId);
      const coverageTag = coverageTraceTagForDomain(domain.domainId);
      if (!coverageTraceTags.includes(coverageTag)) {
        coverageTraceTags.push(coverageTag);
      }
    }
  }

  // Stable order: follow spec domain order for covered/missing lists.
  const coveredDomainIds = coverageSpec.domains
    .map((domain) => domain.domainId)
    .filter((domainId) => covered.has(domainId));
  const missingDomainIds = coverageSpec.domains
    .map((domain) => domain.domainId)
    .filter((domainId) => !covered.has(domainId));

  return {
    state: finalizeCoverageState(
      prevState.scenarioId,
      coveredDomainIds,
      missingDomainIds,
      coverageTraceTags,
    ),
    newlyCoveredDomainIds,
  };
}

/**
 * Return domain ids whose matchesTraceTags include the given trace tag.
 * Shared source of truth for peds adaptive dialogue and coverage model.
 */
export function domainsForTraceTag(
  scenarioId: string,
  traceTag: string,
  requiredTraceTags: readonly string[] = [],
): HistoryTakingDomain[] {
  const spec = buildHistoryTakingCoverageSpec({
    scenarioId,
    requiredTraceTags: [...requiredTraceTags],
  });
  return spec.domains.filter((domain) => domain.matchesTraceTags.includes(traceTag));
}

export function coverageTraceTagForDomain(domainId: string): string {
  return `history_coverage:${domainId}`;
}

function domainFromTraceTag(tag: string): HistoryTakingDomain {
  return {
    domainId: tag,
    label: humanizeTraceTag(tag),
    matchesTraceTags: [tag],
  };
}

function humanizeTraceTag(tag: string): string {
  return tag
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function finalizeCoverageState(
  scenarioId: string,
  coveredDomainIds: string[],
  missingDomainIds: string[],
  coverageTraceTags: string[],
): HistoryTakingCoverageState {
  const total = coveredDomainIds.length + missingDomainIds.length;
  // Count-based coverage of DOMAINS — NOT a clinical/performance score.
  const coveragePercent = total === 0 ? 0 : Math.round((coveredDomainIds.length / total) * 10000) / 100;

  return {
    scenarioId,
    coveredDomainIds,
    missingDomainIds,
    coveragePercent,
    coverageTraceTags,
    claimScope: CONVERSATION_CLAIM_SCOPE.historyCoverage,
    notEvidenceFor: CONVERSATION_NOT_EVIDENCE_FOR,
  };
}
