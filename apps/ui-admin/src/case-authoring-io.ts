/**
 * Data helpers extracted from CaseAuthoringWorkbench.tsx.
 *
 * WHY: the file-size ratchet (architecture-rules/src/checks/file-size-budgets.ts) freezes that
 * panel at 679 lines and its semantics are explicit — a frozen file "may only SHRINK; any growth
 * fails the gate, forcing extraction". W17 (governance + reviewRubric authoring) grew it to 717,
 * so the gate correctly refused the next commit that touched an architecture-relevant path.
 *
 * These five are pure data functions with no JSX and no React state, so they are the clean cut:
 * the panel keeps its rendering, the shape-coercion moves here. Nothing else imported them —
 * verified before the move — so this is a pure relocation, not an API change.
 */
import type { Scenario } from "@openclinxr/shared-schemas";
import { createActorDraft } from "./case-authoring-model.js";

export function actorFormFromDraft(actor: ReturnType<typeof createActorDraft>) {
  return {
    actorId: actor.actorId,
    role: actor.role,
    displayName: actor.displayName,
    demeanor: actor.demeanor ?? "",
    hiddenFacts: [],
    touchResponses: [],
  };
}

export function structuredCloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractScenarioList(raw: unknown): Array<{ scenarioId: string; version: number }> {
  if (!isRecord(raw)) {
    return [];
  }
  const scenarios = raw["scenarios"];
  if (!Array.isArray(scenarios)) {
    return [];
  }
  return scenarios
    .filter(isRecord)
    .map((entry) => {
      const scenarioId = typeof entry["scenarioId"] === "string" ? entry["scenarioId"] : "";
      const version = typeof entry["version"] === "number" ? entry["version"] : 0;
      return { scenarioId, version };
    })
    .filter((entry) => entry.scenarioId.length > 0);
}

export function extractScenario(raw: unknown): Scenario | null {
  if (!isRecord(raw)) {
    return null;
  }
  const scenario = raw["scenario"];
  if (!isRecord(scenario) || typeof scenario["scenarioId"] !== "string") {
    // Allow bare Scenario body if server ever returns it unwrapped.
    if (typeof raw["scenarioId"] === "string") {
      return raw as Scenario;
    }
    return null;
  }
  return scenario as Scenario;
}
