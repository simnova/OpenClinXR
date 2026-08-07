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

const GENERATED = "apps/ui-xr/public/generated-humanoids";
const RUNTIME_GENERATED = "/generated-humanoids";

/**
 * Six distinct humanoid bodies on disk (by content hash). Reuse across scenarios
 * is expected; within one scenario each humanoid role must get a different body.
 */
const ED_ADULT_CAST_GLB = "ed_chest_pain_adult_cast.glb";
const ED_ADULT_CAST_PROV = "ed_chest_pain_adult_cast.provenance.json";
const ED_NURSE_GLB = "ed_chest_pain_nurse_adult.glb";
const ED_SPOUSE_GLB = "ed_chest_pain_spouse_adult.glb";
const PEDS_PARENT_GLB = "peds_anxious_parent.glb";
const PEDS_NURSE_GLB = "peds_nurse_kevin.glb";
const PEDS_CHILD_GLB = "peds_patient_child.glb";

/** Adult pool only — never includes the child mesh. Order is role-preference default. */
const ADULT_POOL_GLBS = [
  ED_ADULT_CAST_GLB,
  ED_NURSE_GLB,
  ED_SPOUSE_GLB,
  PEDS_PARENT_GLB,
  PEDS_NURSE_GLB,
] as const;

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
 */
function pickAdultGlb(role: string, used: Set<string>): string {
  const r = role.toLowerCase();
  const preferred: string[] = [];
  if (r === "patient") {
    preferred.push(ED_ADULT_CAST_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB, ED_SPOUSE_GLB, PEDS_PARENT_GLB);
  } else if (r === "nurse" || r === "medical_assistant" || r === "respiratory_therapist" || r === "physician" || r === "consultant") {
    preferred.push(ED_NURSE_GLB, PEDS_NURSE_GLB, ED_ADULT_CAST_GLB, PEDS_PARENT_GLB, ED_SPOUSE_GLB);
  } else if (r === "family" || r === "family_member" || r === "parent" || r === "spouse") {
    preferred.push(ED_SPOUSE_GLB, PEDS_PARENT_GLB, ED_ADULT_CAST_GLB, ED_NURSE_GLB, PEDS_NURSE_GLB);
  } else {
    preferred.push(...ADULT_POOL_GLBS);
  }
  for (const glb of preferred) {
    if (!used.has(glb)) return glb;
  }
  for (const glb of ADULT_POOL_GLBS) {
    if (!used.has(glb)) return glb;
  }
  // Exhausted pool (should not happen: max humanoid roles per scenario ≤ 4, pool = 5).
  return ED_ADULT_CAST_GLB;
}

function castFromScenarioBank(scenarioId: string): ScenarioActorCast[] {
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!scenario) return [];

  const humanoids = scenario.actors.filter(isHumanoidCastActor);
  const used = new Set<string>();
  const out: ScenarioActorCast[] = [];

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
      glbFile = pickAdultGlb(actor.role, used);
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
        glbFile: ED_NURSE_GLB,
      }),
      castEntry({
        actorId: "spouse_anna_hayes_v1",
        role: "family",
        scenarioId: ED_CHEST_PAIN_SCENARIO_ID,
        glbFile: ED_SPOUSE_GLB,
      }),
    ];
  }

  if (scenarioId === PEDS_ASTHMA_SCENARIO_ID) {
    return [
      castEntry({
        actorId: "patient_maya_johnson_v1",
        role: "patient",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: PEDS_CHILD_GLB,
      }),
      castEntry({
        actorId: "parent_tara_johnson_v1",
        role: "family",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: PEDS_PARENT_GLB,
      }),
      castEntry({
        actorId: "nurse_kevin_lee_v1",
        role: "nurse",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: PEDS_NURSE_GLB,
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

export const ED_ADULT_CAST_RUNTIME_PATH = `${RUNTIME_GENERATED}/${ED_ADULT_CAST_GLB}`;
export const ED_ADULT_CAST_ASSET_PATH = `${GENERATED}/${ED_ADULT_CAST_GLB}`;
export const ED_ADULT_CAST_PROVENANCE_PATH = `${GENERATED}/${ED_ADULT_CAST_PROV}`;
