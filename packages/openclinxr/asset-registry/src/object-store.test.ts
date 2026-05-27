import { describe, expect, it } from "vitest";
import { registerGeneratedRuntimeAssetReference, resolveRuntimeAssetStoreConfig } from "./runtime-bundles.js";
import {
  assertLocalAzuriteEndpoint,
  buildAzuriteConnectionSummary,
  buildSharedKeyAuthorizationHeader,
  createAzuriteAssetObjectStore,
} from "./object-store.js";

describe("asset object store", () => {
  it("summarizes Azurite emulator endpoints without production cloud calls", () => {
    expect(buildAzuriteConnectionSummary()).toEqual({
      storeKind: "azurite_blob",
      accountName: "devstoreaccount1",
      containerName: "openclinxr-assets",
      baseUrl: "http://127.0.0.1:10000/devstoreaccount1",
      expectedEndpoint: "http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets",
      productionCloudCall: false,
    });
  });

  it("builds SharedKey auth headers for emulator requests when an account key is provided", () => {
    const authorization = buildSharedKeyAuthorizationHeader({
      method: "PUT",
      accountName: "devstoreaccount1",
      accountKey: Buffer.from("dev-key-for-test").toString("base64"),
      containerName: "openclinxr-assets",
      blobName: "tenants/local/asset-library/patient/v1/model.glb",
      contentLength: 12,
      contentType: "model/gltf-binary",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-date": "Fri, 22 May 2026 21:30:00 GMT",
        "x-ms-version": "2023-11-03",
      },
    });

    expect(authorization).toMatch(/^SharedKey devstoreaccount1:[A-Za-z0-9+/]+=*$/);
  });

  it("hard-fails local emulator helpers when pointed at non-local endpoints", () => {
    expect(() => assertLocalAzuriteEndpoint("http://127.0.0.1:10000/devstoreaccount1")).not.toThrow();
    expect(() => createAzuriteAssetObjectStore({
      config: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        baseUrl: "https://openclinxrprodassets.blob.core.windows.net",
      },
      accountKey: Buffer.from("dev-key-for-test").toString("base64"),
    })).toThrow("Azurite endpoint must stay local-only and HTTP");
  });

  it("rejects unapproved blob metadata keys", async () => {
    const store = createAzuriteAssetObjectStore({
      accountKey: Buffer.from("dev-key-for-test").toString("base64"),
      fetch: async () => new Response(null, { status: 201 }),
    });

    await expect(store.putObject({
      blobName: "tenants/local/asset-library/patient/v1/model.glb",
      body: "glb-bytes",
      metadata: {
        userId: "learner_1",
      },
    })).rejects.toThrow("Blob metadata key is not allowed");
  });

  it("keeps learner-facing bundle identity out of blob metadata", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const store = createAzuriteAssetObjectStore({
      accountKey: Buffer.from("dev-key-for-test").toString("base64"),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 201 });
      },
    });
    const asset = registerGeneratedRuntimeAssetReference({
      assetId: "generated_patient_model_v17",
      version: "v17",
      kind: "humanoid_model",
      displayName: "Generated patient model v17",
      scenarioAssetId: "patient_robert_hayes_character",
      blobName: "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      contentType: "model/gltf-binary",
      assetStore: resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" }),
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["rigging-report-v17"],
    });

    await store.putEncounterRuntimeAsset(asset, "glb-bytes");
    const headers = new Headers(requests[0]?.init.headers);
    expect(headers.get("x-ms-meta-assetid")).toBe("generated_patient_model_v17");
    expect(headers.get("x-ms-meta-userid")).toBeNull();
    expect(headers.get("x-ms-meta-tenantid")).toBeNull();
    expect(headers.get("x-ms-meta-examrunid")).toBeNull();
  });

  it("puts and gets generated runtime assets through an Azurite-compatible fetch adapter", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      if (init?.method === "GET") {
        return new Response("glb-bytes", {
          status: 200,
          headers: {
            "content-type": "model/gltf-binary",
            etag: "etag-read",
          },
        });
      }
      return new Response(null, {
        status: 201,
        headers: {
          etag: "etag-write",
          "x-ms-request-id": "request-1",
        },
      });
    };
    const store = createAzuriteAssetObjectStore({
      accountKey: Buffer.from("dev-key-for-test").toString("base64"),
      fetch: fetchStub,
      now: () => new Date("2026-05-22T21:30:00.000Z"),
    });
    const asset = registerGeneratedRuntimeAssetReference({
      assetId: "generated_patient_model_v17",
      version: "v17",
      kind: "humanoid_model",
      displayName: "Generated patient model v17",
      scenarioAssetId: "patient_robert_hayes_character",
      blobName: "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      contentType: "model/gltf-binary",
      assetStore: resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" }),
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["rigging-report-v17"],
    });

    await expect(store.putEncounterRuntimeAsset(asset, "glb-bytes")).resolves.toMatchObject({
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
      blobName: "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      etag: "etag-write",
      requestId: "request-1",
    });
    await expect(store.getObject({ blobName: asset.blob.blobName })).resolves.toMatchObject({
      contentType: "model/gltf-binary",
      etag: "etag-read",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      "http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
    ]);
    expect(new Headers(requests[0]?.init.headers).get("x-ms-blob-type")).toBe("BlockBlob");
    expect(new Headers(requests[0]?.init.headers).get("authorization")).toMatch(/^SharedKey devstoreaccount1:/);
  });
});
