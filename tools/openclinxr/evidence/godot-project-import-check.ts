import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { globFiles, readJson } from "../../agent-factory/lib.js";

type CliOptions = {
  projectPath: string;
  godotBinary?: string;
  outputPath: string;
  validatePath?: string;
  validateLatest: boolean;
};

export type GodotBinarySource = {
  sourceRecordIds: readonly string[];
  tag: string;
  releaseUrl: string;
  assetName: string;
  assetDigest: string;
  assetSha256: string;
  cacheArchivePath: string;
  license: "MIT";
};

export type GodotProjectImportInput = {
  generatedAt?: string;
  projectPath: string;
  godotBinarySource?: GodotBinarySource;
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
  godotBinarySource?: GodotBinarySource;
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const notEvidenceFor = [
  "physical_quest_voice_runtime",
  "quest_microphone_capture",
  "native_opus_encode_decode",
  "headset_audio_playback",
  "low_latency_voice_readiness",
  "clinical_voice_dialog_quality",
  "production_runtime_readiness",
] as const;

const knownGodot451MacosRelease = {
  sourceRecordIds: ["src-godot-github-release-2026"],
  tag: "4.5.1-stable",
  releaseUrl: "https://github.com/godotengine/godot/releases/tag/4.5.1-stable",
  assetName: "Godot_v4.5.1-stable_macos.universal.zip",
  assetDigest: "sha256:65c27959d02aaacfc131ec7ecb90179ba8045200cb02982bf2be96d117010b8a",
  assetSha256: "65c27959d02aaacfc131ec7ecb90179ba8045200cb02982bf2be96d117010b8a",
  license: "MIT",
} as const;

async function main(): Promise<void> {
  await runGodotProjectImportCheckCli(process.argv.slice(2));
}

export async function runGodotProjectImportCheckCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestGodotImportCheckPath();
    if (!validatePath) {
      throw new Error("Missing Godot project import check report to validate.");
    }
    const validation = validateGodotProjectImportCheckReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

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
    godotBinarySource: input.godotBinarySource,
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
    mainScript.includes("@onready var client: RealtimeVoiceClient")
      ? "main_client_type_depends_on_global_class_cache"
      : undefined,
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
  const stderrErrorBlockers = godotErrorLines(stderr).map((line) => `godot_stderr:${line}`);
  const failed = typeof result.status !== "number" || result.status !== 0 || stderrErrorBlockers.length > 0;
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
      ...stderrErrorBlockers,
    ]) : [],
  };
}

function godotErrorLines(stderr: string[]): string[] {
  return stderr.filter((line) => /\b(script error|error|failed|parse error)\b/i.test(line));
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
    godotBinarySource: options.godotBinary
      ? await knownGodotBinarySource(options.godotBinary)
      : undefined,
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
    validateLatest: false,
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
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function knownGodotBinarySource(godotBinary: string): Promise<GodotBinarySource | undefined> {
  const normalizedBinary = path.normalize(godotBinary);
  const expectedSuffix = path.join("4.5.1-stable", "Godot.app", "Contents", "MacOS", "Godot");
  if (!normalizedBinary.endsWith(expectedSuffix)) {
    return undefined;
  }

  const versionRoot = path.resolve(path.dirname(normalizedBinary), "../../..");
  const cacheArchivePath = path.join(versionRoot, knownGodot451MacosRelease.assetName);
  try {
    await access(cacheArchivePath);
  } catch {
    return undefined;
  }
  const assetSha256 = sha256(await readFile(cacheArchivePath));
  return {
    ...knownGodot451MacosRelease,
    assetDigest: `sha256:${assetSha256}`,
    assetSha256,
    cacheArchivePath,
  };
}

async function latestGodotImportCheckPath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/godot-project-import-check-*.json");
  return files.sort().at(-1);
}

export function validateGodotProjectImportCheckReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireString(value.projectPath, "/projectPath", errors);
  validateSourceContract(value.sourceContract, errors);
  validateGodotImport(value.godotImport, errors);
  validateGodotBinarySourceForReport(value, errors);
  validateVerdict(value.verdict, errors);
  requireStringArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  validateNotEvidenceFor(value.notEvidenceFor, errors);
  requireStringArray(value.nextSteps, "/nextSteps", errors);
  validateReportConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateSourceContract(value: unknown, errors: string[]): void {
  requireRecord(value, "/sourceContract", errors);
  if (!isRecord(value)) {
    return;
  }
  requireBoolean(value.passed, "/sourceContract/passed", errors);
  requireStringArray(value.blockers, "/sourceContract/blockers", errors);
  requireStringArray(value.satisfiedConditions, "/sourceContract/satisfiedConditions", errors);
}

function validateGodotImport(value: unknown, errors: string[]): void {
  requireRecord(value, "/godotImport", errors);
  if (!isRecord(value)) {
    return;
  }
  requireBoolean(value.attempted, "/godotImport/attempted", errors);
  requireOneOf(value.status, ["passed", "failed", "skipped_no_godot_binary"], "/godotImport/status", errors);
  requireNullableString(value.executable, "/godotImport/executable", errors);
  requireNullableNumber(value.exitCode, "/godotImport/exitCode", errors);
  requireStringArray(value.stdout, "/godotImport/stdout", errors);
  requireStringArray(value.stderr, "/godotImport/stderr", errors);
  requireStringArray(value.blockers, "/godotImport/blockers", errors);
}

function validateGodotBinarySourceForReport(value: Record<string, unknown>, errors: string[]): void {
  const godotImport = value.godotImport;
  if (isRecord(godotImport) && godotImport.status === "passed" && !isRecord(value.godotBinarySource)) {
    errors.push("/godotBinarySource must be present for passed import evidence");
    return;
  }
  if (value.godotBinarySource !== undefined) {
    validateGodotBinarySource(value.godotBinarySource, errors);
  }
}

function validateGodotBinarySource(value: unknown, errors: string[]): void {
  requireRecord(value, "/godotBinarySource", errors);
  if (!isRecord(value)) {
    return;
  }
  requireStringArray(value.sourceRecordIds, "/godotBinarySource/sourceRecordIds", errors);
  requireLiteral(value.tag, knownGodot451MacosRelease.tag, "/godotBinarySource/tag", errors);
  requireLiteral(value.releaseUrl, knownGodot451MacosRelease.releaseUrl, "/godotBinarySource/releaseUrl", errors);
  requireLiteral(value.assetName, knownGodot451MacosRelease.assetName, "/godotBinarySource/assetName", errors);
  requireSha256Digest(value.assetDigest, "/godotBinarySource/assetDigest", errors);
  requireSha256(value.assetSha256, "/godotBinarySource/assetSha256", errors);
  requireString(value.cacheArchivePath, "/godotBinarySource/cacheArchivePath", errors);
  requireLiteral(value.license, "MIT", "/godotBinarySource/license", errors);
  if (Array.isArray(value.sourceRecordIds) && !value.sourceRecordIds.includes("src-godot-github-release-2026")) {
    errors.push("/godotBinarySource/sourceRecordIds must include src-godot-github-release-2026");
  }
  if (typeof value.assetDigest === "string" && typeof value.assetSha256 === "string") {
    if (value.assetDigest !== `sha256:${value.assetSha256}`) {
      errors.push("/godotBinarySource/assetDigest must match /godotBinarySource/assetSha256");
    }
    if (value.assetDigest !== knownGodot451MacosRelease.assetDigest) {
      errors.push(`/godotBinarySource/assetDigest must be ${knownGodot451MacosRelease.assetDigest}`);
    }
  }
}

function validateVerdict(value: unknown, errors: string[]): void {
  requireRecord(value, "/verdict", errors);
  if (!isRecord(value)) {
    return;
  }
  requireBoolean(value.readyForSourceContractClaim, "/verdict/readyForSourceContractClaim", errors);
  requireBoolean(value.readyForGodotImportClaim, "/verdict/readyForGodotImportClaim", errors);
  requireLiteral(value.readyForQuestRuntimeClaim, false, "/verdict/readyForQuestRuntimeClaim", errors);
  requireLiteral(value.readyForVoiceRuntimeClaim, false, "/verdict/readyForVoiceRuntimeClaim", errors);
  requireStringArray(value.blockers, "/verdict/blockers", errors);
}

