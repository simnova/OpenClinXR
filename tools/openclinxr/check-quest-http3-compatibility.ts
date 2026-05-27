import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "tinyglobby";

type CliOptions = {
  inputPath?: string;
  outputPath: string;
};

export type QuestHttp3CompatibilityReport = {
  schemaVersion: "openclinxr.quest-http3-compatibility.v1" | string;
  generatedAt: string;
  runContext: {
    performedBy: string;
    durationMinutes: number;
    notes?: string;
  };
  localServer: {
    appPath: string;
    serverKind: "bun-hono-http3-spike" | string;
    bunVersion: string | null;
    honoVersion: string | null;
    h3Enabled: boolean;
    h3TrueEnabled: boolean;
    origin: string;
    tls: {
      secureContext: boolean;
      certificateTrust: "local_ca_trusted_on_quest" | "self_signed_untrusted" | "unknown" | "not_configured" | string;
      alpnProtocols: string[];
    };
  };
  questBrowser: {
    deviceModel: string;
    browserName: string;
    browserVersion: string | null;
    userAgent: string | null;
    foregroundPageConfirmed: boolean;
  };
  test: {
    physicalQuestUsed: boolean;
    cloudRelayUsed: boolean;
    paidApisUsed: boolean;
    url: string;
    navigationSucceeded: boolean;
    resourceTimingNextHopProtocol: string | null;
    serverReportedProtocol: string | null;
    webTransportApiPresent: boolean;
    webTransportSessionAttempted: boolean;
    webTransportSessionSucceeded: boolean | null;
    websocketFallbackUsed: boolean;
    mediaFramesSent: boolean;
  };
  notEvidenceFor: string[];
};

export type QuestHttp3CompatibilityCheck = {
  generatedAt: string;
  inputFile: string | null;
  readyToClaimQuestHttp3Reachability: boolean;
  readyToClaimWebTransportCompatibility: boolean;
  readyToClaimAzureIngress: false;
  readyToClaimClinicalMedia: false;
  satisfiedConditions: string[];
  http3Blockers: string[];
  webTransportBlockers: string[];
  notEvidenceFor: string[];
  nextSteps: string[];
};

