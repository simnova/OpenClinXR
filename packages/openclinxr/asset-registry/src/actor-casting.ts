/**
 * Scenario → actor casting SSOT (#85 / #96 / #102).
 *
 * Decision: GENERATE/PROMOTE adult assets for adult ED roles (route A), with
 * age-band refuse so a child asset cannot silently resolve into an adult slot.
 *
 * #96: role-distinct wardrobe for the ED bay (content-hash identity, not assetId).
 * #102: WITHIN-SCENARIO distinctness for every shipped scenario, reusing the 6
 * on-disk humanoid GLBs (cross-scenario reuse is fine; global uniqueness is not
 * required and is impossible with 6 bodies × 30 roles).
 *
 * Stature and provenance are read from the ASSET (geometry + provenance JSON),
 * never from fields this module invents at inspect time.
 */

import { scenarioBank } from "@openclinxr/scenario-fixtures";

export type DeclaredAgeBand = "adult" | "child" | "infant" | "unknown";

export type ScenarioActorCast = {
  actorId: string;
  role: string;
  declaredAgeBand: DeclaredAgeBand;
  /** Repo-relative path for inspectors / file reads. */
  assetPath: string;
  /** Public URL path used by UI-XR GLTFLoader. */
  runtimeAssetPath: string;
  /** Repo-relative provenance JSON path. */
  provenanceManifestPath: string;
};

/** Discrete floor: child 1.25 m, shorter adult 1.66 m — open space, not a tuned threshold. */
export const ADULT_STATURE_FLOOR_METERS = 1.5;

export const ED_CHEST_PAIN_SCENARIO_ID = "ed_chest_pain_priority_v1";
export const PEDS_ASTHMA_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";
/** #263 — the OB triage station whose patient is the first promoted MPFB2 cast. */
export const OB_HEADACHE_PREECLAMPSIA_SCENARIO_ID = "ob_headache_preeclampsia_triage_v1";

// Cast asset names/paths live in cast-asset-constants.ts (#403 split — keeps this
// resolver within its file-size budget). Re-export the previously-exported symbols
// so the import surface is unchanged.
import {
  ADULT_MALE_STREET_CASUAL_GLB,
  ADULT_POOL_GLBS,
  CANDIDATES,
  ED_ADULT_CAST_GLB,
  ED_ADULT_CAST_PROVENANCE_PATH,
  ED_ADULT_CAST_RUNTIME_PATH,
  ED_NURSE_GLB,
  ED_SPOUSE_GLB,
  GENERATED,
  LIBRARY_ADULT_LEAN_FEMALE_GLB,
  MPFB_CLINICAL_NURSE_ADULT_GLB,
  MPFB_CLINICAL_PHYSICIAN_ADULT_GLB,
  MPFB_FAMILY_PARTNER_ADULT_GLB,
  MPFB_OB_PATIENT_AISHA_GLB,
  MPFB_PEDS_NURSE_KEVIN_GLB,
  MPFB_PEDS_PARENT_AISHA_GLB,
  MPFB_PEDS_PARENT_AISHA_MOTION_BIND_GLB,
  MPFB_PEDS_PATIENT_CHILD_GLB,
  MPFB_STREET_ADULT_MALE_GLB,
  PEDS_CHILD_GLB,
  PEDS_NURSE_GLB,
  PEDS_PARENT_GLB,
  RUNTIME_CANDIDATES,
  RUNTIME_GENERATED,
} from "./cast-asset-constants.js";
export {
  ADULT_MALE_STREET_CASUAL_GLB,
  ED_ADULT_CAST_ASSET_PATH,
  ED_ADULT_CAST_PROVENANCE_PATH,
  ED_ADULT_CAST_RUNTIME_PATH,
  LIBRARY_ADULT_LEAN_FEMALE_GLB,
  LIBRARY_ADULT_HEAVY_MALE_GLB,
  MPFB_CLINICAL_NURSE_ADULT_GLB,
  MPFB_CLINICAL_PHYSICIAN_ADULT_GLB,
  MPFB_FAMILY_PARTNER_ADULT_GLB,
  MPFB_OB_PATIENT_AISHA_GLB,
  MPFB_PEDS_NURSE_KEVIN_GLB,
  MPFB_PEDS_PARENT_AISHA_GLB,
  MPFB_PEDS_PARENT_AISHA_MOTION_BIND_GLB,
  MPFB_PEDS_PATIENT_CHILD_GLB,
  MPFB_STREET_ADULT_MALE_GLB,
} from "./cast-asset-constants.js";


