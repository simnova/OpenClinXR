import { AssetGenerationCapabilityFacade } from "@openclinxr/capability-gateway";
import { adminGraphqlDocumentByOperationName } from "@openclinxr/graphql";
import { describe, expect, it } from "vitest";
import {
  createBunRealtimeVoiceGatewayPostureInputFromEnvironment,
  createBunServerConfig,
  createNodeServerConfig,
  createOpenClinXrApiProtocolPostureFromEnvironment,
  createOpenClinXrApiStartup,
  readApiBunWebSocketRuntimeVerifiedFromEnvironment,
} from "./index.js";

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
      send(frame: string | Uint8Array): number {
        sentFrames.push(frame);
        return sentFrames.length;
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

  it("rejects malformed and unsupported Bun realtime voice control frames without acknowledging them", () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createBunServerConfig(startup, { port: 4322 });
    const sentFrames: unknown[] = [];
    const fakeSocket = {
      send(frame: string | Uint8Array): number {
        sentFrames.push(frame);
        return sentFrames.length;
      },
    };

    config.websocket.open(fakeSocket);
    config.websocket.message(fakeSocket, "{not-json");
    config.websocket.message(fakeSocket, JSON.stringify({ type: "voice.unsupported_local_smoke_probe", sessionId: "run-001" }));

    const jsonFrames = sentFrames
      .filter((frame): frame is string => typeof frame === "string")
      .map((frame) => JSON.parse(frame) as { type: string; reason?: string; controlType?: string });

    expect(jsonFrames).toEqual([
      expect.objectContaining({ type: "gateway.ready" }),
      expect.objectContaining({
        type: "error",
        reason: "invalid_json_control_frame",
      }),
      expect.objectContaining({
        type: "error",
        reason: "unsupported_control_type",
        controlType: "voice.unsupported_local_smoke_probe",
      }),
    ]);
    expect(jsonFrames).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "control.ack" }),
    ]));
  });

  it("summarizes nested Bun realtime voice control metadata before acknowledging it", () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createBunServerConfig(startup, { port: 4322 });
    const sentFrames: unknown[] = [];
    const fakeSocket = {
      send(frame: string | Uint8Array): number {
        sentFrames.push(frame);
        return sentFrames.length;
      },
    };

    config.websocket.open(fakeSocket);
    config.websocket.message(fakeSocket, JSON.stringify({
      type: "voice.start",
      sessionId: "run-001",
      metadata: { actorId: "patient-001" },
      chunkPlan: [1, 2],
    }));

    const acknowledgement = sentFrames
      .filter((frame): frame is string => typeof frame === "string")
      .map((frame) => JSON.parse(frame) as { type: string; received?: Record<string, unknown> })
      .find((frame) => frame.type === "control.ack");

    expect(acknowledgement?.received).toMatchObject({
      type: "voice.start",
      sessionId: "run-001",
      metadata: "object[1]",
      chunkPlan: "list[2]",
    });
  });

  it("preserves byte offsets when Bun delivers realtime audio as an ArrayBuffer view", () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const config = createBunServerConfig(startup, { port: 4322 });
    const sentFrames: unknown[] = [];
    const fakeSocket = {
      send(frame: string | Uint8Array): number {
        sentFrames.push(frame);
        return sentFrames.length;
      },
    };
    const buffer = new Uint8Array([0xff, 0x4f, 0x70, 0x75, 0x73, 0xee]).buffer;
    const frame = new DataView(buffer, 1, 4);

    config.websocket.open(fakeSocket);
    config.websocket.message(fakeSocket, frame);

    expect(sentFrames.at(-1)).toEqual(new Uint8Array([0x4f, 0x70, 0x75, 0x73]));
  });

  it("can proxy Bun realtime voice frames to a configured Python backend websocket", () => {
    const startup = createOpenClinXrApiStartup().startUp();
    const backendSockets: FakeBackendWebSocket[] = [];
    const config = createBunServerConfig(startup, {
      port: 4322,
      pythonBackendWebSocketUrl: "ws://127.0.0.1:8765/voice/realtime/ws",
      backendWebSocketFactory: (url: string) => {
        const socket = new FakeBackendWebSocket(url);
        backendSockets.push(socket);
        return socket;
      },
    });
    const sentFrames: unknown[] = [];
    const clientSocket = {
      send(frame: string | Uint8Array): number {
        sentFrames.push(frame);
        return sentFrames.length;
      },
    };
    const buffer = new Uint8Array([0xff, 0x4f, 0x70, 0x75, 0x73, 0xee]).buffer;

    config.websocket.open(clientSocket);
    expect(backendSockets).toHaveLength(1);
    expect(JSON.parse(sentFrames[0] as string)).toMatchObject({
      type: "gateway.ready",
      protocol: "bun-native-python-backend-proxy",
      backendUrlConfigured: true,
    });

    config.websocket.message(clientSocket, JSON.stringify({ type: "voice.start", sessionId: "run-001" }));
    config.websocket.message(clientSocket, new DataView(buffer, 1, 4));
    expect(backendSockets[0]?.sentFrames).toEqual([]);

    backendSockets[0]?.emitOpen();
    expect(backendSockets[0]?.sentFrames).toEqual([
      JSON.stringify({ type: "voice.start", sessionId: "run-001" }),
      new Uint8Array([0x4f, 0x70, 0x75, 0x73]),
    ]);

    backendSockets[0]?.emitMessage(JSON.stringify({ type: "backend.ready" }));
    backendSockets[0]?.emitMessage(new Uint8Array([0x61, 0x75]));
    expect(sentFrames.slice(1)).toEqual([
      JSON.stringify({ type: "backend.ready" }),
      new Uint8Array([0x61, 0x75]),
    ]);

    config.websocket.close(clientSocket);
    expect(backendSockets[0]?.closed).toBe(true);
  });

  it("threads Bun runtime posture into the Bun plus Hono server facade", async () => {
    const startup = createOpenClinXrApiStartup({
      realtimeVoiceGatewayPosture: {
        bunAvailable: true,
        pythonBackendWebSocketUrlConfigured: false,
        pythonBackendDependenciesInstalled: false,
        pythonInferenceRuntimeInstalled: false,
      },
    }).startUp();
    const config = createBunServerConfig(startup, { port: 4322 });

    const response = await config.fetch(new Request("http://localhost/voice/realtime/posture"));
    const posture = await response.json() as {
      gatewayRuntime: { blockers: string[] };
      backends: { pythonFastApi: { transportProxy: { status: string; backendUrlConfigured: boolean } } };
    };

    expect(response.status).toBe(200);
    expect(posture.gatewayRuntime.blockers).not.toContain("bun_not_installed");
    expect(posture.gatewayRuntime.blockers).toContain("http3_webtransport_not_verified");
    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "not_configured",
      backendUrlConfigured: false,
    });
  });

  it("threads configured Python websocket proxy posture through startup fetch without claiming inference readiness", async () => {
    const startup = createOpenClinXrApiStartup({
      realtimeVoiceGatewayPosture: {
        bunAvailable: true,
        pythonBackendWebSocketUrlConfigured: true,
        pythonBackendDependenciesInstalled: false,
        pythonInferenceRuntimeInstalled: false,
      },
    }).startUp();

    const response = await startup.fetch(new Request("http://localhost/voice/realtime/posture"));
    const posture = await response.json() as {
      backends: {
        pythonFastApi: {
          status: string;
          transportProxy: {
            status: string;
            backendUrlConfigured: boolean;
            readyForLiveDialog: boolean;
            blockers: string[];
          };
          blockers: string[];
        };
      };
    };

    expect(response.status).toBe(200);
    expect(posture.backends.pythonFastApi.status).toBe("source_present_not_executed");
    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "configured_not_verified",
      backendUrlConfigured: true,
      readyForLiveDialog: false,
    });
    expect(posture.backends.pythonFastApi.transportProxy.blockers).toContain("real_model_inference_not_observed");
    expect(posture.backends.pythonFastApi.blockers).toEqual(expect.arrayContaining([
      "fastapi_uvicorn_websockets_not_installed",
      "mlx_moshi_or_qwen3_tts_not_installed",
    ]));
  });

  it("threads verified Python proxy reachability posture through startup fetch without claiming live dialog", async () => {
    const startup = createOpenClinXrApiStartup({
      realtimeVoiceGatewayPosture: {
        bunAvailable: true,
        pythonBackendWebSocketUrlConfigured: true,
        pythonBackendDependenciesInstalled: true,
        pythonInferenceRuntimeInstalled: false,
        pythonBackendProxyReachabilityEvidence: {
          sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
          generatedAt: "2026-05-06T01:52:40.346Z",
          status: "passed",
          eventTypesObserved: [
            "gateway.ready",
            "backend.ready",
            "voice.started",
            "audio.chunk",
            "transcript.partial",
            "transcript.final",
            "voice.stopped",
          ],
          binaryMessages: 1,
          backendProtocolObserved: true,
          latencyFieldsObserved: true,
          binaryEchoObserved: true,
        },
      },
    }).startUp();

    const response = await startup.fetch(new Request("http://localhost/voice/realtime/posture"));
    const posture = await response.json() as {
      backends: {
        pythonFastApi: {
          transportProxy: {
            status: string;
            readyForLiveDialog: boolean;
            blockers: string[];
            reachabilityEvidence?: {
              sourceFile: string;
              status: string;
            };
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "configured_reachability_verified",
      readyForLiveDialog: false,
      reachabilityEvidence: {
        sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        status: "passed",
      },
    });
    expect(posture.backends.pythonFastApi.transportProxy.blockers).toEqual(expect.arrayContaining([
      "real_model_inference_not_observed",
      "quest_browser_audio_capture_not_observed",
      "quest_playback_not_observed",
      "opus_codec_not_verified",
      "clinical_voice_safety_not_exercised",
    ]));
  });

  it("builds Bun realtime voice posture input from explicit local proxy evidence environment", async () => {
    const postureInput = createBunRealtimeVoiceGatewayPostureInputFromEnvironment(
      {
        OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL: "ws://127.0.0.1:8766/voice/realtime/ws",
        OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/api-python-backend-runtime-smoke-2026-05-05.json",
      },
      {
        readEvidenceFile: (filePath) =>
          filePath.includes("api-python-backend-runtime-smoke")
            ? passedPythonBackendRuntimeSmokeEvidence()
            : passedPythonProxyRuntimeSmokeEvidence(),
      },
    );
    const startup = createOpenClinXrApiStartup({ realtimeVoiceGatewayPosture: postureInput }).startUp();

    const response = await startup.fetch(new Request("http://localhost/voice/realtime/posture"));
    const posture = await response.json() as {
      backends: {
        pythonFastApi: {
          status: string;
          blockers: string[];
          transportProxy: {
            status: string;
            reachabilityEvidence?: {
              sourceFile: string;
              status: string;
            };
          };
        };
      };
    };

    expect(postureInput.pythonBackendProxyReachabilityEvidence).toMatchObject({
      sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
      status: "passed",
      backendProtocolObserved: true,
      latencyFieldsObserved: true,
      binaryEchoObserved: true,
    });
    expect(postureInput.pythonBackendDependenciesInstalled).toBe(true);
    expect(postureInput.pythonInferenceRuntimeInstalled).toBe(false);
    expect(response.status).toBe(200);
    expect(posture.backends.pythonFastApi.status).toBe("available_for_local_run");
    expect(posture.backends.pythonFastApi.blockers).not.toContain("fastapi_uvicorn_websockets_not_installed");
    expect(posture.backends.pythonFastApi.blockers).toContain("mlx_moshi_or_qwen3_tts_not_installed");
    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "configured_reachability_verified",
      reachabilityEvidence: {
        sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        status: "passed",
      },
    });
  });

  it("ignores local proxy and backend runtime evidence when explicit evidence files are blocked or absent", () => {
    const blockedPostureInput = createBunRealtimeVoiceGatewayPostureInputFromEnvironment(
      {
        OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL: "ws://127.0.0.1:8766/voice/realtime/ws",
        OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-blocked.json",
        OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/api-python-backend-runtime-smoke-blocked.json",
      },
      {
        readEvidenceFile: () => ({ status: "blocked" }),
      },
    );
    const absentPostureInput = createBunRealtimeVoiceGatewayPostureInputFromEnvironment({
      OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL: "ws://127.0.0.1:8766/voice/realtime/ws",
      OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE: "docs/openclinxr/missing.json",
      OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/missing-backend-runtime.json",
    });

    expect(blockedPostureInput.pythonBackendProxyReachabilityEvidence).toBeUndefined();
    expect(blockedPostureInput.pythonBackendDependenciesInstalled).toBe(false);
    expect(absentPostureInput.pythonBackendProxyReachabilityEvidence).toBeUndefined();
    expect(absentPostureInput.pythonBackendDependenciesInstalled).toBe(false);
  });

  it("ignores proxy evidence that omits canonical backend event proof", () => {
    const incompletePostureInput = createBunRealtimeVoiceGatewayPostureInputFromEnvironment(
      {
        OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL: "ws://127.0.0.1:8766/voice/realtime/ws",
        OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-incomplete.json",
      },
      {
        readEvidenceFile: () => ({
          status: "passed",
          websocket: {
            eventTypesObserved: ["gateway.ready", "backend.ready", "voice.started", "audio.chunk"],
            binaryMessages: 1,
            backendProtocolObserved: true,
            latencyFieldsObserved: true,
            binaryEchoObserved: true,
          },
        }),
      },
    );

    expect(incompletePostureInput.pythonBackendProxyReachabilityEvidence).toBeUndefined();
  });

  it("promotes websocket protocol posture to runtime_ready when Bun WebSocket smoke evidence passes", async () => {
    const startup = createOpenClinXrApiStartup({
      protocolPostureEnvironment: {
        OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/api-bun-websocket-runtime-smoke-2026-06-06.json",
      },
      protocolPostureEnvironmentOptions: {
        readEvidenceFile: () => passedApiBunWebSocketRuntimeSmokeEvidence(),
      },
    }).startUp();

    expect(startup.protocolSupport).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocolId: "websocket",
        status: "ready",
        claimScope: "runtime_ready",
        blockers: [],
      }),
    ]));

    const response = await startup.fetch(new Request("http://localhost/runtime/protocols"));
    await expect(response.json()).resolves.toMatchObject({
      protocols: expect.arrayContaining([
        expect.objectContaining({
          protocolId: "websocket",
          status: "ready",
          blockers: [],
        }),
      ]),
    });
  });

  it("keeps websocket protocol posture blocked when Bun WebSocket smoke evidence is absent or blocked", () => {
    expect(readApiBunWebSocketRuntimeVerifiedFromEnvironment({}, {})).toBe(false);
    expect(readApiBunWebSocketRuntimeVerifiedFromEnvironment(
      { OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/missing.json" },
      { readEvidenceFile: () => undefined },
    )).toBe(false);
    expect(readApiBunWebSocketRuntimeVerifiedFromEnvironment(
      { OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/api-bun-websocket-runtime-smoke-blocked.json" },
      { readEvidenceFile: () => ({ status: "blocked", runtimeEvidenceBlockers: ["websocket_not_connected"] }) },
    )).toBe(false);
    expect(createOpenClinXrApiProtocolPostureFromEnvironment(
      { OPENCLINXR_API_BUN_WEBSOCKET_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/api-bun-websocket-runtime-smoke-incomplete.json" },
      {
        readEvidenceFile: () => ({
          status: "passed",
          runtimeEvidenceBlockers: ["websocket_control_ack_missing"],
          runtime: { h3: { enabled: false, h3TrueEnabled: false } },
          health: { attempted: true, ok: true },
          websocket: { attempted: true, connected: true },
        }),
      },
    ).protocols.find((protocol) => protocol.protocolId === "websocket")).toMatchObject({
      status: "contract_ready",
      blockers: expect.arrayContaining(["api_bun_websocket_runtime_not_verified"]),
    });
  });

  it("ignores backend runtime evidence that omits dependency, health, capability, or canonical websocket proof", () => {
    const incompletePostureInput = createBunRealtimeVoiceGatewayPostureInputFromEnvironment(
      {
        OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL: "ws://127.0.0.1:8766/voice/realtime/ws",
        OPENCLINXR_PYTHON_VOICE_BACKEND_RUNTIME_EVIDENCE_FILE: "docs/openclinxr/api-python-backend-runtime-smoke-incomplete.json",
      },
      {
        readEvidenceFile: () => ({
          ...passedPythonBackendRuntimeSmokeEvidence(),
          websocket: {
            ...passedPythonBackendRuntimeSmokeEvidence().websocket,
            protocol: {
              ...passedPythonBackendRuntimeSmokeEvidence().websocket.protocol,
              serverEventTypesObserved: ["backend.ready", "voice.started"],
            },
          },
        }),
      },
    );

    expect(incompletePostureInput.pythonBackendDependenciesInstalled).toBe(false);
    expect(incompletePostureInput.pythonInferenceRuntimeInstalled).toBe(false);
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

class FakeBackendWebSocket {
  readonly sentFrames: Array<string | Uint8Array> = [];
  readonly listeners = new Map<string, Array<(event: { data?: unknown; message?: string }) => void>>();
  readyState = 0;
  closed = false;

  constructor(readonly url: string) {}

  send(frame: string | Uint8Array): number {
    this.sentFrames.push(frame); return this.sentFrames.length;
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  addEventListener(type: string, listener: (event: { data?: unknown; message?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emitOpen(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  emitMessage(data: string | Uint8Array): void {
    this.emit("message", { data });
  }

  private emit(type: string, event: { data?: unknown; message?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function passedPythonProxyRuntimeSmokeEvidence(): Record<string, unknown> {
  return {
    generatedAt: "2026-05-06T01:52:40.346Z",
    status: "passed",
    websocket: {
      eventTypesObserved: [
        "gateway.ready",
        "backend.ready",
        "voice.started",
        "audio.chunk",
        "transcript.partial",
        "transcript.final",
        "voice.stopped",
      ],
      binaryMessages: 1,
      backendProtocolObserved: true,
      latencyFieldsObserved: true,
      binaryEchoObserved: true,
    },
  };
}

function passedPythonBackendRuntimeSmokeEvidence(): {
  status: "passed";
  python: {
    dependencies: {
      fastapi: "available";
      uvicorn: "available";
      websockets: "available";
    };
    missingPackages: string[];
  };
  health: { ok: true };
  capabilities: { ok: true };
  websocket: {
    connected: true;
    binaryEchoObserved: true;
    protocol: {
      backendProtocolObserved: true;
      latencyFieldsObserved: true;
      canonicalProtocolObserved: true;
      serverEventTypesObserved: string[];
    };
  };
} {
  return {
    status: "passed",
    python: {
      dependencies: {
        fastapi: "available",
        uvicorn: "available",
        websockets: "available",
      },
      missingPackages: [],
    },
    health: { ok: true },
    capabilities: { ok: true },
    websocket: {
      connected: true,
      binaryEchoObserved: true,
      protocol: {
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        canonicalProtocolObserved: true,
        serverEventTypesObserved: [
          "backend.ready",
          "voice.started",
          "audio.chunk",
          "transcript.partial",
          "transcript.final",
          "voice.stopped",
        ],
      },
    },
  };
}

function passedApiBunWebSocketRuntimeSmokeEvidence(): Record<string, unknown> {
  return {
    generatedAt: "2026-06-06T22:20:36.794Z",
    status: "passed",
    runtimeEvidenceBlockers: [],
    runtime: {
      h3: {
        enabled: false,
        h3TrueEnabled: false,
      },
    },
    health: {
      attempted: true,
      ok: true,
    },
    websocket: {
      attempted: true,
      connected: true,
    },
  };
}
