import type { Hono } from "hono";
import {
  assembleExamForm,
  createDefaultClinicalSkillsBlueprint,
  createExamStationRunQueue,
  createExamTimingPlan,
  createStep2CsStyleSeedBlueprint,
  evaluateBlueprintScenarioReadiness,
  evaluateScenarioVersionDrift,
  selectExamStationScenarios,
  STEP2CS_STATION_COUNT,
} from "@openclinxr/exam-assembly";
import { routeById } from "@openclinxr/rest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import type { ApiAppContext } from "../api-app-context.js";
import type { ApiAppVariables } from "../api-types.js";
import { createSeedStationRunQueueSnapshot, isExamForm } from "../api-route-support.js";
import { buildExamAssemblyScenarioPool } from "../exam-assembly-pool.js";

/** Exam domain routes (composition-root migration). */
export function registerExamRoutes(app: Hono<{ Variables: ApiAppVariables }>, ctx: ApiAppContext): void {
  const { persistence } = ctx;

  app.get(routeById("default-exam-blueprint").path, async (context) => {
    // Multi-station pilot blueprint from the assembly pool (not the no-arg single-station default).
    const pool = await buildExamAssemblyScenarioPool(persistence);
    return context.json(createDefaultClinicalSkillsBlueprint(pool));
  });

  app.get(routeById("step2cs-seed-exam-blueprint").path, async (context) => {
    const pool = await buildExamAssemblyScenarioPool(persistence);
    return context.json(createStep2CsStyleSeedBlueprint(pool));
  });

  app.get(routeById("step2cs-seed-exam-blueprint-readiness").path, async (context) => {
    const pool = await buildExamAssemblyScenarioPool(persistence);
    return context.json(evaluateBlueprintScenarioReadiness(createStep2CsStyleSeedBlueprint(pool), pool));
  });

  app.get(routeById("step2cs-seed-exam-timing-plan").path, async (context) => {
    const pool = await buildExamAssemblyScenarioPool(persistence);
    return context.json(createExamTimingPlan(createStep2CsStyleSeedBlueprint(pool)));
  });

  app.get(routeById("step2cs-seed-station-run-queue").path, async (context) => {
    const pool = await buildExamAssemblyScenarioPool(persistence);
    return context.json(createExamStationRunQueue(createStep2CsStyleSeedBlueprint(pool), pool));
  });

  app.get(routeById("list-step2cs-seed-station-run-queue-snapshots").path, async (context) => {
    const pool = await buildExamAssemblyScenarioPool(persistence);
    const blueprintId = createStep2CsStyleSeedBlueprint(pool).blueprintId;
    return context.json(await Promise.resolve(persistence.listStationRunQueueSnapshots?.(blueprintId) ?? []));
  });

  app.post(routeById("create-step2cs-seed-station-run-queue-snapshot").path, async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      snapshotId?: unknown;
      createdAt?: unknown;
      reviewerId?: unknown;
    };
    const pool = await buildExamAssemblyScenarioPool(persistence);
    const snapshot = createSeedStationRunQueueSnapshot(body, pool);

    await persistence.saveStationRunQueueSnapshot?.(snapshot);
    return context.json(snapshot, 201);
  });

  app.post(routeById("create-exam-form").path, async (context) => {
    // Multi-station pilot form from the assembly pool (not a hardcoded ED singleton).
    // Decisions (#108):
    // - Optional body.stationCount; default STEP2CS_STATION_COUNT (12).
    // - Blueprint slots from selectExamStationScenarios over the pool (includes drafts as slot
    //   definitions so breakAfterStationOrders stay consistent).
    // - Form scenarios: only status===approved members of that selection, in selection order.
    // - When approved count < slot count: assemble short form against the full multi-station
    //   blueprint (stationCount.ok false / assemblyIssues) — fail soft, not throw. Rejected:
    //   shrinking the blueprint to approved-only (hides incomplete capacity); including drafts
    //   (breaks approval gate); throwing when pool is short (breaks 1-approved pilot demos).
    const body = (await context.req.json().catch(() => ({}))) as {
      examFormId?: string;
      stationCount?: unknown;
    };
    const pool = await buildExamAssemblyScenarioPool(persistence);
    const stationCount =
      typeof body.stationCount === "number" && Number.isFinite(body.stationCount) && body.stationCount > 0
        ? Math.floor(body.stationCount)
        : STEP2CS_STATION_COUNT;
    const blueprint = createDefaultClinicalSkillsBlueprint(pool, { stationCount });
    const selected = selectExamStationScenarios(pool, stationCount);
    const approvedSelected = selected.filter((scenario) => scenario.status === "approved");
    const form = assembleExamForm({
      examFormId: body.examFormId ?? "form_openclinxr_pilot_001",
      blueprint,
      scenarios: approvedSelected,
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
