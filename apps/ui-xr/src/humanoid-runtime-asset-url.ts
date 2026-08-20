/**
 * Local humanoid URL resolution for UI-XR emulator/fixture assets (#85/#96/#102 casting).
 *
 * Keeps apps/ui-xr/src/main.ts under SIZE_FREEZE while teaching the loader about
 * generated-humanoids cast paths (adult ED cast must not fall through to neutral
 * or pediatric assets).
 *
 * IMPORTANT (#85 regression): do NOT import NEW named exports from
 * `@openclinxr/asset-registry/runtime-bundles` here. That package's dist/ is
 * gitignored; after a merge that only updates src/, a stale dist lacks the new
 * re-exports and Vite fails the whole main.ts graph — so waitForStationShell
 * times out for EVERY scenario (including telehealth). Cast *contract* SSOT
 * stays in packages/.../actor-casting.ts (inspectScenarioCasting). This module
 * mirrors public URL paths for the loader; #102 pool assignment reads scenarioBank
 * for sibling roles so within-scenario distinctness does not require main.ts edits.
 *
 * #102: within-scenario distinct cast paths for every station. ED/peds keep
 * explicit maps; all other scenarios use the same pool-assignment order as
 * actor-casting (adult pool + child mesh for peds patients only).
 */

import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";

export type HumanoidRuntimeAssetLike = {
  kind: string;
  blob: { blobName: string; url?: string };
};

/** Mirrors actor-casting ED patient cast path — keep in sync when renaming the GLB. */
export const ED_ADULT_CAST_RUNTIME_PATH = "/generated-humanoids/ed_chest_pain_adult_cast.glb";

const ED_SCENARIO_IDS = new Set([
  "ed_chest_pain_priority_v1",
  "ed_chest_pain_priority_v2",
]);

const PEDS_ASTHMA_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";
/** #263 — OB triage station whose patient is the first promoted MPFB2 cast. */
const OB_HEADACHE_PREECLAMPSIA_SCENARIO_ID = "ob_headache_preeclampsia_triage_v1";

const ED_ADULT_CAST_GLB = "ed_chest_pain_adult_cast.glb";
const ED_NURSE_GLB = "ed_chest_pain_nurse_adult.glb";
const ED_SPOUSE_GLB = "ed_chest_pain_spouse_adult.glb";
const PEDS_PARENT_GLB = "peds_anxious_parent.glb";
const PEDS_NURSE_GLB = "peds_nurse_kevin.glb";
const PEDS_CHILD_GLB = "peds_patient_child.glb";
/** Mirrors actor-casting ADULT_MALE_STREET_CASUAL_GLB (#160). */
const ADULT_MALE_STREET_CASUAL_GLB = "adult_male_street_casual.glb";
/** #444 — the street_casual patients' MPFB body. Mirrors actor-casting MPFB_STREET_ADULT_MALE_GLB. */
const MPFB_STREET_ADULT_MALE_GLB = "mpfb-street-adult-male.glb";
/**
 * #218 — body-param library GLB (tracked under candidates/).
 * Staged on ED spouse only; patient stays Anny gown (#160).
 * Mirrors actor-casting LIBRARY_ADULT_LEAN_FEMALE_GLB.
 */
export const LIBRARY_ADULT_LEAN_FEMALE_RUNTIME_PATH =
  "/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";
/**
 * #278 — the second hm08 library body class, staged on the peds nurse (male).
 * Mirrors actor-casting LIBRARY_ADULT_HEAVY_MALE_GLB.
 */
export const LIBRARY_ADULT_HEAVY_MALE_RUNTIME_PATH =
  "/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb";
/**
 * #263 — first promoted MPFB2 cast: OB triage patient.
 * Mirrors actor-casting MPFB_OB_PATIENT_AISHA_GLB.
 */
export const MPFB_OB_PATIENT_AISHA_RUNTIME_PATH =
  "/generated-humanoids/mpfb-ob-patient-aisha.glb";
/**
 * #335 — the peds nurse and child MPFB bodies (cast into the peds asthma station).
 * Mirrors actor-casting MPFB_PEDS_NURSE_KEVIN_GLB / MPFB_PEDS_PATIENT_CHILD_GLB.
 */
export const MPFB_PEDS_NURSE_KEVIN_RUNTIME_PATH =
  "/generated-humanoids/mpfb-peds-nurse-kevin.glb";