const requiredNotEvidenceFor = [
  "azure_http3_ingress_readiness",
  "production_protocol_readiness",
  "clinical_media_transport_readiness",
  "low_latency_voice_readiness",
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = options.inputPath ?? await latestQuestHttp3CompatibilityReportPath();
  const report = inputPath ? await readJson<QuestHttp3CompatibilityReport>(inputPath) : undefined;
  const check = buildQuestHttp3CompatibilityCheck(inputPath, report);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(check, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${options.outputPath}; readyToClaimQuestHttp3Reachability=${check.readyToClaimQuestHttp3Reachability}`,
  );
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    outputPath: ".agent-factory/quest-http3-compatibility-check.json",
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--input") {
      options.inputPath = requireValue(normalizedArgs, index, arg);
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

async function latestQuestHttp3CompatibilityReportPath(): Promise<string | undefined> {
  const files = (await glob("docs/openclinxr/quest-http3-compatibility-*.json", { onlyFiles: true }))
    .filter((file) => !file.endsWith("quest-http3-compatibility-template.json"))
    .filter((file) => !path.basename(file).startsWith("quest-http3-compatibility-check-"))
    .sort();
  return files.at(-1);
}

async function readJson<TValue>(filePath: string): Promise<TValue> {
  return JSON.parse(await readFile(filePath, "utf8")) as TValue;
}

export function buildQuestHttp3CompatibilityCheck(
  inputFile: string | undefined,
  report: QuestHttp3CompatibilityReport | undefined,
): QuestHttp3CompatibilityCheck {
  if (!report) {
    return {
      generatedAt: new Date().toISOString(),
      inputFile: null,
      readyToClaimQuestHttp3Reachability: false,
      readyToClaimWebTransportCompatibility: false,
      readyToClaimAzureIngress: false,
      readyToClaimClinicalMedia: false,
      satisfiedConditions: [],
      http3Blockers: ["missing_quest_http3_compatibility_report"],
      webTransportBlockers: ["missing_quest_http3_compatibility_report"],
      notEvidenceFor: [...requiredNotEvidenceFor],
      nextSteps: ["Capture a real Quest Browser HTTP/3 compatibility report before changing protocol claims."],
    };
  }

  const http3ProtocolObserved = isHttp3Protocol(report.test.resourceTimingNextHopProtocol)
    || isHttp3Protocol(report.test.serverReportedProtocol);
  const httpsOrigin = report.localServer.origin.startsWith("https://") && report.test.url.startsWith("https://");
  const noCloudOrPaidPath = report.test.cloudRelayUsed === false && report.test.paidApisUsed === false;
  const http3Blockers = unique([
    report.schemaVersion === "openclinxr.quest-http3-compatibility.v1" ? undefined : "schema_version_invalid",
    isValidIsoDate(report.generatedAt) ? undefined : "generated_at_invalid_or_missing",
    report.runContext.performedBy.trim().length > 0 ? undefined : "performed_by_missing",
    report.runContext.durationMinutes >= 10 ? undefined : "duration_under_10_minutes",
    report.localServer.appPath === "apps/api" ? undefined : "app_path_not_apps_api",
    report.localServer.serverKind === "bun-hono-http3-spike" ? undefined : "server_kind_not_bun_hono_http3_spike",
    hasValue(report.localServer.bunVersion) ? undefined : "bun_version_missing",
    hasValue(report.localServer.honoVersion) ? undefined : "hono_version_missing",
    report.localServer.h3Enabled ? undefined : "h3_not_enabled",
    report.localServer.h3TrueEnabled ? undefined : "h3_true_not_enabled",
    httpsOrigin ? undefined : "https_origin_missing",
    report.localServer.tls.secureContext ? undefined : "secure_context_missing",
    report.localServer.tls.certificateTrust === "local_ca_trusted_on_quest"
      ? undefined
      : "local_ca_not_trusted_on_quest",
    report.localServer.tls.alpnProtocols.some(isHttp3Protocol) ? undefined : "h3_alpn_not_recorded",
    report.questBrowser.deviceModel.toLowerCase().includes("quest 3") ? undefined : "quest_3_device_not_recorded",
    report.questBrowser.browserName.toLowerCase().includes("quest") ? undefined : "quest_browser_name_not_recorded",
    hasValue(report.questBrowser.browserVersion) ? undefined : "quest_browser_version_missing",
    report.questBrowser.foregroundPageConfirmed ? undefined : "quest_browser_foreground_not_confirmed",
    report.test.physicalQuestUsed ? undefined : "physical_quest_not_used",
    report.test.cloudRelayUsed ? "cloud_relay_used" : undefined,
    report.test.paidApisUsed ? "paid_api_used" : undefined,
    report.test.navigationSucceeded ? undefined : "navigation_not_successful",
    http3ProtocolObserved ? undefined : "http3_protocol_not_observed",
    report.test.websocketFallbackUsed ? "websocket_fallback_used" : undefined,
    report.test.mediaFramesSent ? "media_frames_sent_outside_compatibility_scope" : undefined,
    ...requiredNotEvidenceFor.map((value) => report.notEvidenceFor.includes(value) ? undefined : `not_evidence_for_missing:${value}`),
  ]);
  const webTransportBlockers = unique([
    report.test.webTransportApiPresent ? undefined : "webtransport_api_missing",
    report.test.webTransportSessionAttempted ? undefined : "webtransport_session_not_attempted",
    report.test.webTransportSessionSucceeded === true ? undefined : "webtransport_session_not_succeeded",
  ]);
  const readyToClaimQuestHttp3Reachability = http3Blockers.length === 0;
  const readyToClaimWebTransportCompatibility = readyToClaimQuestHttp3Reachability && webTransportBlockers.length === 0;
  const satisfiedConditions = [
    report.schemaVersion === "openclinxr.quest-http3-compatibility.v1" ? "schema_version_valid" : undefined,
    isValidIsoDate(report.generatedAt) ? "generated_at_valid" : undefined,
    report.runContext.performedBy.trim().length > 0 ? "performed_by_recorded" : undefined,
    report.runContext.durationMinutes >= 10 ? "duration_10_minutes_or_more" : undefined,
    report.localServer.appPath === "apps/api" ? "apps_api_server_recorded" : undefined,
    report.localServer.serverKind === "bun-hono-http3-spike" ? "bun_hono_http3_spike_recorded" : undefined,
    hasValue(report.localServer.bunVersion) ? "bun_version_recorded" : undefined,
    hasValue(report.localServer.honoVersion) ? "hono_version_recorded" : undefined,
    report.localServer.h3Enabled ? "h3_enabled" : undefined,
    report.localServer.h3TrueEnabled ? "h3_true_enabled" : undefined,
    httpsOrigin ? "https_origin_recorded" : undefined,
    report.localServer.tls.secureContext ? "secure_context_recorded" : undefined,
    report.localServer.tls.certificateTrust === "local_ca_trusted_on_quest" ? "local_ca_trusted_on_quest" : undefined,
    report.localServer.tls.alpnProtocols.some(isHttp3Protocol) ? "h3_alpn_recorded" : undefined,
    report.questBrowser.deviceModel.toLowerCase().includes("quest 3") ? "quest_3_device_recorded" : undefined,
    report.questBrowser.browserName.toLowerCase().includes("quest") ? "quest_browser_name_recorded" : undefined,
    hasValue(report.questBrowser.browserVersion) ? "quest_browser_version_recorded" : undefined,
    report.questBrowser.foregroundPageConfirmed ? "quest_browser_foreground_confirmed" : undefined,
    report.test.physicalQuestUsed ? "physical_quest_used" : undefined,
    noCloudOrPaidPath ? "no_cloud_or_paid_path" : undefined,
    report.test.navigationSucceeded ? "navigation_succeeded" : undefined,
    http3ProtocolObserved ? "http3_protocol_observed" : undefined,
    report.test.websocketFallbackUsed === false ? "websocket_fallback_not_used" : undefined,
    report.test.mediaFramesSent === false ? "media_frames_not_sent" : undefined,
    report.test.webTransportApiPresent ? "webtransport_api_present" : undefined,
    report.test.webTransportSessionAttempted ? "webtransport_session_attempted" : undefined,
    report.test.webTransportSessionSucceeded === true ? "webtransport_session_succeeded" : undefined,
  ].filter((condition): condition is string => typeof condition === "string");

  return {
    generatedAt: new Date().toISOString(),
    inputFile: inputFile ?? null,
    readyToClaimQuestHttp3Reachability,
    readyToClaimWebTransportCompatibility,
    readyToClaimAzureIngress: false,
    readyToClaimClinicalMedia: false,
    satisfiedConditions,
    http3Blockers,
    webTransportBlockers,
    notEvidenceFor: [...requiredNotEvidenceFor],
    nextSteps: unique([...http3Blockers, ...webTransportBlockers]).map(nextStepForBlocker),
  };
}

function nextStepForBlocker(blocker: string): string {
  const steps: Record<string, string> = {
    missing_quest_http3_compatibility_report: "Capture a real Quest Browser HTTP/3 compatibility report before changing protocol claims.",
    physical_quest_not_used: "Run the compatibility probe from the physical Quest 3 browser; desktop Chromium evidence is not enough.",
    h3_not_enabled: "Start a dedicated local Bun/Hono HTTP/3 spike server with HTTP/3 explicitly enabled.",
    h3_true_not_enabled: "Record Bun.serve({ h3: true }) or equivalent local HTTP/3 server configuration.",
    secure_context_missing: "Use a secure HTTPS origin trusted by the Quest Browser runtime.",
    local_ca_not_trusted_on_quest: "Install or otherwise validate a local development CA on the Quest before claiming browser reachability.",
    quest_browser_foreground_not_confirmed: "Confirm the Quest Browser page is foregrounded in the headset during the run.",
    navigation_not_successful: "Navigate the Quest Browser to the local HTTP/3 probe URL and record a successful load.",
    http3_protocol_not_observed: "Record Resource Timing or server-side protocol evidence showing h3, not h2 or http/1.1.",
    webtransport_session_not_attempted: "Attempt a local WebTransport session only after HTTP/3 reachability is proven.",
    webtransport_session_not_succeeded: "Record a successful local WebTransport session before making a WebTransport compatibility claim.",
    websocket_fallback_used: "Disable or label WebSocket fallback; fallback success is not HTTP/3 evidence.",
    cloud_relay_used: "Repeat the probe without a cloud relay.",
    paid_api_used: "Repeat the probe without paid API calls.",
  };
  return steps[blocker] ?? `Resolve blocker: ${blocker}`;
}

function isValidIsoDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttp3Protocol(value: string | null | undefined): boolean {
  return typeof value === "string" && /^h3(?:$|-)/i.test(value.trim());
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
