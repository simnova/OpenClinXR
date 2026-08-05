import type { Hono } from "hono";
import { assembleExamForm, createDefaultClinicalSkillsBlueprint, createExamStationRunQueue, createExamTimingPlan, createStep2CsStyleSeedBlueprint, evaluateBlueprintScenarioReadiness, evaluateScenarioVersionDrift } from "@openclinxr/exam-assembly";
import { routeById } from "@openclinxr/rest";
import { edChestPainScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { createSeedStationRunQueueSnapshot, isExamForm } from "../api-route-support.js";

/** Exam domain routes (composition-root migration). */
export function registerExamRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { persistence } = ctx;

  app.get(routeById("default-exam-blueprint").path, (context) => context.json(createDefaultClinicalSkillsBlueprint()));

  app.get(routeById("step2cs-seed-exam-blueprint").path, (context) => context.json(createStep2CsStyleSeedBlueprint()));

  app.get(routeById("step2cs-seed-exam-blueprint-readiness").path, (context) =>
    context.json(evaluateBlueprintScenarioReadiness(createStep2CsStyleSeedBlueprint(), scenarioBank)),
  );

  app.get(routeById("step2cs-seed-exam-timing-plan").path, (context) =>
    context.json(createExamTimingPlan(createStep2CsStyleSeedBlueprint())),
  );

  app.get(routeById("step2cs-seed-station-run-queue").path, (context) =>
    context.json(createExamStationRunQueue(createStep2CsStyleSeedBlueprint(), scenarioBank)),
  );

  app.get(routeById("list-step2cs-seed-station-run-queue-snapshots").path, async (context) => {
    const blueprintId = createStep2CsStyleSeedBlueprint().blueprintId;
    return context.json(await Promise.resolve(persistence.listStationRunQueueSnapshots?.(blueprintId) ?? []));
  });

  app.post(routeById("create-step2cs-seed-station-run-queue-snapshot").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      snapshotId?: unknown;
      createdAt?: unknown;
      reviewerId?: unknown;
    };
    const snapshot = createSeedStationRunQueueSnapshot(body);

    await persistence.saveStationRunQueueSnapshot?.(snapshot);
    return context.json(snapshot, 201);
  });

  app.post(routeById("create-exam-form").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { examFormId?: string };
    const form = assembleExamForm({
      examFormId: body.examFormId ?? "form_openclinxr_pilot_001",
      blueprint: createDefaultClinicalSkillsBlueprint(),
      scenarios: [edChestPainScenario],
    });
    await persistence.saveExamForm?.(form);
    return context.json(form, 201);
  });

  app.post(routeById("exam-form-version-drift").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { form?: unknown };
    if (!isExamForm(body.form)) {
      return context.json({ error: "invalid_exam_form" }, 400);
    }

    return context.json(evaluateScenarioVersionDrift(body.form, [edChestPainScenario]));
  });

  // Authored scenario persistence (control-plane). Registered after literal
  // /scenarios/ed-chest-pain* handlers so Hono prefers static learner routes.
}
