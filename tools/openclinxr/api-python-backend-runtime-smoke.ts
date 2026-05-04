import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { writeJson } from "../agent-factory/lib.js";

export type PythonDependencyStatus = "available" | "missing";

export type ApiPythonBackendRuntimeSmokeReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadsUsed: false;
    committedGeneratedAudio: false;
    productionUseAllowed: false;
  };
  python: {
    executable: string;
    version: string | null;
    dependencies: Record<string, PythonDependencyStatus>;
    missingPackages: string[];
  };
  server: {
    attempted: boolean;
    command: string[];
    port: number;
    stdout: string[];
    stderr: string[];
  };
  health: {
    attempted: boolean;
    ok: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    body: unknown;
  };
  websocket: {
    attempted: boolean;
    connected: boolean;
    jsonMessages: number;
    binaryMessages: number;
    controlAckObserved: boolean;
    audioMetadataObserved: boolean;
    transcriptDeltaObserved: boolean;
    binaryEchoObserved: boolean;
    latencyMs: number | null;
  };
  verdict: {
    passed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

type CliOptions = {
  outputPath?: string;
  pythonExecutable: string;
  port: number;
  timeoutMs: number;
};

type RuntimeSmokeObservation = {
  generatedAt?: string;
  pythonExecutable: string;
  pythonVersion: string | null;
  dependencies: Record<string, PythonDependencyStatus>;
  serverCommand: string[];
  serverAttempted: boolean;
  port: number;
  stdout: string[];
  stderr: string[];
  health: ApiPythonBackendRuntimeSmokeReport["health"];
  websocket: ApiPythonBackendRuntimeSmokeReport["websocket"];
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runApiPythonBackendRuntimeSmoke(options);

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    pythonExecutable: "python3",
    port: 8765,
    timeoutMs: 8_000,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--python") {
      options.pythonExecutable = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

export async function runApiPythonBackendRuntimeSmoke(options: CliOptions): Promise<ApiPythonBackendRuntimeSmokeReport> {
  const pythonVersion = await readPythonVersion(options.pythonExecutable);
  const dependencies = await probePythonDependencies(options.pythonExecutable, ["fastapi", "uvicorn", "websockets"]);
  const serverCommand = [
    options.pythonExecutable,
    "-m",
    "uvicorn",
    "api_python_backend.main:app",
    "--app-dir",
    "apps/api-python-backend/src",
    "--host",
    "127.0.0.1",
    "--port",
    String(options.port),
  ];

  if (Object.values(dependencies).some((status) => status === "missing")) {
    return buildApiPythonBackendRuntimeSmokeReport({
      pythonExecutable: options.pythonExecutable,
      pythonVersion,
      dependencies,
      serverCommand,
      serverAttempted: false,
      port: options.port,
      stdout: [],
      stderr: [],
      health: emptyHealth(false),
      websocket: emptyWebSocket(false),
    });
  }

  const server = spawn(options.pythonExecutable, serverCommand.slice(1), {
    cwd: process.cwd(),
    env: process.env,
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  server.stdout.on("data", (chunk) => pushLines(stdout, chunk));
  server.stderr.on("data", (chunk) => pushLines(stderr, chunk));

  try {
    const health = await waitForHealth(options.port, options.timeoutMs);
    const websocket = health.ok
      ? await runWebSocketProbe(options.port, options.timeoutMs)
      : emptyWebSocket(false);

    return buildApiPythonBackendRuntimeSmokeReport({
      pythonExecutable: options.pythonExecutable,
      pythonVersion,
      dependencies,
      serverCommand,
      serverAttempted: true,
      port: options.port,
      stdout,
      stderr,
      health,
      websocket,
    });
  } finally {
    await stopServer(server);
  }
}

export function buildApiPythonBackendRuntimeSmokeReport(
  input: RuntimeSmokeObservation,
): ApiPythonBackendRuntimeSmokeReport {
  const missingPackages = Object.entries(input.dependencies)
    .filter(([, status]) => status === "missing")
    .map(([packageName]) => packageName);
  const blockers = [
    ...missingPackages.map((packageName) => `python_dependency_missing:${packageName}`),
    ...(input.serverAttempted ? [] : ["server_not_started"]),
    ...(input.health.attempted && input.health.ok ? [] : ["health_check_failed"]),
    ...(input.websocket.attempted && input.websocket.connected ? [] : ["websocket_not_connected"]),
    ...(input.websocket.controlAckObserved ? [] : ["websocket_control_ack_missing"]),
    ...(input.websocket.audioMetadataObserved ? [] : ["websocket_audio_metadata_missing"]),
    ...(input.websocket.transcriptDeltaObserved ? [] : ["websocket_transcript_delta_missing"]),
    ...(input.websocket.binaryEchoObserved ? [] : ["websocket_binary_echo_missing"]),
  ];
  const passed = blockers.length === 0;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsUsed: false,
      committedGeneratedAudio: false,
      productionUseAllowed: false,
    },
    python: {
      executable: input.pythonExecutable,
      version: input.pythonVersion,
      dependencies: input.dependencies,
      missingPackages,
    },
    server: {
      attempted: input.serverAttempted,
      command: input.serverCommand,
      port: input.port,
      stdout: input.stdout.slice(-20),
      stderr: input.stderr.slice(-20),
    },
    health: input.health,
    websocket: input.websocket,
    verdict: {
      passed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "This smoke proves FastAPI health and WebSocket frame handling only.",
        "No Moshi, Qwen3-TTS, VibeVoice, Grok Voice, ASR, Opus codec, or Quest playback inference is exercised.",
      ],
    },
  };
}

async function readPythonVersion(pythonExecutable: string): Promise<string | null> {
  const result = await runCommand(pythonExecutable, ["--version"]);
  return result.exitCode === 0 ? [...result.stdout, ...result.stderr].join("\n").trim() : null;
}

async function probePythonDependencies(
  pythonExecutable: string,
  packageNames: string[],
): Promise<Record<string, PythonDependencyStatus>> {
  const entries = await Promise.all(packageNames.map(async (packageName) => {
    const result = await runCommand(pythonExecutable, ["-c", `import ${packageName}`]);
    return [packageName, result.exitCode === 0 ? "available" : "missing"] as const;
  }));

  return Object.fromEntries(entries);
}

async function runCommand(command: string, args: string[]): Promise<{ exitCode: number | null; stdout: string[]; stderr: string[] }> {
  const child = spawn(command, args, { cwd: process.cwd() });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => pushLines(stdout, chunk));
  child.stderr.on("data", (chunk) => pushLines(stderr, chunk));

  return new Promise((resolve) => {
    child.on("error", (error) => {
      stderr.push(error.message);
      resolve({ exitCode: 1, stdout, stderr });
    });
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function waitForHealth(
  port: number,
  timeoutMs: number,
): Promise<ApiPythonBackendRuntimeSmokeReport["health"]> {
  const startedAt = performance.now();
  let statusCode: number | null = null;
  let body: unknown = null;

  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      statusCode = response.status;
      body = await response.json();
      return {
        attempted: true,
        ok: response.ok && isHealthOk(body),
        statusCode,
        latencyMs: Math.round(performance.now() - startedAt),
        body,
      };
    } catch {
      await sleep(100);
    }
  }

  return {
    attempted: true,
    ok: false,
    statusCode,
    latencyMs: Math.round(performance.now() - startedAt),
    body,
  };
}

function isHealthOk(body: unknown): boolean {
  return typeof body === "object"
    && body !== null
    && (body as { status?: unknown }).status === "ok"
    && (body as { service?: unknown }).service === "api-python-backend";
}

async function runWebSocketProbe(
  port: number,
  timeoutMs: number,
): Promise<ApiPythonBackendRuntimeSmokeReport["websocket"]> {
  const WebSocketCtor = globalThis.WebSocket as unknown as {
    new(url: string): {
      binaryType: string;
      close: () => void;
      send: (data: string | Uint8Array) => void;
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
    };
  } | undefined;

  if (!WebSocketCtor) {
    return {
      ...emptyWebSocket(true),
      latencyMs: 0,
    };
  }

  const startedAt = performance.now();
  const websocket = new WebSocketCtor(`ws://127.0.0.1:${port}/voice/realtime/ws`);
  websocket.binaryType = "arraybuffer";

  return new Promise((resolve) => {
    const state = {
      connected: false,
      jsonMessages: 0,
      binaryMessages: 0,
      controlAckObserved: false,
      audioMetadataObserved: false,
      transcriptDeltaObserved: false,
      binaryEchoObserved: false,
    };
    const timeout = setTimeout(() => {
      websocket.close();
      resolve({
        attempted: true,
        ...state,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    }, timeoutMs);

    websocket.addEventListener("open", () => {
      state.connected = true;
      websocket.send(JSON.stringify({ type: "start", codec: "opus", sampleRateHz: 48_000 }));
      websocket.send(new Uint8Array([1, 1, 2, 3, 5, 8]));
      websocket.send(JSON.stringify({ type: "commit" }));
    });

    websocket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        state.jsonMessages += 1;
        const parsed = safeJsonParse(event.data);
        const type = typeof parsed === "object" && parsed !== null ? (parsed as { type?: unknown }).type : undefined;
        state.controlAckObserved ||= type === "control.ack";
        state.audioMetadataObserved ||= type === "audio.metadata";
        state.transcriptDeltaObserved ||= type === "transcript.delta";
      } else {
        state.binaryMessages += 1;
        state.binaryEchoObserved = true;
      }

      if (
        state.controlAckObserved
        && state.audioMetadataObserved
        && state.transcriptDeltaObserved
        && state.binaryEchoObserved
      ) {
        clearTimeout(timeout);
        websocket.close();
        resolve({
          attempted: true,
          ...state,
          latencyMs: Math.round(performance.now() - startedAt),
        });
      }
    });

    websocket.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve({
        attempted: true,
        ...state,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    });
  });
}

function emptyHealth(attempted: boolean): ApiPythonBackendRuntimeSmokeReport["health"] {
  return {
    attempted,
    ok: false,
    statusCode: null,
    latencyMs: null,
    body: null,
  };
}

function emptyWebSocket(attempted: boolean): ApiPythonBackendRuntimeSmokeReport["websocket"] {
  return {
    attempted,
    connected: false,
    jsonMessages: 0,
    binaryMessages: 0,
    controlAckObserved: false,
    audioMetadataObserved: false,
    transcriptDeltaObserved: false,
    binaryEchoObserved: false,
    latencyMs: null,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.killed || server.exitCode !== null) {
    return;
  }

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("close", () => resolve())),
    sleep(1_000),
  ]);

  if (!server.killed && server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

function pushLines(target: string[], chunk: unknown): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  target.push(...text.split(/\r?\n/).filter(Boolean));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function numberValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
