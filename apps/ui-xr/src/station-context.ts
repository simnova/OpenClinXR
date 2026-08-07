/**
 * Station EHR / doorway context for the selected scenario (#115 vitals honesty).
 *
 * Non-vitals fields prefer an aligned runtime bundle. Vitals always go through
 * resolveInitialVitalsForScenario — never environment prose or placeholders.
 */

import {
  resolveInitialVitalsForScenario,
  type InitialVitalsAuthorshipStatus,
} from "./station-vitals.js";

export type StationContextView = {
  title: string;
  subtitle: string;
  chiefConcern: string;
  initialVitals: string;
  initialVitalsAuthorship: InitialVitalsAuthorshipStatus;
  presentedAsChartedVitals: boolean;
  vitalsEhrRowLabel: string;
  interruption: string;
  stageAriaLabel: string;
  canvasAriaLabel: string;
};

export type RuntimeStationContextInput = {
  title: string;
  subtitle: string;
  chiefConcern: string;
  initialVitals?: string;
  initialVitalsAuthorship?: string;
  interruption: string;
  stageAriaLabel: string;
  canvasAriaLabel: string;
};

function titleFromScenarioId(scenarioId: string): string {
  return scenarioId
    .replace(/_v\d+$/u, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Build the learner-facing station context. Vitals are SSOT from resolveInitialVitalsForScenario
 * even when the shipped bundle still carries stale prose/placeholders.
 */
export function stationContextForScenario(input: {
  scenarioId: string;
  runtimeContext?: RuntimeStationContextInput | null | undefined;
  bundleMismatch?: boolean | undefined;
}): StationContextView {
  const vitals = resolveInitialVitalsForScenario(input.scenarioId);
  const runtime = input.runtimeContext;
  if (!input.bundleMismatch && runtime) {
    return {
      title: runtime.title,
      subtitle: runtime.subtitle,
      chiefConcern: runtime.chiefConcern,
      initialVitals: vitals.rawValue,
      initialVitalsAuthorship: vitals.authorshipStatus,
      presentedAsChartedVitals: vitals.presentedAsChartedVitals,
      vitalsEhrRowLabel: vitals.ehrRowLabel,
      interruption: runtime.interruption,
      stageAriaLabel: runtime.stageAriaLabel,
      canvasAriaLabel: runtime.canvasAriaLabel,
    };
  }
  const title = titleFromScenarioId(input.scenarioId);
  return {
    title,
    subtitle:
      "Scenario-bank generated encounter with actor, room prop, equipment, and dialogue evidence selected by runtime bundle.",
    chiefConcern: "Generated scenario objective pending review",
    initialVitals: vitals.rawValue,
    initialVitalsAuthorship: vitals.authorshipStatus,
    presentedAsChartedVitals: vitals.presentedAsChartedVitals,
    vitalsEhrRowLabel: vitals.ehrRowLabel,
    interruption: "Trace event cue pending review",
    stageAriaLabel: `${title} station scene`,
    canvasAriaLabel: `3D ${title} preview`,
  };
}
