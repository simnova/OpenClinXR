import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateIwsdkSidecarIwerInputProbeEvidence,
  iwsdkSidecarControllerSelectTraceTag,
} from "../../../apps/arena/ui-xr-iwsdk-spike/src/sidecar-state.js";
import { globFiles } from "../../agent-factory/lib.js";

type CliOptions = {
  inputPath?: string;
  outputPath?: string;
  validateLatest: boolean;
};

export type IwerControllerInputProbeEvidence = {
  schemaVersion?: string;
  generatedAt?: string;
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
  };
  probe: {
    source?: string;
    sessionActive?: boolean;
    sessionMode?: string | null;
    attemptedToolNames?: string[];
    successfulToolNames?: string[];
    observedTraceActionTags?: string[];
    controllerSelectTraceTag?: string;
    consoleErrorCount?: number;
    readyForInputEmulationEvidence?: boolean;
    readyForProductionRuntime?: boolean;
    readyForPhysicalQuestClaim?: boolean;
    blockers?: string[];
  };
};

export type IwerControllerInputProbeReadiness = {
  readyForInputEmulationEvidence: boolean;
  readyForProductionRuntime: false;
  readyForPhysicalQuestClaim: false;
  blockers: string[];
  satisfiedConditions: string[];
};

export type IwerControllerInputProbeReport = {
  generatedAt: string;
  inputFile?: string;
  evidence: IwerControllerInputProbeEvidence;
  result: IwerControllerInputProbeReadiness;
};

const requiredNotEvidenceFor = [
  "physical_quest_controller_latency",
  "physical_quest_hand_tracking_quality",
  "physical_quest_foreground_frame_pacing",
  "in_headset_text_readability",
  "production_runtime_readiness",
];

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validateLatest) {
    const inputPath = await latestIwerControllerInputProbePath();
    if (!inputPath) {
      throw new Error("Missing IWER controller/input probe evidence to validate.");
    }
    const report = await readIwerControllerInputProbeReport(inputPath);
    if (report.result.readyForInputEmulationEvidence) {
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

  const report = await readIwerControllerInputProbeReport(options.inputPath);
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (!report.result.readyForInputEmulationEvidence) {
    process.exitCode = 1;
  }
}

async function readIwerControllerInputProbeReport(inputPath: string): Promise<IwerControllerInputProbeReport> {
  const evidence = JSON.parse(await readFile(inputPath, "utf8")) as IwerControllerInputProbeEvidence;
  return buildIwerControllerInputProbeReport({
    inputFile: inputPath,
    evidence,
  });
}

async function latestIwerControllerInputProbePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/iwer-controller-input-probe-*.json");
  return files.sort().at(-1);
}

export function buildIwerControllerInputProbeReport(input: {
  generatedAt?: string;
  inputFile?: string;
  evidence: IwerControllerInputProbeEvidence;
}): IwerControllerInputProbeReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputFile: input.inputFile,
    evidence: input.evidence,
    result: evaluateIwerControllerInputProbeEvidence(input.evidence),
  };
}

export function evaluateIwerControllerInputProbeEvidence(
  evidence: IwerControllerInputProbeEvidence,
): IwerControllerInputProbeReadiness {
  const appReadiness = evaluateIwsdkSidecarIwerInputProbeEvidence({
    sessionActive: evidence.probe?.sessionActive,
    sessionMode: evidence.probe?.sessionMode,
    successfulToolNames: evidence.probe?.successfulToolNames,
    observedTraceActionTags: evidence.probe?.observedTraceActionTags,
    controllerSelectTraceTag: evidence.probe?.controllerSelectTraceTag,
    consoleErrorCount: evidence.probe?.consoleErrorCount,
  });
  const notEvidenceFor = evidence.classification?.notEvidenceFor ?? [];
  const probeBlockers = evidence.probe?.blockers ?? [];
  const blockerSet = new Set([
    ...schemaAndBoundaryBlockers(evidence),
    ...appReadiness.blockers,
    evidence.probe?.source === "iwer_mcp_emulation" ? undefined : "probe_source_not_iwer_mcp_emulation",
    evidence.probe?.readyForInputEmulationEvidence === appReadiness.readyForInputEmulationEvidence
      ? undefined
      : "ready_for_input_emulation_evidence_mismatch",
    evidence.probe?.readyForProductionRuntime === false ? undefined : "ready_for_production_runtime_must_be_false",
    evidence.probe?.readyForPhysicalQuestClaim === false ? undefined : "ready_for_physical_quest_claim_must_be_false",
    sameStringSet(probeBlockers, appReadiness.blockers) ? undefined : "probe_blockers_do_not_match_sidecar_evaluator",
    ...requiredNotEvidenceFor.map((claim) => (
      notEvidenceFor.includes(claim) ? undefined : `missing_not_evidence_for_${claim}`
    )),
  ].filter((blocker): blocker is string => typeof blocker === "string"));
  const blockers = [...blockerSet];

  return {
    readyForInputEmulationEvidence: blockers.length === 0,
    readyForProductionRuntime: false,
    readyForPhysicalQuestClaim: false,
    blockers,
    satisfiedConditions: satisfiedConditions(evidence, appReadiness.readyForInputEmulationEvidence, blockers),
  };
}

