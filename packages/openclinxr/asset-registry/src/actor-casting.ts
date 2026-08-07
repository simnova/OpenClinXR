/**
 * Scenario → actor casting SSOT (#85).
 *
 * Decision: GENERATE/PROMOTE adult assets for adult ED roles (route A), with
 * age-band refuse so a child asset cannot silently resolve into an adult slot.
 *
 * Rejected:
 * - Age-band resolution alone (route B): without adult ED assets there is nowhere
 *   honest to point; it still needs generation or placeholders.
 * - Refuse + labelled placeholder (route C): viable when no adult geometry exists,
 *   but an adult ED Anny candidate already exists (ed_chest_pain_patient_adult_bod
 *   @ 1.79 m). Promoting that is better than a labelled stick figure.
 *
 * Stature and provenance are read from the ASSET (geometry + provenance JSON),
 * never from fields this module invents at inspect time.
 */

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
 * Adult ED cast GLB (shared by patient/nurse/spouse until role-distinct adults exist).
 * Must be upright adult-stature Anny candidate (identity pelvis). The first promote
 * (adult_bod @ 1.79 m) had pelvis −90° X / joints on −Z and rendered diagonal — replaced
 * with upright 1.76 m topology; provenance.scenarioId stays ed_chest_pain_priority_v1.
 */
const ED_ADULT_CAST_GLB = "ed_chest_pain_adult_cast.glb";
const ED_ADULT_CAST_PROV = "ed_chest_pain_adult_cast.provenance.json";

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
  if (role === "patient" || role === "nurse" || role === "family" || role === "family_member" || role === "parent" || role === "spouse") {
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

/**
 * Resolve the cast for a known scenario. Explicit table only — no "nearest humanoid"
 * fallback that could silently hand a pediatric patient to an adult ED role.
 */
export function resolveScenarioActorCast(scenarioId: string): ScenarioActorCast[] {
  if (scenarioId === ED_CHEST_PAIN_SCENARIO_ID || scenarioId === "ed_chest_pain_priority_v2") {
    // All three ED roles are adults. Same promoted adult cast mesh; provenance scenarioId is ED.
    // Age-band refuse: never map these slots to peds_patient_child (1.25 m / peds provenance).
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
        glbFile: ED_ADULT_CAST_GLB,
      }),
      castEntry({
        actorId: "spouse_anna_hayes_v1",
        role: "family",
        scenarioId: ED_CHEST_PAIN_SCENARIO_ID,
        glbFile: ED_ADULT_CAST_GLB,
      }),
    ];
  }

  if (scenarioId === PEDS_ASTHMA_SCENARIO_ID) {
    return [
      castEntry({
        actorId: "patient_maya_johnson_v1",
        role: "patient",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: "peds_patient_child.glb",
      }),
      castEntry({
        actorId: "parent_tara_johnson_v1",
        role: "family",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: "peds_anxious_parent.glb",
      }),
      castEntry({
        actorId: "nurse_kevin_lee_v1",
        role: "nurse",
        scenarioId: PEDS_ASTHMA_SCENARIO_ID,
        glbFile: "peds_nurse_kevin.glb",
      }),
    ];
  }

  return [];
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
