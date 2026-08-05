import type { Scenario } from "@openclinxr/shared-schemas";
import { scenarioBank } from "@openclinxr/scenario-fixtures";

/**
 * Catalog-source discriminant for admin listing and runtime loading.
 * "fixture" = repo-bundled scenario fixture (scenarioBank).
 * "authored" = persisted authored scenario via ScenarioCatalogPort.
 */
export type ScenarioCatalogSource = "fixture" | "authored";

/**
 * Port for authored-scenario persistence lookups.
 * Hosts (API bootstrap, tests) wire their persistence sink through this contract
 * so the scenario catalog stays decoupled from concrete persistence.
 */
export interface ScenarioCatalogPort {
  getAuthoredScenario?(scenarioId: string): Promise<Scenario | undefined> | Scenario | undefined;
  listAuthoredScenarios?(): Promise<Scenario[]> | Scenario[];
}

/** Resolved catalog entry with source discriminant for admin listing consumers. */
export interface ScenarioCatalogEntry {
  scenario: Scenario;
  catalogSource: ScenarioCatalogSource;
}

/**
 * Resolve a scenario by id from authored persistence (preferred) falling back to
 * the fixture bank. Authored-first ensures authoring edits override fixtures without
 * mutating the in-repo bank.
 */
export async function resolveScenarioById(
  scenarioId: string,
  port?: ScenarioCatalogPort,
): Promise<ScenarioCatalogEntry | undefined> {
  // Authored first — lets authoring edits shadow fixture ids.
  if (port?.getAuthoredScenario) {
    const authored = await port.getAuthoredScenario(scenarioId);
    if (authored) {
      return { scenario: authored, catalogSource: "authored" };
    }
  }

  // Fall back to fixture bank.
  for (const scenario of scenarioBank) {
    if (scenario.scenarioId === scenarioId) {
      return { scenario, catalogSource: "fixture" };
    }
  }

  return undefined;
}
