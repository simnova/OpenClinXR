import type { Scenario } from "@openclinxr/shared-schemas";

/**
 * Intelligent exam-form assembly.
 *
 * The case bank is a LIBRARY that should grow freely as scenarios are authored. An exam form is an
 * ASSEMBLED SELECTION from it — not the whole bank. Before this existed, the seed blueprint mapped
 * every bank scenario to a station, so authoring a case silently grew the exam form (and broke the
 * station-count contract).
 *
 * Selection maximizes VARIETY so an examinee's encounters probe breadth rather than repeating a
 * narrow slice: different clinical settings, different actor-role mixes (which drive different
 * communication challenges — interpreter, consultant, respiratory therapist, family), different
 * safety-critical demands, and different skill trace tags.
 *
 * Deterministic by construction: no RNG and no wall-clock. Ties break on the author-controlled bank
 * order, so the same bank always assembles the same form (required for replay + review evidence).
 *
 * `notEvidenceFor`: this is a coverage heuristic for assembling practice forms. It is NOT a
 * psychometric blueprint, not exam-equivalence, and not a validated content-balancing method.
 */

/** Step 2 CS-style form length (docs: 12 stations, breaks after 3/6/9). */
export const STEP2CS_STATION_COUNT = 12;

/**
 * Relative worth of each newly covered dimension. Setting and actor-role variety are weighted
 * highest because they change the ENCOUNTER type; trace tags are finer-grained skill coverage.
 */
const COVERAGE_WEIGHTS = {
  clinicalSetting: 3,
  actorRole: 3,
  safetyCriticalTraceTag: 2,
  requiredTraceTag: 1,
} as const;

type CoverageDimensions = {
  readonly clinicalSettings: readonly string[];
  readonly actorRoles: readonly string[];
  readonly safetyCriticalTraceTags: readonly string[];
  readonly requiredTraceTags: readonly string[];
};

function coverageDimensionsFor(scenario: Scenario): CoverageDimensions {
  return {
    clinicalSettings: scenario.environment?.environmentId ? [scenario.environment.environmentId] : [],
    actorRoles: scenario.actors.map((actor) => actor.role),
    safetyCriticalTraceTags: [...scenario.governance.safetyCriticalTraceTags],
    requiredTraceTags: [...scenario.requiredTraceTags],
  };
}

type CoverageAccumulator = {
  clinicalSettings: Set<string>;
  actorRoles: Set<string>;
  safetyCriticalTraceTags: Set<string>;
  requiredTraceTags: Set<string>;
};

function emptyCoverage(): CoverageAccumulator {
  return {
    clinicalSettings: new Set<string>(),
    actorRoles: new Set<string>(),
    safetyCriticalTraceTags: new Set<string>(),
    requiredTraceTags: new Set<string>(),
  };
}

/**
 * How often each dimension value appears across the candidate pool. Used to weight RARITY:
 * covering something only one scenario can provide is worth far more than covering something
 * seven scenarios provide, because excluding that scenario is the only way to lose the capability.
 */
type RarityIndex = Map<string, number>;

function buildRarityIndex(scenarios: readonly Scenario[]): RarityIndex {
  const frequency: RarityIndex = new Map();
  for (const scenario of scenarios) {
    const dimensions = coverageDimensionsFor(scenario);
    const values = [
      ...dimensions.clinicalSettings.map((value) => `setting:${value}`),
      ...dimensions.actorRoles.map((value) => `role:${value}`),
      ...dimensions.safetyCriticalTraceTags.map((value) => `safety:${value}`),
      ...dimensions.requiredTraceTags.map((value) => `skill:${value}`),
    ];
    for (const value of new Set(values)) {
      frequency.set(value, (frequency.get(value) ?? 0) + 1);
    }
  }
  return frequency;
}

/**
 * How much NEW, hard-to-replace coverage this scenario adds to the form assembled so far.
 *
 * Without rarity weighting, plain max-coverage starves cases whose value is concentrated in unique
 * CONTENT rather than novel settings/roles — it dropped the flagship cardiac case in favour of one
 * that merely had more tags. Weighting by 1/frequency makes irreplaceable content win.
 */
