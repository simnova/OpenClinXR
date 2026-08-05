export type IwsdkSpikePackagePosture = "spike_candidate" | "review_required" | "blocked" | "blocked_unattended";
export type IwsdkSpikePackage = {
    name: string;
    posture: IwsdkSpikePackagePosture;
    intendedUse: string;
    gates: string[];
};
export type IwsdkSpikePlan = {
    status: "advisory_spike";
    workspaceScope: {
        allowedRoots: string[];
        productionRootsBlocked: string[];
    };
    sourceRecordIds: string[];
    packages: IwsdkSpikePackage[];
    requiredEvidence: string[];
};
export type IwsdkSourceRecordIdContract = {
    sourceRecordIds: string[];
};
export type IwsdkSpikeGateStatus = "ready" | "blocked" | "not_configured";
export type IwsdkSpikeGateEvidence = {
    vite8PeerCompatibility: IwsdkSpikeGateStatus;
    explicitNode22Runtime: IwsdkSpikeGateStatus;
    rolldownNativeBinding: IwsdkSpikeGateStatus;
    licenseReview: IwsdkSpikeGateStatus;
    packageWeightAccepted: IwsdkSpikeGateStatus;
    agentMcpRuntimeSmoke: IwsdkSpikeGateStatus;
    quest3PhysicalSmoke: IwsdkSpikeGateStatus;
    foregroundFramePacing: IwsdkSpikeGateStatus;
};
export type IwsdkSpikeReadiness = {
    readyForCommittedSpike: boolean;
    readyForProductionRuntime: boolean;
    blockers: string[];
};
export type IwsdkSpikeMetricThresholds = {
    installedNodeModulesMbMax: number;
    injectedDevRuntimeKbMax: number;
    appJsBundleKbMax: number;
    bundleDeltaVsUiXrKbMax: number;
    avgFpsMin: number;
    p95FrameMsMax: number;
    controllerSelectLatencyMsMax: number;
    consoleErrorCountMax: number;
};
export type IwsdkSpikeMetrics = {
    installedNodeModulesMb?: number;
    injectedDevRuntimeKb?: number;
    appJsBundleKb?: number;
    bundleDeltaVsUiXrKb?: number;
    baselineAppBundleSource?: string;
    smokePlanHash?: string;
    canvasNonblank?: boolean;
    requiredSceneObjectNames?: string[];
    observedSceneObjectNames?: string[];
    controllerSelectTraceTag?: string;
    observedTraceActionTags?: string[];
    avgFps?: number;
    p95FrameMs?: number;
    controllerSelectLatencyMs?: number;
    foregroundQuestPreflightReady?: boolean;
    consoleErrorCount?: number;
};
export type IwsdkSpikeMetricReadiness = {
    readyForCommittedSpike: boolean;
    readyForProductionRuntime: boolean;
    blockers: string[];
};
export type IwsdkUiXrStationParityContract = {
    source: "apps/ui-xr/src/runtime-state.ts";
    baselineAppBundleSource: string;
    smokePlanHash: string;
    mcpToolOrder: IwsdkMcpToolName[];
    requiredSceneObjectNames: string[];
    controllerSelectTraceTag: string;
};
export type IwsdkAgentMode = "agent" | "oversight" | "collaborate";
export type IwsdkAiTool = "codex" | "claude" | "cursor" | "copilot";
export type IwsdkPlaywrightBrowserPosture = "headless_fixed_viewport" | "visible_resizable";
export type IwsdkDevUiPosture = "off" | "on";
export type IwsdkNormalBrowserPosture = "opens_independently" | "playwright_browser";
export type IwsdkVerificationToolId = "browser_use_playwright" | "quest_cdp" | "iwsdk_mcp_future" | "manual_quest_foreground";
export type IwsdkVerificationToolPosture = "default_local" | "device_cdp" | "approved_sidecar_only" | "manual_physical_device";
export type IwsdkVerificationClaim = "desktop_fallback_rendered" | "webgl_canvas_nonblank" | "trace_controls_advance" | "quest_browser_shell_loaded" | "quest_webxr_feature_detected" | "quest_trace_controls_advance" | "emulated_xr_session_ready" | "mcp_scene_hierarchy_matches_station_contract" | "emulated_controller_select_advances_trace" | "foreground_quest_frame_pacing" | "controller_latency_on_headset" | "physical_quest_comfort" | "in_headset_text_readability";
export type IwsdkVerificationToolContract = {
    toolId: IwsdkVerificationToolId;
    posture: IwsdkVerificationToolPosture;
    sourceRecordIds: string[];
    useWhen: string;
    requiredEvidence: string[];
    canSupportClaims: IwsdkVerificationClaim[];
    cannotSupportClaims: IwsdkVerificationClaim[];
    blockedUntil: string[];
};
export type IwsdkVerificationEvidenceStep = {
    order: number;
    toolId: IwsdkVerificationToolId;
    promotionGate: string;
};
export type IwsdkVerificationToolSelectionContract = {
    status: "contract_only";
    sourceRecordIds: string[];
    toolContracts: IwsdkVerificationToolContract[];
    evidenceLadder: IwsdkVerificationEvidenceStep[];
    blockers: string[];
};
export type IwsdkAiModeProfile = {
    mode: IwsdkAgentMode;
    playwrightBrowser: IwsdkPlaywrightBrowserPosture;
    devUi: IwsdkDevUiPosture;
    normalBrowser: IwsdkNormalBrowserPosture;
    openclinxrUse: string;
};
export type IwsdkMcpToolCategory = "session" | "transforms" | "input_mode" | "select_trigger" | "gamepad" | "device_state" | "browser" | "scene" | "ecs";
export type IwsdkMcpToolCoverage = {
    category: IwsdkMcpToolCategory;
    representativeTools: string[];
    evidenceUse: string;
};
export type IwsdkMcpToolName = "xr_get_session_status" | "xr_accept_session" | "xr_end_session" | "xr_get_transform" | "xr_set_transform" | "xr_look_at" | "xr_animate_to" | "xr_set_input_mode" | "xr_set_connected" | "xr_get_select_value" | "xr_set_select_value" | "xr_select" | "xr_get_gamepad_state" | "xr_set_gamepad_state" | "xr_get_device_state" | "xr_set_device_state" | "browser_screenshot" | "browser_get_console_logs" | "browser_reload_page" | "scene_get_hierarchy" | "scene_get_object_transform" | "ecs_pause" | "ecs_resume" | "ecs_step" | "ecs_query_entity" | "ecs_find_entities" | "ecs_list_systems" | "ecs_list_components" | "ecs_toggle_system" | "ecs_set_component" | "ecs_snapshot" | "ecs_diff";
export type IwsdkMcpToolInventoryCategory = {
    category: IwsdkMcpToolCategory;
    tools: IwsdkMcpToolName[];
};
export type IwsdkMcpToolInventory = {
    sourceRecordIds: string[];
    categories: IwsdkMcpToolInventoryCategory[];
    allToolNames: IwsdkMcpToolName[];
};
export type IwsdkMcpToolInventoryRequirement = {
    expectedToolCount: 32;
    sourceRecordIds: string[];
    expectedToolNames: IwsdkMcpToolName[];
    requiredCategories: IwsdkMcpToolCategory[];
    minimalSmokeSubset: string[];
    readinessBlockersWhenMissing: string[];
};
export type IwsdkManagedBrowserModeEvidence = {
    mode: IwsdkAgentMode;
    managedBrowser: string;
    normalBrowser: string;
    requiredEvidence: string[];
};
export type IwsdkManagedBrowserEvidenceContract = {
    sourceRecordIds: string[];
    requiredModeEvidence: IwsdkManagedBrowserModeEvidence[];
    readinessBlockersWhenMissing: string[];
};
export type IwsdkManagedBrowserEvidence = {
    mode: IwsdkAgentMode;
    runtimeUrl?: string;
    managedBrowserReady?: boolean;
    managedSessionId?: string;
    normalBrowserOpened?: boolean;
    normalSessionId?: string;
    screenshotWidth?: number;
    screenshotHeight?: number;
    managedDevUiVisible?: boolean;
    normalDevUiVisible?: boolean;
};
export type IwsdkManagedBrowserEvidenceReadiness = {
    ready: boolean;
    blockers: string[];
};
export type IwsdkAgentToolingEvidence = {
    phase2DevtoolsConfiguredInSidecar?: boolean;
    adapterSyncRecorded?: boolean;
    toolCount?: number;
    coveredCategories: IwsdkMcpToolCategory[];
    validatedSmokeTools: string[];
    observedToolNames?: string[];
    managedBrowserEvidence?: IwsdkManagedBrowserEvidence;
    mcpRuntimeRegistered?: boolean;
    sceneHierarchyContainsRequiredObjects?: boolean;
    ecsRuntimeQueryable?: boolean;
    optionalServerActions?: string[];
};
export type IwsdkAgentToolingEvidenceReadiness = {
    readyForAgentTooling: boolean;
    blockers: string[];
};
export type IwsdkAgentToolingLocalPreflightReadiness = {
    readyForLocalAgentToolingPreflight: boolean;
    blockers: string[];
    notEvidenceFor: string[];
};
export type IwsdkOptionalMcpServerPolicy = {
    serverName: string;
    packageName: string;
    posture: Extract<IwsdkSpikePackagePosture, "blocked" | "blocked_unattended">;
    approvalStatus: "operator_approved_download_scope" | "legal_procurement_approved_sidecar_gated";
    sourceRecordIds: string[];
    allowedOnlyAfter: string[];
    blockedActions: string[];
};
export type IwsdkPackageMetadataDriftPolicy = {
    packageName: string;
    docsVersion: string;
    npmLatestVersion: string;
    sourceRecordIds: string[];
    impact: string;
    blockedActions: string[];
    requiredResolutionEvidence: string[];
};
export type IwsdkPackageMetadataDriftEvidence = {
    packageName: string;
    docsVersion?: string;
    npmLatestVersion?: string;
    exactPinApproved?: boolean;
    exactPinVersion?: string;
    approvalRecordId?: string;
};
export type IwsdkPackageMetadataDriftReadiness = {
    readyForUnattendedUse: boolean;
    blockers: string[];
};
export type IwsdkAgentVerificationRunbook = {
    mode: IwsdkAgentMode;
    modeProfile: IwsdkAiModeProfile;
    aiTool: IwsdkAiTool;
    adapterConfigTarget: string;
    adapterSyncCommand: "iwsdk adapter sync";
    steps: Array<{
        id: string;
        toolOrCommand: string;
        expectedEvidence: string;
    }>;
    doNotRunUnattended: string[];
};
export type IwsdkCodexMcpAdapterTemplate = {
    target: ".codex/config.toml";
    serverName: "iwsdk-runtime";
    status: "blocked_no_installed_stdio_server";
    command: IwsdkPackageManagedMcpCommand;
    tomlSnippet: string;
    prerequisites: string[];
    validationCommandOrder: string[];
    blockedActions: string[];
};
export type IwsdkPackageManagedMcpCommand = {
    executable: "pnpm";
    args: string[];
    sidecarPackageName: "@openclinxr/ui-xr-iwsdk-spike";
    serverBin: "iwsdk-dev-mcp";
    availableInInstalledSidecar: false;
    unavailableReason: "iwsdk_dev_mcp_bin_not_published_by_iwsdk_0_4_2";
};
export type IwsdkViteAiDevConfigContract = {
    status: "phase_2_after_sidecar_shell";
    sourceRecordIds: string[];
    packageName: "@iwsdk/vite-plugin-dev";
    requiredOptions: {
        emulatorDevice: "metaQuest3";
        aiMode: "agent";
        aiTools: ["codex"];
        screenshotSize: {
            width: 500;
            height: 500;
        };
        verbose: true;
    };
    viteConfigSnippet: string;
    requiredEvidence: string[];
    blockedUntil: string[];
    doNotRunUnattended: string[];
};
export type IwsdkCompatibilityContract = {
    sourceRecordIds: string[];
    packageName: "@iwsdk/vite-plugin-dev";
    packageVersion: "0.5.1";
    requiredNodeMajor: 22;
    openclinxrViteMajor: 8;
    iwsdkVitePluginPeerRange: "^7.0.0";
    requiredEvidence: string[];
};
export type IwsdkCompatibilityEvidence = {
    openclinxrViteMajor?: number;
    iwsdkVitePluginPeerRange?: string;
    nodeMajor?: number;
    nodeRuntimePath?: string;
    rolldownNativeBindingLoaded?: boolean;
};
export type IwsdkCompatibilityReadiness = {
    readyForPhase2AgentDevtools: boolean;
    blockers: string[];
};
export type IwsdkCommittedSpikePhase = {
    id: string;
    goal: string;
    allowedPackages: string[];
    blockedPackages: string[];
    requiredMetrics: string[];
    exitCriteria: string[];
};
export type IwsdkCommittedSpikeSequence = {
    status: "sidecar_spike_only";
    sidecarAppRoot: "apps/arena/ui-xr-iwsdk-spike/";
    productionRootsBlocked: string[];
    phases: IwsdkCommittedSpikePhase[];
};
export type IwsdkSidecarReadinessContract = {
    sidecarAppRoot: "apps/arena/ui-xr-iwsdk-spike/";
    currentState: "phase_2_validation_sidecar_promoted";
    runnable: true;
    approvedProposal: "proposals/approved/proposal-iwsdk-sidecar-install.md";
    approvedPackages: string[];
    remainingProductionBlockers: string[];
};
export type IwsdkPreInstallPackagePolicy = {
    exactVersionRequired: true;
    allowedFirstSlicePackages: string[];
    reviewRequiredPackages: string[];
    blockedPackages: string[];
    blockedTransitivePackages: string[];
    blockedLicenseExpressions: string[];
    requiredPackageManagerControls: string[];
    requiredTransitivePackagesByPackageName: Record<string, string[]>;
};
export type IwsdkPackageSelection = {
    name: string;
    version: string;
    license: string;
    transitivePackages: string[];
    transitivePackageLicenses?: Record<string, string>;
};
export type IwsdkPreInstallPackageSelectionResult = {
    readyToInstallInSidecar: boolean;
    blockers: string[];
    reviewWarnings: string[];
};
export type IwsdkWorkspaceDependencyField = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
export type IwsdkWorkspaceDependency = {
    manifestPath: string;
    field: IwsdkWorkspaceDependencyField;
    name: string;
    version: string;
};
export type IwsdkWorkspaceSourceReference = {
    filePath: string;
    packageName: string;
};
export type IwsdkWorkspaceSidecarProductionUiCoupling = {
    filePath: string;
    specifier: string;
};
export type IwsdkWorkspaceScriptReference = {
    manifestPath: string;
    scriptName: string;
    command: string;
};
export type IwsdkWorkspacePackageManagerReference = {
    manifestPath: string;
    location: string;
    packageName: string;
    specifier: string;
};
export type IwsdkWorkspacePackageManagerControls = {
    workspacePostureInVerify: boolean;
    threeOverrideExact?: boolean;
    auditScriptPresent: boolean;
    licenseScriptPresent: boolean;
};
export type IwsdkWorkspacePostureInput = {
    sidecarAppExists: boolean;
    sidecarInstallApproved: boolean;
    phase2DevtoolsApproved?: boolean;
    uikitmlSpatialTextApproved?: boolean;
    sharpLibvipsExceptionApproved?: boolean;
    sidecarLockfileImporterPresent?: boolean;
    sidecarLockfilePackageNames?: string[];
    dependencies: IwsdkWorkspaceDependency[];
    sourceReferences: IwsdkWorkspaceSourceReference[];
    sidecarProductionUiCouplings?: IwsdkWorkspaceSidecarProductionUiCoupling[];
    scriptReferences: IwsdkWorkspaceScriptReference[];
    lockfilePackageNames: string[];
    packageManagerReferences?: IwsdkWorkspacePackageManagerReference[];
    packageManagerControls: IwsdkWorkspacePackageManagerControls;
};
export type IwsdkWorkspaceSidecarStatus = "absent_contract_only" | "present_unapproved" | "present_approved";
export type IwsdkWorkspacePostureReadiness = {
    ready: boolean;
    sidecarStatus: IwsdkWorkspaceSidecarStatus;
    blockers: string[];
    reviewWarnings: string[];
};
export type IwsdkOperatorSteeringBlocker = {
    id: string;
    operatorQuestionText: string;
    blockedAction: string;
    whyHumanApprovalIsRequired: string;
};
export type IwsdkOperatorApprovalNpmResolution = {
    requestedPackage?: string;
    requestedPackageFound?: boolean;
    resolvedPackage: string;
    resolvedVersion: string;
    resolvedBin?: string;
    license: string;
    dependencies?: string[];
};
export type IwsdkOperatorApproval = {
    id: string;
    approvedScope: string[];
    npmResolution: IwsdkOperatorApprovalNpmResolution;
    pnpmEquivalentCandidate?: string;
    remainingGates: string[];
};
export type IwsdkOperatorApprovalContract = {
    status: "operator_approved_with_sidecar_gates";
    approvedAt: "2026-05-04";
    approvals: IwsdkOperatorApproval[];
    stillBlockedActions: string[];
};
export declare function buildIwsdkSourceRecordIdContract(): IwsdkSourceRecordIdContract;
export declare function buildIwsdkSpikePlan(): IwsdkSpikePlan;
export declare function evaluateIwsdkSpikeReadiness(evidence: IwsdkSpikeGateEvidence): IwsdkSpikeReadiness;
export declare function buildIwsdkSpikeMetricThresholds(): IwsdkSpikeMetricThresholds;
export declare function buildIwsdkOperatorSteeringBlockers(): IwsdkOperatorSteeringBlocker[];
export declare function buildIwsdkOperatorApprovalContract(): IwsdkOperatorApprovalContract;
export declare function buildIwsdkUiXrStationParityContract(): IwsdkUiXrStationParityContract;
export declare function evaluateIwsdkSpikeMetrics(metrics: IwsdkSpikeMetrics, thresholds?: IwsdkSpikeMetricThresholds): IwsdkSpikeMetricReadiness;
export declare function buildIwsdkCommittedSpikeSequence(): IwsdkCommittedSpikeSequence;
export declare function buildIwsdkSidecarReadinessContract(): IwsdkSidecarReadinessContract;
export declare function buildIwsdkPreInstallPackagePolicy(): IwsdkPreInstallPackagePolicy;
export declare function buildIwsdkCoreRequiredTransitivePackageNames(): string[];
export declare function buildIwsdkCoreTransitivePackageLicenseEvidence(): Record<string, string>;
export declare function buildIwsdkAiModeProfiles(): IwsdkAiModeProfile[];
export declare function buildIwsdkVerificationToolSelectionContract(): IwsdkVerificationToolSelectionContract;
export declare function selectIwsdkVerificationToolsForClaim(claim: IwsdkVerificationClaim): IwsdkVerificationToolContract[];
export declare function buildIwsdkMcpToolCoverage(): IwsdkMcpToolCoverage[];
export declare function buildIwsdkMcpToolInventory(): IwsdkMcpToolInventory;
export declare function buildIwsdkMcpToolInventoryRequirement(): IwsdkMcpToolInventoryRequirement;
export declare function buildIwsdkManagedBrowserEvidenceContract(): IwsdkManagedBrowserEvidenceContract;
export declare function evaluateIwsdkManagedBrowserEvidence(evidence: IwsdkManagedBrowserEvidence): IwsdkManagedBrowserEvidenceReadiness;
export declare function evaluateIwsdkAgentToolingEvidence(evidence: IwsdkAgentToolingEvidence): IwsdkAgentToolingEvidenceReadiness;
export declare function evaluateIwsdkAgentToolingLocalPreflightEvidence(evidence: IwsdkAgentToolingEvidence): IwsdkAgentToolingLocalPreflightReadiness;
export declare function buildIwsdkOptionalMcpServerPolicy(): IwsdkOptionalMcpServerPolicy[];
export declare function buildIwsdkPackageMetadataDriftPolicies(): IwsdkPackageMetadataDriftPolicy[];
export declare function evaluateIwsdkPackageMetadataDriftEvidence(evidence: IwsdkPackageMetadataDriftEvidence): IwsdkPackageMetadataDriftReadiness;
export declare function evaluateIwsdkPreInstallPackageSelection(selectedPackages: IwsdkPackageSelection[], policy?: IwsdkPreInstallPackagePolicy): IwsdkPreInstallPackageSelectionResult;
export declare function evaluateIwsdkWorkspacePosture(input: IwsdkWorkspacePostureInput, policy?: IwsdkPreInstallPackagePolicy): IwsdkWorkspacePostureReadiness;
export declare function buildIwsdkAgentVerificationRunbook(options: {
    aiTool: IwsdkAiTool;
    mode: IwsdkAgentMode;
}): IwsdkAgentVerificationRunbook;
export declare function buildIwsdkCodexMcpAdapterTemplate(): IwsdkCodexMcpAdapterTemplate;
export declare function buildIwsdkViteAiDevConfigContract(): IwsdkViteAiDevConfigContract;
export declare function buildIwsdkPackageManagedMcpCommand(): IwsdkPackageManagedMcpCommand;
export declare function buildIwsdkCompatibilityContract(): IwsdkCompatibilityContract;
export declare function evaluateIwsdkCompatibilityEvidence(evidence: IwsdkCompatibilityEvidence, contract?: IwsdkCompatibilityContract): IwsdkCompatibilityReadiness;
//# sourceMappingURL=index.d.ts.map