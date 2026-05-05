import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const LOCAL_RUNTIME_COMMAND_TIMEOUT_MS = 60_000;

type CliOptions = {
  outputPath?: string;
};

export type CommandProbe = {
  command: string;
  status: "available" | "missing";
  path?: string;
  version?: string;
  error?: string;
};

type CommandSpec = {
  command: string;
  args: readonly string[];
  firstLineOnly?: boolean;
  versionLinePattern?: RegExp;
};

export type PythonModuleProbe = {
  module: string;
  status: "available" | "missing" | "not_checked";
};

export type GateStatus = {
  status: "ready" | "not_configured" | "blocked";
  blockers: string[];
};

export type LocalRuntimeProbeReport = {
  generatedAt: string;
  system: Record<string, unknown>;
  commands: CommandProbe[];
  pythonModules: PythonModuleProbe[];
  adb: {
    devices: string;
    reverseList?: string;
    power?: {
      wakefulness: string | null;
    };
  };
  gates: {
    questUsb: GateStatus;
    questForegroundPreflight: GateStatus;
    apiBunRuntime: GateStatus;
    localModel: GateStatus;
    localVoice: GateStatus;
    assetPipeline: GateStatus;
  };
};

const commandSpecs: CommandSpec[] = [
  { command: "node", args: ["--version"] },
  { command: "pnpm", args: ["--version"] },
  { command: "npm", args: ["--version"] },
  { command: "bun", args: ["--version"] },
  { command: "brew", args: ["--version"], firstLineOnly: true },
  { command: "portless", args: ["--version"] },
  { command: "python3", args: ["--version"] },
  { command: "ffmpeg", args: ["-version"], firstLineOnly: true },
  { command: "adb", args: ["version"], firstLineOnly: true },
  { command: "ollama", args: ["--version"] },
  { command: "llama-cli", args: ["--version"], versionLinePattern: /^version:/ },
  { command: "llama-server", args: ["--version"], versionLinePattern: /^version:/ },
  { command: "mlx_lm", args: ["--help"], firstLineOnly: true },
  { command: "vibevoice", args: ["--help"], firstLineOnly: true },
  { command: "gltf-transform", args: ["--version"] },
  { command: "gltf-pipeline", args: ["--version"] },
  { command: "blender", args: ["--version"], firstLineOnly: true },
] as const;

export const localRuntimeCommandNames = commandSpecs.map((spec) => spec.command);

const pythonModules = ["torch", "transformers", "numpy", "scipy", "mlx", "soundfile"] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const commands = await Promise.all(commandSpecs.map((spec) => probeCommand(spec)));
  const modules = await probePythonModules(commands);
  const adbDevices = await runOptional("adb", ["devices", "-l"]);
  const adbReverse = await runOptional("adb", ["reverse", "--list"]);
  const adbPower = await runOptional("adb", ["shell", "dumpsys", "power"]);
  const report = buildLocalRuntimeProbeReport({
    system: await probeSystem(),
    commands,
    pythonModules: modules,
    adbDevices,
    adbReverse,
    adbPower,
  });

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
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

async function probeSystem(): Promise<Record<string, unknown>> {
  const [macosVersion, macosBuild, kernel, arch, chip, physicalCores, logicalCores, memoryBytes, disk] = await Promise.all([
    runOptional("sw_vers", ["-productVersion"]),
    runOptional("sw_vers", ["-buildVersion"]),
    runOptional("uname", ["-r"]),
    runOptional("uname", ["-m"]),
    runOptional("sysctl", ["-n", "machdep.cpu.brand_string"]),
    runOptional("sysctl", ["-n", "hw.physicalcpu"]),
    runOptional("sysctl", ["-n", "hw.logicalcpu"]),
    runOptional("sysctl", ["-n", "hw.memsize"]),
    runOptional("df", ["-kP", "/"]),
  ]);

  return {
    macosVersion,
    macosBuild,
    kernel,
    arch,
    chip,
    physicalCores: parseInteger(physicalCores),
    logicalCores: parseInteger(logicalCores),
    memoryBytes: parseInteger(memoryBytes),
    rootDisk: parseDisk(disk),
  };
}

async function probeCommand(spec: CommandSpec): Promise<CommandProbe> {
  const commandPath = await resolveProbeCommandPath(spec.command);
  if (!commandPath) {
    return { command: spec.command, status: "missing" };
  }

  const version = await runOptional(commandPath, [...spec.args]);
  return {
    command: spec.command,
    status: "available",
    path: commandPath,
    version: selectCommandVersionOutput(version, spec.versionLinePattern, spec.firstLineOnly),
  };
}

async function resolveProbeCommandPath(command: string): Promise<string> {
  const commandPath = await runOptional("/usr/bin/which", [command]);
  if (commandPath) {
    return commandPath;
  }

  const userLocalPath = buildUserLocalCommandCandidatePath(homedir(), command);
  return (await isExecutableFile(userLocalPath)) ? userLocalPath : "";
}

