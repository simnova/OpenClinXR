/**
 * #115 — honest INITIAL VITALS presentation.
 *
 * This module does NOT author clinical vitals. Numeric strings exist only for the two
 * historical hardcodes (ed_chest_pain, peds_asthma) marked legacy_hardcoded_unreviewed —
 * not clinician-reviewed. Do not invent BP/HR/RR/SpO2 for other stations.
 *
 * claimScope: field honesty / provenance class for the EHR vitals row.
 * notEvidenceFor: clinical validity, exam equivalence, scoring, Quest readiness.
 */

/** Learner-facing copy when no reviewed vitals exist. Plain; does not imply data exists elsewhere. */
export const UNAUTHORED_INITIAL_VITALS_COPY =
  "Not charted — obtain vitals during the encounter";

/**
 * Provenance for the vitals string.
 * - unauthored: no charted numbers; show honest copy; not presented as charted data
 * - legacy_hardcoded_unreviewed: historical factory hardcodes (not clinician-reviewed)
 * - authored_reviewed: reserved for a future clinician-authored slice — never set here
 */
export type InitialVitalsAuthorshipStatus =
  | "unauthored"
  | "legacy_hardcoded_unreviewed"
  | "authored_reviewed";

export type InitialVitalsValueClass =
  | "unauthored"
  | "authored_numeric"
  | "environment_prose"
  | "unclassified";

export type ResolvedInitialVitals = {
  rawValue: string;
  valueClass: InitialVitalsValueClass;
  authorshipStatus: InitialVitalsAuthorshipStatus;
  /** True only for real numeric vitals shown as charted data. */
  presentedAsChartedVitals: boolean;
  /** EHR row label. Unauthored uses a status label so it is not "charted vitals". */
  ehrRowLabel: string;
};

/** Historical hardcodes only — not reviewed clinical content. */
const LEGACY_NUMERIC_VITALS: Readonly<Record<string, string>> = {
  ed_chest_pain_priority_v1: "BP 152/92, HR 104, RR 20, SpO2 96%",
  // Same historical ED hardcode shipped on the v2 asset variant.
  ed_chest_pain_priority_v2: "BP 152/92, HR 104, RR 20, SpO2 96%",
  peds_asthma_parent_anxiety_v1: "HR 128, RR 32, SpO2 91% on room air",
};

const PLACEHOLDER_PATTERNS = [
  /pending authored station shell/iu,
  /pending headset validation/iu,
  /not provided by generated fallback/iu,
  /generated environment evidence/iu,
  /scenario-specific vitals pending/iu,
];

const ENVIRONMENT_PROSE_PATTERNS = [
  /\bcues?\b/iu,
  /exam table/iu,
  /tissue-box/iu,
  /post-op bed/iu,
  /bedside monitor/iu,
  /iv pump/iu,
  /chairs and/iu,
  /workflow/iu,
  /closed-loop team/iu,
  /last-known-well/iu,
  /no acute medical instability/iu,
  /home glucose logs/iu,
  /remote visit/iu,
  /bp cue requires/iu,
];

/**
 * Resolve honest vitals for a station. Default is unauthored — never invent numbers.
 */
export function resolveInitialVitalsForScenario(scenarioId: string): ResolvedInitialVitals {
  const legacy = LEGACY_NUMERIC_VITALS[scenarioId];
  if (legacy) {
    return {
      rawValue: legacy,
      valueClass: "authored_numeric",
      authorshipStatus: "legacy_hardcoded_unreviewed",
      presentedAsChartedVitals: true,
      ehrRowLabel: "Initial vitals",
    };
  }
  return {
    rawValue: UNAUTHORED_INITIAL_VITALS_COPY,
    valueClass: "unauthored",
    authorshipStatus: "unauthored",
    presentedAsChartedVitals: false,
    ehrRowLabel: "Vitals status",
  };
}

/**
 * Classify a raw shipped string (for inspect / migration). Prefer resolveInitialVitalsForScenario
 * for product paths; this only diagnoses legacy dishonest content.
 */
export function classifyInitialVitalsRaw(
  rawValue: string,
  authorshipStatus?: string | null,
): InitialVitalsValueClass {
  const raw = rawValue.trim();
  if (!raw) return "unclassified";
  if (raw === UNAUTHORED_INITIAL_VITALS_COPY) return "unauthored";
  if (
    authorshipStatus === "legacy_hardcoded_unreviewed" ||
    authorshipStatus === "authored_reviewed"
  ) {
    if (/\d/u.test(raw)) return "authored_numeric";
  }
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(raw))) return "unclassified";
  if (ENVIRONMENT_PROSE_PATTERNS.some((re) => re.test(raw))) return "environment_prose";
  // Numbers with legacy authorship already handled; bare numbers without provenance are unclassified
  // (do not promote them to authored_numeric — that would reward invented vitals).
  if (/\d/u.test(raw) && /(?:BP|HR|RR|SpO2)/iu.test(raw)) {
    if (authorshipStatus && authorshipStatus !== "unauthored") return "authored_numeric";
    return "unclassified";
  }
  return "unclassified";
}

/** Presentation flags for a resolved (or re-classified) vitals row. */
export function vitalsPresentationFromResolved(
  resolved: Pick<ResolvedInitialVitals, "valueClass" | "authorshipStatus">,
): Pick<ResolvedInitialVitals, "presentedAsChartedVitals" | "ehrRowLabel"> {
  const charted =
    resolved.valueClass === "authored_numeric" &&
    resolved.authorshipStatus !== "unauthored";
  return {
    presentedAsChartedVitals: charted,
    ehrRowLabel: charted ? "Initial vitals" : "Vitals status",
  };
}