/**
 * Patient wardrobe class vocabulary (#160).
 * Decision: two classes — `street_casual` (home + ambulatory clinic/primary/oncology)
 * and `inpatient_gown` (ED, ward, stepdown, postop, stroke, OB, psych, peds exam).
 * Rejected: four-way home|clinic|inpatient|ed split (no clinic-distinct asset);
 * psych exam-gown intermediate (second asset, out of scope).
 */
export type PatientWardrobeClass = "street_casual" | "inpatient_gown";

/**
 * Explicit environmentId → patient wardrobe class (#160).
 * Shape matches #44 shell table / #81 posture table. Pattern match is FALLBACK only.
 */
export const PATIENT_WARDROBE_CLASS_BY_ENVIRONMENT_ID: Readonly<
  Record<string, PatientWardrobeClass>
> = {
  telehealth_home_visit_v1: "street_casual",
  primary_care_clinic_room_v1: "street_casual",
  urgent_care_clinic_room_v1: "street_casual",
  oncology_consult_room_v1: "street_casual",
  ed_exam_bay_v1: "inpatient_gown",
  ed_stroke_bay_v1: "inpatient_gown",
  adult_ed_abdominal_bay_v1: "inpatient_gown",
  inpatient_ward_room_v1: "inpatient_gown",
  stepdown_room_v1: "inpatient_gown",
  surgical_ward_room_v1: "inpatient_gown",
  ob_triage_room_v1: "inpatient_gown",
  behavioral_health_private_room_v1: "inpatient_gown",
  pediatric_urgent_care_bay_v1: "inpatient_gown",
  pediatric_fever_urgent_care_bay_v1: "inpatient_gown",
};

/**
 * Resolve patient wardrobe class for an environment id.
 * Named FALLBACK: substring match only when the id is not in the explicit table.
 */
export function patientWardrobeClassForEnvironment(
  environmentId: string,
): PatientWardrobeClass {
  const explicit = PATIENT_WARDROBE_CLASS_BY_ENVIRONMENT_ID[environmentId];
  if (explicit) return explicit;
  const id = environmentId.toLowerCase();
  // FALLBACK for unknown ids — not the SSOT (explicit table is).
  if (
    id.includes("telehealth")
    || id.includes("home")
    || id.includes("primary_care")
    || id.includes("clinic")
    || id.includes("oncology")
  ) {
    return "street_casual";
  }
  return "inpatient_gown";
}

/** Read environmentId from a bank scenario (nested under environment). */
export function environmentIdForScenario(scenarioId: string): string {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId) as
    | { environment?: { environmentId?: string }; environmentId?: string }
    | undefined;
  if (!scenario) return "";
  return scenario.environment?.environmentId
    ?? scenario.environmentId
    ?? "";
}

/**
 * Declared age band from scenario + role — NOT from the resolved asset.
 * Pediatric patient is child; all other humanoid roles in known bank scenarios are adult.
 */
export function declareAgeBand(input: {
  scenarioId: string;
  role: string;
  actorId?: string;
}): DeclaredAgeBand {
  const role = input.role.toLowerCase();
  const sid = input.scenarioId;
  if (
    (sid === PEDS_ASTHMA_SCENARIO_ID || sid.startsWith("peds_"))
    && (role === "patient" || (input.actorId ?? "").includes("maya") || (input.actorId ?? "").includes("patient_maya"))
  ) {
    // School-age patient only — parents/nurses in peds cases are adults.
    if (role === "patient") return "child";
  }
  if (
    role === "patient"
    || role === "nurse"
    || role === "family"
    || role === "family_member"
    || role === "parent"
    || role === "spouse"
    || role === "physician"
    || role === "medical_assistant"
    || role === "respiratory_therapist"
    || role === "consultant"
    || role === "interpreter"
  ) {
    return "adult";
  }
  return "unknown";
}

