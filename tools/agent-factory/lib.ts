import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

export const scoreWeights = {
  clinical_validity: 10,
  psychometric_defensibility: 10,
  technical_feasibility: 9,
  architecture_coherence: 7,
  security_privacy: 9,
  ux_workflow_fit: 7,
  cost_performance_efficiency: 7,
  open_source_sustainability: 5,
  market_gtm_strength: 6,
  evidence_discipline: 8,
  implementation_readiness: 6,
  adversarial_robustness: 5,
  legal_regulatory_resilience: 6,
  specialty_clinical_generalizability: 5,
} as const;

export type ScoreDimension = keyof typeof scoreWeights;

export type Scorecard = {
  iteration_id: string;
  plan_type: string;
  scored_by: string;
  scored_at: string;
  dimensions: Record<ScoreDimension, { score: number; rationale: string }>;
  critical_risks: Array<{ id: string; severity: string; summary: string; owner: string; status: string }>;
  evidence_debt: Array<{ id: string; summary: string; owner: string; status: string }>;
  decision_debt: Array<{ id: string; summary: string; owner: string; status: string }>;
  confidence: number;
  summary: string;
};

export type AgentIndex = {
  agent_id: string;
  team: string;
  last_updated: string;
  entries: Array<{
    id: string;
    type: string;
    topic: string;
    summary: string;
    confidence: number;
    source_ids: string[];
    iteration: number;
    status: string;
    supersedes: string[];
  }>;
};

export async function globFiles(patterns: string | string[]): Promise<string[]> {
  return fg(patterns, {
    cwd: process.cwd(),
    absolute: false,
    dot: true,
    onlyFiles: true,
    ignore: ["node_modules/**", "**/node_modules/**", ".git/**"],
  });
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readText(filePath)) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function weightedScore(scorecard: Scorecard): number {
  const totalWeight = Object.values(scoreWeights).reduce((sum, weight) => sum + weight, 0);
  const weighted = Object.entries(scoreWeights).reduce((sum, [dimension, weight]) => {
    const score = scorecard.dimensions[dimension as ScoreDimension]?.score ?? 0;
    return sum + score * weight;
  }, 0);
  return Number((weighted / totalWeight).toFixed(3));
}

export function compositeScore(scorecard: Scorecard): number {
  const scores = Object.keys(scoreWeights).map((dimension) => scorecard.dimensions[dimension as ScoreDimension]?.score ?? 0);
  const composite = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Number(composite.toFixed(3));
}

export function missingScoreDimensions(scorecard: Scorecard): string[] {
  return Object.keys(scoreWeights).filter((dimension) => !(dimension in scorecard.dimensions));
}

export function scorecardSummary(filePath: string, scorecard: Scorecard): string {
  return [
    `${filePath}`,
    `  plan_type: ${scorecard.plan_type}`,
    `  weighted_score: ${weightedScore(scorecard).toFixed(3)}`,
    `  composite_score: ${compositeScore(scorecard).toFixed(3)}`,
    `  confidence: ${scorecard.confidence.toFixed(2)}`,
    `  critical_risks: ${scorecard.critical_risks.filter((risk) => risk.status === "open").length}`,
    `  evidence_debt: ${scorecard.evidence_debt.filter((debt) => debt.status === "open").length}`,
    `  decision_debt: ${scorecard.decision_debt.filter((debt) => debt.status === "open").length}`,
  ].join("\n");
}

export async function iterationScorecardPaths(iterationDir: string): Promise<string[]> {
  return globFiles(`${iterationDir.replace(/\/$/, "")}/*scorecard.json`);
}

export function requireArgs(args: string[], usage: string): void {
  if (args.length === 0) {
    throw new Error(`Missing argument. Usage: ${usage}`);
  }
}
