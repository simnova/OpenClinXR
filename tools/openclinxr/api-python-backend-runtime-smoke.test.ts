import { describe, expect, it } from "vitest";
import { buildApiPythonBackendRuntimeSmokeReport } from "./api-python-backend-runtime-smoke.js";

const baseInput = {
  generatedAt: "2026-05-04T00:00:00.000Z",
  pythonExecutable: "python3",
  pythonVersion: "Python 3.11.4",
  dependencies: {
    fastapi: "available" as const,
    uvicorn: "available" as const,
    websockets: "available" as const,
  },
  serverCommand: ["python3", "-m", "uvicorn"],
  serverAttempted: true,
  port: 8765,
  stdout: [],
  stderr: [],
  health: {
    attempted: true,
    ok: true,
    statusCode: 200,
    latencyMs: 25,
    body: { status: "ok", service: "api-python-backend" },
  },
  capabilities: {
    attempted: true,
    ok: true,
    statusCode: 200,
    latencyMs: 26,
    modes: [
      { id: "transport-echo", status: "ready", blockers: [] },
      { id: "moshi-mlx", status: "proposal_required", blockers: ["proposal_local_realtime_voice_model_inference_pending"] },
      { id: "qwen3-tts-mlx", status: "proposal_required", blockers: ["proposal_local_realtime_voice_model_inference_pending"] },
    ],
    body: { defaultMode: "transport-echo" },
  },
  websocket: {
    attempted: true,
    connected: true,
    jsonMessages: 4,
    binaryMessages: 1,
    controlAckObserved: true,
    audioMetadataObserved: true,
    transcriptDeltaObserved: true,
    binaryEchoObserved: true,
    latencyMs: 40,
  },
};

describe("API Python backend runtime smoke report", () => {
  it("passes only when health and websocket frame evidence are observed", () => {
    const report = buildApiPythonBackendRuntimeSmokeReport(baseInput);

    expect(report.status).toBe("passed");
    expect(report.verdict).toMatchObject({
      passed: true,
      readyForLiveDialog: false,
      blockers: [],
    });
    expect(report.capabilities).toMatchObject({
      ok: true,
      modes: [
        { id: "transport-echo", status: "ready" },
        { id: "moshi-mlx", status: "proposal_required" },
        { id: "qwen3-tts-mlx", status: "proposal_required" },
      ],
    });
    expect(report.policy).toMatchObject({
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsUsed: false,
    });
    expect(report.verdict.caveats.join("\n")).toContain("FastAPI health and WebSocket frame handling only");
  });

  it("keeps missing FastAPI dependencies as explicit blockers before starting the server", () => {
    const report = buildApiPythonBackendRuntimeSmokeReport({
      ...baseInput,
      dependencies: {
        fastapi: "missing",
        uvicorn: "missing",
        websockets: "available",
      },
      serverAttempted: false,
      health: {
        attempted: false,
        ok: false,
        statusCode: null,
        latencyMs: null,
        body: null,
      },
      capabilities: {
        attempted: false,
        ok: false,
        statusCode: null,
        latencyMs: null,
        modes: [],
        body: null,
      },
      websocket: {
        attempted: false,
        connected: false,
        jsonMessages: 0,
        binaryMessages: 0,
        controlAckObserved: false,
        audioMetadataObserved: false,
        transcriptDeltaObserved: false,
        binaryEchoObserved: false,
        latencyMs: null,
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.python.missingPackages).toEqual(["fastapi", "uvicorn"]);
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "python_dependency_missing:fastapi",
      "python_dependency_missing:uvicorn",
      "server_not_started",
      "health_check_failed",
      "capabilities_check_failed",
      "websocket_not_connected",
    ]));
  });
});
