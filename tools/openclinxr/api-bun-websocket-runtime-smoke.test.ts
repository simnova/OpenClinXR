import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildApiBunWebSocketRuntimeSmokeReport,
  main,
  type ApiBunWebSocketRuntimeSmokeObservation,
  validateApiBunWebSocketRuntimeSmokeReport,
} from "./api-bun-websocket-runtime-smoke.js";

const baseObservation = {
  generatedAt: "2026-05-05T16:45:00.000Z",
  bun: {
    executable: "/Users/patrick/.bun/bin/bun",
    version: "1.3.13",
    revision: "1.3.13+bf2e2cecf",
  },
  server: {
    attempted: true,
    command: ["/Users/patrick/.bun/bin/bun", "src/bun-server.ts"],
    port: 4322,
    stdout: ["OpenClinXR Bun/Hono API listening on http://localhost:4322"],
    stderr: [],
  },
  health: {
    attempted: true,
    ok: true,
    statusCode: 200,
    latencyMs: 38,
    body: { ok: true, service: "openclinxr-api" },
  },
  h3: {
    enabled: false,
    h3TrueEnabled: false,
    optionPresentInServerSource: false,
    outOfScopeForThisSmoke: true,
  },
  websocket: {
    attempted: true,
    connected: true,
    reconnectObserved: true,
    openLatencyMs: 12,
    firstReadyLatencyMs: 14,
    controlAckLatencyMs: 18,
    firstBinaryEchoLatencyMs: 21,
    jsonMessages: 7,
    binaryMessages: 3,
    eventTypesObserved: ["gateway.ready", "control.ack", "transcript.metadata", "audio.metadata", "transcript.delta"],
    controlFrameTypesSent: ["voice.start"],
    binaryFramesSent: 9,
    binaryBytesSent: 2054,
    closeCode: 1000,
    reconnectCloseCode: 1000,
    controlAckObserved: true,
    audioMetadataObserved: true,
    transcriptDeltaObserved: true,
    binaryEchoObserved: true,
    serverErrors: [],
    protocolContract: {
      gatewayReadyLocalEchoObserved: true,
      gatewayReadyLiveDialogDisabledObserved: true,
      canonicalVoiceStartAckObserved: true,
      sanitizedControlPayloadObserved: true,
      localClientObservationOnly: true,
    },
    protocolBoundary: {
      malformedJsonFramesSent: 1,
      malformedJsonControlRejected: true,
      unsupportedControlFrameTypesSent: ["voice.unsupported_local_smoke_probe"],
      unsupportedControlRejected: true,
      errorReasonsObserved: ["invalid_json_control_frame", "unsupported_control_type"],
      localClientObservationOnly: true,
    },
    backpressure: {
      burstFrameCount: 8,
      burstBytes: 2048,
      maxBufferedAmount: 0,
      bufferedAmountSamples: [0, 0, 0],
      droppedOrErroredMessages: 0,
      localClientObservationOnly: true,
    },
  },
} satisfies ApiBunWebSocketRuntimeSmokeObservation;