function marginalCoverageScore(scenario: Scenario, covered: CoverageAccumulator, rarity: RarityIndex): number {
  const dimensions = coverageDimensionsFor(scenario);
  const scoreNew = (values: readonly string[], seen: Set<string>, prefix: string, weight: number): number =>
    [...new Set(values)]
      .filter((value) => !seen.has(value))
      .reduce((total, value) => total + weight / (rarity.get(`${prefix}:${value}`) ?? 1), 0);

  return scoreNew(dimensions.clinicalSettings, covered.clinicalSettings, "setting", COVERAGE_WEIGHTS.clinicalSetting)
    + scoreNew(dimensions.actorRoles, covered.actorRoles, "role", COVERAGE_WEIGHTS.actorRole)
    + scoreNew(dimensions.safetyCriticalTraceTags, covered.safetyCriticalTraceTags, "safety", COVERAGE_WEIGHTS.safetyCriticalTraceTag)
    + scoreNew(dimensions.requiredTraceTags, covered.requiredTraceTags, "skill", COVERAGE_WEIGHTS.requiredTraceTag);
}

function absorb(scenario: Scenario, covered: CoverageAccumulator): void {
  const dimensions = coverageDimensionsFor(scenario);
  for (const value of dimensions.clinicalSettings) covered.clinicalSettings.add(value);
  for (const value of dimensions.actorRoles) covered.actorRoles.add(value);
  for (const value of dimensions.safetyCriticalTraceTags) covered.safetyCriticalTraceTags.add(value);
  for (const value of dimensions.requiredTraceTags) covered.requiredTraceTags.add(value);
}

/** Coverage achieved by an assembled form — useful for review/authoring surfaces. */
export type ExamFormCoverageSummary = {
  readonly stationCount: number;
  readonly candidateCount: number;
  readonly clinicalSettings: readonly string[];
  readonly actorRoles: readonly string[];
  readonly safetyCriticalTraceTags: readonly string[];
  readonly requiredTraceTags: readonly string[];
};

/**
 * Choose `stationCount` scenarios that maximize combined coverage.
 *
 * Greedy: repeatedly take the scenario adding the most new coverage. Greedy is the standard
 * approximation for maximum coverage and is stable + explainable, which matters more here than
 * optimality — a reviewer must be able to see why a station was chosen.
 *
 * When the bank has no more scenarios than stations, every scenario is used and the author's bank
 * order is preserved (callers that pass an explicit short list get exactly that list).
 */
export function selectExamStationScenarios(
  scenarios: readonly Scenario[],
  stationCount: number = STEP2CS_STATION_COUNT,
): readonly Scenario[] {
  if (stationCount <= 0) return [];
  if (scenarios.length <= stationCount) return [...scenarios];

  const covered = emptyCoverage();
  const rarity = buildRarityIndex(scenarios);
  const remaining = scenarios.map((scenario, bankOrder) => ({ scenario, bankOrder }));
  const selected: { scenario: Scenario; bankOrder: number }[] = [];

  while (selected.length < stationCount && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    for (const [index, candidate] of remaining.entries()) {
      const score = marginalCoverageScore(candidate.scenario, covered, rarity);
      // Strictly-greater keeps the earliest (author-ordered) candidate on ties → deterministic.
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;
    absorb(chosen.scenario, covered);
    selected.push(chosen);
  }

  // Present stations in the author's bank order, not selection order, so form reading stays stable.
  return selected.sort((left, right) => left.bankOrder - right.bankOrder).map((entry) => entry.scenario);
}

/** Summarize what an assembled form covers (for review packets and authoring UIs). */
export function summarizeExamFormCoverage(
  selected: readonly Scenario[],
  candidateCount: number,
): ExamFormCoverageSummary {
  const covered = emptyCoverage();
  for (const scenario of selected) absorb(scenario, covered);
  const sorted = (values: Set<string>): string[] => [...values].sort();

  return {
    stationCount: selected.length,
    candidateCount,
    clinicalSettings: sorted(covered.clinicalSettings),
    actorRoles: sorted(covered.actorRoles),
    safetyCriticalTraceTags: sorted(covered.safetyCriticalTraceTags),
    requiredTraceTags: sorted(covered.requiredTraceTags),
  };
}
