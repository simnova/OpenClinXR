import type { AssetObjectStore, AssetObjectStorePutResult } from "./object-store.js";
import type { EncounterRuntimeAsset, EncounterRuntimeAssetBundle } from "./runtime-bundles.js";

export type RuntimeAssetManifestRecord = {
  schemaVersion: "openclinxr.runtime-asset-manifest.v1";
  asset: EncounterRuntimeAsset;
  storedAt: string;
  productionCloudCall: false;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

export type GeneratedRuntimeAssetWriteResult = {
  assetPut: AssetObjectStorePutResult;
  manifestPut: AssetObjectStorePutResult;
  manifestBlobName: string;
};

export type EncounterRuntimeAssetBundleWriteResult = {
  bundlePut: AssetObjectStorePutResult;
  bundleBlobName: string;
};

const NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export async function writeGeneratedRuntimeAssetWithManifest(input: {
  store: AssetObjectStore;
  asset: EncounterRuntimeAsset;
  body: Uint8Array | string;
  storedAt?: string | undefined;
}): Promise<GeneratedRuntimeAssetWriteResult> {
  assertRuntimeAssetApprovedForWrite(input.asset);
  const assetPut = await input.store.putEncounterRuntimeAsset(input.asset, input.body);
  const manifestRecord: RuntimeAssetManifestRecord = {
    schemaVersion: "openclinxr.runtime-asset-manifest.v1",
    asset: input.asset,
    storedAt: input.storedAt ?? "2026-05-22T00:00:00.000Z",
    productionCloudCall: false,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
  const manifestBlobName = runtimeAssetManifestBlobName(input.asset);
  const manifestPut = await input.store.putObject({
    blobName: manifestBlobName,
    body: `${JSON.stringify(manifestRecord, null, 2)}\n`,
    contentType: "application/json",
    metadata: {
      assetid: input.asset.assetId,
      scenarioassetid: input.asset.scenarioAssetId,
      reviewstatus: input.asset.reviewStatus,
      version: input.asset.version,
    },
  });
  return { assetPut, manifestPut, manifestBlobName };
}

export async function writeEncounterRuntimeAssetBundle(input: {
  store: AssetObjectStore;
  bundle: EncounterRuntimeAssetBundle;
}): Promise<EncounterRuntimeAssetBundleWriteResult> {
  const bundleBlobName = encounterRuntimeAssetBundleBlobName(input.bundle);
  const bundlePut = await input.store.putObject({
    blobName: bundleBlobName,
    body: `${JSON.stringify(input.bundle, null, 2)}\n`,
    contentType: "application/json",
    metadata: {
      assetid: sanitizeMetadataValue(input.bundle.bundleId),
      scenarioassetid: sanitizeMetadataValue(input.bundle.scenarioId),
      reviewstatus: "approved_for_local_runtime",
      version: "frozen_encounter_bundle",
    },
  });
  return { bundlePut, bundleBlobName };
}

export function runtimeAssetManifestBlobName(asset: EncounterRuntimeAsset): string {
  const slashIndex = asset.blob.blobName.lastIndexOf("/");
  const prefix = slashIndex >= 0 ? asset.blob.blobName.slice(0, slashIndex + 1) : "";
  return `${prefix}asset.runtime-manifest.json`;
}

export function encounterRuntimeAssetBundleBlobName(bundle: EncounterRuntimeAssetBundle): string {
  return [
    "tenants",
    sanitizePathSegment(bundle.tenantId),
    "sessions",
    sanitizePathSegment(bundle.examRunId),
    "encounters",
    sanitizePathSegment(bundle.encounterId),
    "asset-bundle.json",
  ].join("/");
}

export function assertRuntimeAssetApprovedForWrite(asset: EncounterRuntimeAsset): void {
  if (asset.reviewStatus === "blocked") {
    throw new Error(`Blocked runtime asset cannot be written to object storage: ${asset.assetId}`);
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, "_");
  if (sanitized.length === 0) return "unknown";
  return sanitized;
}

function sanitizeMetadataValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 256);
}
