import { describe, expect, it } from "vitest";
import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import { createBunServerConfig, createOpenClinXrApiStartup, createNodeServerConfig } from "./index.js";

describe("OpenClinXR API startup", () => {
  it("starts through a CellixJS-inspired fluent bootstrap with Azure-compatible handler metadata", async () => {
    const startup = createOpenClinXrApiStartup().startUp();

    expect(startup.infrastructureServiceIds).toEqual(["scenarioRuntime", "apiPersistence", "telemetry", "assetGenerationFacade"]);
    expect(startup.primaryRuntimeTarget).toBe("bun-hono");
    expect(startup.protocolSupport).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocolId: "websocket",
        status: "contract_ready",
        runtimeTarget: "bun-hono",
        path: "/voice/realtime/ws",
        blockers: expect.arrayContaining(["api_bun_websocket_runtime_not_verified"]),
      }),
      expect.objectContaining({
        protocolId: "webtransport",
        status: "blocked",
        blockers: expect.arrayContaining(["bun_http3_webtransport_not_verified", "quest_webtransport_path_not_verified"]),
      }),
      expect.objectContaining({
        protocolId: "quic",
        status: "planned",
        blockers: expect.arrayContaining(["operator_quic_gateway_proposal_missing", "quic_gateway_not_implemented"]),
      }),
      expect.objectContaining({
        protocolId: "web3-signaling",
        status: "planned",
        blockers: expect.arrayContaining(["operator_web3_signaling_proposal_missing", "web3_identity_and_signaling_protocol_not_selected"]),
      }),
    ]));
    expect(startup.handlerSpecs).toEqual([
      {
        name: "graphql-contract",
        trigger: {
          route: "admin/graphql/{*segments}",
          methods: ["GET", "POST", "OPTIONS"],
        },
      },
      {
        name: "rest",
        trigger: {
          route: "{*rest}",
          methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
        },
      },
    ]);

    const response = await startup.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "openclinxr-api",
    });
  });

  it("creates a local Node server config from the same startup path", async () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createNodeServerConfig(startup, { port: 4321 });

    expect(config.port).toBe(4321);
    const response = await config.fetch(new Request("http://localhost/providers/health"));
    await expect(response.json()).resolves.toMatchObject({
      model: { providerId: "mock-model", status: "ready" },
    });
  });

  it("creates a Bun plus Hono server config from the same startup path without requiring Bun during tests", async () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createBunServerConfig(startup, { port: 4322 });

    expect(config.runtime).toBe("bun-hono");
    expect(config.port).toBe(4322);
    expect(config.websocketPath).toBe("/voice/realtime/ws");
    expect(config.protocolSupport.map((protocol) => protocol.protocolId)).toEqual([
      "http-rest",
      "admin-graphql",
      "websocket",
      "webtransport",
      "quic",
      "web3-signaling",
    ]);
    const response = await config.fetch(new Request("http://localhost/runtime/protocols"));
    await expect(response.json()).resolves.toMatchObject({
      primaryRuntimeTarget: "bun-hono",
      localFallbackRuntimeTarget: "node-hono",
      protocols: expect.arrayContaining([
        expect.objectContaining({
          protocolId: "websocket",
          status: "contract_ready",
          blockers: expect.arrayContaining(["api_bun_websocket_runtime_not_verified"]),
        }),
      ]),
    });
  });

  it("creates a Bun WebSocket upgrade handler for local realtime voice source evidence", async () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createBunServerConfig(startup, { port: 4322 });
    const sentFrames: unknown[] = [];
    const fakeSocket = {
      send(frame: string | Uint8Array) {
        sentFrames.push(frame);
      },
    };

    expect(config.canUpgradeWebSocketRequest(new Request("http://localhost/voice/realtime/ws", {
      headers: { upgrade: "websocket" },
    }))).toBe(true);
    expect(config.canUpgradeWebSocketRequest(new Request("http://localhost/voice/realtime/ws"))).toBe(false);
    expect(config.canUpgradeWebSocketRequest(new Request("http://localhost/health", {
      headers: { upgrade: "websocket" },
    }))).toBe(false);

    config.websocket.open(fakeSocket);
    config.websocket.message(fakeSocket, JSON.stringify({ type: "voice.start", sessionId: "run-001" }));
    config.websocket.message(fakeSocket, new Uint8Array([0x4f, 0x70, 0x75, 0x73]));

    expect(sentFrames.map((frame) => typeof frame === "string" ? JSON.parse(frame).type : "binary")).toEqual([
      "gateway.ready",
      "control.ack",
      "transcript.metadata",
      "audio.metadata",
      "transcript.delta",
      "binary",
    ]);
    expect(sentFrames.at(-1)).toBeInstanceOf(Uint8Array);
  });

  it("preserves byte offsets when Bun delivers realtime audio as an ArrayBuffer view", () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createBunServerConfig(startup, { port: 4322 });
    const sentFrames: unknown[] = [];
    const fakeSocket = {
      send(frame: string | Uint8Array) {
        sentFrames.push(frame);
      },
    };
    const buffer = new Uint8Array([0xff, 0x4f, 0x70, 0x75, 0x73, 0xee]).buffer;
    const frame = new DataView(buffer, 1, 4);

    config.websocket.open(fakeSocket);
    config.websocket.message(fakeSocket, frame);

    expect(sentFrames.at(-1)).toEqual(new Uint8Array([0x4f, 0x70, 0x75, 0x73]));
  });

  it("threads Bun runtime posture into the Bun plus Hono server facade", async () => {
    const startup = createOpenClinXrApiStartup({
      realtimeVoiceGatewayPosture: {
        bunAvailable: true,
        pythonBackendDependenciesInstalled: false,
        pythonInferenceRuntimeInstalled: false,
      },
    }).startUp();
    const config = createBunServerConfig(startup, { port: 4322 });

    const response = await config.fetch(new Request("http://localhost/voice/realtime/posture"));
    const posture = await response.json() as { gatewayRuntime: { blockers: string[] } };

    expect(response.status).toBe(200);
    expect(posture.gatewayRuntime.blockers).not.toContain("bun_not_installed");
    expect(posture.gatewayRuntime.blockers).toContain("http3_webtransport_not_verified");
  });

  it("persists station run queue review snapshots in the default single-user startup", async () => {
    const startup = createOpenClinXrApiStartup().startUp();

    const createResponse = await startup.fetch(
      new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshotId: "queue_snapshot_startup_001",
          createdAt: "2026-05-03T18:00:00.000Z",
          reviewerId: "admin_seed_reviewer",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);

    const listResponse = await startup.fetch(new Request("http://localhost/exam-blueprints/step2cs-seed/station-run-queue/snapshots"));
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotId: "queue_snapshot_startup_001",
          reviewerId: "admin_seed_reviewer",
        }),
      ]),
    );
  });

  it("persists scenario review decisions in the default single-user startup", async () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const submitScenarioReviewDocument = adminGraphqlDocumentByOperationName("SubmitScenarioReview");
    const scenarioDetailDocument = adminGraphqlDocumentByOperationName("ScenarioDetail");

    const reviewResponse = await startup.fetch(new Request("http://localhost/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: submitScenarioReviewDocument.source,
        operationName: "SubmitScenarioReview",
        variables: {
          input: {
            scenarioId: "peds_asthma_parent_anxiety_v1",
            version: 1,
            reviewerRole: "clinical",
            reviewerId: "pediatrician_001",
            decision: "APPROVED",
            comments: "Clinical approval recorded in the default startup sink.",
            evidenceRefs: ["evidence:peds:clinical:startup"],
          },
        },
      }),
    }));

    expect(reviewResponse.status).toBe(200);

    const detailResponse = await startup.fetch(new Request("http://localhost/admin/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: scenarioDetailDocument.source,
        operationName: "ScenarioDetail",
        variables: { scenarioId: "peds_asthma_parent_anxiety_v1", version: 1 },
      }),
    }));

    await expect(detailResponse.json()).resolves.toMatchObject({
      data: {
        scenario: {
          status: "READY_FOR_REVIEW",
          review: {
            clinical: "approved",
          },
        },
      },
    });
  });

  it("submits and reads deterministic internal character-generation jobs through startup fetch", async () => {
    const startup = createOpenClinXrApiStartup({
      assetGenerationFacade: new AssetGenerationCapabilityFacade({
        idFactory: () => "asset-job-startup-0001",
        now: () => "2026-05-04T00:00:00.000Z",
      }),
    }).startUp();

    const submitResponse = await startup.fetch(new Request("http://localhost/internal/capabilities/character-generation/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: "local-development",
        payload: { prompt: "paramedic character" },
      }),
    }));

    expect(submitResponse.status).toBe(201);
    await expect(submitResponse.json()).resolves.toMatchObject({
      id: "asset-job-startup-0001",
      status: "succeeded",
      request: {
        capabilityId: "character-generation",
        profile: "local-development",
        payload: { prompt: "paramedic character" },
      },
      provenance: {
        spendCents: 0,
        externalNetworkUsed: false,
      },
    });

    const readResponse = await startup.fetch(
      new Request("http://localhost/internal/capabilities/character-generation/jobs/asset-job-startup-0001"),
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      id: "asset-job-startup-0001",
      request: { capabilityId: "character-generation" },
      provenance: { spendCents: 0, externalNetworkUsed: false },
    });
  });
});
