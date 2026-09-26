import type { EncounterRuntimeAsset, RuntimeAssetStoreConfig } from "./runtime-bundles.js";

/**
 * Asset URL / store-config resolution, split out of `runtime-bundles.ts` (2026-09-26) so that
 * file has room to grow without cramming declarations onto one line to stay under its frozen
 * shrink-only ceiling. Re-exported from `runtime-bundles.ts` (and from there,
 * `runtime-bundles-entry.ts`'s public subpath) so nothing outside this package sees the move --
 * same names, same public entry point.
 */

export function resolveRuntimeAssetUrl(asset: EncounterRuntimeAsset): string {
  return asset.blob.url;
}

export function resolveRuntimeAssetStoreConfig(config: RuntimeAssetStoreConfig): RuntimeAssetStoreConfig {
  if (config.storeKind === "app_public_fixture") {
    return {
      storeKind: "app_public_fixture",
      containerName: config.containerName || "ui-xr-public",
      baseUrl: config.baseUrl,
    };
  }
  if (config.storeKind === "azurite_blob") {
    return {
      storeKind: "azurite_blob",
      containerName: config.containerName || "openclinxr-assets",
      accountName: config.accountName || "devstoreaccount1",
      baseUrl: config.baseUrl || "http://127.0.0.1:10000/devstoreaccount1",
    };
  }
  return {
    storeKind: "azure_blob",
    containerName: config.containerName || "openclinxr-assets",
    accountName: config.accountName || "openclinxrassets",
    baseUrl: config.baseUrl || `https://${config.accountName || "openclinxrassets"}.blob.core.windows.net`,
  };
}

export function resolveRuntimeAssetBlobUrl(config: RuntimeAssetStoreConfig, blobName: string): string {
  const normalizedBlobName = blobName.replace(/^\/+/u, "");
  if (config.storeKind === "app_public_fixture") {
    return `${config.baseUrl ?? ""}/${normalizedBlobName}`;
  }
  const baseUrl = config.baseUrl?.replace(/\/+$/u, "") ?? "";
  return `${baseUrl}/${config.containerName}/${normalizedBlobName}`;
}
