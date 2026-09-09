import type { RuntimeAssetStoreKind } from "./runtime-bundles.js";

/**
 * Small string and container helpers the bundle builder uses.
 *
 * Split out of runtime-bundles.ts, whose frozen ceiling note asks for builder / validate / shape
 * to separate. None of these constructs a bundle: they dedupe, diff and name, which is the "shape"
 * end of that split.
 */

export function uniqueRuntimeStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function missingRuntimeStrings(requiredValues: readonly string[], coveredValues: readonly string[]): string[] {
  const covered = new Set(coveredValues);
  return requiredValues.filter((value) => !covered.has(value));
}

export function defaultRuntimeAssetContainerName(storeKind: RuntimeAssetStoreKind): string {
  return storeKind === "app_public_fixture" ? "ui-xr-public" : "openclinxr-assets";
}
