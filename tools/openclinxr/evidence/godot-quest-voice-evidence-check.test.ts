import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildGodotQuestVoiceEvidenceReport,
  type GodotQuestVoiceEvidence,
  type GodotQuestVoiceEvidenceReport,
} from "./godot-quest-voice-evidence-check.js";

const execFileAsync = promisify(execFile);

describe("Godot Quest voice evidence checker", () => {
  it("accepts physical Quest binary, audio, and latency evidence without production claims", () => {
    const report = buildGodotQuestVoiceEvidenceReport({
      generatedAt: "2026-05-05T23:20:00.000Z",
      evidence: readyEvidence(),
    });

    expect(report.result).toEqual({
      readyForBinaryTransportEvidence: true,
      readyForQuestAudioPipelineEvidence: true,
      readyForLatencyMeasurementEvidence: true,
      readyForProductionRuntime: false,
      readyForClinicalVoiceClaim: false,
      blockers: [],
      satisfiedConditions: expect.arrayContaining([
        "schema_version_godot_quest_voice_evidence_v1",
        "classification_physical_quest_developer_evidence",
        "physical_quest3_device_recorded",
        "local_websocket_gateway_recorded",
        "binary_websocket_roundtrip_observed",
        "quest_microphone_codec_playback_observed",
        "latency_measurement_recorded_without_low_latency_claim",
        "safety_boundaries_preserved",
      ]),
      nextSteps: [],
    });
    expect(report.evidence.classification?.notEvidenceFor).toEqual(expect.arrayContaining([
      "production_voice_runtime_readiness",
      "clinical_voice_dialog_quality",
      "low_latency_voice_readiness",
    ]));
  });

  it("separates binary transport from microphone, codec, playback, latency, and unsafe claim blockers", () => {
    const evidence = readyEvidence();
    const audio = evidence.audio;
    if (!audio) {
      throw new Error("Expected readyEvidence fixture to include audio");
    }
    const latency = evidence.latency;
    if (!latency) {
      throw new Error("Expected readyEvidence fixture to include latency");
    }
    const gateway = evidence.gateway;
    if (!gateway) {
      throw new Error("Expected readyEvidence fixture to include gateway");
    }
    const claims = evidence.claims;
    if (!claims) {
      throw new Error("Expected readyEvidence fixture to include claims");
    }
    audio.microphoneCaptureObserved = false;
    audio.opusEncodeDecodeObserved = false;
    audio.playbackObserved = false;
    audio.sampleRateHz = 44100;
    latency.endToEndLatencyMs = {
      firstPacket: 0,
      p50: 90,
      p95: 50,
      sampleCount: 1,
    };
    gateway.cloudApisUsed = true;
    gateway.http3Enabled = true;
    gateway.webTransportUsed = true;
    claims.readyForProductionRuntime = true;
    claims.readyForLowLatencyVoiceClaim = true;

    const report = buildGodotQuestVoiceEvidenceReport({
      generatedAt: "2026-05-05T23:20:00.000Z",
      evidence,
    });

    expect(report.result.readyForBinaryTransportEvidence).toBe(true);
    expect(report.result.readyForQuestAudioPipelineEvidence).toBe(false);
    expect(report.result.readyForLatencyMeasurementEvidence).toBe(false);
    expect(report.result.readyForProductionRuntime).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "cloud_apis_used",
      "http3_enabled_outside_current_godot_voice_evidence_scope",
      "webtransport_used_outside_current_godot_voice_evidence_scope",
      "quest_microphone_capture_not_observed",
      "opus_encode_decode_not_observed",
      "quest_playback_not_observed",
      "sample_rate_not_48000_hz",
      "latency_first_packet_missing_or_nonpositive",
      "latency_sample_count_under_10",
      "latency_p95_less_than_p50",
      "ready_for_production_runtime_must_be_false",
      "ready_for_low_latency_voice_claim_must_be_false",
    ]));
    expect(report.result.satisfiedConditions).toContain("binary_websocket_roundtrip_observed");
    expect(report.result.satisfiedConditions).not.toContain("quest_microphone_codec_playback_observed");
  });

  it("keeps the committed template blocked and scoped to future operator hardware evidence", async () => {
    const template = JSON.parse(
      await readFile("docs/openclinxr/godot-quest-voice-evidence-template.json", "utf8"),
    ) as GodotQuestVoiceEvidence;
    const report = buildGodotQuestVoiceEvidenceReport({
      generatedAt: "2026-05-05T23:20:00.000Z",
      inputFile: "docs/openclinxr/godot-quest-voice-evidence-template.json",
      evidence: template,
    });

    expect(report.result.readyForBinaryTransportEvidence).toBe(false);
    expect(report.result.readyForProductionRuntime).toBe(false);
    expect(report.result.readyForClinicalVoiceClaim).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "physical_quest3_device_not_confirmed",
      "websocket_not_connected",
      "binary_roundtrip_not_observed",
      "quest_microphone_capture_not_observed",
      "quest_playback_not_observed",
      "latency_sample_count_under_10",
    ]));
  });

  it("exposes a CLI and package script for future Godot Quest voice evidence JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["godot:quest:voice:evidence"]).toBe(
      "tsx tools/openclinxr/evidence/godot-quest-voice-evidence-check.ts",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-godot-quest-voice-"));
    const inputPath = path.join(tempDir, "godot-quest-voice.json");
    const outputPath = path.join(tempDir, "godot-quest-voice-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/evidence/godot-quest-voice-evidence-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as GodotQuestVoiceEvidenceReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForBinaryTransportEvidence).toBe(true);
    expect(report.result.readyForQuestAudioPipelineEvidence).toBe(true);
  });
});

