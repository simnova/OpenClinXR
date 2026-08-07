/**
 * Local humanoid URL resolution for UI-XR emulator/fixture assets (#85 casting).
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
 * only needs public URL paths for the loader.
 */

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

const PEDS_SCENARIO_ID = "peds_asthma_parent_anxiety_v1";

/**
 * Runtime public paths for ED cast (#96 role-distinct wardrobe).
 * Mirrors actor-casting: patient gown, nurse scrubs, spouse street clothes.
 */
const ED_RUNTIME_CAST_BY_ACTOR: Record<string, string> = {
  patient_robert_hayes_v1: ED_ADULT_CAST_RUNTIME_PATH,
  nurse_maria_alvarez_v1: "/generated-humanoids/ed_chest_pain_nurse_adult.glb",
  spouse_anna_hayes_v1: "/generated-humanoids/ed_chest_pain_spouse_adult.glb",
};

/** Runtime public paths for peds cast (mirrors actor-casting table). */
const PEDS_RUNTIME_CAST_BY_ACTOR: Record<string, string> = {
  patient_maya_johnson_v1: "/generated-humanoids/peds_patient_child.glb",
  parent_tara_johnson_v1: "/generated-humanoids/peds_anxious_parent.glb",
  nurse_kevin_lee_v1: "/generated-humanoids/peds_nurse_kevin.glb",
};

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

  // #85/#96: ED adult cast variants and other generated-humanoids must load from their cast path.
  if (
    blobName.includes("generated-humanoids/")
    || fileName.startsWith("ed_chest_pain_adult_cast")
    || fileName.startsWith("ed_chest_pain_nurse_adult")
    || fileName.startsWith("ed_chest_pain_spouse_adult")
  ) {
    return `/generated-humanoids/${fileName}`;
  }
  if (
    fileName === "peds_patient_child.glb"
    || fileName === "peds_anxious_parent.glb"
    || fileName === "peds_nurse_kevin.glb"
  ) {
    return `/generated-humanoids/${fileName}`;
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
 * Prefer scenario casting table (age-band + scenario provenance) over silent fallbacks.
 * Does not import package dist — see file header (#85 regression).
 */
export function resolveHumanoidVariantOrCastPath(input: {
  scenarioId: string;
  actorId: string;
  role: string;
  fallbackPath: string;
  /** Optional comparator override already chosen by caller (e.g. real-garment cagematch). */
  comparatorOverridePath?: string | null;
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
    // Unknown adult ED role → patient gown path (never peds_patient_child).
    return ED_ADULT_CAST_RUNTIME_PATH;
  }

  if (input.scenarioId === PEDS_SCENARIO_ID) {
    const byActor = PEDS_RUNTIME_CAST_BY_ACTOR[input.actorId];
    if (byActor) return byActor;
    const role = input.role.toLowerCase();
    if (role === "patient") return PEDS_RUNTIME_CAST_BY_ACTOR.patient_maya_johnson_v1!;
    if (role === "nurse") return PEDS_RUNTIME_CAST_BY_ACTOR.nurse_kevin_lee_v1!;
    if (role === "family" || role === "family_member" || role === "parent") {
      return PEDS_RUNTIME_CAST_BY_ACTOR.parent_tara_johnson_v1!;
    }
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
