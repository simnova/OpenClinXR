import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildApiBunPythonProxyRuntimeSmokeReport,
  type ApiBunPythonProxyRuntimeSmokeObservation,
} from "./api-bun-python-proxy-runtime-smoke.js";

const baseObservation = {
  generatedAt: "2026-05-05T18:20:00.000Z",
  python: {
    executable: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python",
    version: "Python 3.11.4",
  },
  bun: {
    executable: "/Users/patrick/.bun/bin/bun",
    version: "1.3.13",
    revision: "1.3.13+bf2e2cecf",
  },
  pythonBackend: {
    attempted: true,
    port: 8766,
    healthOk: true,
    stdout: [],
    stderr: [],
  },
  bunGateway: {
    attempted: true,
    port: 4326,
    healthOk: true,
    backendUrlConfigured: true,
    stdout: ["OpenClinXR Bun/Hono API listening on http://localhost:4326/"],
    stderr: [],
  },
  bunGatewayPosture: {
    attempted: true,
    fetched: true,
    httpStatus: 200,
    pythonFastApiStatus: "source_present_not_executed",
    pythonBackendTransportProxyStatus: "configured_not_verified",
    pythonBackendTransportProxyConfigured: true,
    readyForLiveDialog: false,
    transportProxyBlockers: [
      "python_backend_proxy_reachability_not_claimed_by_posture_endpoint",
      "real_model_inference_not_observed",
    ],
    pythonBackendBlockers: [
      "fastapi_uvicorn_websockets_not_installed",
      "mlx_moshi_or_qwen3_tts_not_installed",
    ],
  },
  websocket: {
    attempted: true,
    connected: true,
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
} satisfies ApiBunPythonProxyRuntimeSmokeObservation;

describe("API Bun to Python proxy runtime smoke", () => {
  it("keeps the package script opt-in and outside default verification", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["local:voice:bun-python-proxy-smoke"]).toBe(
      "tsx tools/openclinxr/api-bun-python-proxy-runtime-smoke.ts",
    );
    expect(packageJson.scripts.verify).not.toContain("local:voice:bun-python-proxy-smoke");
  });

  it("passes when Bun forwards JSON and binary frames to a FastAPI backend", () => {
    const report = buildApiBunPythonProxyRuntimeSmokeReport(baseObservation);

    expect(report.status).toBe("passed");
    expect(report.policy).toEqual({
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsUsed: false,
      http3Enabled: false,
      webTransportUsed: false,
      quicUsed: false,
      web3Used: false,
      questHardwareClaimed: false,
      productionUseAllowed: false,
      lowLatencyClaimed: false,
    });
    expect(report.websocket.eventTypesObserved).toEqual(baseObservation.websocket.eventTypesObserved);
    expect(report.bunGatewayPosture).toMatchObject({
      fetched: true,
      pythonBackendTransportProxyConfigured: true,
      pythonBackendTransportProxyStatus: "configured_not_verified",
      readyForLiveDialog: false,
    });
    expect(report.runtimeEvidenceBlockers).toEqual([]);
    expect(report.verdict).toMatchObject({
      smokePassed: true,
      readyForLiveDialog: false,
    });
    expect(report.verdict.blockers).toContain("real_model_inference_not_observed");
  });

  it("blocks when backend protocol, binary echo, or latency fields are missing", () => {
    const report = buildApiBunPythonProxyRuntimeSmokeReport({
      ...baseObservation,
      websocket: {
        ...baseObservation.websocket,
        backendProtocolObserved: false,
        latencyFieldsObserved: false,
        binaryEchoObserved: false,
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.runtimeEvidenceBlockers).toEqual(expect.arrayContaining([
      "backend_protocol_not_observed",
      "latency_fields_not_observed",
      "binary_echo_not_observed",
    ]));
    expect(report.verdict.smokePassed).toBe(false);
  });
});
