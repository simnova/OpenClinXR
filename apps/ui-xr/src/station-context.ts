/**
 * Station EHR / doorway context for the selected scenario
 * (#115 vitals honesty + #127 chart-row honesty).
 *
 * Title/subtitle/aria prefer an aligned runtime bundle. Vitals always go through
 * resolveInitialVitalsForScenario. Chief concern + interruption always go through
 * resolveChartFieldsForScenario — never scoring objectives or event-schedule tags.
 */

import {
  resolveChartFieldsForScenario,
  type ChartFieldAuthorshipStatus,
} from "./station-chart.js";
import {
  resolveInitialVitalsForScenario,
  type InitialVitalsAuthorshipStatus,
} from "./station-vitals.js";

export type StationContextView = {
  title: string;
  subtitle: string;
  chiefConcern: string;
  chiefConcernAuthorship: ChartFieldAuthorshipStatus;
  chiefConcernEhrRowLabel: string;
  initialVitals: string;
  initialVitalsAuthorship: InitialVitalsAuthorshipStatus;
  presentedAsChartedVitals: boolean;
  vitalsEhrRowLabel: string;
  interruption: string;
  interruptionAuthorship: ChartFieldAuthorshipStatus;
  interruptionEhrRowLabel: string;
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
 * Build the learner-facing station context.
 * Vitals + chart rows are SSOT from resolve helpers even when the shipped bundle
 * still carries stale objectives / schedule tags / prose.
 */
export function stationContextForScenario(input: {
  scenarioId: string;
  runtimeContext?: RuntimeStationContextInput | null | undefined;
  bundleMismatch?: boolean | undefined;
}): StationContextView {
  const vitals = resolveInitialVitalsForScenario(input.scenarioId);
  const chart = resolveChartFieldsForScenario(input.scenarioId);
  const runtime = input.runtimeContext;
  if (!input.bundleMismatch && runtime) {
    return {
      title: runtime.title,
      subtitle: runtime.subtitle,
      // #127: never pass through shipped chiefConcern / interruption — they may print the test.
      chiefConcern: chart.chiefConcern,
      chiefConcernAuthorship: chart.chiefConcernAuthorship,
      chiefConcernEhrRowLabel: chart.chiefConcernEhrRowLabel,
      initialVitals: vitals.rawValue,
      initialVitalsAuthorship: vitals.authorshipStatus,
      presentedAsChartedVitals: vitals.presentedAsChartedVitals,
      vitalsEhrRowLabel: vitals.ehrRowLabel,
      interruption: chart.interruption,
      interruptionAuthorship: chart.interruptionAuthorship,
      interruptionEhrRowLabel: chart.interruptionEhrRowLabel,
      stageAriaLabel: runtime.stageAriaLabel,
      canvasAriaLabel: runtime.canvasAriaLabel,
    };
  }
  const title = titleFromScenarioId(input.scenarioId);
  return {
    title,
    subtitle:
      "Scenario-bank generated encounter with actor, room prop, equipment, and dialogue evidence selected by runtime bundle.",
    chiefConcern: chart.chiefConcern,
    chiefConcernAuthorship: chart.chiefConcernAuthorship,
    chiefConcernEhrRowLabel: chart.chiefConcernEhrRowLabel,
    initialVitals: vitals.rawValue,
    initialVitalsAuthorship: vitals.authorshipStatus,
    presentedAsChartedVitals: vitals.presentedAsChartedVitals,
    vitalsEhrRowLabel: vitals.ehrRowLabel,
    interruption: chart.interruption,
    interruptionAuthorship: chart.interruptionAuthorship,
    interruptionEhrRowLabel: chart.interruptionEhrRowLabel,
    stageAriaLabel: `${title} station scene`,
    canvasAriaLabel: `3D ${title} preview`,
  };
}
