/**
 * Canonical staging contracts — expected posture derived from case intent.
 *
 * F2 scope only. No posture/case/app edits here; this module only READS the
 * canonical sources the product already ships, through their PUBLIC entrypoints:
 * - case intent: `placement.supportSurface` per actor read directly from
 *   `scenarioBank` from `@openclinxr/scenario-fixtures/scenario-bank`
 *   (case-authored patient placement, e.g. psychiatric-safety.ts:42);
 *   ph54 narrowing: the former `authoredCasePlacements` dependency was a
 *   redundant mixed entrypoint (direct bank intent matches it 6/6) and is
 *   removed to hold the architecture ceiling — no behavior change;
 * - canonical posture: `createEdChestPainRuntimeSceneManifest` +
 *   `resolveScenarioActorCast` from `@openclinxr/asset-registry/runtime-bundles`
 *   (reviewed public bundle output
 *   `sceneManifest.actorPlacements[primaryPatientActorId].posture`);
 * - posture vocabulary: `resolveActorPosture` from
 *   `@openclinxr/asset-registry/actor-posture` (env/scenario markers).
 *
 * The supportSurface->posture rule (chair->seated, stretcher/bed/
 * exam_table->supine, else standing) lives inside the reviewed public factory's
 * scene manifest, proven from the six case-source lines cited in
 * SIX_CANONICAL_DECLARATIONS (ph37 adversarial correction over ph36), not
 * from observed rows; unit (a) proves the factory maps all six current cases
 * to their declared postures.
 *
 * The six disputed stations are case-authored declarations, not new clinical
 * rulings. Each entry below cites the exact case source line verified in
 * ph37 (adversarial correction over ph36).
 */

import {
  createEdChestPainRuntimeSceneManifest,
  resolveScenarioActorCast,
} from "@openclinxr/asset-registry/runtime-bundles";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";

export type CanonicalPosture = "standing" | "seated" | "supine";

export interface CanonicalDeclaration {
  scenarioId: string;
  primarySupportSurface: string;
  expectedPosture: CanonicalPosture;
  caseSource: string;
}

/**
 * Six explicit canonical declarations (ph37 F2 proven set).
 * supportSurface values are the CURRENT case-authored intent; expected
 * posture follows the reviewed public factory scene manifest output, not
 * observed rows.
 */
export const SIX_CANONICAL_DECLARATIONS: readonly CanonicalDeclaration[] = [
  {
    scenarioId: "psych_suicidal_ideation_safety_v1",
    primarySupportSurface: "chair",
    expectedPosture: "seated",
    caseSource:
      "packages/openclinxr/scenario-fixtures/src/psychiatric-safety.ts:42",
  },
  {
    scenarioId: "ed_stroke_alert_handoff_v1",
    primarySupportSurface: "stretcher",
    expectedPosture: "supine",
    caseSource: "packages/openclinxr/scenario-fixtures/src/stroke-alert.ts:28-29",
  },
  {
    scenarioId: "primary_care_dyslipidemia_joint_pain_v1",
    primarySupportSurface: "exam_table",
    expectedPosture: "supine",
    caseSource:
      "packages/openclinxr/scenario-fixtures/src/primary-care-dyslipidemia.ts:28",
  },
  {
    scenarioId: "adult_abdominal_pain_v1",
    primarySupportSurface: "stretcher",
    expectedPosture: "supine",
    caseSource:
      "packages/openclinxr/scenario-fixtures/src/adult-abdominal-pain.ts:51-52",
  },
  {
    scenarioId: "peds_fever_v1",
    primarySupportSurface: "stretcher",
    expectedPosture: "supine",
    caseSource: "packages/openclinxr/scenario-fixtures/src/peds-fever.ts:51-52",
  },
  {
    scenarioId: "clinic_knee_pain_return_to_play_v1",
    primarySupportSurface: "chair",
    expectedPosture: "seated",
    caseSource: "packages/openclinxr/scenario-fixtures/src/clinic-knee-pain.ts:51-52",
  },
] as const;

export const INPATIENT_TARGET_SCENARIO_IDS = [
  "ward_delirium_med_rec_v1",
  "stepdown_sepsis_nurse_escalation_v1",
  "postop_fever_consult_pressure_v1",
] as const;

export const PINNED_SUPINE_SCENARIO_IDS = [
  "ed_chest_pain_priority_v1",
  "ed_stroke_alert_handoff_v1",
] as const;

