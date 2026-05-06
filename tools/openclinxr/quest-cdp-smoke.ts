import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import fg from "fast-glob";

const execFileAsync = promisify(execFile);

export type CliOptions = {
  mode: "run" | "validate" | "manual-evidence";
  url: string;
  target: QuestSmokeTarget;
  appPort: number;
  cdpPort: number;
  outputPath?: string;
  frameSampleCount: number;
  frameTimeoutMs: number;
  manualEvidenceTimeoutMs: number;
  manualEvidenceMinImmersiveFrames: number;
  manualEvidenceMinSampleWindowSize: number;
  skipLaunch: boolean;
  reuseOpenPage: boolean;
  enterVr: boolean;
  inputPath?: string;
  inputPattern: string;
};

export type QuestSmokeTarget = "station" | "iwsdk-sidecar";

export type CdpPage = {
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

const questCdpPageListFetchTimeoutMs = 1500;
const questCdpDiagnosticCommandTimeoutMs = 2500;

export type QuestSmokeReport = {
  generatedAt: string;
  url: string;
  target: QuestSmokeTarget;
  adb: {
    version: string;
    deviceLine: string;
    reverseList: string;
  };
  browser: Record<string, unknown>;
  immersive?: Record<string, unknown>;
  interaction: Record<string, unknown>;
  frameSample: Record<string, unknown>;
  verdict: {
    shellLoaded: boolean;
    interactionAdvanced: boolean;
    frameSampleComplete: boolean;
    immersiveEntryOutcome: QuestImmersiveEntryOutcome;
    blockers: string[];
  };
};

export type QuestImmersiveEntryOutcome =
  | "not_requested"
  | "activation_missed"
  | "app_request_failed"
  | "session_started";

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
  immersiveEntryOutcome: QuestImmersiveEntryOutcome;
  readinessMatrix?: QuestSmokeReadinessMatrix;
  satisfiedConditions: string[];
  blockers: string[];
};

export type QuestSmokeReadinessStatus = "ready" | "blocked" | "not_requested" | "not_required";

export type QuestSmokeReadinessLane = {
  status: QuestSmokeReadinessStatus;
  satisfiedConditions: string[];
  blockers: string[];
};

export type QuestSmokeImmersiveReadinessLane = QuestSmokeReadinessLane & {
  outcome: QuestImmersiveEntryOutcome;
};

export type QuestSmokeReadinessMatrix = {
  foregroundDevice: QuestSmokeReadinessLane;
  shellInteraction: QuestSmokeReadinessLane;
  immersiveEntry: QuestSmokeImmersiveReadinessLane;
  framePacingSample: QuestSmokeReadinessLane;
  stationRuntimeEvidence: QuestSmokeReadinessLane;
};

export type QuestSmokeReportInput = {
  options: CliOptions;
  adbVersion: string;
  deviceLine: string;
  reverseList: string;
  browser: unknown;
  immersive?: unknown;
  interaction: unknown;
  frameSample: unknown;
};

export type QuestSmokeCdpUnavailableInput = {
  options: CliOptions;
  adbVersion: string;
  deviceLine: string;
  reverseList: string;
  failureStage: "quest_cdp_page_list_unavailable" | "quest_cdp_websocket_unavailable";
  error: unknown;
  diagnostics?: QuestSmokeCdpDiagnostics;
};

export type QuestSmokeCdpDiagnostics = {
  browserPid: string | null;
  devtoolsSocketLines: string;
  browserPackageLine: string;
  browserUidState: string;
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
  let page: CdpPage;
  try {
    page = await waitForQuestPage(options);
  } catch (error) {
    const diagnostics = await collectQuestCdpDiagnostics();
    await emitQuestSmokeReport(buildCdpUnavailableReport({
      options,
      adbVersion,
      deviceLine,
      reverseList,
      failureStage: "quest_cdp_page_list_unavailable",
      error,
      diagnostics,
    }), options.outputPath);
    return;
  }
  await closeStaleQuestPages(options, page.id);
  let client: CdpClient;
  try {
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
  } catch (error) {
    const diagnostics = await collectQuestCdpDiagnostics();
    await emitQuestSmokeReport(buildCdpUnavailableReport({
      options,
      adbVersion,
      deviceLine,
      reverseList,
      failureStage: "quest_cdp_websocket_unavailable",
      error,
      diagnostics,
    }), options.outputPath);
    return;
  }
  try {
    await client.bringToFront();
    await delay(250);
    if (options.mode === "manual-evidence") {
      const harvest = await client.evaluate(manualEvidenceHarvestExpression({
        timeoutMs: options.manualEvidenceTimeoutMs,
        minImmersiveFrames: options.manualEvidenceMinImmersiveFrames,
        minSampleWindowSize: options.manualEvidenceMinSampleWindowSize,
      }), options.manualEvidenceTimeoutMs + 3000);
      await emitManualEvidenceHarvestPayload(buildManualEvidenceHarvestPayload(harvest), options.outputPath);
      return;
    }
    await client.navigate(options.url);
    await delay(750);
    await client.reload();
    await delay(750);
    const immersive = options.enterVr ? await enterImmersiveVr(client) : undefined;
    const browser = await client.evaluate(browserSnapshotExpression());
    const interaction = await client.evaluate(interactionExpression());
    const frameSample = await client.evaluate(frameSampleExpression(options.frameSampleCount, options.frameTimeoutMs), options.frameTimeoutMs + 3000);
    const report = buildReport({
      options,
      adbVersion,
      deviceLine,
      reverseList,
      browser,
      immersive,
      interaction,
      frameSample,
    });

    await emitQuestSmokeReport(report, options.outputPath);
  } finally {
    client.close();
  }
}

