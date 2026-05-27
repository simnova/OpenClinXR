import { pathToFileURL } from "node:url";
import {
  compositeScore,
  globFiles,
  readJson,
  type Scorecard,
  type ScoreDimension,
  weightedScore,
  writeJson,
} from "./lib.js";

export type ScorecardFile = {
  file: string;
  scorecard: Scorecard;
};

export type IterationMaturity = {
  iteration_id: string;
  iteration_number: number;
  selected_scorecard_file: string;
  selected_plan_type: string;
  scored_by: string;
  confidence: number;
  weighted_score: number;
  composite_score: number;
  weighted_delta_from_previous?: number;
  composite_delta_from_previous?: number;
  open_selected_evidence_debt_count: number;
  open_selected_decision_debt_count: number;
  open_selected_risk_count: number;
  open_selected_high_or_critical_risk_count: number;
  open_selected_evidence_debt_ids: string[];
  open_selected_decision_debt_ids: string[];
  open_selected_risk_ids: string[];
  open_selected_high_or_critical_risk_ids: string[];
  dimensions_below_quality_bar: ScoreDimension[];
  blockers: string[];
  leadership_quality_bar_ready: boolean;
};

export type MaturityReport = {
  generated_by: string;
  iteration_count: number;
  latest_iteration_id?: string;
  latest_weighted_score?: number;
  latest_weighted_delta_from_previous?: number;
  improving_iteration_count: number;
  plateaued_iteration_count: number;
  regressing_iteration_count: number;
  leadership_quality_bar_ready_count: number;
  iterations: IterationMaturity[];
};

const preferredScorecards = [
  "06-leadership-scorecard.json",
  "04-adversarial-scorecard.json",
  "02-core-scorecard.json",
];

const qualityBar = {
  weightedScore: 4.5,
  confidence: 0.75,
  dimensions: {
    clinical_validity: 4.5,
    psychometric_defensibility: 4.5,
    legal_regulatory_resilience: 4.3,
    specialty_clinical_generalizability: 4.2,
  },
} as const;

async function main(): Promise<void> {
  const scorecardRecords = await loadScorecardFiles();
  const report = buildMaturityReport(scorecardRecords);

  await writeJson(".agent-factory/maturity-report.json", report);

  console.log(`Wrote .agent-factory/maturity-report.json for ${report.iterations.length} iteration${report.iterations.length === 1 ? "" : "s"}.`);
  if (report.latest_iteration_id) {
    console.log(`Latest ${report.latest_iteration_id}: weighted_score=${report.latest_weighted_score?.toFixed(3)}`);
  }
}

async function loadScorecardFiles(): Promise<ScorecardFile[]> {
  const scorecardFiles = await globFiles("iterations/**/*scorecard.json");
  const scorecardRecords: ScorecardFile[] = [];

  for (const file of scorecardFiles.sort()) {
    scorecardRecords.push({ file, scorecard: await readJson<Scorecard>(file) });
  }

  return scorecardRecords;
}

export function buildMaturityReport(scorecardRecords: ScorecardFile[]): MaturityReport {
  const scorecardsByIteration = new Map<string, Array<{ file: string; scorecard: Scorecard }>>();

  for (const { file, scorecard } of scorecardRecords) {
    scorecardsByIteration.set(scorecard.iteration_id, [
      ...(scorecardsByIteration.get(scorecard.iteration_id) ?? []),
      { file, scorecard },
    ]);
  }

  const iterations = [...scorecardsByIteration.entries()]
    .map(([iterationId, candidates]) => buildIterationMaturity(iterationId, candidates))
    .sort((left, right) => left.iteration_number - right.iteration_number || left.iteration_id.localeCompare(right.iteration_id));

  for (let index = 1; index < iterations.length; index += 1) {
    const previous = iterations[index - 1];
    const current = iterations[index];
    current.weighted_delta_from_previous = roundScore(current.weighted_score - previous.weighted_score);
    current.composite_delta_from_previous = roundScore(current.composite_score - previous.composite_score);
  }

  return buildReport(iterations);
}

