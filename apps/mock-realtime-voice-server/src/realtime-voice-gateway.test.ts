import { afterEach, describe, expect, it } from "vitest";
import {
  createRealtimeVoiceGatewayPosture,
  runRealtimeVoiceProxyHarness,
  startPythonCompatibleVoiceBackendFixture,
  startRealtimeVoiceGatewayServer,
  type StoppableServer,
} from "./index.js";

const startedServers: StoppableServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).reverse().map((server) => server.stop()));
});

describe("realtime voice gateway spike", () => {
  it("keeps Bun HTTP/3 and Python inference claims blocked until the local runtimes are installed", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: false,
      pythonBackendDependenciesInstalled: false,
      pythonInferenceRuntimeInstalled: false,
    });

    expect(posture.policy).toEqual({
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    });
    expect(posture.transports.websocket.status).toBe("working_spike_transport");
    expect(posture.transports.webTransport.status).toBe("blocked_pending_runtime_support");
    expect(posture.gatewayRuntime).toMatchObject({
      target: "bun-hono-http3",
      localVerifiedFallback: "node-hono-ws",
      blockers: ["bun_not_installed", "http3_webtransport_not_verified"],
    });
    expect(posture.backends.pythonFastApi.status).toBe("source_present_not_executed");
    expect(posture.backends.inferenceCandidates.map((candidate) => candidate.id)).toEqual(["moshi-mlx", "qwen3-tts"]);
  });

  it("proxies bidirectional control and binary audio frames through the gateway to a Python-compatible backend contract", async () => {
    const backend = await startPythonCompatibleVoiceBackendFixture({ port: 0, artificialDelayMs: 1 });
    startedServers.push(backend);
    const gateway = await startRealtimeVoiceGatewayServer({ port: 0, backendUrl: backend.wsUrl });
    startedServers.push(gateway);

    const result = await runRealtimeVoiceProxyHarness({
      gatewayUrl: gateway.wsUrl,
      audioChunks: [
        Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x00, 0x01]),
        Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x00, 0x02]),
      ],
      targetLatencyMs: 1_000,
    });

    expect(result).toMatchObject({
      controlFramesSent: 2,
      audioMetadataFramesSent: 2,
      binaryAudioChunksSent: 2,
      transcriptEventsReceived: 2,
      audioChunkMetadataReceived: 2,
      binaryAudioChunksReceived: 2,
      backendProtocol: "python-fastapi-compatible-websocket",
      codec: "opus",
      latencyBudget: {
        targetMs: 1_000,
        passed: true,
      },
    });
    expect(result.roundTripLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.roundTripLatencyMs).toBeLessThan(1_000);
    expect(result.frameLatencySamplesMs).toHaveLength(2);
    for (const latencyMs of result.frameLatencySamplesMs) {
      expect(latencyMs).toBeGreaterThanOrEqual(0);
      expect(latencyMs).toBeLessThan(1_000);
    }
    expect(result.audioChunkIndexesReceived).toEqual([0, 1]);
    expect(result.receivedEventTypes).toEqual(expect.arrayContaining([
      "backend.ready",
      "voice.started",
      "transcript.partial",
      "audio.chunk",
      "voice.stopped",
    ]));
  });

  it("serves Hono HTTP posture routes alongside the websocket upgrade path", async () => {
    const backend = await startPythonCompatibleVoiceBackendFixture({ port: 0 });
    startedServers.push(backend);
    const gateway = await startRealtimeVoiceGatewayServer({ port: 0, backendUrl: backend.wsUrl });
    startedServers.push(gateway);

    const health = await fetch(`${gateway.httpUrl}/health`);
    const posture = await fetch(`${gateway.httpUrl}/voice/realtime/posture`);

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      service: "openclinxr-realtime-voice-gateway",
    });
    expect(posture.status).toBe(200);
    expect(await posture.json()).toMatchObject({
      transports: {
        websocket: { status: "working_spike_transport" },
      },
    });
  });
});
