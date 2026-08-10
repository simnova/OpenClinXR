/**
 * #166 — pre-fix baseline measurement + artifact writer.
 *
 * Records all 14 shipped scenarios (status / validationStage / four review flags /
 * isActivationEligible) measured through the REAL api routes and the REAL learner resolver
 * (`createApiApp` + in-process fetch + `resolveLearnerExamScenarios`) before any edit, so the
 * before-column is observed rather than reconstructed.
 *
 * `isActivationEligible` for every scenario comes from the readiness route's
 * `activationEligibleScenarioIds` — the REAL gate (`assembly.ts:367-373`) run over the whole pool
 * by `evaluateBlueprintScenarioReadiness`, not a local re-implementation.
 */

import { scenarioBank } from "@openclinxr/scenario-fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BLUEPRINT_ID,
  IN_PROCESS_ORIGIN,
  createAuthoredMemorySink,
  createInProcessFetch,
  isRecord,
  loadLearnerScenarioResolver,
  readReadiness,
  repoRoot,
  requestApp,
  reviewStatesFromRecord,
  type HonoLikeApp,
} from "./scenario-promotion-io.js";
import { createApiApp } from "./index.js";

export const PRE_FIX_ARTIFACT_RELATIVE_PATH = ".openclinxr/evidence/issue-166/pre-fix.json";

export type BaselineScenarioRow = {
  scenarioId: string;
  status: string;
  validationStage: string;
  reviewStates: Record<string, string>;
  isActivationEligible: boolean;
  queueStatus: string;
  queueBlockers: string[];
  /** "api_authored" | "bank_residual" | null when the resolver did not return the scenario. */
  bodySource: string | null;
};

export type BankBaseline = {
  blueprintId: string;
  measuredAt: string;
  scenarioCount: number;
  shippedBankApprovedCount: number;
  shippedBankStageZeroCount: number;
  activationEligibleCount: number;
  canStartLearnerExam: boolean;
  queueStationCount: number;
  resolution: {
    scenarioSource: string;
    fallbackActive: boolean;
    bodySourceCounts: Record<string, number>;
  };
  scenarios: BaselineScenarioRow[];
  claimScope: string;
  notEvidenceFor: string[];
};

async function readQueueBody(
  app: HonoLikeApp,
  requestedPaths: string[],
): Promise<{ canStartLearnerExam: boolean; byId: Map<string, { status: string; blockers: string[] }> }> {
  const res = await requestApp(
    app,
    `/exam-blueprints/${BLUEPRINT_ID}/station-run-queue`,
    undefined,
    requestedPaths,
  );
  if (res.status !== 200) {
    throw new Error(`station-run-queue failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    canStartLearnerExam?: boolean;
    stationQueue?: Array<{ scenarioId?: string | null; status?: string; blockers?: unknown }>;
  };
  const byId = new Map<string, { status: string; blockers: string[] }>();
  for (const item of body.stationQueue ?? []) {
    if (typeof item.scenarioId === "string" && item.scenarioId.length > 0) {
      byId.set(item.scenarioId, {
        status: item.status ?? "unknown",
        blockers: Array.isArray(item.blockers) ? item.blockers.map(String) : [],
      });
    }
  }
  return { canStartLearnerExam: body.canStartLearnerExam === true, byId };
}

/**
 * Baseline measurement used by the pre-fix artifact: all 14 shipped scenarios, read through the
 * real API — the readiness route (the REAL `isActivationEligible` over the whole pool), the real
 * station-run-queue, and the REAL learner resolver (each queue record carries `bodySource`).
 */
export async function measureBankBaseline(): Promise<BankBaseline> {
  const sink = createAuthoredMemorySink();
  const app = createApiApp(undefined, sink);
  const requestedPaths: string[] = [];

  const readiness = await readReadiness(app, requestedPaths);
  const queue = await readQueueBody(app, requestedPaths);

  const resolver = await loadLearnerScenarioResolver();
  const fetchAdapter = createInProcessFetch(app, requestedPaths);
  const resolution = await resolver({
    baseUrl: IN_PROCESS_ORIGIN,
    blueprintId: BLUEPRINT_ID,
    fetch: fetchAdapter,
  });

  const resolvedById = new Map(resolution.scenarios.map((s) => [s.scenarioId, s]));
  const bodySourceCounts: Record<string, number> = {};
  for (const record of resolution.scenarios) {
    const source = typeof record.bodySource === "string" ? record.bodySource : "no_bodySource";
    bodySourceCounts[source] = (bodySourceCounts[source] ?? 0) + 1;
  }

  const scenarios: BaselineScenarioRow[] = scenarioBank.map((fixture) => {
    const resolved = resolvedById.get(fixture.scenarioId);
    const body = resolved ?? fixture;
    const queueRead = queue.byId.get(fixture.scenarioId);
    return {
      scenarioId: fixture.scenarioId,
      status: typeof body["status"] === "string" ? (body["status"] as string) : fixture.status,
      validationStage:
        isRecord(body["governance"]) && typeof body["governance"]["validationStage"] === "string"
          ? (body["governance"]["validationStage"] as string)
          : fixture.governance.validationStage,
      reviewStates: isRecord(body["review"])
        ? reviewStatesFromRecord(body["review"])
        : {
            clinical: fixture.review.clinical,
            psychometric: fixture.review.psychometric,
            legal: fixture.review.legal,
            simulationQa: fixture.review.simulationQa,
          },
      isActivationEligible: readiness.activationEligibleScenarioIds.includes(fixture.scenarioId),
      queueStatus: queueRead?.status ?? "not_in_queue",
      queueBlockers: queueRead?.blockers ?? [],
      bodySource: resolved && typeof resolved.bodySource === "string" ? resolved.bodySource : null,
    };
  });

  return {
    blueprintId: BLUEPRINT_ID,
    measuredAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    shippedBankApprovedCount: scenarioBank.filter((s) => s.status === "approved").length,
    shippedBankStageZeroCount: scenarioBank.filter(
      (s) => s.governance.validationStage === "stage_0_synthetic_draft",
    ).length,
    activationEligibleCount: readiness.activationEligibleScenarioIds.length,
    canStartLearnerExam: queue.canStartLearnerExam,
    queueStationCount: queue.byId.size,
    resolution: {
      scenarioSource: resolution.scenarioSource,
      fallbackActive: resolution.fallbackActive,
      bodySourceCounts,
    },
    scenarios,
    claimScope:
      "all_14_shipped_scenarios_measured_through_real_api_routes_and_real_learner_resolver_before_any_edit",
    notEvidenceFor: [
      "clinical_validity_of_approvals",
      "psychometric_readiness",
      "exam_equivalence",
      "xr_scene",
      "cast",
      "garments",
      "rooms",
      "auto_promotion_of_shipped_bank",
      "startable_full_12_station_exam",
    ],
  };
}

/** Write the pre-fix baseline artifact. Returns the absolute artifact path. */
export async function writePreFixArtifact(): Promise<string> {
  const baseline = await measureBankBaseline();
  const artifactPath = join(repoRoot(), PRE_FIX_ARTIFACT_RELATIVE_PATH);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return artifactPath;
}
