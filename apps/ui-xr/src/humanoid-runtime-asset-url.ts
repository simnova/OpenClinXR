/**
 * Local humanoid URL resolution for UI-XR emulator/fixture assets (#85 casting).
 *
 * Keeps apps/ui-xr/src/main.ts under SIZE_FREEZE while teaching the loader about
 * generated-humanoids cast paths (adult ED cast must not fall through to neutral
 * or pediatric assets).
 */

import {
  ED_ADULT_CAST_RUNTIME_PATH,
  resolveRuntimeCastAssetPath,
} from "@openclinxr/asset-registry/runtime-bundles";

export type HumanoidRuntimeAssetLike = {
  kind: string;
  blob: { blobName: string; url?: string };
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

  // #85: ED adult cast and other generated-humanoids must load from their cast path.
  if (blobName.includes("generated-humanoids/") || fileName.startsWith("ed_chest_pain_adult_cast")) {
    return `/generated-humanoids/${fileName}`;
  }
  if (fileName === "peds_patient_child.glb" || fileName === "peds_anxious_parent.glb" || fileName === "peds_nurse_kevin.glb") {
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
  const cast = resolveRuntimeCastAssetPath({
    scenarioId: input.scenarioId,
    actorId: input.actorId,
    role: input.role,
  });
  if (cast) return cast;
  // Defense: never leave an ED adult on the pediatric patient GLB.
  if (
    (input.scenarioId === "ed_chest_pain_priority_v1" || input.scenarioId === "ed_chest_pain_priority_v2")
    && input.fallbackPath.includes("peds_patient_child")
  ) {
    return ED_ADULT_CAST_RUNTIME_PATH;
  }
  return input.fallbackPath;
}
