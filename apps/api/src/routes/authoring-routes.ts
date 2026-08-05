import type { Hono } from "hono";
import { routeById } from "@openclinxr/rest";
import { type Scenario, validateScenario } from "@openclinxr/shared-schemas";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";

/** Authoring domain routes (composition-root migration). */
export function registerAuthoringRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { persistence } = ctx;

  app.post(routeById("save-authored-scenario").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { scenario?: unknown };
    const validation = validateScenario(body.scenario);
    if (!validation.ok) {
      return context.json({ error: "invalid_scenario", details: validation.errors }, 400);
    }
    const scenario = body.scenario as Scenario;
    if (!persistence.saveAuthoredScenario) {
      return context.json({ error: "authored_scenario_persistence_unavailable" }, 503);
    }
    await persistence.saveAuthoredScenario(scenario);
    return context.json({ saved: true, scenarioId: scenario.scenarioId, version: scenario.version }, 201);
  });

  app.get(routeById("list-authored-scenarios").path, async (context) => {
    const scenarios = (await persistence.listAuthoredScenarios?.()) ?? [];
    return context.json({ scenarios });
  });

  app.get(routeById("get-authored-scenario").path, async (context) => {
    const scenarioId = context.req.param("scenarioId");
    const scenario = await persistence.getAuthoredScenario?.(scenarioId);
    if (!scenario) {
      return context.json({ error: "authored_scenario_not_found" }, 404);
    }
    return context.json({ scenario });
  });

}