describe("API Bun WebSocket runtime smoke report", () => {
  it("keeps the package script on tsx so the smoke can resolve user-local Bun installs", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["local:voice:bun-websocket-smoke"]).toBe(
      "tsx tools/openclinxr/api-bun-websocket-runtime-smoke.ts",
    );
    expect(packageJson.scripts["local:voice:bun-websocket-smoke:validate"]).toBe(
      "tsx tools/openclinxr/api-bun-websocket-runtime-smoke.ts --validate-latest",
    );
    expect(packageJson.scripts["agent:verify"]).toContain("pnpm local:voice:bun-websocket-smoke:validate");
  });

  it("passes a local Bun websocket smoke while preserving non-Quest claim boundaries", () => {
    const report = buildApiBunWebSocketRuntimeSmokeReport(baseObservation);

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
    expect(report.runtime).toMatchObject({
      target: "apps/api bun+hono",
      websocketPath: "/voice/realtime/ws",
      h3: {
        enabled: false,
        h3TrueEnabled: false,
        optionPresentInServerSource: false,
        outOfScopeForThisSmoke: true,
      },
    });
    expect(report.traceContexts).toEqual({
      preVrTraceInteraction: {
        observed: true,
        source: "synthetic_local_websocket_control_frame",
        controlFrameTypes: ["voice.start"],
      },
      inVrTraceInteraction: {
        observed: false,
        blocker: "in_vr_trace_not_executed_by_local_bun_smoke",
      },
    });
    expect(report.runtimeEvidenceBlockers).toEqual([]);
    expect(report.websocket.protocolContract).toEqual({
      gatewayReadyLocalEchoObserved: true,
      gatewayReadyLiveDialogDisabledObserved: true,
      canonicalVoiceStartAckObserved: true,
      sanitizedControlPayloadObserved: true,
      localClientObservationOnly: true,
    });
    expect(report.websocket.protocolBoundary).toEqual({
      malformedJsonFramesSent: 1,
      malformedJsonControlRejected: true,
      unsupportedControlFrameTypesSent: ["voice.unsupported_local_smoke_probe"],
      unsupportedControlRejected: true,
      errorReasonsObserved: ["invalid_json_control_frame", "unsupported_control_type"],
      localClientObservationOnly: true,
    });
    expect(report.websocket.backpressure.localClientObservationOnly).toBe(true);
    expect(report.verdict).toEqual({
      smokePassed: true,
      readyForLiveDialog: false,
      blockers: [
        "in_vr_trace_not_executed_by_local_bun_smoke",
        "quest_browser_audio_capture_not_observed",
        "quest_playback_not_observed",
        "opus_media_path_not_verified",
        "real_model_inference_not_observed",
        "production_ingress_not_verified",
        "clinical_voice_safety_not_exercised",
        "low_latency_claim_not_supported_by_local_smoke",
      ],
      caveats: [
        "This smoke proves local Bun server WebSocket upgrade and bidirectional frame handling only.",
        "Protocol-boundary rejection checks are synthetic local client observations; they do not prove Quest, production ingress, or clinical media safety.",
        "Backpressure is measured from the local WebSocket client's bufferedAmount field when available; it is not Quest network or headset media evidence.",
        "HTTP/3, WebTransport, QUIC, Web3, cloud relays, model inference, and Quest in-VR media are out of scope for this report.",
      ],
    });
  });

  it("blocks runtime evidence when Bun health and websocket behavior are incomplete", () => {
    const report = buildApiBunWebSocketRuntimeSmokeReport({
      ...baseObservation,
      bun: { executable: null, version: null, revision: null },
      server: { ...baseObservation.server, attempted: false },
      health: {
        attempted: false,
        ok: false,
        statusCode: null,
        latencyMs: null,
        body: null,
      },
      websocket: {
        ...baseObservation.websocket,
        attempted: false,
        connected: false,
        reconnectObserved: false,
        controlAckObserved: false,
        audioMetadataObserved: false,
        transcriptDeltaObserved: false,
        binaryEchoObserved: false,
        protocolContract: {
          ...baseObservation.websocket.protocolContract,
          gatewayReadyLocalEchoObserved: false,
          gatewayReadyLiveDialogDisabledObserved: false,
          canonicalVoiceStartAckObserved: false,
          sanitizedControlPayloadObserved: false,
        },
        protocolBoundary: {
          ...baseObservation.websocket.protocolBoundary,
          malformedJsonControlRejected: false,
          unsupportedControlRejected: false,
        },
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.runtimeEvidenceBlockers).toEqual(expect.arrayContaining([
      "bun_runtime_not_available",
      "server_not_started",
      "health_check_failed",
      "websocket_not_connected",
      "websocket_reconnect_not_observed",
      "websocket_control_ack_missing",
      "websocket_audio_metadata_missing",
      "websocket_transcript_delta_missing",
      "websocket_binary_echo_missing",
      "websocket_gateway_ready_contract_missing",
      "websocket_live_dialog_disabled_posture_missing",
      "websocket_canonical_voice_start_ack_missing",
      "websocket_control_payload_sanitization_missing",
      "websocket_malformed_json_not_rejected",
      "websocket_unsupported_control_not_rejected",
    ]));
    expect(report.verdict.smokePassed).toBe(false);
    expect(report.verdict.readyForLiveDialog).toBe(false);
  });

  it("validates the latest Bun websocket smoke without expanding its claim scope", async () => {
    const report = JSON.parse(
      await readFile("docs/openclinxr/api-bun-websocket-runtime-smoke-2026-05-05.json", "utf8"),
    );

    expect(validateApiBunWebSocketRuntimeSmokeReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as {
      policy: Partial<{ productionUseAllowed: boolean }>;
      runtime: { h3: { h3TrueEnabled: boolean } };
      verdict: { readyForLiveDialog: boolean };
    };
    delete invalid.policy.productionUseAllowed;
    invalid.runtime.h3.h3TrueEnabled = true;
    invalid.verdict.readyForLiveDialog = true;

    expect(validateApiBunWebSocketRuntimeSmokeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/policy/productionUseAllowed must be false",
        "/runtime/h3/h3TrueEnabled must be false",
        "/verdict/readyForLiveDialog must be false",
        "/status must be blocked when runtime evidence blockers are present",
        "/runtimeEvidenceBlockers missing expected blocker http3_enabled_outside_approved_scope",
        "/verdict/smokePassed must be false when runtime evidence blockers are present",
      ],
    });
  });

  it("requires status and runtime evidence blockers to match websocket observations", () => {
    const report = buildApiBunWebSocketRuntimeSmokeReport({
      ...baseObservation,
      websocket: {
        ...baseObservation.websocket,
        connected: false,
        binaryEchoObserved: false,
      },
    });
    const invalid = structuredClone(report) as {
      status: string;
      runtimeEvidenceBlockers: string[];
      verdict: { smokePassed: boolean };
    };
    invalid.status = "passed";
    invalid.runtimeEvidenceBlockers = [];
    invalid.verdict.smokePassed = true;

    expect(validateApiBunWebSocketRuntimeSmokeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/status must be blocked when runtime evidence blockers are present",
        "/runtimeEvidenceBlockers missing expected blocker websocket_not_connected",
        "/runtimeEvidenceBlockers missing expected blocker websocket_binary_echo_missing",
        "/verdict/smokePassed must be false when runtime evidence blockers are present",
      ],
    });
  });

  it("validates CLI reports by explicit path and latest evidence path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-bun-websocket-validate-"));
    try {
      const report = buildApiBunWebSocketRuntimeSmokeReport(baseObservation);
      const output = path.join(dir, "report.json");
      await writeFile(output, JSON.stringify(report, null, 2));

      await expect(main(["--validate", output])).resolves.toBeUndefined();
      await expect(main(["--validate-latest"])).resolves.toBeUndefined();

      const invalid = structuredClone(report) as {
        websocket: { protocolBoundary: { localClientObservationOnly: boolean } };
      };
      invalid.websocket.protocolBoundary.localClientObservationOnly = false;
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
