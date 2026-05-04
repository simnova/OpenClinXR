import { describe, expect, it } from "vitest";
import {
  AssetGenerationCapabilityFacade,
  createDeterministicAssetGenerationAdapter,
  type AssetGenerationJobRequest,
  type AssetGenerationWorkerAdapter,
  type CommandRunner,
} from "./index.js";

describe("asset-generation job facade", () => {
  it.each([
    "character-generation",
    "medical-equipment-generation",
    "voice-asset-generation",
    "animation-generation",
    "asset-bake",
  ] as const)("submits deterministic no-spend jobs for %s", async (capabilityId) => {
    const facade = new AssetGenerationCapabilityFacade({
      idFactory: () => `job-${capabilityId}`,
      now: fixedClock([
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
        "2026-01-01T00:00:02.000Z",
      ]),
    });

    const record = await facade.submit({
      profile: "local-development",
      capabilityId,
      payload: {
        requestId: `req-${capabilityId}`,
      },
    });

    expect(record.status).toBe("succeeded");
    expect(record.request.capabilityId).toBe(capabilityId);
    expect(record.manifest).toMatchObject({
      schemaVersion: "asset-generation-manifest.v1",
      capabilityId,
    });
    expect(record.provenance).toMatchObject({
      spendCents: 0,
      externalNetworkUsed: false,
    });
    expect(record.history.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
  });

  it("stores a full deterministic no-spend job lifecycle in memory", async () => {
    let sequence = 0;
    const facade = new AssetGenerationCapabilityFacade({
      idFactory: () => `job-${++sequence}`,
      now: fixedClock([
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
        "2026-01-01T00:00:02.000Z",
      ]),
    });

    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "character-generation",
      payload: {
        clinicalRole: "standardized-patient",
        scenarioId: "ed-chest-pain",
      },
    });

    expect(record).toMatchObject({
      id: "job-1",
      status: "succeeded",
      policy: {
        timeoutMs: 120_000,
        sandboxWorkdir: ".openclinxr/asset-generation",
        requireArtifactManifest: true,
        requireLicenseProvenance: true,
        allowExternalNetwork: false,
        spendLimitCents: 0,
        runtime: {
          providerKind: "deterministic-mock",
          implementationLanguage: "typescript",
          transport: "in-process",
        },
      },
      manifest: {
        schemaVersion: "asset-generation-manifest.v1",
        capabilityId: "character-generation",
      },
      provenance: {
        license: "openclinxr-deterministic-test-fixture",
        spendCents: 0,
        externalNetworkUsed: false,
      },
    });
    expect(record.history.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
    expect(record.artifacts).toEqual([
      {
        kind: "manifest",
        path: ".openclinxr/asset-generation/job-1/character-generation-manifest.json",
        mediaType: "application/json",
      },
      {
        kind: "source",
        path: ".openclinxr/asset-generation/job-1/character-generation-source.asset.json",
        mediaType: "application/json",
      },
    ]);
    await expect(facade.get("job-1")).resolves.toEqual(record);
    expect(await facade.list()).toEqual([record]);
  });

  it("invokes Python/native workers through a fake command runner only", async () => {
    const calls: unknown[] = [];
    const runner: CommandRunner = {
      async run(invocation) {
        calls.push(invocation);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            artifacts: [
              {
                kind: "mesh",
                path: ".openclinxr/asset-generation/native-1/baked.glb",
                mediaType: "model/gltf-binary",
              },
            ],
            manifest: {
              schemaVersion: "asset-generation-manifest.v1",
              capabilityId: "asset-bake",
              outputs: ["baked.glb"],
            },
            provenance: {
              generator: "fake-blender",
              license: "fixture-only",
              spendCents: 0,
              externalNetworkUsed: false,
            },
          }),
          stderr: "",
        };
      },
    };
    const facade = new AssetGenerationCapabilityFacade({
      adapters: [
        createDeterministicAssetGenerationAdapter("character-generation"),
        createDeterministicAssetGenerationAdapter("medical-equipment-generation"),
        {
          capabilityId: "asset-bake",
          providerId: "fake-native-bake",
          providerKind: "native-executable-worker",
          implementationLanguage: "native-executable",
          transport: "local-executable-worker",
          async run(request, policy, context) {
            return context.commandRunner.run({
              executable: "fake-blender",
              args: ["--background", "--python", "bake.py", "--job", context.jobId],
              cwd: policy.sandboxWorkdir,
              timeoutMs: policy.timeoutMs,
              env: {
                OPENCLINXR_NO_EXTERNAL_NETWORK: "1",
                OPENCLINXR_SPEND_LIMIT_CENTS: "0",
              },
              input: JSON.stringify(request.payload),
            }).then((result) => {
              if (result.exitCode !== 0) {
                throw new Error(result.stderr || `Worker exited with ${result.exitCode}`);
              }
              return JSON.parse(result.stdout);
            });
          },
        } satisfies AssetGenerationWorkerAdapter,
      ],
      commandRunner: runner,
      idFactory: () => "native-1",
    });

    const record = await facade.submit({
      profile: "local-production",
      capabilityId: "asset-bake",
      payload: { sourceAsset: "clinical-room.glb" },
      policy: {
        timeoutMs: 30_000,
        sandboxWorkdir: ".openclinxr/custom-worker",
      },
    });

    expect(record.status).toBe("succeeded");
    expect(record.worker).toMatchObject({
      providerId: "fake-native-bake",
      providerKind: "native-executable-worker",
      implementationLanguage: "native-executable",
      transport: "local-executable-worker",
    });
    expect(calls).toEqual([
      {
        executable: "fake-blender",
        args: ["--background", "--python", "bake.py", "--job", "native-1"],
        cwd: ".openclinxr/custom-worker",
        timeoutMs: 30_000,
        env: {
          OPENCLINXR_NO_EXTERNAL_NETWORK: "1",
          OPENCLINXR_SPEND_LIMIT_CENTS: "0",
        },
        input: JSON.stringify({ sourceAsset: "clinical-room.glb" }),
      },
    ]);
    expect(record.provenance).toMatchObject({
      spendCents: 0,
      externalNetworkUsed: false,
    });
  });

  it("records worker failures without losing policy or request context", async () => {
    const failingAdapter: AssetGenerationWorkerAdapter = {
      capabilityId: "medical-equipment-generation",
      providerId: "fake-python-equipment",
      providerKind: "python-worker",
      implementationLanguage: "python",
      transport: "local-executable-worker",
      async run() {
        throw new Error("mesh generator crashed");
      },
    };
    const facade = new AssetGenerationCapabilityFacade({
      adapters: [failingAdapter],
      idFactory: () => "failed-1",
    });
    const request: AssetGenerationJobRequest = {
      profile: "local-development",
      capabilityId: "medical-equipment-generation",
      payload: { equipmentType: "defibrillator" },
    };

    const record = await facade.submit(request);

    expect(record).toMatchObject({
      id: "failed-1",
      status: "failed",
      request,
      policy: {
        allowExternalNetwork: false,
        spendLimitCents: 0,
        requireArtifactManifest: true,
        requireLicenseProvenance: true,
      },
      error: {
        message: "mesh generator crashed",
      },
    });
    expect(record.history.map((event) => event.status)).toEqual(["queued", "running", "failed"]);
    await expect(facade.get("failed-1")).resolves.toMatchObject({ status: "failed" });
  });

  it("rejects policy/runtime swaps that would use cloud spend or external network", async () => {
    const facade = new AssetGenerationCapabilityFacade();

    await expect(facade.submit({
      profile: "production",
      capabilityId: "asset-bake",
      payload: {},
      policy: {
        allowExternalNetwork: true,
      },
    })).rejects.toThrow("Asset generation jobs must disable external network access");

    await expect(facade.submit({
      profile: "production",
      capabilityId: "asset-bake",
      payload: {},
      policy: {
        spendLimitCents: 1,
      },
    })).rejects.toThrow("Asset generation jobs must be configured for zero spend");

    await expect(facade.submit({
      profile: "production",
      capabilityId: "asset-bake",
      payload: {},
      policy: {
        runtime: {
          providerKind: "paid-cloud-provider",
        },
      },
    })).rejects.toThrow("Asset generation runtime swaps cannot use paid cloud providers");
  });
});

function fixedClock(values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? values[values.length - 1]!;
}
