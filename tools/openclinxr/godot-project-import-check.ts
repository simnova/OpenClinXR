import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type CliOptions = {
  projectPath: string;
  godotBinary?: string;
  outputPath: string;
};

export type GodotProjectImportInput = {
  generatedAt?: string;
  projectPath: string;
  files: {
    project: string;
    scene: string;
    mainScript: string;
    voiceClientScript: string;
  };
  godotBinary?: string;
};

export type GodotProjectImportCheck = {
  generatedAt: string;
  projectPath: string;
  sourceContract: {
    passed: boolean;
    blockers: string[];
    satisfiedConditions: string[];
  };
  godotImport: {
    attempted: boolean;
    status: "passed" | "failed" | "skipped_no_godot_binary";
    executable: string | null;
    exitCode: number | null;
    stdout: string[];
    stderr: string[];
    blockers: string[];
  };
  verdict: {
    readyForSourceContractClaim: boolean;
    readyForGodotImportClaim: boolean;
    readyForQuestRuntimeClaim: false;
    readyForVoiceRuntimeClaim: false;
    blockers: string[];
  };
  notEvidenceFor: string[];
  nextSteps: string[];
};

const notEvidenceFor = [
  "physical_quest_voice_runtime",
  "quest_microphone_capture",
  "native_opus_encode_decode",
  "headset_audio_playback",
  "low_latency_voice_readiness",
  "clinical_voice_dialog_quality",
  "production_runtime_readiness",
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const input = await readProjectInput(options);
  const check = buildGodotProjectImportCheck(input);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(check, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${options.outputPath}; source=${check.sourceContract.passed} godotImport=${check.godotImport.status}`,
  );
  if (!check.verdict.readyForSourceContractClaim) {
    process.exitCode = 1;
  }
}

export function buildGodotProjectImportCheck(input: GodotProjectImportInput): GodotProjectImportCheck {
  const sourceBlockers = sourceContractBlockers(input);
  const godotImport = runGodotImport(input);
  const sourcePassed = sourceBlockers.length === 0;
  const godotImportPassed = godotImport.status === "passed";
  const verdictBlockers = unique([
    ...(sourcePassed ? [] : sourceBlockers.map((blocker) => `source_contract:${blocker}`)),
    ...(godotImportPassed
      ? []
      : godotImport.blockers.map((blocker) => `godot_import:${stripGodotPrefix(blocker)}`)),
    "quest_runtime:not_executed",
    "voice_runtime:not_executed",
  ]);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    projectPath: input.projectPath,
    sourceContract: {
      passed: sourcePassed,
      blockers: sourceBlockers,
      satisfiedConditions: sourceSatisfiedConditions(input),
    },
    godotImport,
    verdict: {
      readyForSourceContractClaim: sourcePassed,
      readyForGodotImportClaim: sourcePassed && godotImportPassed,
      readyForQuestRuntimeClaim: false,
      readyForVoiceRuntimeClaim: false,
      blockers: verdictBlockers,
    },
    notEvidenceFor: [...notEvidenceFor],
    nextSteps: nextSteps(sourceBlockers, godotImport),
  };
}

function sourceContractBlockers(input: GodotProjectImportInput): string[] {
  const { project, scene, mainScript, voiceClientScript } = input.files;
  return unique([
    project.includes("config_version=5") ? undefined : "project_config_version_not_godot_4",
    project.includes('run/main_scene="res://scenes/realtime_voice_spike.tscn"')
      ? undefined
      : "main_scene_not_realtime_voice_spike",
    project.includes('renderer/rendering_method="mobile"') ? undefined : "mobile_renderer_not_configured",
    scene.includes('type="Script" path="res://src/Main.gd"') ? undefined : "main_script_not_bound_in_scene",
    scene.includes('type="Script" path="res://src/RealtimeVoiceClient.gd"')
      ? undefined
      : "voice_client_script_not_bound_in_scene",
    mainScript.includes("client.connect_gateway(endpoint.text)") ? undefined : "main_does_not_connect_endpoint",
    mainScript.includes("client.send_transport_probe()") ? undefined : "main_transport_probe_button_not_wired",
    voiceClientScript.includes("WebSocketPeer.new()") ? undefined : "websocket_peer_missing",
    voiceClientScript.includes("connect_to_url") ? undefined : "connect_to_url_missing",
    voiceClientScript.includes('const VOICE_GATEWAY_URL := "ws://127.0.0.1:4017/voice/realtime/ws"')
      ? undefined
      : "default_gateway_url_not_local_websocket",
    voiceClientScript.includes('const CODEC := "opus"') ? undefined : "codec_constant_not_opus",
    voiceClientScript.includes("const SAMPLE_RATE_HZ := 48000") ? undefined : "sample_rate_not_48000_hz",
    voiceClientScript.includes('const FRAME_VOICE_START := "voice.start"') ? undefined : "voice_start_frame_missing",
    voiceClientScript.includes('const FRAME_AUDIO_METADATA := "voice.audio_metadata"')
      ? undefined
      : "voice_audio_metadata_frame_missing",
    voiceClientScript.includes('const FRAME_VOICE_STOP := "voice.stop"') ? undefined : "voice_stop_frame_missing",
    voiceClientScript.includes("socket.send_text(JSON.stringify(payload))") ? undefined : "json_control_send_missing",
    voiceClientScript.includes("socket.put_packet(packet)") ? undefined : "binary_packet_send_missing",
    voiceClientScript.includes("socket.was_string_packet()") ? undefined : "json_binary_receive_split_missing",
    ...forbiddenProtocolBlockers([project, scene, mainScript, voiceClientScript].join("\n")),
  ]);
}

function sourceSatisfiedConditions(input: GodotProjectImportInput): string[] {
  const { project, voiceClientScript } = input.files;
  return unique([
    project.includes("config_version=5") ? "godot_4_project_source_observed" : undefined,
    project.includes('renderer/rendering_method="mobile"') ? "mobile_renderer_configured" : undefined,
    voiceClientScript.includes("WebSocketPeer.new()") ? "websocket_peer_source_observed" : undefined,
    voiceClientScript.includes('const CODEC := "opus"') ? "opus_codec_lane_declared" : undefined,
    voiceClientScript.includes("const SAMPLE_RATE_HZ := 48000") ? "forty_eight_khz_sample_rate_declared" : undefined,
    voiceClientScript.includes("socket.put_packet(packet)") ? "binary_packet_send_source_observed" : undefined,
    voiceClientScript.includes("socket.was_string_packet()") ? "json_binary_receive_split_source_observed" : undefined,
  ]);
}

function forbiddenProtocolBlockers(source: string): string[] {
  const forbiddenPatterns: Array<[string, RegExp]> = [
    ["WebTransport", /WebTransport/],
    ["QUIC", /QUIC/],
    ["web3", /web3/i],
    ["wallet", /wallet/i],
    ["MultiplayerPeer", /MultiplayerPeer/],
    ["ENet", /ENet/],
  ];
  return forbiddenPatterns.flatMap(([label, pattern]) => (
    pattern.test(source) ? [`forbidden_protocol_reference:${label}`] : []
  ));
}

function runGodotImport(input: GodotProjectImportInput): GodotProjectImportCheck["godotImport"] {
  if (!input.godotBinary) {
    return {
      attempted: false,
      status: "skipped_no_godot_binary",
      executable: null,
      exitCode: null,
      stdout: [],
      stderr: [],
      blockers: ["godot_import_not_executed"],
    };
  }

  const result = spawnSync(input.godotBinary, [
    "--headless",
    "--path",
    input.projectPath,
    "--quit-after",
    "1",
  ], {
    encoding: "utf8",
    timeout: 20_000,
  });
  const stderr = lines(result.stderr);
  const stdout = lines(result.stdout);
  const failed = typeof result.status !== "number" || result.status !== 0;
  return {
    attempted: true,
    status: failed ? "failed" : "passed",
    executable: input.godotBinary,
    exitCode: typeof result.status === "number" ? result.status : null,
    stdout,
    stderr,
    blockers: failed ? unique([
      "godot_import_failed",
      result.error ? `godot_process_error:${result.error.message}` : undefined,
      result.signal ? `godot_process_signal:${result.signal}` : undefined,
      ...stderr.filter((line) => /error|failed/i.test(line)).map((line) => `godot_stderr:${line}`),
    ]) : [],
  };
}

function stripGodotPrefix(blocker: string): string {
  return blocker === "godot_import_not_executed" ? "not_executed" : blocker;
}

function nextSteps(
  sourceBlockers: string[],
  godotImport: GodotProjectImportCheck["godotImport"],
): string[] {
  return unique([
    sourceBlockers.length > 0 ? "Restore the Godot source-level WebSocket JSON/binary transport contract." : undefined,
    godotImport.status === "skipped_no_godot_binary"
      ? "Provide a local Godot 4 executable with --godot-binary to run the headless import check."
      : undefined,
    godotImport.status === "failed" ? "Fix Godot import errors before attempting Quest runtime evidence." : undefined,
    "Run the sidecar on the physical Quest 3 before claiming microphone, playback, Opus, latency, or production voice readiness.",
  ]);
}

async function readProjectInput(options: CliOptions): Promise<GodotProjectImportInput> {
  const projectPath = options.projectPath.replace(/\/$/, "");
  await assertReadable(path.join(projectPath, "project.godot"));
  return {
    projectPath,
    godotBinary: options.godotBinary,
    files: {
      project: await readFile(path.join(projectPath, "project.godot"), "utf8"),
      scene: await readFile(path.join(projectPath, "scenes/realtime_voice_spike.tscn"), "utf8"),
      mainScript: await readFile(path.join(projectPath, "src/Main.gd"), "utf8"),
      voiceClientScript: await readFile(path.join(projectPath, "src/RealtimeVoiceClient.gd"), "utf8"),
    },
  };
}

async function assertReadable(file: string): Promise<void> {
  await access(file);
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    projectPath: "apps/ui-quest-voice-godot",
    outputPath: ".agent-factory/godot-project-import-check.json",
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--project") {
      options.projectPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--godot-binary") {
      options.godotBinary = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function lines(value: string | null | undefined): string[] {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