function castEntry(input: {
  actorId: string;
  role: string;
  scenarioId: string;
  glbFile: string;
}): ScenarioActorCast {
  return {
    actorId: input.actorId,
    role: input.role,
    declaredAgeBand: declareAgeBand({ scenarioId: input.scenarioId, role: input.role, actorId: input.actorId }),
    assetPath: `${GENERATED}/${input.glbFile}`,
    runtimeAssetPath: `${RUNTIME_GENERATED}/${input.glbFile}`,
    provenanceManifestPath: `${GENERATED}/${input.glbFile.replace(/\.glb$/u, ".provenance.json")}`,
  };
}

/** #218 — cast row pointing at the body-param library under candidates/ (not generated-humanoids). */
function libraryCastEntry(input: {
  actorId: string;
  role: string;
  scenarioId: string;
  glbFile: string;
}): ScenarioActorCast {
  return {
    actorId: input.actorId,
    role: input.role,
    declaredAgeBand: declareAgeBand({ scenarioId: input.scenarioId, role: input.role, actorId: input.actorId }),
    assetPath: `${CANDIDATES}/${input.glbFile}`,
    runtimeAssetPath: `${RUNTIME_CANDIDATES}/${input.glbFile}`,
    provenanceManifestPath: `${CANDIDATES}/${input.glbFile.replace(/\.glb$/u, ".provenance.json")}`,
  };
}

/** Non-embodied / non-mesh actors — do not consume a humanoid body slot. */
function isHumanoidCastActor(actor: { actorId: string; role: string }): boolean {
  const role = actor.role.toLowerCase();
  if (role === "system") return false;
  if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
  return true;
}

/**
 * Prefer role-appropriate wardrobe from the adult pool, then any unused body.
 * Guarantees within-scenario content-hash distinctness when roles.length <= pool size.
 *
 * #160: patient preference is conditioned on PatientWardrobeClass (care setting),
 * not a hard-coded gown-first list. Street patients take the male street body first
 * so family can keep female street shells without content collision.
 */
function pickAdultGlb(
  role: string,
  used: Set<string>,
  patientWardrobeClass: PatientWardrobeClass = "inpatient_gown",
): string {
  const r = role.toLowerCase();
  const preferred: string[] = [];
  if (r === "patient") {
    if (patientWardrobeClass === "street_casual") {
      // #444: the four street_casual patients take the MPFB male street body first
      // (137 joints, library t-shirt + cargo trousers); the 23-joint Anny street
      // body stays immediately behind as the second-body fallback.
      preferred.push(
        MPFB_STREET_ADULT_MALE_GLB,
        ADULT_MALE_STREET_CASUAL_GLB,
        ED_SPOUSE_GLB,
        PEDS_PARENT_GLB,
        ED_NURSE_GLB,
        PEDS_NURSE_GLB,
        ED_ADULT_CAST_GLB,
      );
    } else {
      preferred.push(
        ED_ADULT_CAST_GLB,
        ED_NURSE_GLB,
        PEDS_NURSE_GLB,
        ED_SPOUSE_GLB,
        PEDS_PARENT_GLB,
        ADULT_MALE_STREET_CASUAL_GLB,
      );
    }
  } else if (r === "physician") {
    // 2026-08-14 medical wardrobe: the physician takes the dedicated MPFB
    // physician body (scrub shirt + scrub pants + CC0 lab coat) first. Mirrors
    // the runtime copy in humanoid-runtime-asset-url.ts (both must change
    // together — the patient-attire dual-resolver agreement asserts this).
    preferred.push(MPFB_CLINICAL_PHYSICIAN_ADULT_GLB, MPFB_CLINICAL_NURSE_ADULT_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB, ED_ADULT_CAST_GLB, PEDS_PARENT_GLB, ED_SPOUSE_GLB, ADULT_MALE_STREET_CASUAL_GLB);
  } else if (r === "nurse" || r === "medical_assistant" || r === "respiratory_therapist" || r === "consultant") {
    // #403: nurse-class roles take the MPFB clinical-nurse body first (the Anny
    // nurse file stays as a second-body fallback for co-present nurse-class actors).
    // The physician is NOT here — it has its own body since 2026-08-14.
    preferred.push(MPFB_CLINICAL_NURSE_ADULT_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB, ED_ADULT_CAST_GLB, PEDS_PARENT_GLB, ED_SPOUSE_GLB, ADULT_MALE_STREET_CASUAL_GLB);
  } else if (r === "family" || r === "family_member" || r === "parent" || r === "spouse") {
    // #403: family-class roles take the MPFB family-partner body first.
    preferred.push(MPFB_FAMILY_PARTNER_ADULT_GLB, ED_SPOUSE_GLB, PEDS_PARENT_GLB, ADULT_MALE_STREET_CASUAL_GLB, ED_ADULT_CAST_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB);
  } else {
    preferred.push(...ADULT_POOL_GLBS);
  }
  for (const glb of preferred) {
    if (!used.has(glb)) return glb;
  }
  for (const glb of ADULT_POOL_GLBS) {
    if (!used.has(glb)) return glb;
  }
  // Exhausted pool — prefer gown body as last resort for clinical safety of default.
  return ED_ADULT_CAST_GLB;
}

