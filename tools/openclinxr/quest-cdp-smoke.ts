import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import fg from "fast-glob";

const execFileAsync = promisify(execFile);

export type CliOptions = {
  mode: "run" | "validate";
  url: string;
  appPort: number;
  cdpPort: number;
  outputPath?: string;
  frameSampleCount: number;
  frameTimeoutMs: number;
  skipLaunch: boolean;
  inputPath?: string;
  inputPattern: string;
};

type CdpPage = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type PendingCdpCall = {
  resolve: (value: CdpResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type CdpResult = {
  result?: {
    value?: unknown;
  };
  exceptionDetails?: {
    text?: string;
  };
};

export type QuestSmokeReport = {
  generatedAt: string;
  url: string;
  adb: {
    version: string;
    deviceLine: string;
    reverseList: string;
  };
  browser: Record<string, unknown>;
  interaction: Record<string, unknown>;
  frameSample: Record<string, unknown>;
  verdict: {
    shellLoaded: boolean;
    interactionAdvanced: boolean;
    frameSampleComplete: boolean;
    blockers: string[];
  };
};

export type QuestSmokeEvidenceClassification =
  | "missing"
  | "foreground_ready"
  | "shell_interaction_only_hidden_page"
  | "blocked";

export type QuestSmokeEvidenceCheck = {
  generatedAt: string;
  inputFile: string | null;
  readyForForegroundQuestClaim: boolean;
  classification: QuestSmokeEvidenceClassification;
  satisfiedConditions: string[];
  blockers: string[];
};

export type QuestSmokeReportInput = {
  options: CliOptions;
  adbVersion: string;
  deviceLine: string;
  reverseList: string;
  browser: unknown;
  interaction: unknown;
  frameSample: unknown;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "validate") {
    const inputPath = options.inputPath ?? await latestQuestSmokeReportPath(options.inputPattern);
    const report = inputPath ? await readJson<QuestSmokeReport>(inputPath) : undefined;
    const check = buildQuestSmokeEvidenceCheck(inputPath, report);
    const payload = `${JSON.stringify(check, null, 2)}\n`;
    if (options.outputPath) {
      await mkdir(path.dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, payload, "utf8");
      console.log(`Wrote ${options.outputPath}; classification=${check.classification}`);
    } else {
      console.log(payload.trimEnd());
    }
    return;
  }

  const adbVersion = await adb(["version"]);
  const devices = await adb(["devices", "-l"]);
  const deviceLine = devices.split("\n").find((line) => /\sdevice\s/.test(line));
  if (!deviceLine) {
    throw new Error(`No authorized Quest device found through adb.\n${devices}`);
  }

  await adb(["reverse", `tcp:${options.appPort}`, `tcp:${options.appPort}`]);
  await adb(["forward", `tcp:${options.cdpPort}`, "localabstract:chrome_devtools_remote"]);
  if (!options.skipLaunch) {
    await adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", options.url, "com.oculus.browser"]);
    await delay(750);
  }

  const reverseList = await adb(["reverse", "--list"]);
  const page = await waitForQuestPage(options);
  const client = await CdpClient.connect(page.webSocketDebuggerUrl);
  try {
    await client.reload();
    await delay(750);
    const browser = await client.evaluate(browserSnapshotExpression());
    const interaction = await client.evaluate(interactionExpression());
    const frameSample = await client.evaluate(frameSampleExpression(options.frameSampleCount, options.frameTimeoutMs), options.frameTimeoutMs + 3000);
    const report = buildReport({
      options,
      adbVersion,
      deviceLine,
      reverseList,
      browser,
      interaction,
      frameSample,
    });

    if (options.outputPath) {
      await mkdir(path.dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(`Wrote ${options.outputPath}`);
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    client.close();
  }
}

export function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    mode: "run",
    url: "http://localhost:5173/",
    appPort: 5173,
    cdpPort: 9222,
    frameSampleCount: 90,
    frameTimeoutMs: 4000,
    skipLaunch: false,
    inputPattern: "docs/openclinxr/quest-cdp-smoke-*.json",
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--url") {
      options.url = requireValue(normalizedArgs, index, arg);
      options.appPort = Number(new URL(options.url).port || "80");
      index += 1;
      continue;
    }
    if (arg === "--input") {
      options.inputPath = requireValue(normalizedArgs, index, arg);
      options.mode = "validate";
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.mode = "validate";
      const nextArg = normalizedArgs[index + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        options.inputPattern = nextArg;
        index += 1;
      }
      continue;
    }
    if (arg === "--app-port") {
      options.appPort = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--cdp-port") {
      options.cdpPort = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--frame-sample-count") {
      options.frameSampleCount = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--frame-timeout-ms") {
      options.frameTimeoutMs = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--skip-launch") {
      options.skipLaunch = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  if (!Number.isFinite(options.appPort) || options.appPort <= 0) {
    throw new Error("--app-port must be a positive number");
  }
  if (!Number.isFinite(options.cdpPort) || options.cdpPort <= 0) {
    throw new Error("--cdp-port must be a positive number");
  }
  if (!Number.isFinite(options.frameSampleCount) || options.frameSampleCount <= 0) {
    throw new Error("--frame-sample-count must be a positive number");
  }
  if (!Number.isFinite(options.frameTimeoutMs) || options.frameTimeoutMs <= 0) {
    throw new Error("--frame-timeout-ms must be a positive number");
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

async function adb(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("adb", args, { encoding: "utf8" });
  return `${stdout}${stderr}`.trim();
}

async function waitForQuestPage(options: CliOptions): Promise<CdpPage> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${options.cdpPort}/json`);
    const pages = await response.json() as CdpPage[];
    const page = pages.find((candidate) => candidate.type === "page" && pageMatchesRequestedUrl(candidate.url, options.url) && candidate.webSocketDebuggerUrl);
    if (page) {
      return page;
    }
    await delay(250);
  }
  throw new Error(`Quest Browser page ${options.url} was not exposed through CDP port ${options.cdpPort}`);
}

async function latestQuestSmokeReportPath(pattern: string): Promise<string | undefined> {
  return (await fg(pattern, { onlyFiles: true })).sort().at(-1);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

export function pageMatchesRequestedUrl(actual: string, requested: string): boolean {
  if (actual === requested) {
    return true;
  }
  try {
    const actualUrl = new URL(actual);
    const requestedUrl = new URL(requested);
    return actualUrl.origin === requestedUrl.origin && actualUrl.pathname === requestedUrl.pathname;
  } catch {
    return false;
  }
}

export function browserSnapshotExpression(): string {
  return String.raw`(() => {
    const canvas = document.querySelector("canvas");
    return {
      title: document.title,
      url: location.href,
      userAgent: navigator.userAgent,
      devicePixelRatio,
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
      bodyHasEdChestPain: document.body.textContent.includes("ED Chest Pain"),
      hasViteOverlay: !!document.querySelector("vite-error-overlay"),
      hasNavigatorXr: !!navigator.xr,
      xrStatus: document.querySelector("#xr-status")?.textContent ?? null,
      trace: document.body.textContent.match(/Trace\s+\d+\/\d+/)?.[0] ?? null,
      frameStats: window.__openClinXrFrameStats ?? null,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        dataUrlLength: canvas.toDataURL("image/png").length,
      } : null,
    };
  })()`;
}

export function interactionExpression(): string {
  return String.raw`(async () => {
    const clickByText = (label) => {
      const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
      button?.click();
      return !!button;
    };
    const beforeTrace = document.body.textContent.match(/Trace\s+\d+\/\d+/)?.[0] ?? null;
    const clickedEcg = clickByText("ecg request");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const clickedUrgent = clickByText("urgent escalation");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterTrace = document.body.textContent.match(/Trace\s+\d+\/\d+/)?.[0] ?? null;
    return {
      beforeTrace,
      afterTrace,
      clickedEcg,
      clickedUrgent,
      hasViteOverlay: !!document.querySelector("vite-error-overlay"),
      dialogue: document.body.textContent.match(/Mock Dialogue\s+([^]+?)Trace Actions/)?.[1]?.trim() ?? null,
    };
  })()`;
}

export function frameSampleExpression(frameSampleCount: number, frameTimeoutMs: number): string {
  return String.raw`(async () => {
    const started = performance.now();
    const readStats = () => window.__openClinXrFrameStats ?? null;
    const initialStats = readStats();
    const initialFrames = initialStats?.framesObserved ?? 0;
    let latestStats = initialStats;
    let timedOut = false;

    while (performance.now() - started < ${frameTimeoutMs}) {
      latestStats = readStats();
      const framesObserved = latestStats?.framesObserved ?? 0;
      const sampleCount = latestStats?.sampleCount ?? 0;
      const framesObservedDuringProbe = framesObserved - initialFrames;
      if (sampleCount >= ${frameSampleCount} || framesObservedDuringProbe >= ${frameSampleCount}) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    latestStats = readStats();
    const elapsedWallMs = Number((performance.now() - started).toFixed(2));
    const sampleCount = latestStats?.sampleCount ?? 0;
    const framesObserved = latestStats?.framesObserved ?? 0;
    const framesObservedDuringProbe = framesObserved - initialFrames;
    const latestFrameAgeMs = typeof latestStats?.latestFrameAtMs === "number"
      ? Number((performance.now() - latestStats.latestFrameAtMs).toFixed(2))
      : null;
    timedOut = sampleCount < ${frameSampleCount} && framesObservedDuringProbe < ${frameSampleCount};

    return {
      framesObserved,
      framesObservedDuringProbe,
      sampleCount,
      timedOut,
      elapsedWallMs,
      latestFrameAgeMs,
      avgFrameMs: latestStats?.avgFrameMs ?? null,
      p95FrameMs: latestStats?.p95FrameMs ?? null,
      maxFrameMs: latestStats?.maxFrameMs ?? null,
      approxFps: latestStats?.approxFps ?? null,
    };
  })()`;
}

export function buildReport(input: QuestSmokeReportInput): QuestSmokeReport {
  const browser = asRecord(input.browser);
  const interaction = asRecord(input.interaction);
  const frameSample = asRecord(input.frameSample);
  const shellLoaded = browser.title === "OpenClinXR Station Runtime"
    && browser.bodyHasEdChestPain === true
    && browser.hasViteOverlay === false
    && asRecord(browser.canvas).dataUrlLength !== undefined;
  const interactionAdvanced = interaction.afterTrace === "Trace 2/10" && interaction.clickedEcg === true && interaction.clickedUrgent === true;
  const pageVisible = browser.hidden === false && browser.visibilityState === "visible";
  const frameSampleComplete = pageVisible && frameSample.timedOut === false && typeof frameSample.avgFrameMs === "number";
  const blockers = [
    shellLoaded ? undefined : "quest_shell_not_loaded",
    interactionAdvanced ? undefined : "quest_trace_interaction_not_advanced",
    pageVisible ? undefined : "quest_page_hidden_or_inactive",
    frameSampleComplete ? undefined : "quest_cdp_frame_sample_incomplete",
  ].filter((item): item is string => typeof item === "string");

  return {
    generatedAt: new Date().toISOString(),
    url: input.options.url,
    adb: {
      version: input.adbVersion,
      deviceLine: input.deviceLine,
      reverseList: input.reverseList,
    },
    browser,
    interaction,
    frameSample,
    verdict: {
      shellLoaded,
      interactionAdvanced,
      frameSampleComplete,
      blockers,
    },
  };
}

export function buildQuestSmokeEvidenceCheck(inputFile: string | undefined, report: QuestSmokeReport | undefined): QuestSmokeEvidenceCheck {
  if (!report) {
    return {
      generatedAt: new Date().toISOString(),
      inputFile: null,
      readyForForegroundQuestClaim: false,
      classification: "missing",
      satisfiedConditions: [],
      blockers: ["missing_quest_cdp_smoke_report"],
    };
  }

  const browser = asRecord(report.browser);
  const frameSample = asRecord(report.frameSample);
  const adb = asRecord(report.adb);
  const verdict = report.verdict;
  const pageVisible = browser.hidden === false && browser.visibilityState === "visible";
  const frameStatsPresent = typeof browser.frameStats === "object" && browser.frameStats !== null;
  const latestFrameAgeMs = frameSample.latestFrameAgeMs;
  const latestFrameFresh = typeof latestFrameAgeMs === "number" && Number.isFinite(latestFrameAgeMs) && latestFrameAgeMs <= 1000;
  const framesObservedDuringProbe = frameSample.framesObservedDuringProbe;
  const framesAdvancedDuringProbe = typeof framesObservedDuringProbe === "number"
    && Number.isFinite(framesObservedDuringProbe)
    && framesObservedDuringProbe > 0;
  const rawBlockers = Array.isArray(verdict?.blockers) ? verdict.blockers.filter((blocker): blocker is string => typeof blocker === "string") : [];
  const readyForForegroundQuestClaim = verdict?.shellLoaded === true
    && verdict.interactionAdvanced === true
    && verdict.frameSampleComplete === true
    && rawBlockers.length === 0
    && pageVisible
    && latestFrameFresh
    && framesAdvancedDuringProbe;
  const blockers = unique([
    isValidIsoDate(report.generatedAt) ? undefined : "quest_cdp_generated_at_invalid_or_missing",
    typeof adb.deviceLine === "string" && adb.deviceLine.trim().length > 0 ? undefined : "quest_cdp_adb_device_line_missing",
    typeof browser.userAgent === "string" && browser.userAgent.trim().length > 0 ? undefined : "quest_cdp_user_agent_missing",
    verdict?.shellLoaded === true ? undefined : "quest_shell_not_loaded",
    verdict?.interactionAdvanced === true ? undefined : "quest_trace_interaction_not_advanced",
    pageVisible ? undefined : "quest_page_hidden_or_inactive",
    verdict?.frameSampleComplete === true ? undefined : "quest_cdp_frame_sample_incomplete",
    frameStatsPresent ? undefined : "quest_frame_stats_missing",
    frameSample.timedOut === true ? "quest_cdp_frame_sample_timed_out" : undefined,
    framesAdvancedDuringProbe ? undefined : "quest_no_frames_observed_during_probe",
    latestFrameFresh ? undefined : "quest_latest_frame_stale_over_1000ms",
    ...rawBlockers,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ?? null,
    readyForForegroundQuestClaim,
    classification: classifyQuestSmokeEvidence(verdict, blockers),
    satisfiedConditions: [
      isValidIsoDate(report.generatedAt) ? "quest_cdp_generated_at_valid" : undefined,
      typeof adb.deviceLine === "string" && adb.deviceLine.trim().length > 0 ? "quest_cdp_adb_device_recorded" : undefined,
      typeof browser.userAgent === "string" && browser.userAgent.trim().length > 0 ? "quest_cdp_user_agent_recorded" : undefined,
      verdict?.shellLoaded === true ? "quest_shell_loaded" : undefined,
      verdict?.interactionAdvanced === true ? "quest_trace_interaction_advanced" : undefined,
      pageVisible ? "quest_page_visible" : undefined,
      verdict?.frameSampleComplete === true ? "quest_cdp_frame_sample_complete" : undefined,
      frameStatsPresent ? "quest_frame_stats_present" : undefined,
      latestFrameFresh ? "quest_latest_frame_fresh" : undefined,
      framesAdvancedDuringProbe ? "quest_frames_advanced_during_probe" : undefined,
    ].filter((condition): condition is string => typeof condition === "string"),
    blockers,
  };
}

function classifyQuestSmokeEvidence(
  verdict: QuestSmokeReport["verdict"],
  blockers: string[],
): QuestSmokeEvidenceClassification {
  if (blockers.length === 0 && verdict.shellLoaded && verdict.interactionAdvanced && verdict.frameSampleComplete) {
    return "foreground_ready";
  }
  if (
    verdict.shellLoaded
    && verdict.interactionAdvanced
    && blockers.includes("quest_page_hidden_or_inactive")
    && blockers.includes("quest_cdp_frame_sample_incomplete")
  ) {
    return "shell_interaction_only_hidden_page";
  }
  return "blocked";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isValidIsoDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

class CdpClient {
  private nextId = 0;
  private readonly pending = new Map<number, PendingCdpCall>();

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")) as {
        id?: number;
        result?: CdpResult;
        error?: unknown;
      };
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const pendingCall = this.pending.get(message.id);
      if (!pendingCall) {
        return;
      }
      clearTimeout(pendingCall.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pendingCall.reject(new Error(JSON.stringify(message.error)));
        return;
      }
      pendingCall.resolve(message.result ?? {});
    });
  }

  static async connect(url: string | undefined): Promise<CdpClient> {
    if (!url) {
      throw new Error("CDP page is missing webSocketDebuggerUrl");
    }
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Unable to connect to ${url}`)), { once: true });
    });
    const client = new CdpClient(socket);
    await client.send("Runtime.enable");
    return client;
  }

  async evaluate(expression: string, timeoutMs = 5000): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  close(): void {
    this.socket.close();
  }

  async reload(): Promise<void> {
    await this.send("Page.enable");
    await this.send("Page.reload", { ignoreCache: true });
  }

  private send(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<CdpResult> {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
