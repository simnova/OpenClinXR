import { createHmac } from "node:crypto";
import type { EncounterRuntimeAsset, RuntimeAssetStoreConfig } from "./runtime-bundles.js";
import { resolveRuntimeAssetBlobUrl, resolveRuntimeAssetStoreConfig } from "./runtime-bundles.js";

export type AssetObjectStorePutInput = {
  blobName: string;
  body: Uint8Array | string;
  contentType?: string | undefined;
  metadata?: Record<string, string> | undefined;
};

export type AssetObjectStoreGetInput = {
  blobName: string;
};

export type AssetObjectStorePutResult = {
  storeKind: RuntimeAssetStoreConfig["storeKind"];
  containerName: string;
  blobName: string;
  url: string;
  etag: string | null;
  requestId: string | null;
};

export type AssetObjectStoreGetResult = {
  storeKind: RuntimeAssetStoreConfig["storeKind"];
  containerName: string;
  blobName: string;
  url: string;
  body: Uint8Array;
  contentType: string | null;
  etag: string | null;
};

export type AssetObjectStore = {
  readonly config: RuntimeAssetStoreConfig;
  putObject(input: AssetObjectStorePutInput): Promise<AssetObjectStorePutResult>;
  getObject(input: AssetObjectStoreGetInput): Promise<AssetObjectStoreGetResult>;
  putEncounterRuntimeAsset(asset: EncounterRuntimeAsset, body: Uint8Array | string): Promise<AssetObjectStorePutResult>;
};

export type AzuriteAssetObjectStoreOptions = {
  config?: Partial<RuntimeAssetStoreConfig> | undefined;
  accountKey?: string | undefined;
  fetch?: typeof fetch | undefined;
  now?: () => Date;
};

export const AZURITE_DEFAULT_ACCOUNT_NAME = "devstoreaccount1";
export const AZURITE_DEFAULT_CONTAINER_NAME = "openclinxr-assets";
export const AZURITE_ALLOWED_METADATA_KEYS = ["assetid", "scenarioassetid", "reviewstatus", "version"] as const;

export function createAzuriteAssetObjectStore(options: AzuriteAssetObjectStoreOptions = {}): AssetObjectStore {
  const config = resolveRuntimeAssetStoreConfig({
    storeKind: "azurite_blob",
    containerName: options.config?.containerName ?? AZURITE_DEFAULT_CONTAINER_NAME,
    accountName: options.config?.accountName ?? AZURITE_DEFAULT_ACCOUNT_NAME,
    baseUrl: options.config?.baseUrl,
  });
  assertLocalAzuriteEndpoint(config.baseUrl ?? "");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const accountKey = options.accountKey;

  return {
    config,
    async putObject(input) {
      const blobName = normalizeBlobName(input.blobName);
      const body = normalizeBody(input.body);
      const url = resolveRuntimeAssetBlobUrl(config, blobName);
      const headers = buildBlobRequestHeaders({
        method: "PUT",
        config,
        accountKey,
        blobName,
        contentLength: body.byteLength,
        contentType: input.contentType,
        metadata: input.metadata,
        now: now(),
        requestHeaders: {
          "x-ms-blob-type": "BlockBlob",
        },
      });
      const response = await fetchImpl(url, {
        method: "PUT",
        headers,
        body: new Blob([new Uint8Array(body)]),
      });
      await assertOkResponse(response, "putObject", url);
      return {
        storeKind: config.storeKind,
        containerName: config.containerName,
        blobName,
        url,
        etag: response.headers.get("etag"),
        requestId: response.headers.get("x-ms-request-id"),
      };
    },
    async getObject(input) {
      const blobName = normalizeBlobName(input.blobName);
      const url = resolveRuntimeAssetBlobUrl(config, blobName);
      const headers = buildBlobRequestHeaders({
        method: "GET",
        config,
        accountKey,
        blobName,
        contentLength: 0,
        now: now(),
      });
      const response = await fetchImpl(url, { method: "GET", headers });
      await assertOkResponse(response, "getObject", url);
      return {
        storeKind: config.storeKind,
        containerName: config.containerName,
        blobName,
        url,
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag"),
      };
    },
    putEncounterRuntimeAsset(asset, body) {
      return this.putObject({
        blobName: asset.blob.blobName,
        body,
        contentType: asset.blob.contentType,
        metadata: {
          assetid: sanitizeMetadataValue(asset.assetId),
          scenarioassetid: sanitizeMetadataValue(asset.scenarioAssetId),
          reviewstatus: sanitizeMetadataValue(asset.reviewStatus),
          version: sanitizeMetadataValue(asset.version),
        },
      });
    },
  };
}