function buildIterationMaturity(
  iterationId: string,
  candidates: Array<{ file: string; scorecard: Scorecard }>,
): IterationMaturity {
  const selected = selectScorecard(candidates);
  const scorecard = selected.scorecard;
  const weighted = weightedScore(scorecard);
  const composite = compositeScore(scorecard);
  const dimensionsBelowQualityBar = dimensionsBelowBar(scorecard);
  const blockers = qualityBlockers(scorecard, weighted, dimensionsBelowQualityBar);
  const openEvidenceDebt = scorecard.evidence_debt.filter((debt) => debt.status === "open");
  const openDecisionDebt = scorecard.decision_debt.filter((debt) => debt.status === "open");
  const openRisks = scorecard.critical_risks.filter((risk) => risk.status === "open");
  const openHighOrCriticalRisks = openRisks.filter((risk) => risk.severity === "high" || risk.severity === "critical");

  return {
    iteration_id: iterationId,
    iteration_number: iterationNumber(iterationId),
    selected_scorecard_file: selected.file,
    selected_plan_type: scorecard.plan_type,
    scored_by: scorecard.scored_by,
    confidence: scorecard.confidence,
    weighted_score: weighted,
    composite_score: composite,
    open_selected_evidence_debt_count: openEvidenceDebt.length,
    open_selected_decision_debt_count: openDecisionDebt.length,
    open_selected_risk_count: openRisks.length,
    open_selected_high_or_critical_risk_count: openHighOrCriticalRisks.length,
    open_selected_evidence_debt_ids: openEvidenceDebt.map((debt) => debt.id).sort(),
    open_selected_decision_debt_ids: openDecisionDebt.map((debt) => debt.id).sort(),
    open_selected_risk_ids: openRisks.map((risk) => risk.id).sort(),
    open_selected_high_or_critical_risk_ids: openHighOrCriticalRisks.map((risk) => risk.id).sort(),
    dimensions_below_quality_bar: dimensionsBelowQualityBar,
    blockers,
    leadership_quality_bar_ready: blockers.length === 0,
  };
}

function selectScorecard(candidates: Array<{ file: string; scorecard: Scorecard }>): { file: string; scorecard: Scorecard } {
  const sorted = [...candidates].sort((left, right) => left.file.localeCompare(right.file));
  for (const fileName of preferredScorecards) {
    const preferred = sorted.find((candidate) => candidate.file.endsWith(`/${fileName}`));
    if (preferred) {
      return preferred;
    }
  }
  const last = sorted.at(-1);
  if (!last) {
    throw new Error("Cannot select a scorecard from an empty candidate list");
  }
  return last;
}

function dimensionsBelowBar(scorecard: Scorecard): ScoreDimension[] {
  const dimensions = Object.keys(qualityBar.dimensions) as Array<keyof typeof qualityBar.dimensions>;
  return dimensions.filter((dimension) => scorecard.dimensions[dimension].score < qualityBar.dimensions[dimension]);
}

function qualityBlockers(scorecard: Scorecard, weighted: number, dimensionsBelowQualityBar: ScoreDimension[]): string[] {
  const blockers: string[] = [];
  if (weighted < qualityBar.weightedScore) {
    blockers.push("weighted_score_below_quality_bar");
  }
  if (scorecard.confidence < qualityBar.confidence) {
    blockers.push("confidence_below_quality_bar");
  }
  if (scorecard.evidence_debt.some((debt) => debt.status === "open")) {
    blockers.push("open_selected_evidence_debt");
  }
  if (scorecard.decision_debt.some((debt) => debt.status === "open")) {
    blockers.push("open_selected_decision_debt");
  }
  if (scorecard.critical_risks.some((risk) => risk.status === "open" && (risk.severity === "high" || risk.severity === "critical"))) {
    blockers.push("open_selected_high_or_critical_risk");
  }
  if (dimensionsBelowQualityBar.length > 0) {
    blockers.push("required_dimensions_below_quality_bar");
  }
  return blockers;
}

function buildReport(iterations: IterationMaturity[]): MaturityReport {
  const latest = iterations.at(-1);

  const report: MaturityReport = {
    generated_by: "tools/agent-factory/build-maturity-report.ts",
    iteration_count: iterations.length,
    improving_iteration_count: iterations.filter((iteration) => (iteration.weighted_delta_from_previous ?? 0) > 0.05).length,
    plateaued_iteration_count: iterations.filter((iteration) => {
      const delta = iteration.weighted_delta_from_previous;
      return delta !== undefined && Math.abs(delta) <= 0.05;
    }).length,
    regressing_iteration_count: iterations.filter((iteration) => (iteration.weighted_delta_from_previous ?? 0) < -0.05).length,
    leadership_quality_bar_ready_count: iterations.filter((iteration) => iteration.leadership_quality_bar_ready).length,
    iterations,
  };

  if (latest) {
    report.latest_iteration_id = latest.iteration_id;
    report.latest_weighted_score = latest.weighted_score;
    if (latest.weighted_delta_from_previous !== undefined) {
      report.latest_weighted_delta_from_previous = latest.weighted_delta_from_previous;
    }
  }

  return report;
}

function iterationNumber(iterationId: string): number {
  const match = /(\d+)$/.exec(iterationId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function roundScore(value: number): number {
  return Number(value.toFixed(3));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
