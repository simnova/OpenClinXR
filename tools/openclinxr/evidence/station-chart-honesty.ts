/**
 * #127 — station chart honesty inspector (chief concern + interruption).
 *
 * Enumerates every scenarioBank station, reads the shipped learner bundle the runtime
 * loads, and reports chart-field values + provenance + objective-overlap using the same
 * resolve helpers the UI-XR app uses (stationContextForScenario / factoryResolveChartFields).
 *
 * claimScope: chart-row honesty / provenance (not clinical correctness of any text).
 * notEvidenceFor: clinical validity, exam equivalence, scoring, Quest readiness.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import {
  factoryResolveChartFields,
  factoryResolveInitialVitals,
} from "../factory/generated-ed-station-runtime-bundle.js";
import { stationContextForScenario } from "../../../apps/ui-xr/src/station-context.js";
import { classifyInitialVitalsRaw } from "../../../apps/ui-xr/src/station-vitals.js";

export type ChartFieldSource =
  | "authored_patient_voice"
  | "authored_reviewed"
  | "legacy_hardcoded_unreviewed"
  | "unauthored"
  | "derived_from_objective"
  | "derived_from_event_schedule";

export type StationChartField = {
  fieldName: string;
  rawValue: string;
  source: ChartFieldSource;
  maxObjectiveOverlap: number;
  looksLikeScheduleSynthesis: boolean;
};

export type StationChart = {
  scenarioId: string;
  fields: StationChartField[];
  initialVitalsAuthorship: string;
  initialVitalsValueClass: string;
};

export type StationChartHonestyReport = {
  stations: StationChart[];
};

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "been",
  "being", "have", "has", "had", "not", "but", "you", "your", "our", "their", "they",
  "she", "him", "her", "his", "its", "who", "what", "when", "where", "why", "how",
  "can", "may", "will", "shall", "into", "onto", "over", "under", "about", "after",
  "before", "during", "while", "than", "then", "also", "only", "just", "very", "more",
  "most", "some", "any", "all", "each", "other", "such", "own", "same", "both", "few",
  "many", "much", "too", "out", "off", "via", "per",
]);

function normalizeTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gu, " ")
      .split(/\s+/u)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

/** Normalized token-set overlap in 0..1 (Jaccard-like with max-size denominator). */
export function objectiveTokenOverlap(rawValue: string, objective: string): number {
  const A = normalizeTokens(rawValue);
  const B = normalizeTokens(objective);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

export function maxObjectiveOverlap(rawValue: string, objectives: readonly string[]): number {
  if (objectives.length === 0) return 0;
  return Math.max(0, ...objectives.map((o) => objectiveTokenOverlap(rawValue, o)));
}

export function looksLikeScheduleSynthesis(rawValue: string): boolean {
  return /\bcue at\b/iu.test(rawValue) || /\d+s:/u.test(rawValue);
}

const HONEST: ReadonlySet<ChartFieldSource> = new Set([
  "authored_patient_voice",
  "authored_reviewed",
  "legacy_hardcoded_unreviewed",
  "unauthored",
]);

function asHonestSource(raw: string): ChartFieldSource {
  if (HONEST.has(raw as ChartFieldSource)) return raw as ChartFieldSource;
  return "unauthored";
}

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
      chiefConcernAuthorship?: string;
      interruption?: string;
      interruptionAuthorship?: string;
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
        chiefConcernAuthorship?: string;
        interruption?: string;
        interruptionAuthorship?: string;
        stageAriaLabel?: string;
        canvasAriaLabel?: string;
      };
    };
  };
}

/**
 * What the learner sees for each bank station. Runtime resolve is SSOT for display
 * (stationContextForScenario always uses resolveChartFieldsForScenario); factory source
 * records provenance for contract (2).
 */
export async function inspectStationChartHonesty(): Promise<StationChartHonestyReport> {
  const stations: StationChart[] = [];

  for (const scenario of scenarioBank) {
    const scenarioId = scenario.scenarioId;
    const shipped = await readShippedLearnerBundle(scenarioId);
    const factory = factoryResolveChartFields(scenarioId);
    const vitalsFactory = factoryResolveInitialVitals(scenarioId);
    const ctx = shipped?.sceneManifest?.stationContext;
    const objectives = scenario.clinicalObjectives ?? [];

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

    const chiefSource = asHonestSource(view.chiefConcernAuthorship);
    const interruptSource = asHonestSource(view.interruptionAuthorship);

    // Defense: if someone re-wires pass-through of shipped dishonest rows, report them
    // as derived so contract (1)/(2) stay red until fixed.
    let chiefReportSource: ChartFieldSource = chiefSource;
    let interruptReportSource: ChartFieldSource = interruptSource;
    if (
      shipped?.sceneManifest?.stationContext?.chiefConcern === view.chiefConcern &&
      factory.chiefConcern !== view.chiefConcern &&
      maxObjectiveOverlap(view.chiefConcern, objectives) > 0.5
    ) {
      chiefReportSource = "derived_from_objective";
    }
    if (looksLikeScheduleSynthesis(view.interruption)) {
      interruptReportSource = "derived_from_event_schedule";
    }

    const shippedRaw = ctx?.initialVitals ?? "";
    const shippedAuth = ctx?.initialVitalsAuthorship ?? vitalsFactory.initialVitalsAuthorship;
    const shippedClass = shippedRaw
      ? classifyInitialVitalsRaw(shippedRaw, shippedAuth)
      : "unauthored";
    let initialVitalsValueClass = view.presentedAsChartedVitals
      ? "authored_numeric"
      : "unauthored";
    if (shipped && (shippedClass === "environment_prose" || shippedClass === "unclassified")) {
      initialVitalsValueClass = shippedClass;
    }

    stations.push({
      scenarioId,
      fields: [
        {
          fieldName: "chiefConcern",
          rawValue: view.chiefConcern,
          source: chiefReportSource,
          maxObjectiveOverlap: maxObjectiveOverlap(view.chiefConcern, objectives),
          looksLikeScheduleSynthesis: looksLikeScheduleSynthesis(view.chiefConcern),
        },
        {
          fieldName: "interruption",
          rawValue: view.interruption,
          source: interruptReportSource,
          maxObjectiveOverlap: maxObjectiveOverlap(view.interruption, objectives),
          looksLikeScheduleSynthesis: looksLikeScheduleSynthesis(view.interruption),
        },
      ],
      initialVitalsAuthorship: view.initialVitalsAuthorship,
      initialVitalsValueClass,
    });
  }

  return { stations };
}
