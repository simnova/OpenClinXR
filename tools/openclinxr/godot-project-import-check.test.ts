import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGodotProjectImportCheck,
  type GodotProjectImportInput,
} from "./godot-project-import-check.js";

const appPath = "apps/ui-quest-voice-godot";

function sourceOnlyInput(): GodotProjectImportInput {
  return {
    generatedAt: "2026-05-06T10:00:00.000Z",
    projectPath: appPath,
    files: {
      project: readFileSync(`${appPath}/project.godot`, "utf8"),
      scene: readFileSync(`${appPath}/scenes/realtime_voice_spike.tscn`, "utf8"),
      mainScript: readFileSync(`${appPath}/src/Main.gd`, "utf8"),
      voiceClientScript: readFileSync(`${appPath}/src/RealtimeVoiceClient.gd`, "utf8"),
    },
  };
}

describe("Godot project import check", () => {
  it("accepts the Quest voice sidecar source contract without claiming runtime evidence", () => {
    const check = buildGodotProjectImportCheck(sourceOnlyInput());

    expect(check.sourceContract.passed).toBe(true);
    expect(check.sourceContract.blockers).toEqual([]);
    expect(check.godotImport).toMatchObject({
      attempted: false,
      status: "skipped_no_godot_binary",
      blockers: ["godot_import_not_executed"],
    });
    expect(check.verdict).toMatchObject({
      readyForSourceContractClaim: true,
      readyForGodotImportClaim: false,
      readyForQuestRuntimeClaim: false,
      readyForVoiceRuntimeClaim: false,
    });
    expect(check.verdict.blockers).toEqual([
      "godot_import:not_executed",
      "quest_runtime:not_executed",
      "voice_runtime:not_executed",
    ]);
    expect(check.notEvidenceFor).toEqual(expect.arrayContaining([
      "physical_quest_voice_runtime",
      "quest_microphone_capture",
      "native_opus_encode_decode",
      "headset_audio_playback",
      "low_latency_voice_readiness",
      "clinical_voice_dialog_quality",
      "production_runtime_readiness",
    ]));
  });

  it("reports precise source blockers when the sidecar drifts from the approved transport contract", () => {
    const input = sourceOnlyInput();
    input.files.voiceClientScript = input.files.voiceClientScript
      .replace("WebSocketPeer.new()", "ENetMultiplayerPeer.new()")
      .replace('const CODEC := "opus"', 'const CODEC := "pcm"');

    const check = buildGodotProjectImportCheck(input);

    expect(check.sourceContract.passed).toBe(false);
    expect(check.sourceContract.blockers).toEqual(expect.arrayContaining([
      "websocket_peer_missing",
      "forbidden_protocol_reference:ENet",
      "codec_constant_not_opus",
    ]));
    expect(check.verdict.readyForSourceContractClaim).toBe(false);
  });

  it("keeps the root script available for local source/import evidence generation", () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(rootPackage.scripts?.["godot:project:import-check"]).toBe(
      "tsx tools/openclinxr/godot-project-import-check.ts",
    );
  });
});
