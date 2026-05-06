import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

  it("blocks Main.gd from depending on Godot global class cache for the voice client type", () => {
    const input = sourceOnlyInput();
    input.files.mainScript = input.files.mainScript.replace(
      "@onready var client = $RealtimeVoiceClient",
      "@onready var client: RealtimeVoiceClient = $RealtimeVoiceClient",
    );

    const check = buildGodotProjectImportCheck(input);

    expect(check.sourceContract.blockers).toContain("main_client_type_depends_on_global_class_cache");
    expect(check.verdict.readyForSourceContractClaim).toBe(false);
  });

  it("fails the import check when Godot prints parse errors despite a zero exit code", () => {
    const fakeGodot = path.join(mkdtempSync(path.join(tmpdir(), "openclinxr-godot-")), "godot");
    writeFileSync(fakeGodot, [
      "#!/usr/bin/env bash",
      "echo 'Godot Engine v4.5.1.stable.official.f62fdbde1 - https://godotengine.org'",
      "echo 'SCRIPT ERROR: Parse Error: Could not find type \"RealtimeVoiceClient\" in the current scope.' >&2",
      "echo 'ERROR: Failed to load script \"res://src/Main.gd\" with error \"Parse error\".' >&2",
      "exit 0",
      "",
    ].join("\n"));
    chmodSync(fakeGodot, 0o755);

    const check = buildGodotProjectImportCheck({
      ...sourceOnlyInput(),
      godotBinary: fakeGodot,
    });

    expect(check.godotImport).toMatchObject({
      attempted: true,
      status: "failed",
      exitCode: 0,
    });
    expect(check.godotImport.blockers).toEqual(expect.arrayContaining([
      "godot_import_failed",
      "godot_stderr:SCRIPT ERROR: Parse Error: Could not find type \"RealtimeVoiceClient\" in the current scope.",
      "godot_stderr:ERROR: Failed to load script \"res://src/Main.gd\" with error \"Parse error\".",
    ]));
    expect(check.verdict.readyForGodotImportClaim).toBe(false);
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