export const MPFB_PEDS_PATIENT_CHILD_RUNTIME_PATH =
  "/generated-humanoids/mpfb-peds-patient-child.glb";
/** Dark-factory B — peds parent loads the motion-bind GLB. Mirrors actor-casting. */
export const MPFB_PEDS_PARENT_AISHA_RUNTIME_PATH =
  "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
/**
 * #403 — step 2 of the MPFB2 migration: the two ED adult MPFB bodies (nurse-class
 * and family-class) replace the shared Anny nurse/spouse meshes. Mirrors
 * actor-casting MPFB_CLINICAL_NURSE_ADULT_GLB / MPFB_FAMILY_PARTNER_ADULT_GLB.
 */
export const MPFB_CLINICAL_NURSE_ADULT_RUNTIME_PATH =
  "/generated-humanoids/mpfb-clinical-nurse-adult.glb";
export const MPFB_CLINICAL_PHYSICIAN_ADULT_RUNTIME_PATH =
  "/generated-humanoids/mpfb-clinical-physician-adult.glb";
export const MPFB_FAMILY_PARTNER_ADULT_RUNTIME_PATH =
  "/generated-humanoids/mpfb-family-partner-adult.glb";
/** Bare filenames for pool assignment — mirrors actor-casting #403/#476 constants. */
const MPFB_CLINICAL_NURSE_ADULT_GLB = "mpfb-clinical-nurse-adult.glb";
const MPFB_CLINICAL_PHYSICIAN_ADULT_GLB = "mpfb-clinical-physician-adult.glb";
const MPFB_FAMILY_PARTNER_ADULT_GLB = "mpfb-family-partner-adult.glb";
const MPFB_PEDS_NURSE_KEVIN_GLB = "mpfb-peds-nurse-kevin.glb";

const ADULT_POOL_GLBS = [
  MPFB_CLINICAL_NURSE_ADULT_GLB,
  MPFB_PEDS_NURSE_KEVIN_GLB,
  MPFB_CLINICAL_PHYSICIAN_ADULT_GLB,
  MPFB_FAMILY_PARTNER_ADULT_GLB,
  MPFB_STREET_ADULT_MALE_GLB,
  ED_ADULT_CAST_GLB,
  ED_NURSE_GLB,
  ED_SPOUSE_GLB,
  PEDS_PARENT_GLB,
  PEDS_NURSE_GLB,
  ADULT_MALE_STREET_CASUAL_GLB,
] as const;

/**
 * Mirrors actor-casting PATIENT_WARDROBE_CLASS_BY_ENVIRONMENT_ID (#160).
 * Keep in lockstep — contract asserts both resolvers agree per station.
 */
type PatientWardrobeClass = "street_casual" | "inpatient_gown";