function castFromScenarioBank(scenarioId: string): ScenarioActorCast[] {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!scenario) return [];

  const humanoids = scenario.actors.filter(isHumanoidCastActor);
  const used = new Set<string>();
  const out: ScenarioActorCast[] = [];
  const envId = environmentIdForScenario(scenarioId);
  const patientWardrobe = patientWardrobeClassForEnvironment(envId);

  // Child patients first so they claim the single child mesh before adults fill the pool.
  const ordered = [...humanoids].sort((a, b) => {
    const aChild = declareAgeBand({ scenarioId, role: a.role, actorId: a.actorId }) === "child" ? 0 : 1;
    const bChild = declareAgeBand({ scenarioId, role: b.role, actorId: b.actorId }) === "child" ? 0 : 1;
    if (aChild !== bChild) return aChild - bChild;
    return a.actorId.localeCompare(b.actorId);
  });

  for (const actor of ordered) {
    const band = declareAgeBand({ scenarioId, role: actor.role, actorId: actor.actorId });
    let glbFile: string;
    if (band === "child") {
      glbFile = PEDS_CHILD_GLB;
      used.add(glbFile);
    } else {
      glbFile = pickAdultGlb(actor.role, used, patientWardrobe);
      used.add(glbFile);
    }
    out.push(castEntry({
      actorId: actor.actorId,
      role: actor.role,
      scenarioId,
      glbFile,
    }));
  }

  return out;
}

/**
 * Resolve the cast for a known scenario. Explicit tables for the two generation
 * stations (#85/#96); all other bank scenarios get pool assignment (#102).
 * No silent "nearest humanoid" that could hand a pediatric patient to an adult slot.
 */
