import { globFiles, readJson, writeJson, type Scorecard } from "./lib.js";

type RiskRecord = {
  id: string;
  file: string;
  iteration_id: string;
  iteration_number: number;
  plan_type: string;
  scored_by: string;
  severity: string;
  owner: string;
  summary: string;
  status: string;
};

type RiskReport = {
  generated_by: string;
  scorecard_count: number;
  risk_count: number;
  open_count: number;
  open_critical_count: number;
  open_high_or_critical_count: number;
  status_counts: Record<string, number>;
  open_by_severity: Record<string, number>;
  open_by_iteration: Record<string, number>;
  open_by_owner: Record<string, number>;
  open_high_or_critical_risks: RiskRecord[];
  open_risks: RiskRecord[];
  all_risks: RiskRecord[];
};

async function main(): Promise<void> {
  const files = await globFiles("iterations/**/*scorecard.json");
  const allRisks: RiskRecord[] = [];

  for (const file of files.sort()) {
    const scorecard = await readJson<Scorecard>(file);
    for (const risk of scorecard.critical_risks) {
      allRisks.push({
        id: risk.id,
        file,
        iteration_id: scorecard.iteration_id,
        iteration_number: iterationNumber(scorecard.iteration_id),
        plan_type: scorecard.plan_type,
        scored_by: scorecard.scored_by,
        severity: risk.severity,
        owner: risk.owner,
        summary: risk.summary,
        status: risk.status,
      });
    }
  }

  const report = buildRiskReport(files.length, allRisks);
  await writeJson(".agent-factory/risk-report.json", report);

  const openCritical = report.open_risks.filter((risk) => risk.severity === "critical");
  if (openCritical.length === 0) {
    console.log("No open critical risks found in scorecards.");
    console.log("Wrote .agent-factory/risk-report.json");
    return;
  }

  console.log("Open critical risks:");
  for (const risk of openCritical) {
    console.log(`- ${risk.id} (${risk.file}) owner=${risk.owner}: ${risk.summary}`);
  }
  console.log("Wrote .agent-factory/risk-report.json");
  process.exitCode = 1;
}

function buildRiskReport(scorecardCount: number, allRisks: RiskRecord[]): RiskReport {
  const sortedRisks = [...allRisks].sort(compareRisks);
  const openRisks = sortedRisks.filter((risk) => risk.status === "open");
  const openHighOrCriticalRisks = openRisks.filter((risk) => risk.severity === "high" || risk.severity === "critical");

  return {
    generated_by: "tools/agent-factory/find-stale-risks.ts",
    scorecard_count: scorecardCount,
    risk_count: sortedRisks.length,
    open_count: openRisks.length,
    open_critical_count: openRisks.filter((risk) => risk.severity === "critical").length,
    open_high_or_critical_count: openHighOrCriticalRisks.length,
    status_counts: countBy(sortedRisks, (risk) => risk.status),
    open_by_severity: countBy(openRisks, (risk) => risk.severity),
    open_by_iteration: countBy(openRisks, (risk) => risk.iteration_id),
    open_by_owner: countBy(openRisks, (risk) => risk.owner),
    open_high_or_critical_risks: openHighOrCriticalRisks,
    open_risks: openRisks,
    all_risks: sortedRisks,
  };
}

function compareRisks(left: RiskRecord, right: RiskRecord): number {
  return left.iteration_number - right.iteration_number
    || left.iteration_id.localeCompare(right.iteration_id)
    || left.plan_type.localeCompare(right.plan_type)
    || severityRank(right.severity) - severityRank(left.severity)
    || left.id.localeCompare(right.id);
}

function countBy(records: RiskRecord[], key: (record: RiskRecord) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = key(record);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function iterationNumber(iterationId: string): number {
  const match = /(\d+)$/.exec(iterationId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function severityRank(severity: string): number {
  const ranks = new Map([
    ["low", 1],
    ["medium", 2],
    ["high", 3],
    ["critical", 4],
  ]);
  return ranks.get(severity) ?? 0;
}

await main();
