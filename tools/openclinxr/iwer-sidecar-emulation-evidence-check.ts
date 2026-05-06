import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildIwsdkMcpToolInventory } from "../../packages/openclinxr/iwsdk-spike/src/index.js";
import { globFiles } from "../agent-factory/lib.js";
import {
  evaluateAdversarialVisualQaEvidence,
  type AdversarialVisualQaEvidence,
} from "./adversarial-visual-qa-evidence.js";
import {
  inspectMediaArtifact,
  isAllowedRelativeArtifactPath,
} from "./media-artifact-integrity.js";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
  validateLatest: boolean;
};

type IwerEvidencePackage = {
  name?: string;
  version?: string;
  license?: string;
  dependencyPosture?: string;
};

type IwerEvidenceProbe = {
  id?: string;
  method?: string;
  elapsedMs?: number;
  ok?: boolean;
  blocker?: string;
  interpretation?: string;
  resultSummary?: Record<string, unknown>;
  artifact?: string;
  mimeType?: string;
  bytes?: number;
  dimensions?: {
    width?: number;
    height?: number;
  };
};

type IwerSessionStatusEvidence = {
  isRuntimeInstalled?: boolean;
  sessionOffered?: boolean;
  sessionActive?: boolean;
  sessionMode?: string | null;
  visibilityState?: string;
};

type IwerSessionEntryEvidence = {
  mode?: "immersive-vr";
  requestedBy?: "iwer_accept_session" | "dom_enter_full_vr_button";
  beforeStatus?: IwerSessionStatusEvidence;
  attempt?: {
    ok?: boolean;
    elapsedMs?: number;
    blocker?: string;
    errorName?: string;
    errorMessage?: string;
  };
  appEvidence?: {
    attempts?: number;
    lastStatus?: "not_requested" | "unsupported" | "requesting" | "started" | "ended" | "failed";
    lastOutcome?: "not_requested" | "unsupported" | "request_in_flight" | "session_started" | "session_ended" | "activation_required" | "request_failed";
    lastMode?: "immersive-vr";
    lastErrorName?: string;
    lastErrorMessage?: string;
  };
  afterStatus?: IwerSessionStatusEvidence;
  outcome?: "unsupported" | "no_activation" | "session_started" | "request_failed";
};

export type IwerSidecarEmulationEvidence = {
  schemaVersion?: string;
  proposal?: string;
  classification?: {
    lane?: string;
    scope?: string;
    notEvidenceFor?: string[];
  };
  sidecar?: {
    app?: string;
    runtimeUrl?: string;
    devServerPort?: number;
    mcpWebSocketEndpoint?: string;
    generatedLocalCodexConfigPolicy?: string;
  };
  packages?: IwerEvidencePackage[];
  vitePluginConfiguration?: {
    pluginName?: string;
    apply?: string;
    options?: {
      emulator?: {
        device?: string;
        injectOnBuild?: boolean;
      };
      ai?: {
        mode?: string;
        tools?: string[];
        screenshotSize?: {
          width?: number;
          height?: number;
        };
      };
    };
  };
  mcpToolInventory?: {
    count?: number;
    toolNames?: string[];
  };
  rawWebSocketProbes?: IwerEvidenceProbe[];
  sessionEntryEvidence?: IwerSessionEntryEvidence;
  productionBuildOutputInspection?: {
    buildExitCode?: number;
    distIndexHtmlContainsDevRuntimeInjection?: boolean;
    distSearchMatches?: unknown[];
  };
  adversarialVisualQa?: {
    artifact?: string;
    xrMode?: string;
    notes?: string[];
  };
  blockers?: string[];
};

export type IwerSidecarEmulationEvidenceReadiness = {
  readyForEmulationEvidence: boolean;
  readyForProductionRuntime: false;
  readyForPhysicalQuestClaim: false;
  blockers: string[];
};

export type IwerSidecarEmulationEvidenceReport = {
  generatedAt: string;
  inputFile?: string;
  evidence: IwerSidecarEmulationEvidence;
  result: IwerSidecarEmulationEvidenceReadiness;
};

