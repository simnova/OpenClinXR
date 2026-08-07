/**
 * #115 — station vitals honesty inspector.
 *
 * Enumerates every scenarioBank station, reads the shipped learner bundle the runtime
 * loads, and reports class + provenance + presentation using the same resolve helpers
 * the UI-XR app uses (stationContextForScenario / resolveInitialVitalsForScenario).
 *
 * claimScope: vitals field honesty / provenance (not clinical correctness of numbers).
 * notEvidenceFor: clinical validity, exam equivalence, scoring, Quest readiness.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import { factoryResolveInitialVitals } from "../factory/generated-ed-station-runtime-bundle.js";
import { stationContextForScenario } from "../../../apps/ui-xr/src/station-context.js";
import {
  classifyInitialVitalsRaw,
  type InitialVitalsValueClass,
} from "../../../apps/ui-xr/src/station-vitals.js";

export type StationVitals = {
  scenarioId: string;
  rawValue: string;
  valueClass: InitialVitalsValueClass;
  authorshipStatus: string;
  presentedAsChartedVitals: boolean;
};

export type StationVitalsHonestyReport = {
  stations: StationVitals[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

async function readShippedLearnerBundle(scenarioId: string): Promise<{
  scenarioId?: string;
  sceneManifest?: {
    stationContext?: {
      initialVitals?: string;
      initialVitalsAuthorship?: string;
      title?: string;
      subtitle?: string;
      chiefConcern?: string;
      interruption?: string;
      stageAriaLabel?: string;
      canvasAriaLabel?: string;
    };
  };
} | null> {
  const bundlePath = path.join(generatedRoot, scenarioId, "learner-runtime-bundle.v1.json");
  if (!existsSync(bundlePath)) return null;
  return JSON.parse(await readFile(bundlePath, "utf8")) as {
    scenarioId?: string;
    sceneManifest?: {
      stationContext?: {
        initialVitals?: string;
        initialVitalsAuthorship?: string;
        title?: string;
        subtitle?: string;
        chiefConcern?: string;
        interruption?: string;
        stageAriaLabel?: string;
        canvasAriaLabel?: string;
      };
    };
  };
}

/**
 * What the learner sees for each bank station. Runtime resolve is SSOT for display;
 * shipped bundle raw is still classified so un-patched prose fails the contract.
 */
export async function inspectStationVitalsHonesty(): Promise<StationVitalsHonestyReport> {
  const stations: StationVitals[] = [];

  for (const scenario of scenarioBank) {
    const scenarioId = scenario.scenarioId;
    const shipped = await readShippedLearnerBundle(scenarioId);
    const factory = factoryResolveInitialVitals(scenarioId);
    const ctx = shipped?.sceneManifest?.stationContext;

    const view = stationContextForScenario({
      scenarioId,
      runtimeContext: ctx
        ? {
            title: ctx.title ?? scenarioId,
            subtitle: ctx.subtitle ?? "",
            chiefConcern: ctx.chiefConcern ?? "",
            initialVitals: ctx.initialVitals,
            initialVitalsAuthorship: ctx.initialVitalsAuthorship,
            interruption: ctx.interruption ?? "",
            stageAriaLabel: ctx.stageAriaLabel ?? "",
            canvasAriaLabel: ctx.canvasAriaLabel ?? "",
          }
        : null,
      bundleMismatch: !shipped,
    });

    const shippedRaw = ctx?.initialVitals ?? "";
    const shippedAuth = ctx?.initialVitalsAuthorship ?? factory.initialVitalsAuthorship;
    const shippedClass = shippedRaw
      ? classifyInitialVitalsRaw(shippedRaw, shippedAuth)
      : "unauthored";

    // If shipped still has prose/placeholder, report that class (contract (1) fails).
    // Otherwise report the runtime presentation class.
    let valueClass: InitialVitalsValueClass = view.presentedAsChartedVitals
      ? "authored_numeric"
      : "unauthored";
    if (shipped && (shippedClass === "environment_prose" || shippedClass === "unclassified")) {
      valueClass = shippedClass;
    }

    stations.push({
      scenarioId,
      rawValue: view.initialVitals,
      valueClass,
      authorshipStatus: view.initialVitalsAuthorship,
      presentedAsChartedVitals: view.presentedAsChartedVitals,
    });
  }

  return { stations };
}
