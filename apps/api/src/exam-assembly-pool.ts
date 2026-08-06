import { scenarioBank } from "@openclinxr/scenario-fixtures";
import type { Scenario } from "@openclinxr/shared-schemas";
import type { ApiPersistenceSink } from "./api-types.js";

/**
 * Assembly pool = fixture bank UNION persisted authored scenarios.
 *
 * The case bank is a LIBRARY (station-selection.ts): fixtures stay so seed blueprints and pilot
 * demos do not break when authored work appears. Authored wins on scenarioId clash (reversible
 * default). Only approved authored scenarios enter the pool — draft authored work can be listed
 * and started individually, but must not become exam stations until approved.
 */
export async function buildExamAssemblyScenarioPool(
  persistence: Pick<ApiPersistenceSink, "listAuthoredScenarios">,
): Promise<Scenario[]> {
  const authored = (await Promise.resolve(persistence.listAuthoredScenarios?.() ?? [])) as Scenario[];
  const approvedAuthored = authored.filter((scenario) => scenario.status === "approved");

  const fixtureIds = new Set(scenarioBank.map((scenario) => scenario.scenarioId));
  const authoredById = new Map(approvedAuthored.map((scenario) => [scenario.scenarioId, scenario]));

  // Fixtures first (authored override in place), then authored-only ids appended in persistence order.
  const pool: Scenario[] = scenarioBank.map((fixture) => authoredById.get(fixture.scenarioId) ?? fixture);
  for (const scenario of approvedAuthored) {
    if (!fixtureIds.has(scenario.scenarioId)) {
      pool.push(scenario);
    }
  }
  return pool;
}