function validateNotEvidenceFor(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const claim of notEvidenceFor) {
    if (!value.includes(claim)) {
      errors.push(`/notEvidenceFor must include ${claim}`);
    }
  }
}

function validateReportConsistency(value: Record<string, unknown>, errors: string[]): void {
  const sourceContract = value.sourceContract;
  const godotImport = value.godotImport;
  const verdict = value.verdict;
  if (!isRecord(sourceContract) || !isRecord(godotImport) || !isRecord(verdict)) {
    return;
  }

  if (typeof sourceContract.passed === "boolean" && Array.isArray(sourceContract.blockers)) {
    const sourcePassed = sourceContract.blockers.length === 0;
    if (sourceContract.passed !== sourcePassed) {
      errors.push("/sourceContract/passed must match whether sourceContract blockers are empty");
    }
    if (verdict.readyForSourceContractClaim !== sourceContract.passed) {
      errors.push("/verdict/readyForSourceContractClaim must match /sourceContract/passed");
    }
  }

  if (typeof godotImport.status === "string" && Array.isArray(godotImport.blockers)) {
    if (godotImport.status === "passed") {
      if (godotImport.attempted !== true) {
        errors.push("/godotImport/attempted must be true when status is passed");
      }
      if (godotImport.exitCode !== 0) {
        errors.push("/godotImport/exitCode must be 0 when status is passed");
      }
      if (godotImport.blockers.length !== 0) {
        errors.push("/godotImport/blockers must be empty when status is passed");
      }
      if (Array.isArray(godotImport.stderr) && godotErrorLines(godotImport.stderr).length > 0) {
        errors.push("/godotImport/stderr must not contain Godot error lines when status is passed");
      }
    }
    if (godotImport.status === "skipped_no_godot_binary") {
      if (godotImport.attempted !== false) {
        errors.push("/godotImport/attempted must be false when status is skipped_no_godot_binary");
      }
      if (godotImport.executable !== null || godotImport.exitCode !== null) {
        errors.push("/godotImport executable and exitCode must be null when no Godot binary was used");
      }
      if (!godotImport.blockers.includes("godot_import_not_executed")) {
        errors.push("/godotImport/blockers must include godot_import_not_executed when status is skipped_no_godot_binary");
      }
    }
    if (godotImport.status === "failed" && godotImport.blockers.length === 0) {
      errors.push("/godotImport/blockers must be non-empty when status is failed");
    }
  }

  if (
    typeof sourceContract.passed === "boolean"
    && typeof verdict.readyForGodotImportClaim === "boolean"
    && typeof godotImport.status === "string"
  ) {
    const expected = sourceContract.passed && godotImport.status === "passed";
    if (verdict.readyForGodotImportClaim !== expected) {
      errors.push("/verdict/readyForGodotImportClaim must require passed source contract and passed Godot import");
    }
  }

  if (Array.isArray(verdict.blockers)) {
    if (!verdict.blockers.includes("quest_runtime:not_executed")) {
      errors.push("/verdict/blockers must include quest_runtime:not_executed");
    }
    if (!verdict.blockers.includes("voice_runtime:not_executed")) {
      errors.push("/verdict/blockers must include voice_runtime:not_executed");
    }
  }
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

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireNullableString(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    errors.push(`${pathName} must be null or non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNullableNumber(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`${pathName} must be null or finite number`);
  }
}

function requireLiteral<T extends string | boolean | number>(
  value: unknown,
  literal: T,
  pathName: string,
  errors: string[],
): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
}

function requireSha256(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    errors.push(`${pathName} must be sha256 hex string`);
  }
}

function requireSha256Digest(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    errors.push(`${pathName} must be sha256 digest string`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
