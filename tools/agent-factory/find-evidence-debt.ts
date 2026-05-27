import { pathToFileURL } from "node:url";
import { globFiles, readJson, type Scorecard, writeJson } from "./lib.js";

export type EvidenceDebtRecord = {
  id: string;
  file: string;
  iteration_id: string;
  iteration_number: number;
  plan_type: string;
  scored_by: string;
  owner: string;
  summary: string;
  status: string;
};

export type EvidenceDebtReport = {
  generated_by: string;
  scorecard_count: number;
  debt_count: number;
  open_count: number;
  closed_count: number;
  status_counts: Record<string, number>;
  open_by_iteration: Record<string, number>;
  open_by_owner: Record<string, number>;
  priority_open_debt: EvidenceDebtRecord[];
  open_debt: EvidenceDebtRecord[];
  all_debt: EvidenceDebtRecord[];
};

async function main(): Promise<void> {
  const files = await globFiles("iterations/**/*scorecard.json");
  const allDebt: EvidenceDebtRecord[] = [];

  for (const file of files.sort()) {
    const scorecard = await readJson<Scorecard>(file);
    for (const debt of scorecard.evidence_debt) {
      allDebt.push({
        id: debt.id,
        file,
        iteration_id: scorecard.iteration_id,
        iteration_number: iterationNumber(scorecard.iteration_id),
        plan_type: scorecard.plan_type,
        scored_by: scorecard.scored_by,
        owner: debt.owner,
        summary: debt.summary,
        status: debt.status,
      });
    }
  }

  const report = buildEvidenceDebtReport(files.length, allDebt);
  await writeJson(".agent-factory/evidence-debt-report.json", report);

  const openDebt = report.priority_open_debt;
  if (openDebt.length === 0) {
    console.log("No open evidence debt found in scorecards.");
    console.log("Wrote .agent-factory/evidence-debt-report.json");
    return;
  }

  console.log("Open evidence debt:");
  for (const debt of openDebt) {
    console.log(`- ${debt.id} (${debt.file}) owner=${debt.owner}: ${debt.summary}`);
  }
  console.log("Wrote .agent-factory/evidence-debt-report.json");
}

export function buildEvidenceDebtReport(scorecardCount: number, allDebt: EvidenceDebtRecord[]): EvidenceDebtReport {
  const sortedDebt = [...allDebt].sort(compareDebt);
  const openDebt = sortedDebt.filter((debt) => debt.status === "open");
  const priorityOpenDebt = [...openDebt].sort(comparePriorityDebt);

  return {
    generated_by: "tools/agent-factory/find-evidence-debt.ts",
    scorecard_count: scorecardCount,
    debt_count: sortedDebt.length,
    open_count: openDebt.length,
    closed_count: sortedDebt.filter((debt) => debt.status === "closed" || debt.status === "resolved").length,
    status_counts: countBy(sortedDebt, (debt) => debt.status),
    open_by_iteration: countBy(openDebt, (debt) => debt.iteration_id),
    open_by_owner: countBy(openDebt, (debt) => debt.owner),
    priority_open_debt: priorityOpenDebt,
    open_debt: openDebt,
    all_debt: sortedDebt,
  };
}

function compareDebt(left: EvidenceDebtRecord, right: EvidenceDebtRecord): number {
  return left.iteration_number - right.iteration_number
    || left.iteration_id.localeCompare(right.iteration_id)
    || left.plan_type.localeCompare(right.plan_type)
    || left.id.localeCompare(right.id);
}

function comparePriorityDebt(left: EvidenceDebtRecord, right: EvidenceDebtRecord): number {
  return right.iteration_number - left.iteration_number
    || right.iteration_id.localeCompare(left.iteration_id)
    || left.owner.localeCompare(right.owner)
    || left.plan_type.localeCompare(right.plan_type)
    || left.id.localeCompare(right.id);
}

function countBy(records: EvidenceDebtRecord[], key: (record: EvidenceDebtRecord) => string): Record<string, number> {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