function readyEvidence(): GodotQuestVoiceEvidence {
  return {
    schemaVersion: "openclinxr.godot-quest-voice-evidence.v1",
    generatedAt: "2026-05-05T23:10:00.000Z",
    classification: {
      lane: "godot_quest_voice_transport",
      scope: "physical_quest_developer_evidence",
      notEvidenceFor: [
        "production_voice_runtime_readiness",
        "clinical_voice_dialog_quality",
        "grok_voice_parity",
        "webxr_client_readiness",
        "low_latency_voice_readiness",
      ],
    },
    device: {
      app: "apps/arena/ui-quest-voice-godot",
      performedOnPhysicalQuest3: true,
      headsetConnectedViaUsbC: true,
      godotVersion: "4.4.1",
      buildProfile: "debug_local",
    },
    gateway: {
      endpoint: "ws://127.0.0.1:4017/voice/realtime/ws",
      serverRuntime: "bun_hono_gateway",
      cloudApisUsed: false,
      paidApisUsed: false,
      http3Enabled: false,
      webTransportUsed: false,
      quicUsed: false,
      web3Used: false,
    },
    transport: {
      webSocketConnected: true,
      jsonControlFramesObserved: ["voice.start", "voice.audio_metadata", "voice.stop", "backend.ready"],
      binaryPacketsSent: 14,
      binaryPacketsReceived: 14,
      binaryRoundTripObserved: true,
      firstBinaryRoundTripLatencyMs: 42,
      reconnects: 0,
    },
    audio: {
      microphoneCaptureObserved: true,
      opusEncodeDecodeObserved: true,
      playbackObserved: true,
      codec: "opus",
      sampleRateHz: 48000,
    },
    latency: {
      endToEndLatencyMs: {
        firstPacket: 110,
        p50: 180,
        p95: 280,
        sampleCount: 24,
      },
    },
    safety: {
      rawAudioCommitted: false,
      noCloudApis: true,
      noPaidApis: true,
    },
    claims: {
      readyForProductionRuntime: false,
      readyForClinicalVoiceUse: false,
      readyForLowLatencyVoiceClaim: false,
    },
  };
}
