import { pathToFileURL } from "node:url";
import { globFiles, readJson } from "./lib.js";

type ScorecardEvidenceDebt = {
  id: string;
  status: string;
};

type ScorecardRecord = {
  evidence_debt: ScorecardEvidenceDebt[];
};

type BenchmarkGateRecord = {
  evidence_gates: Array<{
    evidence_id: string;
    ready_to_resolve: boolean;
  }>;
};

export type BenchmarkEvidenceIdInput = {
  scorecardFiles: Array<{
    file: string;
    evidenceDebt: ScorecardEvidenceDebt[];
  }>;
  benchmarkGateIds: Array<{
    evidence_id: string;
    ready_to_resolve: boolean;
  }>;
};

export type BenchmarkEvidenceIdReport = {
  ok: boolean;
  scorecard_debt_count: number;
  benchmark_gate_count: number;
  gates_without_scorecard_debt: string[];
  duplicate_gate_ids: string[];
  latest_open_debt_without_gate: Array<{
    evidence_id: string;
    scorecard_file: string;
  }>;
  resolved_debt_with_unready_gate: Array<{
    evidence_id: string;
    scorecard_file: string;
  }>;
};

async function main(): Promise<void> {
  const report = buildBenchmarkEvidenceIdReport({
    scorecardFiles: await loadScorecardEvidenceDebt(),
    benchmarkGateIds: (await readJson<BenchmarkGateRecord>(".agent-factory/benchmark-gate-report.json")).evidence_gates,
  });

  if (report.ok) {
    console.log(`Checked ${report.benchmark_gate_count} benchmark evidence gate IDs against ${report.scorecard_debt_count} scorecard evidence debt records.`);
    return;
  }

  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

async function loadScorecardEvidenceDebt(): Promise<BenchmarkEvidenceIdInput["scorecardFiles"]> {
  const files = await globFiles("iterations/**/*scorecard.json");
  const scorecardFiles: BenchmarkEvidenceIdInput["scorecardFiles"] = [];

  for (const file of files.sort()) {
    const scorecard = await readJson<ScorecardRecord>(file);
    scorecardFiles.push({
      file,
      evidenceDebt: scorecard.evidence_debt,
    });
  }

  return scorecardFiles;
}

export function buildBenchmarkEvidenceIdReport(input: BenchmarkEvidenceIdInput): BenchmarkEvidenceIdReport {
  const debtById = new Map<string, Array<{ file: string; status: string }>>();
  for (const scorecardFile of input.scorecardFiles) {
    for (const debt of scorecardFile.evidenceDebt) {
      debtById.set(debt.id, [
        ...(debtById.get(debt.id) ?? []),
        { file: scorecardFile.file, status: debt.status },
      ]);
    }
  }

  const gateIdCounts = new Map<string, number>();
  for (const gate of input.benchmarkGateIds) {
    gateIdCounts.set(gate.evidence_id, (gateIdCounts.get(gate.evidence_id) ?? 0) + 1);
  }
  const gateById = new Map(input.benchmarkGateIds.map((gate) => [gate.evidence_id, gate]));
  const latestScorecardFile = [...input.scorecardFiles]
    .sort((left, right) => left.file.localeCompare(right.file))
    .at(-1);

  const gatesWithoutScorecardDebt = input.benchmarkGateIds
    .map((gate) => gate.evidence_id)
    .filter((id) => !debtById.has(id));
  const duplicateGateIds = [...gateIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const latestOpenDebtWithoutGate = latestScorecardFile
    ? latestScorecardFile.evidenceDebt
      .filter((debt) => debt.status === "open" && !gateById.has(debt.id))
      .map((debt) => ({
        evidence_id: debt.id,
        scorecard_file: latestScorecardFile.file,
      }))
      .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id))
    : [];
  const resolvedDebtWithUnreadyGate = [...debtById.entries()]
    .flatMap(([id, debtRecords]) => {
      const gate = gateById.get(id);
      if (!gate || gate.ready_to_resolve) {
        return [];
      }
      return debtRecords
        .filter((record) => record.status === "resolved")
        .map((record) => ({
          evidence_id: id,
          scorecard_file: record.file,
        }));
    })
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id) || left.scorecard_file.localeCompare(right.scorecard_file));

  return {
    ok: gatesWithoutScorecardDebt.length === 0
      && duplicateGateIds.length === 0
      && latestOpenDebtWithoutGate.length === 0
      && resolvedDebtWithUnreadyGate.length === 0,
    scorecard_debt_count: [...debtById.values()].reduce((sum, records) => sum + records.length, 0),
    benchmark_gate_count: input.benchmarkGateIds.length,
    gates_without_scorecard_debt: [...new Set(gatesWithoutScorecardDebt)].sort(),
    duplicate_gate_ids: duplicateGateIds,
    latest_open_debt_without_gate: latestOpenDebtWithoutGate,
    resolved_debt_with_unready_gate: resolvedDebtWithUnreadyGate,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