export function resolveScenarioActorCast(scenarioId: string): ScenarioActorCast[] {
  if (scenarioId === ED_CHEST_PAIN_SCENARIO_ID || scenarioId === "ed_chest_pain_priority_v2") {
    // All three ED roles are adults with role-distinct wardrobe (#96):
    // patient = male base + hospital_gown; nurse = male scrubs; spouse = female street clothes.
    return [
      castEntry({
        actorId: "patient_robert_hayes_v1",
        role: "patient",
        scenarioId: ED_CHEST_PAIN_SCENARIO_ID,
        glbFile: ED_ADULT_CAST_GLB,
      }),
      castEntry({
        actorId: "nurse_maria_alvarez_v1",
        role: "nurse",
        scenarioId: ED_CHEST_PAIN_SCENARIO_ID,
        // #403: the ED nurse is the first MPFB clinical-nurse adult cast slot.
        glbFile: MPFB_CLINICAL_NURSE_ADULT_GLB,
      }),
      // #218: stage ONE library body via ordinary cast resolution (spouse only).
      // Patient keeps Anny gown (#160 counterweight). Nurse keeps Anny scrubs.
      libraryCastEntry({
        actorId: "spouse_anna_hayes_v1",
        role: "family",
        scenarioId: ED_CHEST_PAIN_SCENARIO_ID,
        glbFile: LIBRARY_ADULT_LEAN_FEMALE_GLB,
      }),
    ];
  }

  if (scenarioId === PEDS_ASTHMA_SCENARIO_ID) {
    return [
      // #335: all three peds roles are MPFB bodies. Child/nurse stay on generated
      // MPFB bakes. Parent loads the motion-bind GLB so the mixer sees
      // openclinxr_retarget_cmu_07_01_walk (#388 body, dark-factory B clip).
      castEntry({
        actorId: "patient_maya_johnson_v1",
        role: "patient",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: MPFB_PEDS_PATIENT_CHILD_GLB,
      }),
      libraryCastEntry({
        actorId: "parent_tara_johnson_v1",
        role: "family",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: MPFB_PEDS_PARENT_AISHA_MOTION_BIND_GLB,
      }),
      castEntry({
        actorId: "nurse_kevin_lee_v1",
        role: "nurse",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: MPFB_PEDS_NURSE_KEVIN_GLB,
      }),
    ];
  }

  // #263: OB triage patient is the first promoted MPFB2 cast. Nurse and partner
  // move to the #403 MPFB adult bodies so the whole station is on the MPFB rail;
  // within-scenario content-hash distinctness holds (three different files).
  if (scenarioId === OB_HEADACHE_PREECLAMPSIA_SCENARIO_ID) {
    return [
      castEntry({
        actorId: "patient_aisha_khan_v1",
        role: "patient",
        scenarioId,
        glbFile: MPFB_OB_PATIENT_AISHA_GLB,
      }),
      castEntry({
        actorId: "ob_nurse_williams_v1",
        role: "nurse",
        scenarioId,
        glbFile: MPFB_CLINICAL_NURSE_ADULT_GLB,
      }),
      castEntry({
        actorId: "partner_omar_khan_v1",
        role: "family",
        scenarioId,
        glbFile: MPFB_FAMILY_PARTNER_ADULT_GLB,
      }),
    ];
  }

  return castFromScenarioBank(scenarioId);
}

/**
 * Scenario ids that ship in the bank and have at least one humanoid cast role.
 * Enumerated from scenarioBank — never a hardcoded station list (#102).
 */
export function listShippedCastScenarioIds(): string[] {
  return scenarioBank
    .map((s) => s.scenarioId)
    .filter((id) => resolveScenarioActorCast(id).length > 0);
}

/**
 * Runtime path for a single actor. Returns null when the scenario has no casting table
 * (caller keeps its existing fallback). Never returns a peds child path for an adult role.
 */
export function resolveRuntimeCastAssetPath(input: {
  scenarioId: string;
  actorId: string;
  role?: string;
}): string | null {
  const cast = resolveScenarioActorCast(input.scenarioId);
  if (cast.length === 0) return null;

  const byId = cast.find((a) => a.actorId === input.actorId);
  if (byId) {
    return refuseIfAgeMismatch(byId) ? null : byId.runtimeAssetPath;
  }

  const role = (input.role ?? "").toLowerCase();
  if (!role) return null;
  const byRole = cast.find((a) => a.role.toLowerCase() === role
    || (role === "family_member" && a.role === "family")
    || (role === "parent" && a.role === "family")
    || (role === "spouse" && a.role === "family"));
  if (!byRole) return null;
  return refuseIfAgeMismatch(byRole) ? null : byRole.runtimeAssetPath;
}

/**
 * Hard refuse: adult declared band must not resolve to the known child GLB.
 * Catalog is explicit so this is defense-in-depth against a future bad row.
 */
function refuseIfAgeMismatch(entry: ScenarioActorCast): boolean {
  if (entry.declaredAgeBand !== "adult") return false;
  if (entry.runtimeAssetPath.includes("peds_patient_child")) return true;
  if (entry.assetPath.includes("peds_patient_child")) return true;
  return false;
}

/** Repo-relative provenance path next to a generated-humanoid runtime path. */
export function provenancePathForRuntimeAsset(runtimeAssetPath: string): string | null {
  if (!runtimeAssetPath.includes("generated-humanoids/")) return null;
  const file = runtimeAssetPath.split("/").pop();
  if (!file?.endsWith(".glb")) return null;
  return `${GENERATED}/${file.replace(/\.glb$/u, ".provenance.json")}`;
}
