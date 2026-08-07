/**
 * #108 multi-station exam assembly inspector.
 *
 * Measures the live assembly path: default blueprint + pool + assembleExamForm.
 * claimScope: blueprint slot capacity vs declared breaks; distinct pool-drawn stations; approval gate.
 * notEvidenceFor: psychometric station order, learner runtime behaviour, clinical validity.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  selectExamStationScenarios,
  STEP2CS_STATION_COUNT,
} from "../../../packages/openclinxr/exam-assembly/src/index.js";
import { edChestPainScenario } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { buildExamAssemblyScenarioPool } from "../../../apps/api/src/exam-assembly-pool.js";

export type AssemblyReport = {
  blueprintStationSlotCount: number;
  blueprintBreakAfterStationOrders: number[];
  poolScenarioIds: string[];
  assembledStations: { order: number; slotId: string | null; scenarioId: string }[];
  unreachableScenarioIds: string[];
  refusedUnapproved: boolean;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactPath = path.join(repoRoot, ".openclinxr/evidence/multi-station-exam-assembly-report.json");

/**
 * Run the real assembly path over `buildExamAssemblyScenarioPool` and report slot capacity,
 * which stations locked into the form, and which pool members remain unreachable.
 *
 * slotId is correlated by position against sorted blueprint slots — stationRefs have no slotId.
 */
export async function inspectExamAssembly(): Promise<AssemblyReport> {
  // Empty authored list: fixture bank only (same merge path as API with no authored content).
  const pool = await buildExamAssemblyScenarioPool({
    listAuthoredScenarios: async () => [],
  });

  const blueprint = createDefaultClinicalSkillsBlueprint(pool, {
    stationCount: STEP2CS_STATION_COUNT,
  });
  const sortedSlots = [...blueprint.stationSlots].sort(
    (left, right) => left.order - right.order || left.slotId.localeCompare(right.slotId),
  );

  const selected = selectExamStationScenarios(pool, STEP2CS_STATION_COUNT);
  const approvedSelected = selected.filter((scenario) => scenario.status === "approved");

  const form = assembleExamForm({
    examFormId: "form_inspect_multi_station_exam_assembly",
    blueprint,
    scenarios: approvedSelected,
  });

  // stationRefs have no slotId — correlate by position against the same sortedSlots zip assemble uses.
  const assembledStations = form.stationRefs.map((ref, index) => ({
    order: ref.order,
    slotId: sortedSlots[index]?.slotId ?? null,
    scenarioId: ref.scenarioId,
  }));

  const assembledIds = new Set(assembledStations.map((station) => station.scenarioId));
  const unreachableScenarioIds = pool
    .map((scenario) => scenario.scenarioId)
    .filter((scenarioId) => !assembledIds.has(scenarioId));

  let refusedUnapproved = false;
  try {
    assembleExamForm({
      examFormId: "form_inspect_unapproved_counterweight",
      blueprint: createDefaultClinicalSkillsBlueprint([edChestPainScenario]),
      scenarios: [{ ...edChestPainScenario, status: "draft" }],
    });
  } catch {
    refusedUnapproved = true;
  }

  const report: AssemblyReport = {
    blueprintStationSlotCount: blueprint.stationSlots.length,
    blueprintBreakAfterStationOrders: [...blueprint.timing.breakAfterStationOrders],
    poolScenarioIds: pool.map((scenario) => scenario.scenarioId),
    assembledStations,
    unreachableScenarioIds,
    refusedUnapproved,
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return report;
}