const requiredNotEvidenceFor = [
  "physical_quest_foreground_frame_pacing",
  "quest_controller_latency",
  "quest_hand_tracking_quality",
  "quest_passthrough_privacy_or_safety",
  "in_headset_text_readability",
  "thermal_or_battery_behavior",
  "production_runtime_readiness",
];

const requiredPackages = [
  ["@iwsdk/vite-plugin-dev", "0.3.1"],
  ["iwer", "2.2.1"],
  ["@iwer/devui", "2.2.0"],
  ["@iwer/sem", "0.2.5"],
  ["sharp", "0.33.5"],
  ["@img/sharp-libvips-darwin-arm64", "1.0.4"],
  ["playwright", "1.59.1"],
  ["ws", "8.20.0"],
  ["vite", "8.0.10"],
] as const;

const knownBlockers = [
  "iwer_emulation_not_physical_quest_evidence",
  "session_acceptance_blocked_until_app_offers_xr_session",
  "input_mutation_blocked_without_active_xr_session",
  "scene_hierarchy_and_ecs_blocked_until_framework_mcp_runtime_exists",
  "vite_8_peer_mismatch_with_iwsdk_vite_plugin_dev_0_3_1",
  "iwsdk_vendor_chunk_exceeds_650kb_budget",
  "managed_chromium_first_run_downloaded_to_local_playwright_cache",
];

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest) {
    const inputPath = await latestIwerSidecarEvidencePath();
    if (!inputPath) {
      throw new Error("Missing IWER sidecar emulation evidence to validate.");
    }
    const report = await readIwerSidecarReport(inputPath);
    if (report.result.readyForEmulationEvidence) {
      console.log(`Validated ${inputPath}`);
      return;
    }

    for (const blocker of report.result.blockers) {
      console.error(blocker);
    }
    process.exitCode = 1;
    return;
  }

  if (!options.inputPath) {
    throw new Error("--input is required");
  }

  const report = await readIwerSidecarReport(options.inputPath);
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.readyForEmulationEvidence) {
    process.exitCode = 1;
  }
}

async function readIwerSidecarReport(inputPath: string): Promise<IwerSidecarEmulationEvidenceReport> {
  const evidence = JSON.parse(await readFile(inputPath, "utf8")) as IwerSidecarEmulationEvidence;
  return buildIwerSidecarEmulationEvidenceReport({
    inputFile: inputPath,
    evidence,
  });
}

async function latestIwerSidecarEvidencePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/iwer-sidecar-emulation-evidence-*.json");
  return files.sort().at(-1);
}

export function buildIwerSidecarEmulationEvidenceReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: IwerSidecarEmulationEvidence;
}): IwerSidecarEmulationEvidenceReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateIwerSidecarEmulationEvidence(input.evidence),
  };
}

