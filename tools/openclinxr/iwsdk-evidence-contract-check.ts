import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "tinyglobby";
import {
  buildIwsdkCompatibilityContract,
  buildIwsdkCoreRequiredTransitivePackageNames,
  buildIwsdkCoreTransitivePackageLicenseEvidence,
  buildIwsdkMcpToolInventory,
  buildIwsdkOperatorApprovalContract,
  buildIwsdkOperatorSteeringBlockers,
  buildIwsdkPackageMetadataDriftPolicies,
  buildIwsdkPreInstallPackagePolicy,
  buildIwsdkSidecarReadinessContract,
  buildIwsdkUiXrStationParityContract,
  buildIwsdkVerificationToolSelectionContract,
  buildIwsdkViteAiDevConfigContract,
  evaluateIwsdkAgentToolingEvidence,
  evaluateIwsdkAgentToolingLocalPreflightEvidence,
  evaluateIwsdkCompatibilityEvidence,
  evaluateIwsdkPackageMetadataDriftEvidence,
  evaluateIwsdkPreInstallPackageSelection,
  evaluateIwsdkSpikeMetrics,
  type IwsdkAgentToolingEvidence,
  type IwsdkAgentToolingEvidenceReadiness,
  type IwsdkAgentToolingLocalPreflightReadiness,
  type IwsdkCompatibilityContract,
  type IwsdkCompatibilityEvidence,
  type IwsdkCompatibilityReadiness,
  type IwsdkMcpToolCategory,
  type IwsdkOperatorApprovalContract,
  type IwsdkOperatorSteeringBlocker,
  type IwsdkPackageMetadataDriftEvidence,
  type IwsdkPackageMetadataDriftPolicy,
  type IwsdkPackageMetadataDriftReadiness,
  type IwsdkPreInstallPackagePolicy,
  type IwsdkPreInstallPackageSelectionResult,
  type IwsdkSidecarReadinessContract,
  type IwsdkSpikeMetricReadiness,
  type IwsdkSpikeMetrics,
  type IwsdkUiXrStationParityContract,
  type IwsdkVerificationToolSelectionContract,
  type IwsdkViteAiDevConfigContract,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";
import type { IwerSidecarEmulationEvidence } from "./iwer-sidecar-emulation-evidence-check.js";
import type { IwsdkMcpInventoryEvidenceReport } from "./iwsdk-mcp-inventory-evidence.js";

type CliOptions = {
  outputPath?: string;
  validateLatestPattern?: string;
  agentToolingInputPath?: string;
  mcpInventoryInputPath?: string;
  iwerSidecarInputPath?: string;
  compatibilityInputPath?: string;
  metadataDriftInputPath?: string;
  sidecarMetricsInputPath?: string;
};

export type IwsdkEvidenceContractReport = {
  generatedAt: string;
  status: "phase_1_install_backed_sidecar";
  sidecar: IwsdkSidecarReadinessContract;
  preinstall: {
    policy: IwsdkPreInstallPackagePolicy;
    defaultFirstSliceReady: boolean;
    result: IwsdkPreInstallPackageSelectionResult;
  };
  viteAiDevConfig: IwsdkViteAiDevConfigContract;
  compatibility: {
    contract: IwsdkCompatibilityContract;
    currentKnownEvidence: IwsdkCompatibilityEvidence;
    result: IwsdkCompatibilityReadiness;
  };
  metadataDrift: {
    policies: IwsdkPackageMetadataDriftPolicy[];
    result: IwsdkPackageMetadataDriftReadiness;
  };
  uiXrParity: IwsdkUiXrStationParityContract;
  toolSelection: IwsdkVerificationToolSelectionContract;
  operatorApprovals: IwsdkOperatorApprovalContract;
  operatorSteeringBlockers: IwsdkOperatorSteeringBlocker[];
  agentTooling: IwsdkAgentToolingEvidenceReadiness;
  agentToolingLocalPreflight: IwsdkAgentToolingLocalPreflightReadiness;
  productionRuntime: IwsdkSpikeMetricReadiness;
  verdict: {
    readyForInstallBackedSidecar: boolean;
    readyForAgentTooling: boolean;
    readyForProductionRuntime: boolean;
    blockers: string[];
  };
};

export type IwsdkEvidenceContractValidationResult = { ok: true } | { ok: false; errors: string[] };

const defaultValidateLatestPattern = "docs/openclinxr/iwsdk-evidence-contract-*.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.validateLatestPattern) {
    await validateLatestReportFile(options.validateLatestPattern);
    return;
  }

  const mcpInventoryEvidence = await readJsonFile<IwsdkMcpInventoryEvidenceReport>(options.mcpInventoryInputPath);
  const iwerSidecarEvidence = await readJsonFile<IwerSidecarEmulationEvidence>(options.iwerSidecarInputPath);
  const report = buildIwsdkEvidenceContractReport({
    agentToolingEvidence: await readJsonFile<IwsdkAgentToolingEvidence>(options.agentToolingInputPath)
      ?? (iwerSidecarEvidence ? mapIwerSidecarEvidenceToIwsdkAgentToolingEvidence(iwerSidecarEvidence) : undefined)
      ?? mcpInventoryEvidence?.agentToolingEvidence,
    iwerSidecarEvidence,
    compatibilityEvidence: await readJsonFile<IwsdkCompatibilityEvidence>(options.compatibilityInputPath),
    metadataDriftEvidence: await readJsonFile<IwsdkPackageMetadataDriftEvidence>(options.metadataDriftInputPath),
    sidecarMetrics: await readJsonFile<IwsdkSpikeMetrics>(options.sidecarMetricsInputPath),
  });
  const payload = `${JSON.stringify(report, null, 2)}\n`;

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, payload, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  } else {
    console.log(payload.trimEnd());
  }

  if (report.verdict.blockers.length > 0) {
    process.exitCode = 1;
  }
}