export function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    mode: "run",
    url: "http://localhost:5173/",
    target: "station",
    appPort: 5173,
    cdpPort: 9222,
    frameSampleCount: 90,
    frameTimeoutMs: 4000,
    manualEvidenceTimeoutMs: 600_000,
    manualEvidenceMinImmersiveFrames: 600,
    manualEvidenceMinSampleWindowSize: 120,
    skipLaunch: false,
    reuseOpenPage: false,
    enterVr: false,
    inputPattern: "docs/openclinxr/quest-cdp-smoke-[0-9]*.json",
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
    if (arg === "--target") {
      options.target = parseTarget(requireValue(normalizedArgs, index, arg));
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
    if (arg === "--harvest-manual-evidence") {
      if (options.enterVr) {
        throw new Error("--harvest-manual-evidence waits for operator-entered VR and cannot be combined with --enter-vr");
      }
      options.mode = "manual-evidence";
      options.enterVr = false;
      options.skipLaunch = true;
      options.reuseOpenPage = true;
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
    if (arg === "--manual-evidence-timeout-ms") {
      options.manualEvidenceTimeoutMs = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--manual-evidence-min-immersive-frames") {
      options.manualEvidenceMinImmersiveFrames = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--manual-evidence-min-sample-window") {
      options.manualEvidenceMinSampleWindowSize = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      index += 1;
      continue;
    }
    if (arg === "--skip-launch") {
      options.skipLaunch = true;
      continue;
    }
    if (arg === "--reuse-open-page") {
      options.reuseOpenPage = true;
      continue;
    }
    if (arg === "--enter-vr") {
      if (options.mode === "manual-evidence") {
        throw new Error("--harvest-manual-evidence waits for operator-entered VR and cannot be combined with --enter-vr");
      }
      options.enterVr = true;
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
  if (!Number.isFinite(options.manualEvidenceTimeoutMs) || options.manualEvidenceTimeoutMs <= 0) {
    throw new Error("--manual-evidence-timeout-ms must be a positive number");
  }
  if (!Number.isFinite(options.manualEvidenceMinImmersiveFrames) || options.manualEvidenceMinImmersiveFrames <= 0) {
    throw new Error("--manual-evidence-min-immersive-frames must be a positive number");
  }
  if (!Number.isFinite(options.manualEvidenceMinSampleWindowSize) || options.manualEvidenceMinSampleWindowSize <= 0) {
    throw new Error("--manual-evidence-min-sample-window must be a positive number");
  }
  if (options.mode === "manual-evidence" && options.enterVr) {
    throw new Error("--harvest-manual-evidence waits for operator-entered VR and cannot be combined with --enter-vr");
  }

  return options;
}

function parseTarget(value: string): QuestSmokeTarget {
  if (value === "station" || value === "iwsdk-sidecar") {
    return value;
  }
  throw new Error("--target must be one of: station, iwsdk-sidecar");
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

async function collectQuestCdpDiagnostics(): Promise<QuestSmokeCdpDiagnostics> {
  const [browserPid, devtoolsSocketLines, browserPackageLine] = await Promise.all([
    adbShellOrEmpty("pidof com.oculus.browser || true"),
    adbShellOrEmpty("cat /proc/net/unix | grep -i devtools | head -20 || true"),
    adbShellOrEmpty("cmd package list packages -U com.oculus.browser || true"),
  ]);
  const browserUid = browserPackageLine.match(/uid:(\d+)/)?.[1];
  const browserUidState = browserUid
    ? await adbShellOrEmpty(`cmd activity get-uid-state ${browserUid} || true`)
    : "uid_unavailable";
  return {
    browserPid: browserPid.trim() || null,
    devtoolsSocketLines: devtoolsSocketLines.trim(),
    browserPackageLine: browserPackageLine.trim(),
    browserUidState: browserUidState.trim(),
  };
}

async function adbShellOrEmpty(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("adb", ["shell", command], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: questCdpDiagnosticCommandTimeoutMs,
    });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    return `diagnostic_failed: ${formatUnknownError(error)}`;
  }
}

async function waitForQuestPage(options: CliOptions): Promise<CdpPage> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let pages: CdpPage[];
    try {
      pages = await fetchQuestCdpPages(options.cdpPort);
    } catch (error) {
      lastError = error;
      await delay(250);
      continue;
    }
    const page = selectQuestPage(pages, options.url, { reuseOpenPage: options.reuseOpenPage });
    if (page) {
      return page;
    }
    await delay(250);
  }
  const causeSuffix = lastError ? ` Last CDP fetch error: ${formatUnknownError(lastError)}` : "";
  throw new Error(`Quest Browser page ${options.url} was not exposed through CDP port ${options.cdpPort}.${causeSuffix}`);
}

export async function fetchQuestCdpPages(cdpPort: number): Promise<CdpPage[]> {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
    signal: AbortSignal.timeout(questCdpPageListFetchTimeoutMs),
  });
  return await response.json() as CdpPage[];
}

async function closeStaleQuestPages(options: CliOptions, keepPageId: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${options.cdpPort}/json`);
  const pages = await response.json() as CdpPage[];
  await Promise.all(staleQuestSmokePageIds(pages, options.url, keepPageId).map(async (pageId) => {
    await fetch(`http://127.0.0.1:${options.cdpPort}/json/close/${encodeURIComponent(pageId)}`);
  }));
}

async function enterImmersiveVr(client: CdpClient): Promise<Record<string, unknown>> {
  const buttonRect = asRecord(await client.evaluate(enterVrButtonRectExpression()));
  const x = buttonRect.x;
  const y = buttonRect.y;
  const canClick = buttonRect.buttonFound === true
    && buttonRect.disabled !== true
    && typeof x === "number"
    && typeof y === "number";
  if (!canClick) {
    return {
      ...buttonRect,
      clickedEnterVr: false,
      immersiveSessionStarted: false,
      xrStatusAfter: buttonRect.xrStatusBefore ?? null,
      failureReason: buttonRect.failureReason ?? "enter_vr_button_not_clickable",
    };
  }

  await client.dispatchMouseClick(x, y);
  const completion = asRecord(await client.evaluate(enterVrCompletionExpression(8000), 10_000));
  return {
    ...buttonRect,
    ...completion,
    clickedEnterVr: true,
  };
}