const PATIENT_WARDROBE_CLASS_BY_ENVIRONMENT_ID: Readonly<Record<string, PatientWardrobeClass>> = {
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

function patientWardrobeClassForEnvironment(environmentId: string): PatientWardrobeClass {
  const explicit = PATIENT_WARDROBE_CLASS_BY_ENVIRONMENT_ID[environmentId];
  if (explicit) return explicit;
  const id = environmentId.toLowerCase();
  // FALLBACK for unknown ids — explicit table is SSOT.
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

function environmentIdForScenario(scenarioId: string): string {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId) as
    | { environment?: { environmentId?: string }; environmentId?: string }
    | undefined;
  if (!scenario) return "";
  return scenario.environment?.environmentId ?? scenario.environmentId ?? "";
}

/**
 * Runtime public paths for ED cast (#96 role-distinct wardrobe; #218 library spouse).
 * Mirrors actor-casting: patient gown, nurse scrubs, spouse = body-param library.
 * Rejected full cast migration and patient-library swap (#160 gown counterweight).
 */
const ED_RUNTIME_CAST_BY_ACTOR: Record<string, string> = {
  patient_robert_hayes_v1: ED_ADULT_CAST_RUNTIME_PATH,
  // #403: the ED nurse loads the MPFB clinical-nurse body (was the shared Anny nurse mesh).
  nurse_maria_alvarez_v1: MPFB_CLINICAL_NURSE_ADULT_RUNTIME_PATH,
  spouse_anna_hayes_v1: LIBRARY_ADULT_LEAN_FEMALE_RUNTIME_PATH,
};

/** Runtime public paths for peds asthma cast (mirrors actor-casting table). */
const PEDS_RUNTIME_CAST_BY_ACTOR: Record<string, string> = {
  // #335: child + nurse stay generated MPFB. Parent is the motion-bind GLB
  // (dark-factory B) so the mixer sees openclinxr_retarget_cmu_07_01_walk.
  patient_maya_johnson_v1: MPFB_PEDS_PATIENT_CHILD_RUNTIME_PATH,
  parent_tara_johnson_v1: MPFB_PEDS_PARENT_AISHA_RUNTIME_PATH,
  nurse_kevin_lee_v1: MPFB_PEDS_NURSE_KEVIN_RUNTIME_PATH,
};

/**
 * Runtime public paths for OB triage cast (#263, mirrors actor-casting table).
 * patient = promoted MPFB2 asset; nurse/partner move to the #403 MPFB adult bodies
 * so the whole station is on the MPFB rail (three distinct files).
 */
const OB_RUNTIME_CAST_BY_ACTOR: Record<string, string> = {
  patient_aisha_khan_v1: MPFB_OB_PATIENT_AISHA_RUNTIME_PATH,
  ob_nurse_williams_v1: MPFB_CLINICAL_NURSE_ADULT_RUNTIME_PATH,
  partner_omar_khan_v1: MPFB_FAMILY_PARTNER_ADULT_RUNTIME_PATH,
};

function runtimePath(glbFile: string): string {
  return `/generated-humanoids/${glbFile}`;
}

function isPedsChildPatient(scenarioId: string, role: string, actorId: string): boolean {
  if (!scenarioId.startsWith("peds_")) return false;
  if (role.toLowerCase() !== "patient") return false;
  return true;
}

/** Mirrors actor-casting.pickAdultGlb — care-setting-conditioned patient preference (#160). */
function pickAdultGlb(
  role: string,
  used: Set<string>,
  patientWardrobeClass: PatientWardrobeClass = "inpatient_gown",
): string {
  const r = role.toLowerCase();
  const preferred: string[] = [];
  if (r === "patient") {
    if (patientWardrobeClass === "street_casual") {
      // #444: mirrors actor-casting — MPFB male street body first, Anny street
      // body immediately behind as the second-body fallback.
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
    // actor-casting; the clinical-nurse body stays as the second-body fallback.
    preferred.push(MPFB_CLINICAL_PHYSICIAN_ADULT_GLB, MPFB_CLINICAL_NURSE_ADULT_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB, ED_ADULT_CAST_GLB, PEDS_PARENT_GLB, ED_SPOUSE_GLB, ADULT_MALE_STREET_CASUAL_GLB);
  } else if (
    r === "nurse"
    || r === "medical_assistant"
    || r === "respiratory_therapist"
    || r === "consultant"
  ) {
    // #403: nurse-class roles take the MPFB clinical-nurse body first. #476: the
    // second MPFB clinical body (peds-nurse-kevin) takes the second co-present
    // nurse-class slot; the Anny tail stays as last-resort (mirrors actor-casting).
    // The physician is NOT here — it has its own body since 2026-08-14.
    preferred.push(MPFB_CLINICAL_NURSE_ADULT_GLB, MPFB_PEDS_NURSE_KEVIN_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB, ED_ADULT_CAST_GLB, PEDS_PARENT_GLB, ED_SPOUSE_GLB, ADULT_MALE_STREET_CASUAL_GLB);
  } else if (r === "family" || r === "family_member" || r === "parent" || r === "spouse") {
    // #403: family-class roles take the MPFB family-partner body first (mirrors actor-casting).
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
  return ED_ADULT_CAST_GLB;
}

/**
 * Deterministic within-scenario pool assignment for one role, mirroring
 * actor-casting.castFromScenarioBank. Callers that only know one actor still get
 * a stable path; callers that walk all actors must use the same sort order so
 * used-set assignment matches the SSOT (actorId sort after child-first).
 *
 * When only one actor is resolved in isolation, we approximate by role preference
 * without siblings — good enough for single-actor loads; room capture loads all
 * actors and should prefer resolveRuntimeCastAssetPath from the package after build.
 */
function poolPathForIsolatedActor(input: {
  scenarioId: string;
  actorId: string;
  role: string;
}): string | null {
  const role = input.role.toLowerCase();
  if (role === "system") return null;
  if (/_phone_|_tablet_|telehealth_system/iu.test(input.actorId)) return null;

  if (isPedsChildPatient(input.scenarioId, role, input.actorId)) {
    return runtimePath(PEDS_CHILD_GLB);
  }

  const wardrobe = patientWardrobeClassForEnvironment(environmentIdForScenario(input.scenarioId));
  // Isolated single-role resolution: use first preferred unused (= full pool free).
  const glb = pickAdultGlb(role, new Set(), wardrobe);
  return runtimePath(glb);
}

/**
 * Full-scenario assignment for known sibling actor lists (optional). When the
 * runtime has the full actor roster, pass it so within-scenario distinctness holds.
 */
export function resolvePoolCastPathWithSiblings(input: {
  scenarioId: string;
  actorId: string;
  role: string;
  siblings: ReadonlyArray<{ actorId: string; role: string }>;
}): string | null {
  const humanoids = input.siblings.filter((a) => {
    if (a.role.toLowerCase() === "system") return false;
    if (/_phone_|_tablet_|telehealth_system/iu.test(a.actorId)) return false;
    return true;
  });

  const ordered = [...humanoids].sort((a, b) => {
    const aChild = isPedsChildPatient(input.scenarioId, a.role, a.actorId) ? 0 : 1;
    const bChild = isPedsChildPatient(input.scenarioId, b.role, b.actorId) ? 0 : 1;
    if (aChild !== bChild) return aChild - bChild;
    return a.actorId.localeCompare(b.actorId);
  });

  const wardrobe = patientWardrobeClassForEnvironment(environmentIdForScenario(input.scenarioId));
  const used = new Set<string>();
  const assignment = new Map<string, string>();
  for (const actor of ordered) {
    let glb: string;
    if (isPedsChildPatient(input.scenarioId, actor.role, actor.actorId)) {
      glb = PEDS_CHILD_GLB;
    } else {
      glb = pickAdultGlb(actor.role, used, wardrobe);
    }
    used.add(glb);
    assignment.set(actor.actorId, runtimePath(glb));
  }
  return assignment.get(input.actorId) ?? poolPathForIsolatedActor(input);
}

/**
 * Map a runtime-bundle humanoid asset to a public URL the GLTFLoader can fetch.
 * Generated-humanoid cast files stay under /generated-humanoids/ (not remapped into
 * /xr-assets/humanoids/, where only neutral/variants live).
 */
export function resolveLocalHumanoidRuntimeAssetUrl(
  asset: HumanoidRuntimeAssetLike,
  resolveRuntimeAssetUrl: (asset: HumanoidRuntimeAssetLike) => string = () => "",
): string {
  const blobName = asset.blob.blobName.replace(/^\/+/u, "");
  const fileName = blobName.split("/").at(-1);
  if (!fileName) return resolveRuntimeAssetUrl(asset as HumanoidRuntimeAssetLike);

  // #85/#96/#102/#160: generated-humanoids cast variants load from their cast path.
  if (
    blobName.includes("generated-humanoids/")
    || fileName.startsWith("ed_chest_pain_adult_cast")
    || fileName.startsWith("ed_chest_pain_nurse_adult")
    || fileName.startsWith("ed_chest_pain_spouse_adult")
    || fileName === PEDS_CHILD_GLB
    || fileName === PEDS_PARENT_GLB
    || fileName === PEDS_NURSE_GLB
    || fileName === ADULT_MALE_STREET_CASUAL_GLB
    || fileName === MPFB_STREET_ADULT_MALE_GLB
  ) {
    return `/generated-humanoids/${fileName}`;
  }

  // #218: body-param / MakeClothes library GLBs under candidates/ stay there.
  if (
    blobName.includes("humanoids/candidates/")
    || (fileName.includes("body-param-") && fileName.endsWith("-library.glb"))
    || fileName.startsWith("makeclothes-hm08-")
    || fileName.endsWith(".motion-bind.glb")
  ) {
    return `/xr-assets/humanoids/candidates/${fileName}`;
  }

  return `/xr-assets/humanoids/${resolveLocalHumanoidRuntimeAssetFileName(fileName)}`;
}

export function resolveLocalHumanoidRuntimeAssetFileName(fileName: string): string {
  if (fileName === "patient.glb" || fileName === "nurse.glb" || fileName === "spouse.glb") {
    return "neutral-generated-human.glb";
  }
  return fileName;
}

/**
 * Variant/cast override after the bundle path is known.
 * Prefer scenario casting table (age-band + within-scenario distinct bodies) over silent fallbacks.
 * Does not import package dist — see file header (#85 regression).
 */
export function resolveHumanoidVariantOrCastPath(input: {
  scenarioId: string;
  actorId: string;
  role: string;
  fallbackPath: string;
  /** Optional comparator override already chosen by caller (e.g. real-garment cagematch). */
  comparatorOverridePath?: string | null;
  /** Optional full roster for within-scenario distinct pool assignment (#102). */
  siblings?: ReadonlyArray<{ actorId: string; role: string }>;
}): string {
  if (input.comparatorOverridePath) return input.comparatorOverridePath;

  if (ED_SCENARIO_IDS.has(input.scenarioId)) {
    const byActor = ED_RUNTIME_CAST_BY_ACTOR[input.actorId];
    if (byActor) return byActor;
    const role = input.role.toLowerCase();
    if (role === "patient") return ED_RUNTIME_CAST_BY_ACTOR.patient_robert_hayes_v1!;
    if (role === "nurse") return ED_RUNTIME_CAST_BY_ACTOR.nurse_maria_alvarez_v1!;
    if (role === "family" || role === "family_member" || role === "spouse" || role === "parent") {
      return ED_RUNTIME_CAST_BY_ACTOR.spouse_anna_hayes_v1!;
    }
    return ED_ADULT_CAST_RUNTIME_PATH;
  }

  if (input.scenarioId === PEDS_ASTHMA_SCENARIO_ID) {
    const byActor = PEDS_RUNTIME_CAST_BY_ACTOR[input.actorId];
    if (byActor) return byActor;
    const role = input.role.toLowerCase();
    if (role === "patient") return PEDS_RUNTIME_CAST_BY_ACTOR.patient_maya_johnson_v1!;
    if (role === "nurse") return PEDS_RUNTIME_CAST_BY_ACTOR.nurse_kevin_lee_v1!;
    if (role === "family" || role === "family_member" || role === "parent") {
      return PEDS_RUNTIME_CAST_BY_ACTOR.parent_tara_johnson_v1!;
    }
  }

  // #263: OB triage — patient is the promoted MPFB2 cast; nurse/partner keep pool.
  if (input.scenarioId === OB_HEADACHE_PREECLAMPSIA_SCENARIO_ID) {
    const byActor = OB_RUNTIME_CAST_BY_ACTOR[input.actorId];
    if (byActor) return byActor;
    const role = input.role.toLowerCase();
    if (role === "patient") return OB_RUNTIME_CAST_BY_ACTOR.patient_aisha_khan_v1!;
    if (role === "nurse") return OB_RUNTIME_CAST_BY_ACTOR.ob_nurse_williams_v1!;
    if (role === "family" || role === "family_member" || role === "spouse" || role === "parent") {
      return OB_RUNTIME_CAST_BY_ACTOR.partner_omar_khan_v1!;
    }
    return OB_RUNTIME_CAST_BY_ACTOR.patient_aisha_khan_v1!;
  }

  // #102: all other shipped stations — pool assignment with bank siblings (or explicit).
  const bankSiblings =
    input.siblings
    ?? scenarioBank.find((s) => s.scenarioId === input.scenarioId)?.actors.map((a) => ({
      actorId: a.actorId,
      role: a.role,
    }));
  if (bankSiblings && bankSiblings.length > 0) {
    const pooled = resolvePoolCastPathWithSiblings({
      scenarioId: input.scenarioId,
      actorId: input.actorId,
      role: input.role,
      siblings: bankSiblings,
    });
    if (pooled) return pooled;
  } else {
    const pooled = poolPathForIsolatedActor({
      scenarioId: input.scenarioId,
      actorId: input.actorId,
      role: input.role,
    });
    if (pooled) return pooled;
  }

  // Defense: never leave an ED adult on the pediatric patient GLB (stale fallback paths).
  if (
    ED_SCENARIO_IDS.has(input.scenarioId)
    && input.fallbackPath.includes("peds_patient_child")
  ) {
    return ED_ADULT_CAST_RUNTIME_PATH;
  }
  return input.fallbackPath;
}