export function buildUserLocalCommandCandidatePath(homeDirectory: string, command: string): string {
  return path.join(homeDirectory, ".local/bin", command);
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function selectCommandVersionOutput(output: string, versionLinePattern?: RegExp, firstLineOnly = false): string {
  if (versionLinePattern) {
    const versionLine = output.split("\n").find((line) => versionLinePattern.test(line.trim()));
    if (versionLine) {
      return versionLine.trim();
    }
  }

  return firstLineOnly ? output.split("\n")[0]?.trim() ?? "" : output;
}

async function probePythonModules(commands: CommandProbe[]): Promise<PythonModuleProbe[]> {
  if (!commands.some((command) => command.command === "python3" && command.status === "available")) {
    return pythonModules.map((module) => ({ module, status: "not_checked" }));
  }

  const script = [
    "import importlib.util, json",
    `mods = ${JSON.stringify([...pythonModules])}`,
    "print(json.dumps({name: importlib.util.find_spec(name) is not None for name in mods}))",
  ].join("\n");
  const result = await runOptional("python3", ["-c", script]);
  if (!result) {
    return pythonModules.map((module) => ({ module, status: "not_checked" }));
  }
  const parsed = JSON.parse(result) as Record<string, boolean>;
  return pythonModules.map((module) => ({ module, status: parsed[module] ? "available" : "missing" }));
}

export function buildLocalRuntimeProbeReport(input: {
  generatedAt?: string;
  system: Record<string, unknown>;
  commands: CommandProbe[];
  pythonModules: PythonModuleProbe[];
  adbDevices: string;
  adbReverse: string;
  adbPower: string;
}): LocalRuntimeProbeReport {
  const hasCommand = (command: string) => input.commands.some((probe) => probe.command === command && probe.status === "available");
  const hasModule = (module: string) => input.pythonModules.some((probe) => probe.module === module && probe.status === "available");
  const bunRuntimeAvailable = hasCommand("bun");
  const adbHasQuestDevice = /\sdevice\s/.test(input.adbDevices) && /Quest_3|eureka/.test(input.adbDevices);
  const questWakefulness = parseQuestWakefulness(input.adbPower);
  const localModelRuntimeAvailable = hasCommand("ollama") || hasCommand("llama-cli") || hasCommand("llama-server") || hasCommand("mlx_lm") || hasModule("mlx");
  const localVoiceRuntimeAvailable = hasCommand("vibevoice");
  const hasGltfOptimizationCli = hasCommand("gltf-transform") || hasCommand("gltf-pipeline");
  const hasBlender = hasCommand("blender");
  const assetPipelineBlockers = [
    hasGltfOptimizationCli ? undefined : "missing_permissive_gltf_optimization_cli",
    hasBlender ? undefined : "missing_blender",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    system: input.system,
    commands: input.commands,
    pythonModules: input.pythonModules,
    adb: {
      devices: input.adbDevices,
      reverseList: input.adbReverse || undefined,
      power: input.adbPower ? { wakefulness: questWakefulness } : undefined,
    },
    gates: {
      questUsb: adbHasQuestDevice ? readyGate() : blockedGate("quest_3_not_authorized_or_not_connected"),
      questForegroundPreflight: questForegroundPreflightGate(adbHasQuestDevice, questWakefulness),
      apiBunRuntime: bunRuntimeAvailable
        ? blockedGate("api_bun_websocket_runtime_not_benchmarked")
        : notConfiguredGate("bun_runtime_not_installed_on_this_machine"),
      localModel: localModelRuntimeAvailable ? blockedGate("model_weights_not_selected_or_benchmarked") : notConfiguredGate("no_ollama_llama_cpp_or_mlx_runtime_detected"),
      localVoice: localVoiceRuntimeAvailable ? blockedGate("voice_model_not_selected_or_benchmarked") : notConfiguredGate("no_vibevoice_runtime_detected"),
      assetPipeline: assetPipelineBlockers.length === 0 ? readyGate() : notConfiguredGate(...assetPipelineBlockers),
    },
  };
}

function questForegroundPreflightGate(adbHasQuestDevice: boolean, wakefulness: string | null): GateStatus {
  if (!adbHasQuestDevice) {
    return blockedGate("quest_3_not_authorized_or_not_connected");
  }
  if (!wakefulness) {
    return blockedGate("quest_power_state_not_available");
  }
  return wakefulness === "Awake" ? readyGate() : blockedGate("quest_3_asleep_or_not_foreground_ready");
}

function readyGate(): GateStatus {
  return { status: "ready", blockers: [] };
}

function notConfiguredGate(...blockers: string[]): GateStatus {
  return { status: "not_configured", blockers };
}

function blockedGate(blocker: string): GateStatus {
  return { status: "blocked", blockers: [blocker] };
}

async function runOptional(command: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: LOCAL_RUNTIME_COMMAND_TIMEOUT_MS,
    });
    return `${stdout}${stderr}`.trim();
  } catch {
    return "";
  }
}

function parseInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDisk(value: string): Record<string, unknown> | null {
  const lines = value.split("\n").filter(Boolean);
  const row = lines.at(-1);
  if (!row) {
    return null;
  }
  const [filesystem, oneKBlocks, used, available, capacity, mountedOn] = row.trim().split(/\s+/);
  return {
    filesystem,
    oneKBlocks: parseInteger(oneKBlocks ?? ""),
    used: parseInteger(used ?? ""),
    available: parseInteger(available ?? ""),
    capacity,
    mountedOn,
  };
}

function parseQuestWakefulness(value: string): string | null {
  return value.match(/mWakefulness=([A-Za-z_]+)/)?.[1] ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