async function latestQuestSmokeReportPath(pattern: string): Promise<string | undefined> {
  return (await fg(pattern, { onlyFiles: true })).sort().at(-1);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

async function emitQuestSmokeReport(report: QuestSmokeReport, outputPath: string | undefined): Promise<void> {
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outputPath}`);
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

async function emitManualEvidenceHarvestPayload(payload: Record<string, unknown>, outputPath: string | undefined): Promise<void> {
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outputPath}; harvestReady=${asRecord(payload.harvestSummary).ready === true}`);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
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

export function selectQuestPage(
  pages: CdpPage[],
  requested: string,
  options: { reuseOpenPage?: boolean } = {},
): CdpPage | undefined {
  const eligiblePages = pages.filter((candidate) => isQuestSmokePageCandidate(candidate, requested));
  const requestedPage = eligiblePages.find((candidate) => candidate.url === requested) ?? eligiblePages[0];
  if (requestedPage || !options.reuseOpenPage) {
    return requestedPage;
  }

  const reusablePages = pages.filter(isReusableOpenHttpPage);
  return reusablePages.length === 1 ? reusablePages[0] : undefined;
}

export function staleQuestSmokePageIds(pages: CdpPage[], requested: string, keepPageId: string): string[] {
  return pages
    .filter((candidate) => candidate.id !== keepPageId && isQuestSmokePageCandidate(candidate, requested))
    .map((candidate) => candidate.id);
}

function isQuestSmokePageCandidate(candidate: CdpPage, requested: string): boolean {
  return candidate.type === "page" && pageMatchesRequestedUrl(candidate.url, requested) && !!candidate.webSocketDebuggerUrl;
}

