/**
 * #127 — honest chief-concern / interruption presentation for the Simulated EHR.
 *
 * Does NOT invent clinical presenting complaints. Does NOT print scoring objectives
 * or event-schedule tags. Patient voice may come only from bank-authored
 * `openingUtterance` (#113). Default is honest unauthored copy (same voice/shape as #115).
 *
 * claimScope: chart-row honesty / provenance (not clinical correctness of any text).
 * notEvidenceFor: clinical validity, exam equivalence, scoring, Quest readiness.
 */

import { findScenarioFixtureById } from "@openclinxr/scenario-fixtures/scenario-bank";

/** Learner-facing copy when no presenting complaint is authored. Match #115 shape. */
export const UNAUTHORED_CHIEF_CONCERN_COPY =
  "Not charted — obtain chief concern during the encounter";

/** Learner-facing copy when no interruption is authored for the chart. Match #115 shape. */
export const UNAUTHORED_INTERRUPTION_COPY =
  "Not charted — observe interruptions during the encounter";

/**
 * Provenance for a learner-visible chart row.
 * - unauthored: honest absence copy; not presented as charted clinical data
 * - authored_patient_voice: bank patient openingUtterance (#113)
 * - legacy_hardcoded_unreviewed: historical hardcodes (not clinician-reviewed)
 * - authored_reviewed: reserved for a future clinician-authored slice — never set here
 */
export type ChartFieldAuthorshipStatus =
  | "unauthored"
  | "authored_patient_voice"
  | "legacy_hardcoded_unreviewed"
  | "authored_reviewed";

export type ResolvedChartFields = {
  chiefConcern: string;
  chiefConcernAuthorship: ChartFieldAuthorshipStatus;
  /** EHR row label. Unauthored uses a status label so it is not "charted chief concern". */
  chiefConcernEhrRowLabel: string;
  interruption: string;
  interruptionAuthorship: ChartFieldAuthorshipStatus;
  interruptionEhrRowLabel: string;
};

/**
 * Resolve honest chart rows for a station.
 *
 * Decisions (#127):
 * 1. Chief concern from authored patient openingUtterance when present (authored_patient_voice).
 *    Rejected: clinicalObjectives[0] (prints the exam); inventing presenting complaints for
 *    the bank; blank rows (#73 / §6p).
 * 2. Interruption is always unauthored honest copy. Rejected: event-schedule tag synthesis
 *    (debug string in the chart); inventing narrative interruptions for eleven stations.
 * 3. Unauthored copy voice matches #115 exactly ("Not charted — obtain … during the encounter").
 *    Rejected alternate strings left for the report only — product voice is not implementer choice.
 * 4. ED bay keeps patient-voice chest language via openingUtterance (counterweight /chest/).
 *    Rejected re-using clinicalObjectives; rejected deleting the row.
 */
export function resolveChartFieldsForScenario(scenarioId: string): ResolvedChartFields {
  const scenario = findScenarioFixtureById(scenarioId);
  const patient =
    scenario?.actors.find((actor) => actor.role === "patient") ?? scenario?.actors[0];
  const opening = patient?.openingUtterance?.trim() ?? "";

  const interruption = {
    interruption: UNAUTHORED_INTERRUPTION_COPY,
    interruptionAuthorship: "unauthored" as const,
    interruptionEhrRowLabel: "Interruption status",
  };

  if (opening.length > 0) {
    return {
      chiefConcern: opening,
      chiefConcernAuthorship: "authored_patient_voice",
      chiefConcernEhrRowLabel: "Chief concern",
      ...interruption,
    };
  }

  return {
    chiefConcern: UNAUTHORED_CHIEF_CONCERN_COPY,
    chiefConcernAuthorship: "unauthored",
    chiefConcernEhrRowLabel: "Chief concern status",
    ...interruption,
  };
}
