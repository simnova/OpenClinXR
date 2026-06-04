import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ApiBunPythonProxyRuntimeSmokeObservation,
  buildApiBunPythonProxyRuntimeSmokeReport,
  main,
  validateApiBunPythonProxyRuntimeSmokeReport,
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
      "tsx tools/openclinxr/evidence/api-bun-python-proxy-runtime-smoke.ts",
    );
    expect(packageJson.scripts["local:voice:bun-python-proxy-smoke:validate"]).toBe(
      "tsx tools/openclinxr/evidence/api-bun-python-proxy-runtime-smoke.ts --validate-latest",
    );
    expect(packageJson.scripts["agent:verify"]).toContain("pnpm local:voice:bun-python-proxy-smoke:validate");
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
    expect(report.postureEvidencePromotion).toMatchObject({
      eligible: true,
      promotedTransportProxyStatus: "configured_reachability_verified",
      environment: {
        backendUrlVariable: "OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL",
        evidenceFileVariable: "OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE",
      },
      blockers: [],
    });
    expect(report.postureEvidencePromotion.instructions.join("\n")).toContain("later Bun/Hono API process");
    expect(report.postureEvidencePromotion.caveats.join("\n")).toContain("configured_not_verified");
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
    expect(report.postureEvidencePromotion).toMatchObject({
      eligible: false,
      promotedTransportProxyStatus: null,
    });
    expect(report.postureEvidencePromotion.blockers).toEqual(expect.arrayContaining([
      "backend_protocol_not_observed",
      "latency_fields_not_observed",
      "binary_echo_not_observed",
    ]));
    expect(report.postureEvidencePromotion.instructions.join("\n")).toContain("Do not use this blocked report");
    expect(report.verdict.smokePassed).toBe(false);
  });

  it("requires status, runtime blockers, and promotion eligibility to match websocket observations", () => {
    const report = buildApiBunPythonProxyRuntimeSmokeReport({
      ...baseObservation,
      websocket: {
        ...baseObservation.websocket,
        backendProtocolObserved: false,
        binaryEchoObserved: false,
      },
    });
    const invalid = structuredClone(report) as {
      status: string;
      runtimeEvidenceBlockers: string[];
      postureEvidencePromotion: { eligible: boolean; blockers: string[] };
      verdict: { smokePassed: boolean };
    };
    invalid.status = "passed";
    invalid.runtimeEvidenceBlockers = [];
    invalid.postureEvidencePromotion.eligible = true;
    invalid.postureEvidencePromotion.blockers = [];
    invalid.verdict.smokePassed = true;

    expect(validateApiBunPythonProxyRuntimeSmokeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/status must be blocked when runtime evidence blockers are present",
        "/runtimeEvidenceBlockers missing expected blocker backend_protocol_not_observed",
        "/runtimeEvidenceBlockers missing expected blocker binary_echo_not_observed",
        "/postureEvidencePromotion/eligible must be false when runtime evidence blockers are present",
        "/postureEvidencePromotion/blockers missing expected blocker backend_protocol_not_observed",
        "/postureEvidencePromotion/blockers missing expected blocker binary_echo_not_observed",
        "/verdict/smokePassed must be false when runtime evidence blockers are present",
      ],
    });
  });

  it("validates CLI reports by explicit path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-bun-python-proxy-validate-"));
    try {
      const report = buildApiBunPythonProxyRuntimeSmokeReport(baseObservation);
      const output = path.join(dir, "report.json");
      await writeFile(output, JSON.stringify(report, null, 2));

      await expect(main(["--validate", output])).resolves.toBeUndefined();

      const invalid = structuredClone(report) as {
        runtime: { backendProtocol: string };
      };
      invalid.runtime.backendProtocol = "other";
      const invalidOutput = path.join(dir, "invalid-report.json");
      await writeFile(invalidOutput, JSON.stringify(invalid, null, 2));
      process.exitCode = undefined;

      await expect(main(["--validate", invalidOutput])).resolves.toBeUndefined();

      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