export function buildAzuriteConnectionSummary(config: RuntimeAssetStoreConfig = {
  storeKind: "azurite_blob",
  containerName: AZURITE_DEFAULT_CONTAINER_NAME,
}): {
  storeKind: "azurite_blob";
  accountName: string;
  containerName: string;
  baseUrl: string;
  expectedEndpoint: string;
  productionCloudCall: false;
} {
  const resolved = resolveRuntimeAssetStoreConfig(config);
  assertLocalAzuriteEndpoint(resolved.baseUrl ?? "");
  return {
    storeKind: "azurite_blob",
    accountName: resolved.accountName ?? AZURITE_DEFAULT_ACCOUNT_NAME,
    containerName: resolved.containerName,
    baseUrl: resolved.baseUrl ?? "http://127.0.0.1:10000/devstoreaccount1",
    expectedEndpoint: `${resolved.baseUrl ?? "http://127.0.0.1:10000/devstoreaccount1"}/${resolved.containerName}`,
    productionCloudCall: false,
  };
}

export function assertLocalAzuriteEndpoint(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Azurite endpoint must be a valid local URL: ${baseUrl}`);
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (parsed.protocol !== "http:" || !localHosts.has(parsed.hostname)) {
    throw new Error(`Azurite endpoint must stay local-only and HTTP: ${baseUrl}`);
  }
}

export function buildSharedKeyAuthorizationHeader(input: {
  method: "GET" | "PUT";
  accountName: string;
  accountKey: string;
  containerName: string;
  blobName: string;
  headers: Record<string, string>;
  contentLength: number;
  contentType?: string | undefined;
}): string {
  const canonicalizedHeaders = Object.entries(input.headers)
    .filter(([name]) => name.toLowerCase().startsWith("x-ms-"))
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}\n`)
    .join("");
  const canonicalizedResource = `/${input.accountName}/${input.containerName}/${normalizeBlobName(input.blobName)}`;
  const contentLength = input.contentLength === 0 ? "" : String(input.contentLength);
  const stringToSign = [
    input.method,
    "",
    "",
    contentLength,
    "",
    input.contentType ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    `${canonicalizedHeaders}${canonicalizedResource}`,
  ].join("\n");
  const signature = createHmac("sha256", Buffer.from(input.accountKey, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  return `SharedKey ${input.accountName}:${signature}`;
}

function buildBlobRequestHeaders(input: {
  method: "GET" | "PUT";
  config: RuntimeAssetStoreConfig;
  accountKey?: string | undefined;
  blobName: string;
  contentLength: number;
  contentType?: string | undefined;
  metadata?: Record<string, string> | undefined;
  requestHeaders?: Record<string, string> | undefined;
  now: Date;
}): Headers {
  const accountName = input.config.accountName ?? AZURITE_DEFAULT_ACCOUNT_NAME;
  const headers: Record<string, string> = {
    "x-ms-date": input.now.toUTCString(),
    "x-ms-version": "2023-11-03",
    ...(input.requestHeaders ?? {}),
  };
  if (input.contentType) headers["content-type"] = input.contentType;
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (!AZURITE_ALLOWED_METADATA_KEYS.includes(normalizedKey as typeof AZURITE_ALLOWED_METADATA_KEYS[number])) {
      throw new Error(`Blob metadata key is not allowed for generated asset uploads: ${key}`);
    }
    headers[`x-ms-meta-${normalizedKey}`] = value;
  }
  if (input.accountKey) {
    headers['authorization'] = buildSharedKeyAuthorizationHeader({
      method: input.method,
      accountName,
      accountKey: input.accountKey,
      containerName: input.config.containerName,
      blobName: input.blobName,
      headers,
      contentLength: input.contentLength,
      contentType: input.contentType,
    });
  }
  return new Headers(headers);
}

function normalizeBlobName(blobName: string): string {
  return blobName.replace(/^\/+/, "");
}

function normalizeBody(body: Uint8Array | string): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function sanitizeMetadataValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 256);
}

async function assertOkResponse(response: Response, operation: string, url: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`${operation} failed for ${url}: ${response.status} ${response.statusText}${body ? ` ${body}` : ""}`);
}