export const PINNED_SEATED_SCENARIO_ID =
  "telehealth_diabetes_health_literacy_v1" as const;

/**
 * Full declared-nonstanding set for primary-patient rows:
 * 3 inpatient targets + ED chest pin + telehealth pin + the six.
 * ed_stroke appears in both the pin list and the six; deduped below.
 * Everything NOT in this set is normatively standing.
 */
export const DECLARED_NONSTANDING_SCENARIO_IDS: readonly string[] = [
  ...INPATIENT_TARGET_SCENARIO_IDS,
  "ed_chest_pain_priority_v1",
  PINNED_SEATED_SCENARIO_ID,
  ...SIX_CANONICAL_DECLARATIONS.map((d) => d.scenarioId),
].filter((id, i, all) => all.indexOf(id) === i);

/**
 * Primary-patient authored supportSurface for a scenario, or null when absent.
 * Patient identity and authored placement both come from the public
 * scenarioBank (the patient actor's own `placement.supportSurface`).
 */
export function primarySupportSurfaceForScenario(
  scenarioId: string,
): string | null {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!scenario) return null;
  const actors = (scenario as unknown as { actors?: Array<{ actorId: string; role?: string; placement?: { supportSurface?: unknown } }> }).actors;
  if (!Array.isArray(actors)) return null;
  const patient = actors.find((a) => a?.role === "patient");
  if (!patient) return null;
  const surface = patient.placement?.supportSurface;
  return typeof surface === "string" ? surface : null;
}

/**
 * Expected primary posture from canonical package output, independent of any
 * observed live row. Returns null when the scenario has no authored patient
 * placement (caller treats as standing only if scenario is undeclared).
 * Source is the reviewed public `createEdChestPainRuntimeSceneManifest`
 * output `actorPlacements[primaryPatientActorId].posture` (patient identity
 * via public `resolveScenarioActorCast`/`scenarioBank`); no copied
 * supportSurface mapping and no private helper import.
 */
export function expectedPostureFromCaseIntent(
  scenarioId: string,
): CanonicalPosture | null {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!scenario) return null;
  const actors = (scenario as unknown as { actors?: Array<{ actorId: string; role?: string }> }).actors;
  if (!Array.isArray(actors)) return null;
  const patient = actors.find((a) => a?.role === "patient");
  if (!patient) return null;
  const cast = resolveScenarioActorCast(scenarioId);
  const castPatient = cast.find((c) => c.role === "patient");
  const patientActorId = castPatient?.actorId ?? patient.actorId;
  const manifest = createEdChestPainRuntimeSceneManifest({ scenarioId });
  const posture = (manifest.actorPlacements as Record<string, { posture?: unknown }>)?.[patientActorId]?.posture;
  if (posture === "seated" || posture === "supine" || posture === "standing") return posture;
  return null;
}

export type MinimalStagingRow = {
  scenarioId: string;
  posture: string;
};

export interface CounterweightEvaluation {
  undeclaredNonstanding: string[];
  mismatchedDeclared: string[];
}

/**
 * Pure counterweight evaluator (no browser, no live scene).
 * - undeclaredNonstanding: rows whose posture != standing while their
 *   scenario is NOT in the declared set. Normative standing guard.
 * - mismatchedDeclared: declared rows whose observed posture != expected
 *   posture from canonical intent (caller supplies expected map so the
 *   expectation stays independent of the observed rows).
 */
export function evaluateStagingCounterweight(
  rows: readonly MinimalStagingRow[],
  expectedByScenarioId: Readonly<Record<string, string>>,
  declaredScenarioIds: readonly string[] = DECLARED_NONSTANDING_SCENARIO_IDS,
): CounterweightEvaluation {
  const declared = new Set(declaredScenarioIds);
  const undeclaredNonstanding: string[] = [];
  const mismatchedDeclared: string[] = [];
  for (const row of rows) {
    const expected = expectedByScenarioId[row.scenarioId];
    if (!declared.has(row.scenarioId)) {
      if (row.posture !== "standing") {
        undeclaredNonstanding.push(`${row.scenarioId}: ${row.posture}`);
      }
      continue;
    }
    if (typeof expected === "string" && row.posture !== expected) {
      mismatchedDeclared.push(
        `${row.scenarioId}: observed=${row.posture} expected=${expected}`,
      );
    }
  }
  return { undeclaredNonstanding, mismatchedDeclared };
}