function schemaAndBoundaryBlockers(evidence: IwerControllerInputProbeEvidence): string[] {
  return [
    evidence.schemaVersion === "openclinxr.iwer-controller-input-probe.v1"
      ? undefined
      : "schema_version_not_iwer_controller_input_probe_v1",
    evidence.classification?.lane === "iwer_controller_input_probe"
      ? undefined
      : "classification_lane_not_iwer_controller_input_probe",
    evidence.classification?.scope === "sidecar_only_dev_evidence"
      ? undefined
      : "classification_scope_not_sidecar_only_dev_evidence",
    evidence.sidecar?.app === "apps/arena/ui-xr-iwsdk-spike" ? undefined : "sidecar_app_not_ui_xr_iwsdk_spike",
    isLocalHttpUrl(evidence.sidecar?.runtimeUrl) ? undefined : "runtime_url_not_localhost",
    isValidPort(evidence.sidecar?.devServerPort) ? undefined : "dev_server_port_invalid_or_missing",
    isLocalWebSocketUrl(evidence.sidecar?.mcpWebSocketEndpoint)
      ? undefined
      : "mcp_websocket_endpoint_not_localhost",
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function satisfiedConditions(
  evidence: IwerControllerInputProbeEvidence,
  appReady: boolean,
  blockers: string[],
): string[] {
  return [
    evidence.schemaVersion === "openclinxr.iwer-controller-input-probe.v1"
      ? "schema_version_iwer_controller_input_probe_v1"
      : undefined,
    evidence.classification?.lane === "iwer_controller_input_probe"
    && evidence.classification.scope === "sidecar_only_dev_evidence"
      ? "classification_sidecar_only"
      : undefined,
    isLocalHttpUrl(evidence.sidecar?.runtimeUrl) && isLocalWebSocketUrl(evidence.sidecar?.mcpWebSocketEndpoint)
      ? "sidecar_localhost_endpoint_recorded"
      : undefined,
    evidence.probe?.sessionActive === true && evidence.probe.sessionMode === "immersive-vr"
      ? "iwer_input_probe_emulated_session_active"
      : undefined,
    requiredToolsSucceeded(evidence.probe?.successfulToolNames)
      ? "iwer_input_probe_required_tools_succeeded"
      : undefined,
    evidence.probe?.observedTraceActionTags?.includes(
      evidence.probe.controllerSelectTraceTag ?? iwsdkSidecarControllerSelectTraceTag,
    ) === true
      ? "iwer_input_probe_controller_select_trace_observed"
      : undefined,
    appReady && blockers.length === 0 ? "iwer_input_probe_sidecar_evaluator_ready" : undefined,
    evidence.probe?.readyForProductionRuntime === false && evidence.probe.readyForPhysicalQuestClaim === false
      ? "safety_boundaries_preserved"
      : undefined,
  ].filter((condition): condition is string => typeof condition === "string");
}

function requiredToolsSucceeded(successfulToolNames: string[] | undefined): boolean {
  const names = successfulToolNames ?? [];
  return ["xr_set_input_mode", "xr_set_connected", "xr_set_gamepad_state", "xr_select"].every((tool) => (
    names.includes(tool)
  ));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function isLocalHttpUrl(value: string | undefined): boolean {
  return isLocalUrlWithProtocol(value, ["http:", "https:"]);
}

function isLocalWebSocketUrl(value: string | undefined): boolean {
  return isLocalUrlWithProtocol(value, ["ws:", "wss:"]);
}

function isLocalUrlWithProtocol(value: string | undefined, protocols: string[]): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return protocols.includes(parsed.protocol) && isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isValidPort(port: number | undefined): boolean {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
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