function isReusableOpenHttpPage(candidate: CdpPage): boolean {
  if (candidate.type !== "page" || !candidate.webSocketDebuggerUrl) {
    return false;
  }
  try {
    const url = new URL(candidate.url);
    return url.protocol === "http:" || url.protocol === "https:";
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
      bootEvidence: window.__openClinXrBootEvidence ?? null,
      iwsdkEvidence: window.__openClinXrIwsdkSidecarEvidence ?? null,
      frameStats: window.__openClinXrFrameStats ?? null,
      inputEvidence: window.__openClinXrInputEvidence ?? null,
      textPanelEvidence: window.__openClinXrTextPanelEvidence ?? null,
      traceLatencyEvidence: window.__openClinXrTraceLatencyEvidence ?? null,
      xrEntryEvidence: window.__openClinXrXrEntryEvidence ?? null,
      manualPerformanceDraft: window.__openClinXrManualPerformanceDraft ?? null,
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

export function enterVrButtonRectExpression(): string {
  return String.raw`(() => {
    const button = document.querySelector("#enter-xr-button");
    const xrStatus = document.querySelector("#xr-status")?.textContent ?? null;
    if (!(button instanceof HTMLButtonElement)) {
      return {
        buttonFound: false,
        disabled: true,
        xrStatusBefore: xrStatus,
        failureReason: "enter_vr_button_missing",
      };
    }
    const rect = button.getBoundingClientRect();
    return {
      buttonFound: true,
      disabled: button.disabled,
      text: button.textContent?.trim() ?? "",
      xrStatusBefore: xrStatus,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`;
}

export function enterVrCompletionExpression(timeoutMs: number): string {
  return String.raw`(async () => {
    const started = performance.now();
    const readStatus = () => document.querySelector("#xr-status")?.textContent ?? null;
    const readManualPerformanceDraft = () => window.__openClinXrManualPerformanceDraft ?? null;
    const readXrEntryEvidence = () => window.__openClinXrXrEntryEvidence ?? null;
    let xrStatusAfter = readStatus();
    let manualPerformanceDraft = readManualPerformanceDraft();
    let xrEntryEvidence = readXrEntryEvidence();
    let immersiveSessionStarted = manualPerformanceDraft?.station?.immersiveSessionStarted === true
      || xrEntryEvidence?.lastStatus === "started";
    while (performance.now() - started < ${timeoutMs}) {
      xrStatusAfter = readStatus();
      manualPerformanceDraft = readManualPerformanceDraft();
      xrEntryEvidence = readXrEntryEvidence();
      immersiveSessionStarted = manualPerformanceDraft?.station?.immersiveSessionStarted === true
        || xrEntryEvidence?.lastStatus === "started";
      if ((xrStatusAfter === "In Full VR" && immersiveSessionStarted) || xrStatusAfter === "WebXR entry blocked") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    manualPerformanceDraft = readManualPerformanceDraft();
    xrEntryEvidence = readXrEntryEvidence();
    immersiveSessionStarted = xrStatusAfter === "In Full VR"
      || manualPerformanceDraft?.station?.immersiveSessionStarted === true
      || xrEntryEvidence?.lastStatus === "started";
    return {
      xrStatusAfter,
      immersiveSessionStarted,
      manualPerformanceDraft,
      xrEntryEvidence,
      inputEvidence: window.__openClinXrInputEvidence ?? null,
      elapsedWallMs: Number((performance.now() - started).toFixed(2)),
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
    const parseTraceCount = (traceText) => Number(traceText?.match(/Trace\s+(\d+)\/\d+/)?.[1] ?? Number.NaN);
    const beforeTraceCount = parseTraceCount(beforeTrace);
    const afterTraceCount = parseTraceCount(afterTrace);
    return {
      beforeTrace,
      afterTrace,
      traceActionsAdvancedBy: Number.isFinite(beforeTraceCount) && Number.isFinite(afterTraceCount)
        ? afterTraceCount - beforeTraceCount
        : null,
      clickedEcg,
      clickedUrgent,
      hasViteOverlay: !!document.querySelector("vite-error-overlay"),
      dialogue: document.body.textContent.match(/Mock Dialogue\s+([^]+?)Trace Actions/)?.[1]?.trim() ?? null,
      traceLatencyEvidence: window.__openClinXrTraceLatencyEvidence ?? null,
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
      const framesObservedDuringProbe = framesObserved - initialFrames;
      if (framesObservedDuringProbe >= ${frameSampleCount}) {
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
    timedOut = framesObservedDuringProbe < ${frameSampleCount};

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
      latestFrameDeltaMs: latestStats?.latestFrameDeltaMs ?? null,
      sampleWindowMs: latestStats?.sampleWindowMs ?? null,
      longFrameCountOver33Ms: latestStats?.longFrameCountOver33Ms ?? null,
      longFrameRatio: latestStats?.longFrameRatio ?? null,
      previewFramesObserved: latestStats?.previewFramesObserved ?? null,
      immersiveFramesObserved: latestStats?.immersiveFramesObserved ?? null,
      qualitySource: latestStats?.qualitySource ?? null,
      renderLoopMode: latestStats?.renderLoopMode ?? null,
      isPresenting: latestStats?.isPresenting ?? null,
      visibilityState: latestStats?.visibilityState ?? null,
      iwsdkEvidence: window.__openClinXrIwsdkSidecarEvidence ?? null,
    };
  })()`;
}

export function manualEvidenceHarvestExpression(input: {
  timeoutMs: number;
  minImmersiveFrames: number;
  minSampleWindowSize: number;
}): string {
  return String.raw`(async () => {
    const started = performance.now();
    const readHarvest = () => {
      const manualPerformanceDraft = window.__openClinXrManualPerformanceDraft ?? null;
      const captureSummary = window.__openClinXrManualPerformanceCaptureSummary ?? null;
      const textPanelEvidence = window.__openClinXrTextPanelEvidence ?? null;
      const performanceEvidence = manualPerformanceDraft?.performance ?? {};
      const stationEvidence = manualPerformanceDraft?.station ?? {};
      const inputEvidence = manualPerformanceDraft?.input ?? {};
      const traceEvidence = manualPerformanceDraft?.traceLatencyProxy ?? {};
      const locomotionDelta = inputEvidence?.locomotionDelta ?? {};
      const immersiveFramesObserved = performanceEvidence?.immersiveFramesObserved
        ?? captureSummary?.immersiveFramesObserved
        ?? null;
      const sampleWindowSize = performanceEvidence?.sampleWindowSize ?? captureSummary?.sampleWindowSize ?? null;
      const traceSource = traceEvidence?.source ?? captureSummary?.traceLatencySource ?? null;
      const lastTraceTag = traceEvidence?.lastTraceTag ?? captureSummary?.lastTraceTag ?? null;
      const lastTraceLatencyMs = traceEvidence?.lastSelectLatencyMs ?? captureSummary?.lastTraceLatencyMs ?? null;
      const locomotionDistanceMeters = locomotionDelta?.distanceMeters ?? captureSummary?.locomotionDistanceMeters ?? null;
      const locomotionTurnRadians = locomotionDelta?.turnRadians ?? captureSummary?.locomotionTurnRadians ?? null;
      const technicalGaps = Array.isArray(captureSummary?.technicalGaps)
        ? captureSummary.technicalGaps.filter((gap) => typeof gap === "string")
        : [];
      const locomotionProbeReasons = Array.isArray(captureSummary?.locomotionProbeSummary?.reasonCodes)
        ? captureSummary.locomotionProbeSummary.reasonCodes.filter((reason) =>
          typeof reason === "string" && reason !== "locomotion_observed"
        )
        : [];
      const immersiveSessionStarted = stationEvidence?.immersiveSessionStarted === true;
      const frameStatsFresh = captureSummary?.frameStatsFresh === true;
      const immersiveFrameReady = typeof immersiveFramesObserved === "number" && immersiveFramesObserved >= ${input.minImmersiveFrames};
      const sampleWindowReady = typeof sampleWindowSize === "number" && sampleWindowSize >= ${input.minSampleWindowSize};
      const hasHeadsetTraceEvidence = (traceSource === "xr_controller_select" || traceSource === "xr_hand_select")
        && typeof lastTraceTag === "string"
        && lastTraceTag.trim().length > 0
        && typeof lastTraceLatencyMs === "number"
        && Number.isFinite(lastTraceLatencyMs)
        && lastTraceLatencyMs > 0;
      const hasLocomotionEvidence = typeof inputEvidence?.lastLocomotionAtMs === "number"
        && Number.isFinite(inputEvidence.lastLocomotionAtMs)
        && inputEvidence?.locomotionAttempt === "runtime_event_observed"
        && typeof inputEvidence?.activeLocomotionSource === "string"
        && inputEvidence?.activeLocomotionSource !== "none"
        && ((typeof locomotionDistanceMeters === "number" && locomotionDistanceMeters > 0)
          || (typeof locomotionTurnRadians === "number" && locomotionTurnRadians > 0));
      const blockers = [
        manualPerformanceDraft ? undefined : "manual_performance_draft_missing",
        captureSummary ? undefined : "manual_performance_capture_summary_missing",
        immersiveSessionStarted ? undefined : "immersive_session_not_started",
        frameStatsFresh ? undefined : "frame_stats_stale_or_unsampled",
        immersiveFrameReady ? undefined : "immersive_frame_sample_under_${input.minImmersiveFrames}",
        sampleWindowReady ? undefined : "rolling_frame_window_under_${input.minSampleWindowSize}",
        hasHeadsetTraceEvidence ? undefined : "headset_trace_latency_missing",
        hasLocomotionEvidence ? undefined : "locomotion_evidence_missing",
        technicalGaps.length > 0 ? "capture_summary_technical_gaps_present" : undefined,
        ...technicalGaps.map((gap) => "capture_summary_technical_gap:" + gap),
        ...locomotionProbeReasons.map((reason) => "capture_summary_locomotion_probe:" + reason),
      ].filter((blocker) => typeof blocker === "string");
      return {
        ready: blockers.length === 0,
        timedOut: false,
        blockers,
        elapsedWallMs: Number((performance.now() - started).toFixed(2)),
        manualPerformanceDraft,
        captureSummary,
        textPanelEvidence,
      };
    };

    let latest = readHarvest();
    while (!latest.ready && performance.now() - started < ${input.timeoutMs}) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      latest = readHarvest();
    }
    latest = readHarvest();
    return {
      ...latest,
      timedOut: latest.ready ? false : true,
      elapsedWallMs: Number((performance.now() - started).toFixed(2)),
    };
  })()`;
}

export function buildManualEvidenceHarvestPayload(input: unknown): Record<string, unknown> {
  const result = asRecord(input);
  return {
    manualPerformanceDraft: result.manualPerformanceDraft ?? null,
    captureSummary: result.captureSummary ?? null,
    textPanelEvidence: result.textPanelEvidence ?? null,
    harvestSummary: {
      source: "quest_cdp_manual_evidence_harvest",
      ready: result.ready === true,
      timedOut: result.timedOut === true,
      blockers: Array.isArray(result.blockers)
        ? result.blockers.filter((blocker): blocker is string => typeof blocker === "string")
        : ["manual_evidence_harvest_result_invalid"],
      elapsedWallMs: typeof result.elapsedWallMs === "number" && Number.isFinite(result.elapsedWallMs)
        ? result.elapsedWallMs
        : null,
    },
  };
}

export function buildReport(input: QuestSmokeReportInput): QuestSmokeReport {
  const browser = asRecord(input.browser);
  const immersive = asRecord(input.immersive);
  const interaction = asRecord(input.interaction);
  const frameSample = asRecord(input.frameSample);
  const shellLoaded = browser.title === expectedQuestSmokeTitle(input.options.target)
    && browser.bodyHasEdChestPain === true
    && browser.hasViteOverlay === false
    && asRecord(browser.canvas).dataUrlLength !== undefined;
  const interactionAdvanced = traceInteractionAdvanced(interaction)
    && interaction.clickedEcg === true
    && interaction.clickedUrgent === true;
  const pageVisible = browser.hidden === false && browser.visibilityState === "visible";
  const manualDraft = asRecord(browser.manualPerformanceDraft);
  const manualDraftStation = asRecord(manualDraft.station);
  const immersiveXrEntryEvidence = asRecord(immersive.xrEntryEvidence);
  const browserXrEntryEvidence = asRecord(browser.xrEntryEvidence);
  const immersiveEntryOutcome = classifyImmersiveEntryOutcome(
    input.options.enterVr,
    browser,
    immersive,
    manualDraftStation,
    immersiveXrEntryEvidence,
    browserXrEntryEvidence,
  );
  const xrEntryActivationReceived = immersiveEntryOutcome !== "activation_missed";
  const immersiveSessionStarted = immersiveEntryOutcome === "not_requested" || immersiveEntryOutcome === "session_started";
  const immersiveFrameLaneObserved = immersiveEntryOutcome !== "session_started"
    || (typeof frameSample.immersiveFramesObserved === "number"
      && Number.isFinite(frameSample.immersiveFramesObserved)
      && frameSample.immersiveFramesObserved > 0);
  const frameSampleComplete = pageVisible
    && frameSample.timedOut === false
    && typeof frameSample.avgFrameMs === "number"
    && immersiveFrameLaneObserved;
  const blockers = [
    shellLoaded ? undefined : "quest_shell_not_loaded",
    xrEntryActivationReceived ? undefined : "quest_immersive_entry_activation_not_received",
    immersiveSessionStarted ? undefined : "quest_immersive_session_not_started",
    interactionAdvanced ? undefined : "quest_trace_interaction_not_advanced",
    pageVisible ? undefined : "quest_page_hidden_or_inactive",
    frameSampleComplete ? undefined : "quest_cdp_frame_sample_incomplete",
    immersiveFrameLaneObserved ? undefined : "quest_cdp_immersive_frame_lane_not_observed",
  ].filter((item): item is string => typeof item === "string");

  return {
    generatedAt: new Date().toISOString(),
    url: input.options.url,
    target: input.options.target,
    adb: {
      version: input.adbVersion,
      deviceLine: input.deviceLine,
      reverseList: input.reverseList,
    },
    browser,
    ...(input.immersive === undefined ? {} : { immersive }),
    interaction,
    frameSample,
    verdict: {
      shellLoaded,
      interactionAdvanced,
      frameSampleComplete,
      immersiveEntryOutcome,
      blockers,
    },
  };
}

export function buildCdpUnavailableReport(input: QuestSmokeCdpUnavailableInput): QuestSmokeReport {
  const immersiveEntryOutcome: QuestImmersiveEntryOutcome = input.options.enterVr ? "activation_missed" : "not_requested";
  const blockers = [
    input.failureStage,
    "quest_shell_not_loaded",
    "quest_trace_interaction_not_advanced",
    "quest_page_hidden_or_inactive",
    "quest_cdp_frame_sample_incomplete",
    ...(input.options.enterVr
      ? ["quest_immersive_entry_activation_not_received", "quest_immersive_session_not_started"]
      : []),
  ];
  return {
    generatedAt: new Date().toISOString(),
    url: input.options.url,
    target: input.options.target,
    adb: {
      version: input.adbVersion,
      deviceLine: input.deviceLine,
      reverseList: input.reverseList,
    },
    browser: {
      cdpUnavailable: true,
      failureStage: input.failureStage,
      error: formatUnknownError(input.error),
      ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
    },
    interaction: {
      skipped: true,
      reason: "cdp_unavailable",
    },
    frameSample: {
      skipped: true,
      timedOut: true,
      reason: "cdp_unavailable",
    },
    verdict: {
      shellLoaded: false,
      interactionAdvanced: false,
      frameSampleComplete: false,
      immersiveEntryOutcome,
      blockers,
    },
  };
}

function expectedQuestSmokeTitle(target: QuestSmokeTarget): string {
  return target === "iwsdk-sidecar" ? "OpenClinXR IWSDK Spike" : "OpenClinXR Station Runtime";
}

function traceInteractionAdvanced(interaction: Record<string, unknown>): boolean {
  if (typeof interaction.traceActionsAdvancedBy === "number") {
    return interaction.traceActionsAdvancedBy >= 2;
  }
  if (typeof interaction.beforeTrace === "string" && typeof interaction.afterTrace === "string") {
    const before = traceCount(interaction.beforeTrace);
    const after = traceCount(interaction.afterTrace);
    if (before !== undefined && after !== undefined) {
      return after - before >= 2;
    }
  }
  return typeof interaction.afterTrace === "string" && /^Trace\s+2\/\d+$/.test(interaction.afterTrace);
}

function traceCount(traceText: string): number | undefined {
  const match = traceText.match(/Trace\s+(\d+)\/\d+/);
  if (!match?.[1]) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

export function buildQuestSmokeEvidenceCheck(inputFile: string | undefined, report: QuestSmokeReport | undefined): QuestSmokeEvidenceCheck {
  if (!report) {
    return {
      generatedAt: new Date().toISOString(),
      inputFile: null,
      readyForForegroundQuestClaim: false,
      classification: "missing",
      immersiveEntryOutcome: "not_requested",
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
  const adbQuestDeviceRecorded = isQuestAdbDeviceLine(adb.deviceLine);
  const browserQuestUserAgentRecorded = isQuestBrowserUserAgent(browser.userAgent);
  const stationRuntimeEvidenceRequired = report.target === "station";
  const textPanelMetadataPresent = hasTextPanelMetadataEvidence(browser.textPanelEvidence);
  const inputEvidenceShapePresent = hasInputEvidenceShape(browser.inputEvidence);
  const frameQualityEvidencePresent = hasFrameQualityEvidence(frameSample) || hasFrameQualityEvidence(browser.frameStats);
  const latestFrameAgeMs = frameSample.latestFrameAgeMs;
  const latestFrameFresh = typeof latestFrameAgeMs === "number" && Number.isFinite(latestFrameAgeMs) && latestFrameAgeMs <= 1000;
  const framesObservedDuringProbe = frameSample.framesObservedDuringProbe;
  const framesAdvancedDuringProbe = typeof framesObservedDuringProbe === "number"
    && Number.isFinite(framesObservedDuringProbe)
    && framesObservedDuringProbe > 0;
  const rawBlockers = Array.isArray(verdict?.blockers) ? verdict.blockers.filter((blocker): blocker is string => typeof blocker === "string") : [];
  const immersiveEntryOutcome = inferImmersiveEntryOutcomeFromReport(report, rawBlockers);
  const effectiveRawBlockers = immersiveEntryOutcome === "not_requested"
    ? rawBlockers.filter((blocker) => blocker !== "quest_immersive_entry_activation_not_received" && blocker !== "quest_immersive_session_not_started")
    : rawBlockers;
  const readyForForegroundQuestClaim = verdict?.shellLoaded === true
    && verdict.interactionAdvanced === true
    && verdict.frameSampleComplete === true
    && effectiveRawBlockers.length === 0
    && adbQuestDeviceRecorded
    && browserQuestUserAgentRecorded
    && pageVisible
    && latestFrameFresh
    && framesAdvancedDuringProbe
    && (!stationRuntimeEvidenceRequired || textPanelMetadataPresent)
    && (!stationRuntimeEvidenceRequired || inputEvidenceShapePresent)
    && (!stationRuntimeEvidenceRequired || frameQualityEvidencePresent);
  const blockers = unique([
    isValidIsoDate(report.generatedAt) ? undefined : "quest_cdp_generated_at_invalid_or_missing",
    typeof adb.deviceLine === "string" && adb.deviceLine.trim().length > 0 ? undefined : "quest_cdp_adb_device_line_missing",
    adbQuestDeviceRecorded ? undefined : "quest_cdp_adb_quest_device_missing",
    typeof browser.userAgent === "string" && browser.userAgent.trim().length > 0 ? undefined : "quest_cdp_user_agent_missing",
    browserQuestUserAgentRecorded ? undefined : "quest_cdp_browser_quest_user_agent_missing",
    verdict?.shellLoaded === true ? undefined : "quest_shell_not_loaded",
    verdict?.interactionAdvanced === true ? undefined : "quest_trace_interaction_not_advanced",
    pageVisible ? undefined : "quest_page_hidden_or_inactive",
    verdict?.frameSampleComplete === true ? undefined : "quest_cdp_frame_sample_incomplete",
    frameStatsPresent ? undefined : "quest_frame_stats_missing",
    !stationRuntimeEvidenceRequired || textPanelMetadataPresent ? undefined : "quest_text_panel_metadata_missing",
    !stationRuntimeEvidenceRequired || inputEvidenceShapePresent ? undefined : "quest_input_evidence_shape_missing",
    !stationRuntimeEvidenceRequired || frameQualityEvidencePresent ? undefined : "quest_frame_quality_evidence_missing",
    frameSample.timedOut === true ? "quest_cdp_frame_sample_timed_out" : undefined,
    framesAdvancedDuringProbe ? undefined : "quest_no_frames_observed_during_probe",
    latestFrameFresh ? undefined : "quest_latest_frame_stale_over_1000ms",
    immersiveEntryOutcome === "activation_missed" ? "quest_immersive_entry_activation_not_received" : undefined,
    immersiveEntryOutcome === "app_request_failed" ? "quest_immersive_app_request_failed" : undefined,
    immersiveEntryOutcome === "session_started" || immersiveEntryOutcome === "not_requested" ? undefined : "quest_immersive_session_not_started",
    ...effectiveRawBlockers,
  ]);
  const satisfiedConditions = [
    isValidIsoDate(report.generatedAt) ? "quest_cdp_generated_at_valid" : undefined,
    typeof adb.deviceLine === "string" && adb.deviceLine.trim().length > 0 ? "quest_cdp_adb_device_recorded" : undefined,
    adbQuestDeviceRecorded ? "quest_cdp_adb_quest_device_recorded" : undefined,
    typeof browser.userAgent === "string" && browser.userAgent.trim().length > 0 ? "quest_cdp_user_agent_recorded" : undefined,
    browserQuestUserAgentRecorded ? "quest_cdp_browser_quest_user_agent_recorded" : undefined,
    verdict?.shellLoaded === true ? "quest_shell_loaded" : undefined,
    verdict?.interactionAdvanced === true ? "quest_trace_interaction_advanced" : undefined,
    pageVisible ? "quest_page_visible" : undefined,
    verdict?.frameSampleComplete === true ? "quest_cdp_frame_sample_complete" : undefined,
    frameStatsPresent ? "quest_frame_stats_present" : undefined,
    stationRuntimeEvidenceRequired && textPanelMetadataPresent ? "quest_text_panel_metadata_present" : undefined,
    stationRuntimeEvidenceRequired && inputEvidenceShapePresent ? "quest_input_evidence_shape_present" : undefined,
    stationRuntimeEvidenceRequired && frameQualityEvidencePresent ? "quest_frame_quality_evidence_present" : undefined,
    latestFrameFresh ? "quest_latest_frame_fresh" : undefined,
    framesAdvancedDuringProbe ? "quest_frames_advanced_during_probe" : undefined,
    immersiveEntryOutcome === "not_requested" ? "quest_immersive_entry_not_requested" : undefined,
    immersiveEntryOutcome === "session_started" ? "quest_immersive_session_started" : undefined,
    immersiveEntryOutcome === "app_request_failed" ? "quest_immersive_activation_reached_app" : undefined,
  ].filter((condition): condition is string => typeof condition === "string");

  return {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ?? null,
    readyForForegroundQuestClaim,
    classification: classifyQuestSmokeEvidence(verdict, blockers),
    immersiveEntryOutcome,
    readinessMatrix: buildQuestSmokeReadinessMatrix({
      satisfiedConditions,
      blockers,
      immersiveEntryOutcome,
      stationRuntimeEvidenceRequired,
    }),
    satisfiedConditions,
    blockers,
  };
}

function buildQuestSmokeReadinessMatrix(input: {
  satisfiedConditions: string[];
  blockers: string[];
  immersiveEntryOutcome: QuestImmersiveEntryOutcome;
  stationRuntimeEvidenceRequired: boolean;
}): QuestSmokeReadinessMatrix {
  return {
    foregroundDevice: readinessLane(input, {
      satisfiedConditions: [
        "quest_cdp_adb_device_recorded",
        "quest_cdp_adb_quest_device_recorded",
        "quest_cdp_user_agent_recorded",
        "quest_cdp_browser_quest_user_agent_recorded",
        "quest_page_visible",
      ],
      blockers: [
        "quest_cdp_adb_device_line_missing",
        "quest_cdp_adb_quest_device_missing",
        "quest_cdp_user_agent_missing",
        "quest_cdp_browser_quest_user_agent_missing",
        "quest_page_hidden_or_inactive",
      ],
    }),
    shellInteraction: readinessLane(input, {
      satisfiedConditions: [
        "quest_shell_loaded",
        "quest_trace_interaction_advanced",
      ],
      blockers: [
        "quest_shell_not_loaded",
        "quest_trace_interaction_not_advanced",
      ],
    }),
    immersiveEntry: {
      ...readinessLane(input, {
        satisfiedConditions: [
          "quest_immersive_entry_not_requested",
          "quest_immersive_session_started",
          "quest_immersive_activation_reached_app",
        ],
        blockers: [
          "quest_immersive_entry_activation_not_received",
          "quest_immersive_app_request_failed",
          "quest_immersive_session_not_started",
        ],
        emptyStatus: input.immersiveEntryOutcome === "not_requested" ? "not_requested" : "ready",
      }),
      outcome: input.immersiveEntryOutcome,
    },
    framePacingSample: readinessLane(input, {
      satisfiedConditions: [
        "quest_cdp_frame_sample_complete",
        "quest_latest_frame_fresh",
        "quest_frames_advanced_during_probe",
        "quest_frame_quality_evidence_present",
      ],
      blockers: [
        "quest_cdp_frame_sample_incomplete",
        "quest_cdp_frame_sample_timed_out",
        "quest_no_frames_observed_during_probe",
        "quest_latest_frame_stale_over_1000ms",
        "quest_frame_quality_evidence_missing",
        "quest_cdp_immersive_frame_lane_not_observed",
      ],
    }),
    stationRuntimeEvidence: input.stationRuntimeEvidenceRequired
      ? readinessLane(input, {
        satisfiedConditions: [
          "quest_text_panel_metadata_present",
          "quest_input_evidence_shape_present",
          "quest_frame_quality_evidence_present",
        ],
        blockers: [
          "quest_text_panel_metadata_missing",
          "quest_input_evidence_shape_missing",
          "quest_frame_quality_evidence_missing",
        ],
      })
      : {
        status: "not_required",
        satisfiedConditions: [],
        blockers: [],
      },
  };
}

function readinessLane(
  input: { satisfiedConditions: string[]; blockers: string[] },
  lane: { satisfiedConditions: string[]; blockers: string[]; emptyStatus?: QuestSmokeReadinessStatus },
): QuestSmokeReadinessLane {
  const laneBlockers = lane.blockers.filter((blocker) => input.blockers.includes(blocker));
  return {
    status: laneBlockers.length === 0 ? lane.emptyStatus ?? "ready" : "blocked",
    satisfiedConditions: lane.satisfiedConditions.filter((condition) => input.satisfiedConditions.includes(condition)),
    blockers: laneBlockers,
  };
}

function hasTextPanelMetadataEvidence(value: unknown): boolean {
  const evidence = asRecord(value);
  const panels = Array.isArray(evidence.panels) ? evidence.panels.map(asRecord) : [];
  const panelCount = typeof evidence.panelCount === "number" ? evidence.panelCount : panels.length;

  return panelCount >= 3
    && panels.length >= 3
    && panels.every((panel) => typeof panel.name === "string"
      && typeof panel.lineCount === "number"
      && panel.lineCount > 0
      && panel.readabilityClaim === "metadata_only_requires_foreground_headset_confirmation");
}

function hasInputEvidenceShape(value: unknown): boolean {
  const evidence = asRecord(value);
  return typeof evidence.activeLocomotionSource === "string"
    && typeof evidence.inputSourceCount === "number"
    && Array.isArray(evidence.inputSourceKinds)
    && isRecord(evidence.keyboardVector)
    && isRecord(evidence.xrVector);
}

function hasFrameQualityEvidence(value: unknown): boolean {
  const evidence = asRecord(value);
  const latestFrameDeltaKnown = typeof evidence.latestFrameDeltaMs === "number" || evidence.latestFrameDeltaMs === null;
  const longFrameRatioKnown = typeof evidence.longFrameRatio === "number" || evidence.longFrameRatio === null;
  return typeof evidence.qualitySource === "string"
    && typeof evidence.renderLoopMode === "string"
    && latestFrameDeltaKnown
    && longFrameRatioKnown;
}

function isQuestAdbDeviceLine(value: unknown): boolean {
  return typeof value === "string" && /\b(?:model:Quest_3|product:eureka|device:eureka|product:quest3|Quest_3|Quest 3)\b/i.test(value);
}

function isQuestBrowserUserAgent(value: unknown): boolean {
  return typeof value === "string" && /\b(?:Quest|OculusBrowser|VR)\b/.test(value);
}

function inferImmersiveEntryOutcomeFromReport(
  report: QuestSmokeReport,
  rawBlockers: string[],
): QuestImmersiveEntryOutcome {
  if (report.verdict?.immersiveEntryOutcome) {
    return report.verdict.immersiveEntryOutcome;
  }
  if (!report.immersive) {
    return "not_requested";
  }

  if (rawBlockers.includes("quest_immersive_entry_activation_not_received")) {
    return "activation_missed";
  }
  if (rawBlockers.includes("quest_immersive_session_not_started")) {
    return "app_request_failed";
  }

  const browser = asRecord(report.browser);
  const immersive = asRecord(report.immersive);
  if (immersive.immersiveSessionStarted === true || browser.xrStatus === "In Full VR") {
    return "session_started";
  }
  return "not_requested";
}

function classifyImmersiveEntryOutcome(
  enterVrRequested: boolean,
  browser: Record<string, unknown>,
  immersive: Record<string, unknown>,
  manualDraftStation: Record<string, unknown>,
  immersiveXrEntryEvidence: Record<string, unknown>,
  browserXrEntryEvidence: Record<string, unknown>,
): QuestImmersiveEntryOutcome {
  if (!enterVrRequested) {
    return "not_requested";
  }

  const immersiveSessionStarted = immersive.immersiveSessionStarted === true
    || browser.xrStatus === "In Full VR"
    || manualDraftStation.immersiveSessionStarted === true
    || immersiveXrEntryEvidence.lastStatus === "started"
    || browserXrEntryEvidence.lastStatus === "started";
  if (immersiveSessionStarted) {
    return "session_started";
  }

  const attempts = immersiveXrEntryEvidence.attempts ?? browserXrEntryEvidence.attempts;
  const appSawEntryAttempt = (typeof attempts === "number" && attempts > 0)
    || (typeof immersiveXrEntryEvidence.lastStatus === "string"
      && immersiveXrEntryEvidence.lastStatus !== "not_requested")
    || (typeof browserXrEntryEvidence.lastStatus === "string"
      && browserXrEntryEvidence.lastStatus !== "not_requested");

  return appSawEntryAttempt ? "app_request_failed" : "activation_missed";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const baseMessage = `${error.name}: ${error.message}`;
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: unknown }).code;
      const codeSuffix = typeof code === "string" && code.trim().length > 0 ? ` (${code})` : "";
      return `${baseMessage}; cause=${cause.name}: ${cause.message}${codeSuffix}`;
    }
    if (cause !== undefined) {
      return `${baseMessage}; cause=${String(cause)}`;
    }
    return baseMessage;
  }
  return String(error);
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

  async bringToFront(): Promise<void> {
    await this.send("Page.bringToFront");
  }

  async dispatchMouseClick(x: number, y: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });
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