export function evaluateIwerSidecarEmulationEvidence(
  evidence: IwerSidecarEmulationEvidence,
): IwerSidecarEmulationEvidenceReadiness {
  const notEvidenceFor = evidence.classification?.notEvidenceFor ?? [];
  const toolNames = evidence.mcpToolInventory?.toolNames ?? [];
  const expectedToolNames = buildIwsdkMcpToolInventory().allToolNames;
  const screenshotProbe = evidence.rawWebSocketProbes?.find((probe) => probe.method === "screenshot");
  const screenshotArtifactIntegrity = inspectMediaArtifact(screenshotProbe?.artifact);
  const screenshotFileSize = screenshotArtifactIntegrity.size;
  const screenshotPngDimensions = screenshotArtifactIntegrity.pngDimensions;
  const blockers = [
    evidence.schemaVersion === "openclinxr.iwer-sidecar-emulation-evidence.v1"
      ? undefined
      : "schema_version_not_iwer_sidecar_emulation_v1",
    evidence.proposal === "proposals/approved/proposal-iwer-sidecar-emulation-spike.md"
      ? undefined
      : "approved_iwer_proposal_not_recorded",
    evidence.classification?.lane === "iwer_managed_browser_emulation" ? undefined : "classification_lane_not_iwer_emulation",
    evidence.classification?.scope === "sidecar_only_dev_evidence" ? undefined : "classification_scope_not_sidecar_dev_evidence",
    ...requiredNotEvidenceFor.map((claim) => (
      notEvidenceFor.includes(claim) ? undefined : `missing_not_evidence_for_${claim}`
    )),
    evidence.sidecar?.app === "apps/ui-xr-iwsdk-spike" ? undefined : "sidecar_app_not_recorded",
    isLocalHttpUrl(evidence.sidecar?.runtimeUrl) ? undefined : "runtime_url_not_localhost",
    isValidPort(evidence.sidecar?.devServerPort) ? undefined : "dev_server_port_invalid_or_missing",
    isLocalWebSocketUrl(evidence.sidecar?.mcpWebSocketEndpoint) ? undefined : "mcp_websocket_endpoint_not_localhost",
    evidence.sidecar?.generatedLocalCodexConfigPolicy === "ignored_by_git_and_not_committed"
      ? undefined
      : "generated_codex_config_not_marked_uncommitted",
    ...requiredPackages.map(([name, version]) => (
      packageHas(evidence, name, version) ? undefined : `missing_package_${name}_${version}`
    )),
    packagePostureContains(evidence, "sharp", "approved_libvips_exception") ? undefined : "sharp_libvips_exception_not_recorded",
    evidence.vitePluginConfiguration?.pluginName === "iwsdk-dev" ? undefined : "vite_plugin_name_not_iwsdk_dev",
    evidence.vitePluginConfiguration?.apply === "serve" ? undefined : "vite_plugin_not_serve_only",
    evidence.vitePluginConfiguration?.options?.emulator?.device === "metaQuest3" ? undefined : "emulator_device_not_meta_quest_3",
    evidence.vitePluginConfiguration?.options?.emulator?.injectOnBuild === false ? undefined : "inject_on_build_not_false",
    evidence.vitePluginConfiguration?.options?.ai?.mode === "agent" ? undefined : "ai_mode_not_agent",
    JSON.stringify(evidence.vitePluginConfiguration?.options?.ai?.tools ?? []) === JSON.stringify(["codex"])
      ? undefined
      : "ai_tools_not_exactly_codex",
    evidence.vitePluginConfiguration?.options?.ai?.screenshotSize?.width === 500
      && evidence.vitePluginConfiguration.options.ai.screenshotSize.height === 500
      ? undefined
      : "screenshot_size_not_bounded_500",
    evidence.mcpToolInventory?.count === 32 ? undefined : "mcp_tool_inventory_count_not_32",
    sameStringSet(toolNames, expectedToolNames) ? undefined : "mcp_tool_inventory_names_do_not_match_contract",
    probeSucceeded(evidence, "get_session_status") ? undefined : "get_session_status_probe_not_successful",
    probeSucceeded(evidence, "screenshot") ? undefined : "screenshot_probe_not_successful",
    screenshotProbe?.mimeType === "image/png" ? undefined : "screenshot_probe_mime_type_not_png",
    typeof screenshotProbe?.bytes === "number" && screenshotProbe.bytes > 0 ? undefined : "screenshot_probe_has_no_bytes",
    typeof screenshotProbe?.bytes === "number"
      && screenshotFileSize !== undefined
      && screenshotProbe.bytes !== screenshotFileSize
      ? "screenshot_probe_bytes_do_not_match_file_size"
      : undefined,
    screenshotProbe?.dimensions?.width === 500 && screenshotProbe.dimensions.height === 500
      ? undefined
      : "screenshot_probe_dimensions_not_500",
    screenshotProbe?.mimeType === "image/png" && screenshotArtifactIntegrity.exists && !screenshotPngDimensions
      ? "screenshot_probe_png_signature_invalid"
      : undefined,
    screenshotProbe?.mimeType === "image/png"
      && screenshotPngDimensions
      && (
        screenshotProbe.dimensions?.width !== screenshotPngDimensions.width
        || screenshotProbe.dimensions.height !== screenshotPngDimensions.height
      )
      ? "screenshot_probe_dimensions_do_not_match_png_header"
      : undefined,
    screenshotArtifactIntegrity.exists ? undefined : "screenshot_probe_artifact_file_missing",
    screenshotFileSize === undefined || screenshotFileSize > 0 ? undefined : "screenshot_probe_artifact_file_empty",
    isAllowedRelativeArtifactPath(screenshotProbe?.artifact, "docs/openclinxr/screenshots/")
      ? undefined
      : "screenshot_artifact_not_under_docs_openclinxr_screenshots",
    ...iwerSessionEntryBlockers(evidence.sessionEntryEvidence),
    evidence.productionBuildOutputInspection?.buildExitCode === 0 ? undefined : "production_build_not_successful",
    evidence.productionBuildOutputInspection?.distIndexHtmlContainsDevRuntimeInjection === false
      ? undefined
      : "production_build_contains_dev_runtime_injection",
    Array.isArray(evidence.productionBuildOutputInspection?.distSearchMatches)
      && evidence.productionBuildOutputInspection?.distSearchMatches.length === 0
      ? undefined
      : "production_dist_dev_runtime_matches_present",
    ...iwerVisualQaBlockers(evidence),
    ...knownBlockers.map((blocker) => (
      evidence.blockers?.includes(blocker) ? undefined : `known_blocker_missing_${blocker}`
    )),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    readyForEmulationEvidence: blockers.length === 0,
    readyForProductionRuntime: false,
    readyForPhysicalQuestClaim: false,
    blockers,
  };
}