async function validateLatestReportFile(pattern: string): Promise<void> {
  const files = (await glob(pattern, { onlyFiles: true })).sort();
  const latestFile = files.at(-1);
  if (!latestFile) {
    throw new Error(`No IWSDK evidence contract snapshots matched ${pattern}`);
  }

  const value = JSON.parse(await readFile(latestFile, "utf8")) as unknown;
  const validation = validateIwsdkEvidenceContractReport(value);
  if (!validation.ok) {
    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${latestFile}`);
}

export function buildIwsdkEvidenceContractReport(input: {
  generatedAt?: string;
  agentToolingEvidence?: IwsdkAgentToolingEvidence;
  iwerSidecarEvidence?: IwerSidecarEmulationEvidence;
  compatibilityEvidence?: IwsdkCompatibilityEvidence;
  metadataDriftEvidence?: IwsdkPackageMetadataDriftEvidence;
  sidecarMetrics?: IwsdkSpikeMetrics;
} = {}): IwsdkEvidenceContractReport {
  const sidecar = buildIwsdkSidecarReadinessContract();
  const preinstallPolicy = buildIwsdkPreInstallPackagePolicy();
  const preinstallResult = evaluateIwsdkPreInstallPackageSelection([
    {
      name: "@iwsdk/core",
      version: "0.3.1",
      license: "MIT",
      transitivePackages: buildIwsdkCoreRequiredTransitivePackageNames(),
      transitivePackageLicenses: buildIwsdkCoreTransitivePackageLicenseEvidence(),
    },
    { name: "@iwsdk/xr-input", version: "0.3.1", license: "MIT", transitivePackages: [] },
  ], preinstallPolicy);
  const agentToolingEvidence = input.agentToolingEvidence
    ?? (input.iwerSidecarEvidence ? mapIwerSidecarEvidenceToIwsdkAgentToolingEvidence(input.iwerSidecarEvidence) : undefined)
    ?? {
    phase2DevtoolsConfiguredInSidecar: false,
    adapterSyncRecorded: false,
    toolCount: 0,
    coveredCategories: [],
    validatedSmokeTools: [],
    optionalServerActions: [],
  };
  const agentTooling = evaluateIwsdkAgentToolingEvidence(agentToolingEvidence);
  const agentToolingLocalPreflight = evaluateIwsdkAgentToolingLocalPreflightEvidence(agentToolingEvidence);
  const compatibilityContract = buildIwsdkCompatibilityContract();
  const currentKnownCompatibilityEvidence: IwsdkCompatibilityEvidence = input.compatibilityEvidence ?? {
    openclinxrViteMajor: 8,
    iwsdkVitePluginPeerRange: "^7.0.0",
    nodeMajor: 22,
    nodeRuntimePath: "/Users/patrick/.nvm/versions/node/v22.19.0/bin/node",
    rolldownNativeBindingLoaded: true,
  };
  const compatibility = evaluateIwsdkCompatibilityEvidence(
    currentKnownCompatibilityEvidence,
    compatibilityContract,
  );
  const metadataDriftPolicies = buildIwsdkPackageMetadataDriftPolicies();
  const metadataDrift = evaluateIwsdkPackageMetadataDriftEvidence(input.metadataDriftEvidence ?? {
    packageName: "@iwsdk/reference",
    docsVersion: "0.3.1",
    npmLatestVersion: "0.3.2",
  });
  const toolSelection = buildIwsdkVerificationToolSelectionContract();
  const currentKnownSidecarMetrics: IwsdkSpikeMetrics = input.sidecarMetrics ?? {
    installedNodeModulesMb: 24,
    injectedDevRuntimeKb: 0,
    appJsBundleKb: 2511.19,
    bundleDeltaVsUiXrKb: 1895.52,
    baselineAppBundleSource: "apps/ui-xr-iwsdk-spike/dist/assets/*.js total minus apps/ui-xr/dist/assets/index-DWeRkXUD.js + apps/ui-xr/dist/assets/three-vendor-Csg9FCqN.js",
    smokePlanHash: "runtime-state:iwsdk-station-mcp-smoke-plan:v1",
    canvasNonblank: true,
    requiredSceneObjectNames: buildIwsdkUiXrStationParityContract().requiredSceneObjectNames,
    observedSceneObjectNames: buildIwsdkUiXrStationParityContract().requiredSceneObjectNames,
    controllerSelectTraceTag: "ecg_request",
    observedTraceActionTags: ["ecg_request"],
    foregroundQuestPreflightReady: true,
    avgFps: 15.4,
    p95FrameMs: 66.1,
    consoleErrorCount: 0,
  };
  const productionRuntime = evaluateIwsdkSpikeMetrics(currentKnownSidecarMetrics);
  const sidecarBlockers: string[] = [];
  const installBackedSidecarReady = sidecar.runnable && preinstallResult.readyToInstallInSidecar;
  const phase2McpReady = installBackedSidecarReady
    && compatibility.readyForPhase2AgentDevtools
    && agentTooling.readyForAgentTooling;
  const toolSelectionBlockers = selectUnresolvedToolSelectionBlockers(toolSelection.blockers, {
    phase2McpReady,
    productionRuntimeReady: productionRuntime.readyForProductionRuntime,
  });
  const blockers = unique([
    ...sidecarBlockers,
    ...preinstallResult.blockers.map((blocker) => `preinstall:${blocker}`),
    ...preinstallResult.reviewWarnings.map((blocker) => `preinstall_review:${blocker}`),
    ...compatibility.blockers.map((blocker) => `compatibility:${blocker}`),
    ...metadataDrift.blockers.map((blocker) => `metadata_drift:${blocker}`),
    ...agentTooling.blockers.map((blocker) => `agent_tooling:${blocker}`),
    ...toolSelectionBlockers,
    ...productionRuntime.blockers.map((blocker) => `production_runtime:${blocker}`),
  ]);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: "phase_1_install_backed_sidecar",
    sidecar,
    preinstall: {
      policy: preinstallPolicy,
      defaultFirstSliceReady: preinstallResult.readyToInstallInSidecar,
      result: preinstallResult,
    },
    viteAiDevConfig: buildIwsdkViteAiDevConfigContract(),
    compatibility: {
      contract: compatibilityContract,
      currentKnownEvidence: currentKnownCompatibilityEvidence,
      result: compatibility,
    },
    metadataDrift: {
      policies: metadataDriftPolicies,
      result: metadataDrift,
    },
    uiXrParity: buildIwsdkUiXrStationParityContract(),
    toolSelection,
    operatorApprovals: buildIwsdkOperatorApprovalContract(),
    operatorSteeringBlockers: buildIwsdkOperatorSteeringBlockers(),
    agentTooling,
    agentToolingLocalPreflight,
    productionRuntime,
    verdict: {
      readyForInstallBackedSidecar: installBackedSidecarReady,
      readyForAgentTooling: phase2McpReady,
      readyForProductionRuntime: productionRuntime.readyForProductionRuntime,
      blockers,
    },
  };
}

export function mapIwerSidecarEvidenceToIwsdkAgentToolingEvidence(
  evidence: IwerSidecarEmulationEvidence,
): IwsdkAgentToolingEvidence {
  const inventory = buildIwsdkMcpToolInventory();
  const observedToolNames = evidence.mcpToolInventory?.toolNames ?? [];
  const observedToolNameSet = new Set(observedToolNames);
  const coveredCategories = inventory.categories
    .filter((category) => category.tools.every((toolName) => observedToolNameSet.has(toolName)))
    .map((category) => category.category);
  const successfulTools = new Set((evidence.rawWebSocketProbes ?? [])
    .filter((probe) => probe.ok === true)
    .map((probe) => iwerProbeMethodToIwsdkToolName(probe.method))
    .filter((toolName): toolName is string => typeof toolName === "string"));
  const screenshotProbe = evidence.rawWebSocketProbes?.find((probe) => probe.method === "screenshot" && probe.ok === true);
  const mcpRuntimeRegistered = Boolean(
    evidence.sidecar?.mcpWebSocketEndpoint
      && (evidence.rawWebSocketProbes ?? []).some((probe) => probe.ok === true),
  );

  return {
    phase2DevtoolsConfiguredInSidecar: true,
    adapterSyncRecorded: false,
    toolCount: evidence.mcpToolInventory?.count ?? observedToolNames.length,
    coveredCategories: coveredCategories as IwsdkMcpToolCategory[],
    validatedSmokeTools: [...successfulTools].sort(),
    observedToolNames,
    managedBrowserEvidence: screenshotProbe
      ? {
        mode: "oversight",
        runtimeUrl: evidence.sidecar?.runtimeUrl,
        managedBrowserReady: true,
        managedSessionId: `iwer-managed-browser:${evidence.sidecar?.devServerPort ?? "unknown"}`,
        normalBrowserOpened: false,
        screenshotWidth: screenshotProbe.dimensions?.width,
        screenshotHeight: screenshotProbe.dimensions?.height,
        managedDevUiVisible: false,
      }
      : undefined,
    mcpRuntimeRegistered,
    sceneHierarchyContainsRequiredObjects: false,
    ecsRuntimeQueryable: false,
    optionalServerActions: [],
  };
}

function iwerProbeMethodToIwsdkToolName(method: string | undefined): string | undefined {
  switch (method) {
    case "get_session_status":
      return "xr_get_session_status";
    case "accept_session":
      return "xr_accept_session";
    case "screenshot":
      return "browser_screenshot";
    case "get_console_logs":
      return "browser_get_console_logs";
    case "get_scene_hierarchy":
      return "scene_get_hierarchy";
    case "select":
      return "xr_select";
    case "get_device_state":
      return "xr_get_device_state";
    case "set_input_mode":
      return "xr_set_input_mode";
    case "set_connected":
      return "xr_set_connected";
    default:
      return undefined;
  }
}

function selectUnresolvedToolSelectionBlockers(
  blockers: string[],
  readiness: {
    phase2McpReady: boolean;
    productionRuntimeReady: boolean;
  },
): string[] {
  return blockers.filter((blocker) => {
    if (blocker === "tool_selection:iwsdk_mcp_future_blocked_until_sidecar") {
      return !readiness.phase2McpReady;
    }
    if (blocker === "tool_selection:manual_quest_foreground_required_for_production_readiness") {
      return !readiness.productionRuntimeReady;
    }
    return true;
  });
}

export function validateIwsdkEvidenceContractReport(value: unknown): IwsdkEvidenceContractValidationResult {
  const errors: string[] = [];

  requireObject(value, "", errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  requireString(readAt(value, ["generatedAt"]), "/generatedAt", errors);
  requireLiteral(readAt(value, ["status"]), "phase_1_install_backed_sidecar", "/status", errors);
  requireObject(readAt(value, ["sidecar"]), "/sidecar", errors);
  requireObject(readAt(value, ["preinstall"]), "/preinstall", errors);
  requireObject(readAt(value, ["viteAiDevConfig"]), "/viteAiDevConfig", errors);
  requireObject(readAt(value, ["compatibility"]), "/compatibility", errors);
  requireObject(readAt(value, ["metadataDrift"]), "/metadataDrift", errors);
  requireObject(readAt(value, ["uiXrParity"]), "/uiXrParity", errors);
  requireObject(readAt(value, ["toolSelection"]), "/toolSelection", errors);
  requireObject(readAt(value, ["operatorApprovals"]), "/operatorApprovals", errors);
  requireArray(readAt(value, ["operatorSteeringBlockers"]), "/operatorSteeringBlockers", errors);
  requireObject(readAt(value, ["agentTooling"]), "/agentTooling", errors);
  requireObject(readAt(value, ["agentToolingLocalPreflight"]), "/agentToolingLocalPreflight", errors);
  requireObject(readAt(value, ["productionRuntime"]), "/productionRuntime", errors);
  requireObject(readAt(value, ["verdict"]), "/verdict", errors);

  requireObject(readAt(value, ["preinstall", "policy"]), "/preinstall/policy", errors);
  requireBoolean(readAt(value, ["preinstall", "policy", "exactVersionRequired"]), "/preinstall/policy/exactVersionRequired", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "allowedFirstSlicePackages"]), "/preinstall/policy/allowedFirstSlicePackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "reviewRequiredPackages"]), "/preinstall/policy/reviewRequiredPackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "blockedPackages"]), "/preinstall/policy/blockedPackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "blockedTransitivePackages"]), "/preinstall/policy/blockedTransitivePackages", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "blockedLicenseExpressions"]), "/preinstall/policy/blockedLicenseExpressions", errors);
  requireStringArray(readAt(value, ["preinstall", "policy", "requiredPackageManagerControls"]), "/preinstall/policy/requiredPackageManagerControls", errors);
  requireBoolean(readAt(value, ["preinstall", "defaultFirstSliceReady"]), "/preinstall/defaultFirstSliceReady", errors);
  requireObject(readAt(value, ["preinstall", "result"]), "/preinstall/result", errors);
  requireBoolean(readAt(value, ["preinstall", "result", "readyToInstallInSidecar"]), "/preinstall/result/readyToInstallInSidecar", errors);
  requireStringArray(readAt(value, ["preinstall", "result", "blockers"]), "/preinstall/result/blockers", errors);
  requireStringArray(readAt(value, ["preinstall", "result", "reviewWarnings"]), "/preinstall/result/reviewWarnings", errors);

  requireLiteral(readAt(value, ["viteAiDevConfig", "status"]), "phase_2_after_sidecar_shell", "/viteAiDevConfig/status", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "sourceRecordIds"]), "/viteAiDevConfig/sourceRecordIds", errors);
  requireLiteral(readAt(value, ["viteAiDevConfig", "packageName"]), "@iwsdk/vite-plugin-dev", "/viteAiDevConfig/packageName", errors);
  requireObject(readAt(value, ["viteAiDevConfig", "requiredOptions"]), "/viteAiDevConfig/requiredOptions", errors);
  requireLiteral(readAt(value, ["viteAiDevConfig", "requiredOptions", "emulatorDevice"]), "metaQuest3", "/viteAiDevConfig/requiredOptions/emulatorDevice", errors);
  requireLiteral(readAt(value, ["viteAiDevConfig", "requiredOptions", "aiMode"]), "agent", "/viteAiDevConfig/requiredOptions/aiMode", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "requiredOptions", "aiTools"]), "/viteAiDevConfig/requiredOptions/aiTools", errors);
  requireObject(readAt(value, ["viteAiDevConfig", "requiredOptions", "screenshotSize"]), "/viteAiDevConfig/requiredOptions/screenshotSize", errors);
  requireNumber(readAt(value, ["viteAiDevConfig", "requiredOptions", "screenshotSize", "width"]), "/viteAiDevConfig/requiredOptions/screenshotSize/width", errors);
  requireNumber(readAt(value, ["viteAiDevConfig", "requiredOptions", "screenshotSize", "height"]), "/viteAiDevConfig/requiredOptions/screenshotSize/height", errors);
  requireBoolean(readAt(value, ["viteAiDevConfig", "requiredOptions", "verbose"]), "/viteAiDevConfig/requiredOptions/verbose", errors);
  requireString(readAt(value, ["viteAiDevConfig", "viteConfigSnippet"]), "/viteAiDevConfig/viteConfigSnippet", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "requiredEvidence"]), "/viteAiDevConfig/requiredEvidence", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "blockedUntil"]), "/viteAiDevConfig/blockedUntil", errors);
  requireStringArray(readAt(value, ["viteAiDevConfig", "doNotRunUnattended"]), "/viteAiDevConfig/doNotRunUnattended", errors);

  requireObject(readAt(value, ["compatibility", "contract"]), "/compatibility/contract", errors);
  requireStringArray(readAt(value, ["compatibility", "contract", "sourceRecordIds"]), "/compatibility/contract/sourceRecordIds", errors);
  requireLiteral(readAt(value, ["compatibility", "contract", "packageName"]), "@iwsdk/vite-plugin-dev", "/compatibility/contract/packageName", errors);
  requireLiteral(readAt(value, ["compatibility", "contract", "packageVersion"]), "0.3.1", "/compatibility/contract/packageVersion", errors);
  requireNumber(readAt(value, ["compatibility", "contract", "requiredNodeMajor"]), "/compatibility/contract/requiredNodeMajor", errors);
  requireNumber(readAt(value, ["compatibility", "contract", "openclinxrViteMajor"]), "/compatibility/contract/openclinxrViteMajor", errors);
  requireString(readAt(value, ["compatibility", "contract", "iwsdkVitePluginPeerRange"]), "/compatibility/contract/iwsdkVitePluginPeerRange", errors);
  requireStringArray(readAt(value, ["compatibility", "contract", "requiredEvidence"]), "/compatibility/contract/requiredEvidence", errors);
  requireObject(readAt(value, ["compatibility", "currentKnownEvidence"]), "/compatibility/currentKnownEvidence", errors);
  requireNumber(readAt(value, ["compatibility", "currentKnownEvidence", "openclinxrViteMajor"]), "/compatibility/currentKnownEvidence/openclinxrViteMajor", errors);
  requireString(readAt(value, ["compatibility", "currentKnownEvidence", "iwsdkVitePluginPeerRange"]), "/compatibility/currentKnownEvidence/iwsdkVitePluginPeerRange", errors);
  requireNumber(readAt(value, ["compatibility", "currentKnownEvidence", "nodeMajor"]), "/compatibility/currentKnownEvidence/nodeMajor", errors);
  requireString(readAt(value, ["compatibility", "currentKnownEvidence", "nodeRuntimePath"]), "/compatibility/currentKnownEvidence/nodeRuntimePath", errors);
  requireBoolean(readAt(value, ["compatibility", "currentKnownEvidence", "rolldownNativeBindingLoaded"]), "/compatibility/currentKnownEvidence/rolldownNativeBindingLoaded", errors);
  requireObject(readAt(value, ["compatibility", "result"]), "/compatibility/result", errors);
  requireBoolean(readAt(value, ["compatibility", "result", "readyForPhase2AgentDevtools"]), "/compatibility/result/readyForPhase2AgentDevtools", errors);
  requireStringArray(readAt(value, ["compatibility", "result", "blockers"]), "/compatibility/result/blockers", errors);

  requireArray(readAt(value, ["metadataDrift", "policies"]), "/metadataDrift/policies", errors);
  for (const [index, policy] of arrayEntries(readAt(value, ["metadataDrift", "policies"]))) {
    const pathPrefix = `/metadataDrift/policies/${index}`;
    requireObject(policy, pathPrefix, errors);
    requireString(readAt(policy, ["packageName"]), `${pathPrefix}/packageName`, errors);
    requireString(readAt(policy, ["docsVersion"]), `${pathPrefix}/docsVersion`, errors);
    requireString(readAt(policy, ["npmLatestVersion"]), `${pathPrefix}/npmLatestVersion`, errors);
    requireStringArray(readAt(policy, ["sourceRecordIds"]), `${pathPrefix}/sourceRecordIds`, errors);
    requireString(readAt(policy, ["impact"]), `${pathPrefix}/impact`, errors);
    requireStringArray(readAt(policy, ["blockedActions"]), `${pathPrefix}/blockedActions`, errors);
    requireStringArray(readAt(policy, ["requiredResolutionEvidence"]), `${pathPrefix}/requiredResolutionEvidence`, errors);
  }
  requireObject(readAt(value, ["metadataDrift", "result"]), "/metadataDrift/result", errors);
  requireBoolean(readAt(value, ["metadataDrift", "result", "readyForUnattendedUse"]), "/metadataDrift/result/readyForUnattendedUse", errors);
  requireStringArray(readAt(value, ["metadataDrift", "result", "blockers"]), "/metadataDrift/result/blockers", errors);

  requireLiteral(readAt(value, ["uiXrParity", "source"]), "apps/ui-xr/src/runtime-state.ts", "/uiXrParity/source", errors);
  requireString(readAt(value, ["uiXrParity", "baselineAppBundleSource"]), "/uiXrParity/baselineAppBundleSource", errors);
  requireString(readAt(value, ["uiXrParity", "smokePlanHash"]), "/uiXrParity/smokePlanHash", errors);
  requireStringArray(readAt(value, ["uiXrParity", "mcpToolOrder"]), "/uiXrParity/mcpToolOrder", errors);
  requireStringArray(readAt(value, ["uiXrParity", "requiredSceneObjectNames"]), "/uiXrParity/requiredSceneObjectNames", errors);
  requireString(readAt(value, ["uiXrParity", "controllerSelectTraceTag"]), "/uiXrParity/controllerSelectTraceTag", errors);

  requireLiteral(readAt(value, ["toolSelection", "status"]), "contract_only", "/toolSelection/status", errors);
  requireStringArray(readAt(value, ["toolSelection", "sourceRecordIds"]), "/toolSelection/sourceRecordIds", errors);
  requireArray(readAt(value, ["toolSelection", "toolContracts"]), "/toolSelection/toolContracts", errors);
  for (const [index, contract] of arrayEntries(readAt(value, ["toolSelection", "toolContracts"]))) {
    const pathPrefix = `/toolSelection/toolContracts/${index}`;
    requireObject(contract, pathPrefix, errors);
    requireString(readAt(contract, ["toolId"]), `${pathPrefix}/toolId`, errors);
    requireString(readAt(contract, ["posture"]), `${pathPrefix}/posture`, errors);
    requireStringArray(readAt(contract, ["sourceRecordIds"]), `${pathPrefix}/sourceRecordIds`, errors);
    requireString(readAt(contract, ["useWhen"]), `${pathPrefix}/useWhen`, errors);
    requireStringArray(readAt(contract, ["requiredEvidence"]), `${pathPrefix}/requiredEvidence`, errors);
    requireStringArray(readAt(contract, ["canSupportClaims"]), `${pathPrefix}/canSupportClaims`, errors);
    requireStringArray(readAt(contract, ["cannotSupportClaims"]), `${pathPrefix}/cannotSupportClaims`, errors);
    requireStringArray(readAt(contract, ["blockedUntil"]), `${pathPrefix}/blockedUntil`, errors);
  }
  requireArray(readAt(value, ["toolSelection", "evidenceLadder"]), "/toolSelection/evidenceLadder", errors);
  for (const [index, step] of arrayEntries(readAt(value, ["toolSelection", "evidenceLadder"]))) {
    const pathPrefix = `/toolSelection/evidenceLadder/${index}`;
    requireObject(step, pathPrefix, errors);
    requireNumber(readAt(step, ["order"]), `${pathPrefix}/order`, errors);
    requireString(readAt(step, ["toolId"]), `${pathPrefix}/toolId`, errors);
    requireString(readAt(step, ["promotionGate"]), `${pathPrefix}/promotionGate`, errors);
  }
  requireStringArray(readAt(value, ["toolSelection", "blockers"]), "/toolSelection/blockers", errors);

  requireLiteral(readAt(value, ["operatorApprovals", "status"]), "operator_approved_with_sidecar_gates", "/operatorApprovals/status", errors);
  requireString(readAt(value, ["operatorApprovals", "approvedAt"]), "/operatorApprovals/approvedAt", errors);
  requireArray(readAt(value, ["operatorApprovals", "approvals"]), "/operatorApprovals/approvals", errors);
  for (const [index, approval] of arrayEntries(readAt(value, ["operatorApprovals", "approvals"]))) {
    const pathPrefix = `/operatorApprovals/approvals/${index}`;
    requireObject(approval, pathPrefix, errors);
    requireString(readAt(approval, ["id"]), `${pathPrefix}/id`, errors);
    requireStringArray(readAt(approval, ["approvedScope"]), `${pathPrefix}/approvedScope`, errors);
    requireObject(readAt(approval, ["npmResolution"]), `${pathPrefix}/npmResolution`, errors);
    requireString(readAt(approval, ["npmResolution", "resolvedPackage"]), `${pathPrefix}/npmResolution/resolvedPackage`, errors);
    requireString(readAt(approval, ["npmResolution", "resolvedVersion"]), `${pathPrefix}/npmResolution/resolvedVersion`, errors);
    requireString(readAt(approval, ["npmResolution", "license"]), `${pathPrefix}/npmResolution/license`, errors);
    requireStringArray(readAt(approval, ["remainingGates"]), `${pathPrefix}/remainingGates`, errors);
  }
  requireStringArray(readAt(value, ["operatorApprovals", "stillBlockedActions"]), "/operatorApprovals/stillBlockedActions", errors);

  for (const [index, blocker] of arrayEntries(readAt(value, ["operatorSteeringBlockers"]))) {
    const pathPrefix = `/operatorSteeringBlockers/${index}`;
    requireObject(blocker, pathPrefix, errors);
    requireString(readAt(blocker, ["id"]), `${pathPrefix}/id`, errors);
    requireString(readAt(blocker, ["operatorQuestionText"]), `${pathPrefix}/operatorQuestionText`, errors);
    requireString(readAt(blocker, ["blockedAction"]), `${pathPrefix}/blockedAction`, errors);
    requireString(readAt(blocker, ["whyHumanApprovalIsRequired"]), `${pathPrefix}/whyHumanApprovalIsRequired`, errors);
  }

  requireBoolean(readAt(value, ["agentTooling", "readyForAgentTooling"]), "/agentTooling/readyForAgentTooling", errors);
  requireStringArray(readAt(value, ["agentTooling", "blockers"]), "/agentTooling/blockers", errors);
  requireBoolean(
    readAt(value, ["agentToolingLocalPreflight", "readyForLocalAgentToolingPreflight"]),
    "/agentToolingLocalPreflight/readyForLocalAgentToolingPreflight",
    errors,
  );
  requireStringArray(readAt(value, ["agentToolingLocalPreflight", "blockers"]), "/agentToolingLocalPreflight/blockers", errors);
  requireStringArray(
    readAt(value, ["agentToolingLocalPreflight", "notEvidenceFor"]),
    "/agentToolingLocalPreflight/notEvidenceFor",
    errors,
  );
  requireBoolean(readAt(value, ["productionRuntime", "readyForCommittedSpike"]), "/productionRuntime/readyForCommittedSpike", errors);
  requireBoolean(readAt(value, ["productionRuntime", "readyForProductionRuntime"]), "/productionRuntime/readyForProductionRuntime", errors);
  requireStringArray(readAt(value, ["productionRuntime", "blockers"]), "/productionRuntime/blockers", errors);

  requireBoolean(readAt(value, ["verdict", "readyForInstallBackedSidecar"]), "/verdict/readyForInstallBackedSidecar", errors);
  requireBoolean(readAt(value, ["verdict", "readyForAgentTooling"]), "/verdict/readyForAgentTooling", errors);
  requireBoolean(readAt(value, ["verdict", "readyForProductionRuntime"]), "/verdict/readyForProductionRuntime", errors);
  requireStringArray(readAt(value, ["verdict", "blockers"]), "/verdict/blockers", errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--agent-tooling-input") {
      options.agentToolingInputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--mcp-inventory-input") {
      options.mcpInventoryInputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--iwer-sidecar-input") {
      options.iwerSidecarInputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--compatibility-input") {
      options.compatibilityInputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--metadata-drift-input") {
      options.metadataDriftInputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--sidecar-metrics-input") {
      options.sidecarMetricsInputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      const possiblePattern = normalizedArgs[index + 1];
      if (possiblePattern && !possiblePattern.startsWith("--")) {
        options.validateLatestPattern = possiblePattern;
        index += 1;
      } else {
        options.validateLatestPattern = defaultValidateLatestPattern;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function readJsonFile<T>(filePath: string | undefined): Promise<T | undefined> {
  if (!filePath) {
    return undefined;
  }
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function readAt(value: unknown, pathParts: string[]): unknown {
  return pathParts.reduce<unknown>((current, pathPart) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[pathPart];
  }, value);
}

function requireObject(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName || "/"} must be object`);
  }
}

function requireLiteral(value: unknown, literal: string, pathName: string, errors: string[]): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  }
}

function requireArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
  }
}

function arrayEntries(value: unknown): Array<[number, unknown]> {
  return Array.isArray(value) ? [...value.entries()] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