function iwerVisualQaBlockers(evidence: IwerSidecarEmulationEvidence): string[] {
  const screenshotProbe = evidence.rawWebSocketProbes?.find((probe) => probe.method === "screenshot");
  const visualEvidence = buildIwerVisualQaEvidence(evidence, screenshotProbe);
  return evaluateAdversarialVisualQaEvidence(visualEvidence).blockers.map((blocker) => `visual_qa:${blocker}`);
}

function buildIwerVisualQaEvidence(
  evidence: IwerSidecarEmulationEvidence,
  screenshotProbe: IwerEvidenceProbe | undefined,
): AdversarialVisualQaEvidence {
  const notes = evidence.adversarialVisualQa?.notes ?? [];
  const evidenceLimitNotes = [
    ...notes,
    "This is IWER emulation only for adversarial visual iteration.",
    "This is not physical Quest, not a headset readability pass, and not production runtime readiness proof.",
    "Manual headset validation is required before physical Quest readiness claims.",
  ];

  return {
    schemaVersion: "openclinxr.adversarial-visual-qa-evidence.v1",
    media: [{
      source: "iwer_emulation",
      artifactType: "screenshot",
      artifact: evidence.adversarialVisualQa?.artifact ?? screenshotProbe?.artifact,
      mimeType: screenshotProbe?.mimeType,
      bytes: screenshotProbe?.bytes,
      dimensions: screenshotProbe?.dimensions,
      runtimeUrl: evidence.sidecar?.runtimeUrl,
      route: "/",
      scenarioId: "ed_chest_pain_priority_v1",
      xrMode: evidence.adversarialVisualQa?.xrMode,
      captureCommand: "pnpm iwsdk:iwer:evidence",
    }],
    notes: evidenceLimitNotes,
    notEvidenceFor: [
      "physical_quest_foreground_frame_pacing",
      "quest_controller_latency",
      "quest_hand_tracking_quality",
      "in_headset_text_readability",
      "thermal_or_battery_behavior",
      "production_runtime_readiness",
    ],
    allowedClaims: ["adversarial_visual_iteration_artifact"],
  };
}

function iwerSessionEntryBlockers(entry: IwerSessionEntryEvidence | undefined): string[] {
  if (!entry) {
    return ["session_entry_evidence_missing"];
  }

  return [
    entry.mode === "immersive-vr" ? undefined : "session_entry_mode_not_immersive_vr",
    entry.requestedBy === "iwer_accept_session" || entry.requestedBy === "dom_enter_full_vr_button"
      ? undefined
      : "session_entry_requested_by_invalid_or_missing",
    entry.attempt ? undefined : "session_entry_attempt_missing",
    isIwerSessionEntryOutcome(entry.outcome) ? undefined : "session_entry_outcome_invalid_or_missing",
    ...iwerSessionEntryOutcomeBlockers(entry),
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function iwerSessionEntryOutcomeBlockers(entry: IwerSessionEntryEvidence): string[] {
  if (entry.outcome === "no_activation") {
    return [
      entry.attempt?.ok === false ? undefined : "session_entry_no_activation_attempt_not_failed",
      entry.attempt?.blocker === "no_session_has_been_offered"
        ? undefined
        : "session_entry_no_activation_without_session_not_offered_blocker",
      entry.beforeStatus?.sessionOffered === false || entry.afterStatus?.sessionOffered === false
        ? undefined
        : "session_entry_no_activation_without_unoffered_status",
    ].filter((blocker): blocker is string => typeof blocker === "string");
  }

  if (entry.outcome === "session_started") {
    return [
      entry.attempt?.ok === true ? undefined : "session_entry_session_started_without_successful_attempt",
      entry.afterStatus?.sessionActive === true ? undefined : "session_entry_session_started_without_active_after_status",
      entry.appEvidence?.lastStatus === "started" ? undefined : "session_entry_session_started_without_app_started",
      (entry.appEvidence?.attempts ?? 0) > 0 ? undefined : "session_entry_session_started_without_app_attempt",
    ].filter((blocker): blocker is string => typeof blocker === "string");
  }

  if (entry.outcome === "request_failed") {
    return [
      entry.attempt?.ok === false ? undefined : "session_entry_request_failed_attempt_not_failed",
      (entry.appEvidence?.attempts ?? 0) > 0 ? undefined : "session_entry_request_failed_without_app_attempt",
      entry.appEvidence?.lastStatus === "failed" ? undefined : "session_entry_request_failed_without_app_failed",
      entry.attempt?.errorName || entry.attempt?.errorMessage || entry.appEvidence?.lastErrorName || entry.appEvidence?.lastErrorMessage
        ? undefined
        : "session_entry_request_failed_without_error_metadata",
    ].filter((blocker): blocker is string => typeof blocker === "string");
  }

  if (entry.outcome === "unsupported") {
    return [
      entry.appEvidence?.lastStatus === "unsupported" || entry.attempt?.blocker === "webxr_unsupported"
        ? undefined
        : "session_entry_unsupported_without_support_evidence",
    ].filter((blocker): blocker is string => typeof blocker === "string");
  }

  return [];
}

function isIwerSessionEntryOutcome(value: string | undefined): value is NonNullable<IwerSessionEntryEvidence["outcome"]> {
  return value === "unsupported" || value === "no_activation" || value === "session_started" || value === "request_failed";
}

function packageHas(evidence: IwerSidecarEmulationEvidence, name: string, version: string): boolean {
  return evidence.packages?.some((pkg) => pkg.name === name && pkg.version === version) ?? false;
}

function packagePostureContains(evidence: IwerSidecarEmulationEvidence, name: string, text: string): boolean {
  return evidence.packages?.some((pkg) => pkg.name === name && pkg.dependencyPosture?.includes(text)) ?? false;
}

function probeSucceeded(evidence: IwerSidecarEmulationEvidence, method: string): boolean {
  return evidence.rawWebSocketProbes?.some((probe) => probe.method === method && probe.ok === true) ?? false;
}

function isValidPort(port: number | undefined): boolean {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

function isLocalHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalWebSocketUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return ["ws:", "wss:"].includes(url.protocol) && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function sameStringSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length
    && expected.every((value) => actual.includes(value))
    && actual.every((value) => expected.includes(value));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
