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

export type IwsdkAgentMode = "agent" | "oversight" | "collaborate";
export type IwsdkAiTool = "codex" | "claude" | "cursor" | "copilot";
export type IwsdkPlaywrightBrowserPosture = "headless_fixed_viewport" | "visible_resizable";
export type IwsdkDevUiPosture = "off" | "on";
export type IwsdkNormalBrowserPosture = "opens_independently" | "playwright_browser";

export type IwsdkAiModeProfile = {
  mode: IwsdkAgentMode;
  playwrightBrowser: IwsdkPlaywrightBrowserPosture;
  devUi: IwsdkDevUiPosture;
  normalBrowser: IwsdkNormalBrowserPosture;
  openclinxrUse: string;
};

export type IwsdkMcpToolCategory =
  | "session"
  | "transforms"
  | "input_mode"
  | "select_trigger"
  | "gamepad"
  | "device_state"
  | "browser"
  | "scene"
  | "ecs";

export type IwsdkMcpToolCoverage = {
  category: IwsdkMcpToolCategory;
  representativeTools: string[];
  evidenceUse: string;
};

export type IwsdkMcpToolName =
  | "xr_get_session_status"
  | "xr_accept_session"
  | "xr_end_session"
  | "xr_get_transform"
  | "xr_set_transform"
  | "xr_look_at"
  | "xr_animate_to"
  | "xr_set_input_mode"
  | "xr_set_connected"
  | "xr_get_select_value"
  | "xr_set_select_value"
  | "xr_select"
  | "xr_get_gamepad_state"
  | "xr_set_gamepad_state"
  | "xr_get_device_state"
  | "xr_set_device_state"
  | "browser_screenshot"
  | "browser_get_console_logs"
  | "browser_reload_page"
  | "scene_get_hierarchy"
  | "scene_get_object_transform"
  | "ecs_pause"
  | "ecs_resume"
  | "ecs_step"
  | "ecs_query_entity"
  | "ecs_find_entities"
  | "ecs_list_systems"
  | "ecs_list_components"
  | "ecs_toggle_system"
  | "ecs_set_component"
  | "ecs_snapshot"
  | "ecs_diff";

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
  adapterSyncRecorded?: boolean;
  toolCount?: number;
  coveredCategories: IwsdkMcpToolCategory[];
  validatedSmokeTools: string[];
  observedToolNames?: string[];
  managedBrowserEvidence?: IwsdkManagedBrowserEvidence;
  optionalServerActions?: string[];
};

export type IwsdkAgentToolingEvidenceReadiness = {
  readyForAgentTooling: boolean;
  blockers: string[];
};

export type IwsdkOptionalMcpServerPolicy = {
  serverName: string;
  packageName: string;
  posture: Extract<IwsdkSpikePackagePosture, "blocked" | "blocked_unattended">;
  sourceRecordIds: string[];
  allowedOnlyAfter: string[];
  blockedActions: string[];
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
  tomlSnippet: string;
  prerequisites: string[];
  validationCommandOrder: string[];
  blockedActions: string[];
};

export type IwsdkViteAiDevConfigContract = {
  status: "phase_2_after_sidecar_shell";
  sourceRecordIds: string[];
  packageName: "@iwsdk/vite-plugin-dev";
  requiredOptions: {
    emulatorDevice: "metaQuest3";
    aiMode: "agent";
    aiTools: ["codex"];
    screenshotSize: { width: 500; height: 500 };
    verbose: true;
  };
  viteConfigSnippet: string;
  requiredEvidence: string[];
  blockedUntil: string[];
  doNotRunUnattended: string[];
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
  sidecarAppRoot: "apps/ui-xr-iwsdk-spike/";
  productionRootsBlocked: string[];
  phases: IwsdkCommittedSpikePhase[];
};

export type IwsdkSidecarReadinessContract = {
  sidecarAppRoot: "apps/ui-xr-iwsdk-spike/";
  currentState: "contract_only";
  runnable: false;
  createAppOnlyAfter: string[];
  misleadingScaffoldRisks: string[];
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

export type IwsdkWorkspaceDependencyField =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

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
  sidecarLockfileImporterPresent?: boolean;
  sidecarLockfilePackageNames?: string[];
  dependencies: IwsdkWorkspaceDependency[];
  sourceReferences: IwsdkWorkspaceSourceReference[];
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

const sourceRecordIds = [
  "src-meta-iwsdk-github-2026",
  "src-iwsdk-ai-docs-2026",
  "src-iwsdk-npm-metadata-2026-05-04",
  "src-iwsdk-local-spike-2026-05-04",
  "src-openclinxr-iwsdk-spike-plan-2026-05-04",
] as const;

const gateBlockerNames: Record<keyof IwsdkSpikeGateEvidence, string> = {
  vite8PeerCompatibility: "vite_8_peer_compatibility",
  explicitNode22Runtime: "explicit_node_22_runtime",
  rolldownNativeBinding: "rolldown_native_binding",
  licenseReview: "license_review",
  packageWeightAccepted: "package_weight_accepted",
  agentMcpRuntimeSmoke: "agent_mcp_runtime_smoke",
  quest3PhysicalSmoke: "quest3_physical_smoke",
  foregroundFramePacing: "foreground_frame_pacing",
};

const committedSpikeGateKeys: Array<keyof IwsdkSpikeGateEvidence> = [
  "vite8PeerCompatibility",
  "explicitNode22Runtime",
  "rolldownNativeBinding",
  "licenseReview",
  "packageWeightAccepted",
  "agentMcpRuntimeSmoke",
];

const productionRuntimeGateKeys: Array<keyof IwsdkSpikeGateEvidence> = [
  ...committedSpikeGateKeys,
  "quest3PhysicalSmoke",
  "foregroundFramePacing",
];

const iwsdkCoreRequiredTransitivePackages = [
  "@babylonjs/havok",
  "@iwsdk/glxf",
  "@iwsdk/locomotor",
  "@iwsdk/xr-input",
  "@pmndrs/handle",
  "@pmndrs/pointer-events",
  "@pmndrs/uikit",
  "@pmndrs/uikitml",
  "@preact/signals-core",
  "elics",
  "three",
  "three-mesh-bvh",
] as const;

const iwsdkCoreTransitivePackageLicenses: Record<(typeof iwsdkCoreRequiredTransitivePackages)[number], string> = {
  "@babylonjs/havok": "Apache-2.0",
  "@iwsdk/glxf": "MIT",
  "@iwsdk/locomotor": "MIT",
  "@iwsdk/xr-input": "MIT",
  "@pmndrs/handle": "MIT",
  "@pmndrs/pointer-events": "MIT",
  "@pmndrs/uikit": "MIT",
  "@pmndrs/uikitml": "MIT",
  "@preact/signals-core": "MIT",
  elics: "MIT",
  three: "MIT",
  "three-mesh-bvh": "MIT",
};

export function buildIwsdkSpikePlan(): IwsdkSpikePlan {
  return {
    status: "advisory_spike",
    workspaceScope: {
      allowedRoots: ["apps/ui-xr-iwsdk-spike/", "packages/openclinxr/iwsdk-spike/"],
      productionRootsBlocked: ["apps/ui-xr/", "packages/openclinxr/ui-*", "packages/openclinxr/scenario-runtime/"],
    },
    sourceRecordIds: [...sourceRecordIds],
    packages: [
      {
        name: "@iwsdk/core",
        posture: "spike_candidate",
        intendedUse: "Evaluate ECS, WebXR runtime helpers, desktop emulation, and Three.js integration against the existing station shell.",
        gates: ["three_version_pin_or_override", "bundle_size_budget", "quest3_physical_smoke"],
      },
      {
        name: "@iwsdk/xr-input",
        posture: "spike_candidate",
        intendedUse: "Evaluate controller and hand input modeling for clinical interactions such as chart selection, object pointing, and actor focus.",
        gates: ["controller_input_smoke", "desktop_fallback_smoke", "quest3_physical_smoke"],
      },
      {
        name: "@iwsdk/glxf",
        posture: "review_required",
        intendedUse: "Evaluate the GLXF scene loader only if it improves reusable exam-room scene composition without fragmenting the existing GLB/GLTF asset pipeline.",
        gates: ["scene_format_review", "bundle_size_budget", "asset_pipeline_smoke"],
      },
      {
        name: "@iwsdk/locomotor",
        posture: "spike_candidate",
        intendedUse: "Evaluate locomotion only for stations that need movement beyond a fixed examination bay.",
        gates: ["comfort_review", "motion_sickness_review", "foreground_frame_pacing"],
      },
      {
        name: "@iwsdk/vite-plugin-dev",
        posture: "spike_candidate",
        intendedUse: "Evaluate MCP-driven XR screenshots, controller simulation, scene inspection, ECS debugging, and Codex adapter configuration.",
        gates: ["vite_8_peer_compatibility", "explicit_node_22_runtime", "agent_mcp_runtime_smoke"],
      },
      {
        name: "@iwsdk/vite-plugin-gltf-optimizer",
        posture: "review_required",
        intendedUse: "Evaluate build-time GLB/GLTF optimization only after dependency license review accepts the sharp/libvips path.",
        gates: ["vite_8_peer_compatibility", "license_review", "asset_pipeline_smoke"],
      },
      {
        name: "@iwsdk/vite-plugin-uikitml",
        posture: "review_required",
        intendedUse: "Evaluate spatial UI markup for in-headset EHR panels and case-note surfaces only after text readability, accessibility, and Vite compatibility checks.",
        gates: ["vite_8_peer_compatibility", "headset_text_readability", "accessibility_review", "ehr_panel_smoke"],
      },
      {
        name: "@iwsdk/vite-plugin-metaspatial",
        posture: "review_required",
        intendedUse: "Evaluate Meta Spatial Editor integration only as an optional authoring workflow after asset provenance and build-pipeline impact are reviewed.",
        gates: ["asset_authoring_workflow_review", "license_review", "vite_8_peer_compatibility"],
      },
      {
        name: "@iwsdk/create",
        posture: "blocked_unattended",
        intendedUse: "Do not run the project generator inside this workspace unattended; use it only after the operator approves scaffold scope and workspace boundaries.",
        gates: ["operator_approves_scaffold_generation", "workspace_boundary_review"],
      },
      {
        name: "@iwsdk/reference",
        posture: "blocked_unattended",
        intendedUse: "Optional local IWSDK reference lookup after an operator approves model and reference-corpus downloads.",
        gates: ["operator_approval_for_model_and_corpus_downloads", "cache_location_documented"],
      },
      {
        name: "@iwsdk/starter-assets",
        posture: "blocked_unattended",
        intendedUse: "Do not rely on CDN-hosted starter templates or assets until asset licensing, cache location, and offline reproducibility are reviewed.",
        gates: ["asset_license_and_cache_review", "cache_location_documented", "offline_reproducibility_review"],
      },
      {
        name: "@meta-quest/hzdb",
        posture: "blocked",
        intendedUse: "Do not use until legal/procurement approves the package terms and npm metadata posture.",
        gates: ["legal_review_for_unlicensed_metadata", "procurement_approval"],
      },
    ],
    requiredEvidence: productionRuntimeGateKeys.map((key) => gateBlockerNames[key]),
  };
}

export function evaluateIwsdkSpikeReadiness(evidence: IwsdkSpikeGateEvidence): IwsdkSpikeReadiness {
  const blockers = productionRuntimeGateKeys.flatMap((key) => (evidence[key] === "ready" ? [] : [gateBlockerNames[key]]));
  const committedSpikeBlockers = committedSpikeGateKeys.flatMap((key) => (evidence[key] === "ready" ? [] : [gateBlockerNames[key]]));

  return {
    readyForCommittedSpike: committedSpikeBlockers.length === 0,
    readyForProductionRuntime: blockers.length === 0,
    blockers,
  };
}

export function buildIwsdkSpikeMetricThresholds(): IwsdkSpikeMetricThresholds {
  return {
    installedNodeModulesMbMax: 300,
    injectedDevRuntimeKbMax: 1200,
    appJsBundleKbMax: 550,
    bundleDeltaVsUiXrKbMax: 100,
    avgFpsMin: 72,
    p95FrameMsMax: 25,
    controllerSelectLatencyMsMax: 150,
    consoleErrorCountMax: 0,
  };
}

export function evaluateIwsdkSpikeMetrics(
  metrics: IwsdkSpikeMetrics,
  thresholds: IwsdkSpikeMetricThresholds = buildIwsdkSpikeMetricThresholds(),
): IwsdkSpikeMetricReadiness {
  const committedBlockers = [
    missingOrOverMax(
      metrics.installedNodeModulesMb,
      thresholds.installedNodeModulesMbMax,
      "missing_installed_node_modules_mb",
      "installed_node_modules_mb_over_budget",
    ),
    missingOrOverMax(
      metrics.injectedDevRuntimeKb,
      thresholds.injectedDevRuntimeKbMax,
      "missing_injected_dev_runtime_kb",
      "injected_dev_runtime_kb_over_budget",
    ),
    missingOrOverMax(
      metrics.appJsBundleKb,
      thresholds.appJsBundleKbMax,
      "missing_app_js_bundle_kb",
      "app_js_bundle_kb_over_budget",
    ),
    missingOrOverMax(
      metrics.bundleDeltaVsUiXrKb,
      thresholds.bundleDeltaVsUiXrKbMax,
      "missing_bundle_delta_vs_ui_xr_kb",
      "bundle_delta_vs_ui_xr_kb_over_budget",
    ),
    missingOrOverMax(
      metrics.consoleErrorCount,
      thresholds.consoleErrorCountMax,
      "missing_console_error_count",
      "console_errors_present",
    ),
  ].filter((blocker): blocker is string => Boolean(blocker));
  const productionBlockers = [
    foregroundQuestPreflightBlocker(metrics.foregroundQuestPreflightReady),
    missingOrUnderMin(metrics.avgFps, thresholds.avgFpsMin, "missing_avg_fps", "avg_fps_below_floor"),
    missingOrOverMax(metrics.p95FrameMs, thresholds.p95FrameMsMax, "missing_p95_frame_ms", "p95_frame_ms_over_budget"),
    missingOrOverMax(
      metrics.controllerSelectLatencyMs,
      thresholds.controllerSelectLatencyMsMax,
      "missing_controller_select_latency_ms",
      "controller_select_latency_ms_over_budget",
    ),
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    readyForCommittedSpike: committedBlockers.length === 0,
    readyForProductionRuntime: committedBlockers.length === 0 && productionBlockers.length === 0,
    blockers: [...committedBlockers, ...productionBlockers],
  };
}

export function buildIwsdkCommittedSpikeSequence(): IwsdkCommittedSpikeSequence {
  return {
    status: "sidecar_spike_only",
    sidecarAppRoot: "apps/ui-xr-iwsdk-spike/",
    productionRootsBlocked: ["apps/ui-xr/", "apps/api/", "packages/openclinxr/scenario-runtime/"],
    phases: [
      {
        id: "phase-0-policy",
        goal: "Create the sidecar app and prove workspace, license, and architecture boundaries before adding dev tooling.",
        allowedPackages: ["@iwsdk/core", "@iwsdk/xr-input"],
        blockedPackages: ["@iwsdk/reference", "@meta-quest/hzdb", "@iwsdk/vite-plugin-gltf-optimizer"],
        requiredMetrics: [
          "pinned_dependency_specs",
          "license_policy_review",
          "architecture_boundary_check",
        ],
        exitCriteria: [
          "No @iwsdk/* dependency appears outside the sidecar app and planning package.",
          "No package with blocked or unknown license metadata is installed in the committed workspace.",
        ],
      },
      {
        id: "phase-1-runtime-shell",
        goal: "Replicate the current ED bay shell with IWSDK core/input while preserving the same trace semantics as apps/ui-xr.",
        allowedPackages: ["@iwsdk/core", "@iwsdk/xr-input"],
        blockedPackages: ["@iwsdk/reference", "@meta-quest/hzdb", "@iwsdk/vite-plugin-gltf-optimizer"],
        requiredMetrics: [
          "canvas_nonblank",
          "bundle_size_delta_vs_apps_ui_xr",
          "controller_select_trace_event",
          "desktop_mouse_keyboard_fallback",
        ],
        exitCriteria: [
          "The sidecar shell emits the same learner trace action for one controller select as the production shell.",
          "Bundle delta and console warnings are recorded before the next phase.",
        ],
      },
      {
        id: "phase-2-agent-devtools",
        goal: "Evaluate IWSDK agent tooling and MCP runtime only after the runtime shell is stable.",
        allowedPackages: ["@iwsdk/vite-plugin-dev"],
        blockedPackages: ["@iwsdk/reference", "@meta-quest/hzdb"],
        requiredMetrics: [
          "vite_8_peer_compatibility",
          "node_22_runtime_path",
          "scene_get_hierarchy",
          "xr_select",
          "browser_get_console_logs",
        ],
        exitCriteria: [
          "Agent mode can capture a nonblank screenshot and scene hierarchy without attaching the physical headset.",
          "MCP config changes are local, documented, and reversible.",
        ],
      },
      {
        id: "phase-3-quest-device-proof",
        goal: "Decide whether IWSDK can move from sidecar spike toward production based on physical Quest evidence.",
        allowedPackages: ["@iwsdk/core", "@iwsdk/xr-input", "@iwsdk/locomotor"],
        blockedPackages: ["@iwsdk/reference", "@meta-quest/hzdb", "@iwsdk/vite-plugin-gltf-optimizer"],
        requiredMetrics: [
          "foreground_frame_pacing",
          "quest3_controller_select_latency",
          "headset_text_readability",
          "thermal_or_comfort_notes",
        ],
        exitCriteria: [
          "Foreground Quest 3 performance is no worse than the current apps/ui-xr baseline.",
          "A clinician-style station can be completed without controller, text, or comfort regressions.",
        ],
      },
    ],
  };
}

export function buildIwsdkSidecarReadinessContract(): IwsdkSidecarReadinessContract {
  return {
    sidecarAppRoot: "apps/ui-xr-iwsdk-spike/",
    currentState: "contract_only",
    runnable: false,
    createAppOnlyAfter: [
      "operator_accepts_iwsdk_install_scope",
      "exact_iwsdk_versions_selected",
      "license_review_accepts_transitive_dependency_posture",
      "pnpm_iwsdk_verify_passes",
    ],
    misleadingScaffoldRisks: [
      "A no-install sidecar app can look like runtime progress while proving no IWSDK behavior.",
      "A scaffold without exact IWSDK dependencies cannot measure Vite peer compatibility, install footprint, MCP runtime behavior, or Quest 3 frame pacing.",
    ],
  };
}

export function buildIwsdkPreInstallPackagePolicy(): IwsdkPreInstallPackagePolicy {
  return {
    exactVersionRequired: true,
    allowedFirstSlicePackages: ["@iwsdk/core", "@iwsdk/xr-input"],
    reviewRequiredPackages: [
      "@iwsdk/glxf",
      "@iwsdk/locomotor",
      "@iwsdk/vite-plugin-dev",
      "@iwsdk/vite-plugin-gltf-optimizer",
      "@iwsdk/vite-plugin-uikitml",
      "@iwsdk/vite-plugin-metaspatial",
    ],
    blockedPackages: ["@iwsdk/create", "@iwsdk/reference", "@iwsdk/starter-assets", "@meta-quest/hzdb"],
    blockedTransitivePackages: ["@img/sharp-libvips-darwin-arm64"],
    blockedLicenseExpressions: ["AGPL", "GPL", "LGPL", "UNLICENSED", "Unknown"],
    requiredPackageManagerControls: ["pin_exact_versions", "pin_three_override", "record_pnpm_audit", "record_license_policy_report"],
    requiredTransitivePackagesByPackageName: {
      "@iwsdk/core": buildIwsdkCoreRequiredTransitivePackageNames(),
    },
  };
}

export function buildIwsdkCoreRequiredTransitivePackageNames(): string[] {
  return [...iwsdkCoreRequiredTransitivePackages];
}

export function buildIwsdkCoreTransitivePackageLicenseEvidence(): Record<string, string> {
  return { ...iwsdkCoreTransitivePackageLicenses };
}

export function buildIwsdkAiModeProfiles(): IwsdkAiModeProfile[] {
  return [
    {
      mode: "agent",
      playwrightBrowser: "headless_fixed_viewport",
      devUi: "off",
      normalBrowser: "opens_independently",
      openclinxrUse: "Default unattended Codex smoke for screenshots, console logs, scene hierarchy, and controller-input regression.",
    },
    {
      mode: "oversight",
      playwrightBrowser: "visible_resizable",
      devUi: "off",
      normalBrowser: "playwright_browser",
      openclinxrUse: "Human-observed debug run when visual framing, text readability, or XR entry behavior needs review.",
    },
    {
      mode: "collaborate",
      playwrightBrowser: "visible_resizable",
      devUi: "on",
      normalBrowser: "playwright_browser",
      openclinxrUse: "Hands-on pairing session for controller, hand, or spatial UI tuning after the sidecar shell is stable.",
    },
  ];
}

export function buildIwsdkMcpToolCoverage(): IwsdkMcpToolCoverage[] {
  return [
    {
      category: "session",
      representativeTools: ["xr_get_session_status", "xr_accept_session"],
      evidenceUse: "XR entry readiness and session state before screenshots or controller actions.",
    },
    {
      category: "browser",
      representativeTools: ["browser_screenshot", "browser_get_console_logs"],
      evidenceUse: "Nonblank canvas and warning/error capture for unattended sidecar smoke.",
    },
    {
      category: "scene",
      representativeTools: ["scene_get_hierarchy"],
      evidenceUse: "Named station object presence without relying only on visual screenshots.",
    },
    {
      category: "transforms",
      representativeTools: ["xr_set_transform", "xr_look_at"],
      evidenceUse: "Repeatable headset/controller positioning for station framing checks.",
    },
    {
      category: "input_mode",
      representativeTools: ["xr_set_input_mode", "xr_set_connected"],
      evidenceUse: "Controller/hand tracking mode and device connectivity checks for repeatable station setup.",
    },
    {
      category: "select_trigger",
      representativeTools: ["xr_select", "xr_set_select_value"],
      evidenceUse: "Controller-triggered learner trace actions and grab/release interaction checks.",
    },
    {
      category: "gamepad",
      representativeTools: ["xr_get_gamepad_state", "xr_set_gamepad_state"],
      evidenceUse: "Thumbstick/button regression evidence for high-pressure station controls.",
    },
    {
      category: "device_state",
      representativeTools: ["xr_get_device_state", "xr_set_device_state"],
      evidenceUse: "Whole-device reset and headset/controller state snapshots for deterministic smoke setup.",
    },
    {
      category: "ecs",
      representativeTools: ["ecs_pause", "ecs_step", "ecs_query_entity"],
      evidenceUse: "Deterministic inspection of runtime entity state during scenario transitions.",
    },
  ];
}

export function buildIwsdkMcpToolInventory(): IwsdkMcpToolInventory {
  const categories: IwsdkMcpToolInventoryCategory[] = [
    {
      category: "session",
      tools: ["xr_get_session_status", "xr_accept_session", "xr_end_session"],
    },
    {
      category: "transforms",
      tools: ["xr_get_transform", "xr_set_transform", "xr_look_at", "xr_animate_to"],
    },
    {
      category: "input_mode",
      tools: ["xr_set_input_mode", "xr_set_connected"],
    },
    {
      category: "select_trigger",
      tools: ["xr_get_select_value", "xr_set_select_value", "xr_select"],
    },
    {
      category: "gamepad",
      tools: ["xr_get_gamepad_state", "xr_set_gamepad_state"],
    },
    {
      category: "device_state",
      tools: ["xr_get_device_state", "xr_set_device_state"],
    },
    {
      category: "browser",
      tools: ["browser_screenshot", "browser_get_console_logs", "browser_reload_page"],
    },
    {
      category: "scene",
      tools: ["scene_get_hierarchy", "scene_get_object_transform"],
    },
    {
      category: "ecs",
      tools: [
        "ecs_pause",
        "ecs_resume",
        "ecs_step",
        "ecs_query_entity",
        "ecs_find_entities",
        "ecs_list_systems",
        "ecs_list_components",
        "ecs_toggle_system",
        "ecs_set_component",
        "ecs_snapshot",
        "ecs_diff",
      ],
    },
  ];

  return {
    sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
    categories,
    allToolNames: categories.flatMap((category) => category.tools),
  };
}

export function buildIwsdkMcpToolInventoryRequirement(): IwsdkMcpToolInventoryRequirement {
  return {
    expectedToolCount: 32,
    sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
    expectedToolNames: buildIwsdkMcpToolInventory().allToolNames,
    requiredCategories: [
      "session",
      "transforms",
      "input_mode",
      "select_trigger",
      "gamepad",
      "device_state",
      "browser",
      "scene",
      "ecs",
    ],
    minimalSmokeSubset: [
      "xr_get_session_status",
      "xr_accept_session",
      "browser_screenshot",
      "scene_get_hierarchy",
      "xr_select",
      "browser_get_console_logs",
    ],
    readinessBlockersWhenMissing: [
      "mcp_tool_inventory_count_not_recorded",
      "mcp_tool_names_not_recorded",
      "mcp_expected_tool_missing",
      "mcp_unknown_tool_present",
      "mcp_required_category_missing",
      "mcp_smoke_subset_not_validated",
    ],
  };
}

export function buildIwsdkManagedBrowserEvidenceContract(): IwsdkManagedBrowserEvidenceContract {
  return {
    sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
    requiredModeEvidence: [
      {
        mode: "agent",
        managedBrowser: "headless Playwright browser with fixed screenshot viewport",
        normalBrowser: "opens independently with its own XR session",
        requiredEvidence: [
          "runtime_url",
          "managed_browser_ready",
          "managed_session_id",
          "normal_browser_opened",
          "normal_session_id",
          "session_ids_differ",
          "fixed_screenshot_size",
          "managed_devui_off",
          "normal_devui_on",
        ],
      },
      {
        mode: "oversight",
        managedBrowser: "visible resizable Playwright browser",
        normalBrowser: "suppressed by default",
        requiredEvidence: [
          "runtime_url",
          "managed_browser_ready",
          "managed_session_id",
          "normal_browser_not_opened",
          "managed_devui_off",
        ],
      },
      {
        mode: "collaborate",
        managedBrowser: "visible resizable Playwright browser with DevUI",
        normalBrowser: "suppressed by default",
        requiredEvidence: [
          "runtime_url",
          "managed_browser_ready",
          "managed_session_id",
          "normal_browser_not_opened",
          "managed_devui_on",
        ],
      },
    ],
    readinessBlockersWhenMissing: [
      "managed_browser_readiness_not_recorded",
      "normal_browser_independence_not_recorded_for_agent_mode",
      "devui_posture_not_recorded",
      "screenshot_size_not_recorded_for_agent_mode",
    ],
  };
}

export function evaluateIwsdkManagedBrowserEvidence(
  evidence: IwsdkManagedBrowserEvidence,
): IwsdkManagedBrowserEvidenceReadiness {
  const blockers: string[] = [];

  if (!evidence.runtimeUrl) {
    blockers.push("missing_runtime_url");
  }
  if (evidence.managedBrowserReady !== true) {
    blockers.push("managed_browser_not_ready");
  }
  if (!evidence.managedSessionId) {
    blockers.push("missing_managed_browser_session_id");
  }

  switch (evidence.mode) {
    case "agent":
      appendAgentModeBrowserBlockers(evidence, blockers);
      break;
    case "oversight":
      appendOversightModeBrowserBlockers(evidence, blockers);
      break;
    case "collaborate":
      appendCollaborateModeBrowserBlockers(evidence, blockers);
      break;
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function evaluateIwsdkAgentToolingEvidence(
  evidence: IwsdkAgentToolingEvidence,
): IwsdkAgentToolingEvidenceReadiness {
  const inventoryRequirement = buildIwsdkMcpToolInventoryRequirement();
  const blockers: string[] = [];

  if (evidence.adapterSyncRecorded !== true) {
    blockers.push("adapter_sync_not_recorded");
  }
  if (evidence.toolCount !== inventoryRequirement.expectedToolCount) {
    blockers.push("mcp_tool_inventory_count_not_32");
  }

  const expectedToolNames = buildIwsdkMcpToolInventory().allToolNames;
  if (!evidence.observedToolNames?.length) {
    blockers.push("mcp_tool_names_not_recorded");
  } else {
    for (const expectedToolName of expectedToolNames) {
      if (!evidence.observedToolNames.includes(expectedToolName)) {
        blockers.push(`mcp_tool_missing_${expectedToolName}`);
      }
    }

    for (const observedToolName of evidence.observedToolNames) {
      if (!expectedToolNames.includes(observedToolName as IwsdkMcpToolName)) {
        blockers.push(`mcp_tool_unknown_${observedToolName}`);
      }
    }
  }

  for (const category of inventoryRequirement.requiredCategories) {
    if (!evidence.coveredCategories.includes(category)) {
      blockers.push(`mcp_required_category_missing_${category}`);
    }
  }

  for (const tool of inventoryRequirement.minimalSmokeSubset) {
    if (!evidence.validatedSmokeTools.includes(tool)) {
      blockers.push(`mcp_smoke_tool_not_validated_${tool}`);
    }
  }

  if (!evidence.managedBrowserEvidence) {
    blockers.push("missing_managed_browser_evidence");
  } else {
    blockers.push(
      ...evaluateIwsdkManagedBrowserEvidence(evidence.managedBrowserEvidence).blockers.map((blocker) =>
        `managed_browser:${blocker}`
      ),
    );
  }

  const blockedOptionalActions = buildIwsdkOptionalMcpServerPolicy().flatMap((policy) => policy.blockedActions);
  for (const action of evidence.optionalServerActions ?? []) {
    if (blockedOptionalActions.includes(action)) {
      blockers.push(`optional_mcp_server_action_blocked:${action}`);
    }
  }

  const uniqueBlockers = unique(blockers);
  return {
    readyForAgentTooling: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
  };
}

export function buildIwsdkOptionalMcpServerPolicy(): IwsdkOptionalMcpServerPolicy[] {
  return [
    {
      serverName: "iwsdk-reference",
      packageName: "@iwsdk/reference",
      posture: "blocked_unattended",
      sourceRecordIds: ["src-iwsdk-ai-docs-2026", "src-iwsdk-npm-metadata-2026-05-04"],
      allowedOnlyAfter: ["operator_approval_for_model_and_corpus_downloads", "cache_location_documented"],
      blockedActions: ["npx iwsdk reference warmup"],
    },
    {
      serverName: "hzdb",
      packageName: "@meta-quest/hzdb",
      posture: "blocked",
      sourceRecordIds: ["src-iwsdk-ai-docs-2026", "src-iwsdk-npm-metadata-2026-05-04"],
      allowedOnlyAfter: ["legal_review_for_unlicensed_metadata", "procurement_approval"],
      blockedActions: ["install @meta-quest/hzdb"],
    },
  ];
}

export function evaluateIwsdkPreInstallPackageSelection(
  selectedPackages: IwsdkPackageSelection[],
  policy: IwsdkPreInstallPackagePolicy = buildIwsdkPreInstallPackagePolicy(),
): IwsdkPreInstallPackageSelectionResult {
  const blockers: string[] = [];
  const reviewWarnings: string[] = [];

  for (const selectedPackage of selectedPackages) {
    const blockerCountBeforePackageChecks = blockers.length;
    if (policy.exactVersionRequired && !isExactVersion(selectedPackage.version)) {
      blockers.push(`${selectedPackage.name}:version_not_exact`);
    }

    if (
      selectedPackage.name.startsWith("@iwsdk/")
      && !policy.allowedFirstSlicePackages.includes(selectedPackage.name)
      && !policy.blockedPackages.includes(selectedPackage.name)
    ) {
      blockers.push(`${selectedPackage.name}:not_allowed_in_first_slice`);
    }

    if (policy.blockedPackages.includes(selectedPackage.name)) {
      blockers.push(`${selectedPackage.name}:blocked_package`);
    }

    if (policy.reviewRequiredPackages.includes(selectedPackage.name)) {
      reviewWarnings.push(`${selectedPackage.name}:review_required_package`);
    }

    const blockedLicense = policy.blockedLicenseExpressions.find((licenseExpression) =>
      licenseExpressionMatches(selectedPackage.license, licenseExpression)
    );
    if (blockedLicense) {
      blockers.push(`${selectedPackage.name}:blocked_license_${blockedLicense}`);
    }

    for (const transitivePackage of selectedPackage.transitivePackages) {
      if (transitivePackageIsBlocked(transitivePackage, policy.blockedTransitivePackages)) {
        blockers.push(`${selectedPackage.name}:blocked_transitive_${transitivePackage}`);
      }
    }

    if (blockers.length === blockerCountBeforePackageChecks) {
      const requiredTransitivePackages = policy.requiredTransitivePackagesByPackageName[selectedPackage.name] ?? [];
      for (const requiredTransitivePackage of requiredTransitivePackages) {
        if (!selectedPackage.transitivePackages.includes(requiredTransitivePackage)) {
          blockers.push(`${selectedPackage.name}:missing_required_transitive_${requiredTransitivePackage}`);
        }
      }

      for (const transitivePackage of requiredTransitivePackages.filter((packageName) =>
        selectedPackage.transitivePackages.includes(packageName)
      )) {
        const transitiveLicense = selectedPackage.transitivePackageLicenses?.[transitivePackage];
        if (!transitiveLicense) {
          blockers.push(`${selectedPackage.name}:missing_transitive_license_${transitivePackage}`);
          continue;
        }
        const blockedTransitiveLicense = policy.blockedLicenseExpressions.find((licenseExpression) =>
          licenseExpressionMatches(transitiveLicense, licenseExpression)
        );
        if (blockedTransitiveLicense) {
          blockers.push(`${selectedPackage.name}:blocked_transitive_license_${transitivePackage}_${blockedTransitiveLicense}`);
        }
      }
    }
  }

  return {
    readyToInstallInSidecar: blockers.length === 0 && reviewWarnings.length === 0,
    blockers,
    reviewWarnings,
  };
}

export function evaluateIwsdkWorkspacePosture(
  input: IwsdkWorkspacePostureInput,
  policy: IwsdkPreInstallPackagePolicy = buildIwsdkPreInstallPackagePolicy(),
): IwsdkWorkspacePostureReadiness {
  const sidecarRoot = buildIwsdkSidecarReadinessContract().sidecarAppRoot;
  const executableIwsdkAllowedRoots = [sidecarRoot];
  const iwsdkDependencies = input.dependencies.filter((dependency) => dependencyReferencesIwsdkPackage(dependency));
  const iwsdkSourceReferences = input.sourceReferences.filter((reference) =>
    isIwsdkWorkspacePackage(reference.packageName)
  );
  const blockers: string[] = [];

  blockers.push(
    ...iwsdkDependencies
      .filter((dependency) => !pathStartsWithAllowedRoot(dependency.manifestPath, executableIwsdkAllowedRoots))
      .map((dependency) =>
        `dependency_outside_iwsdk_sidecar:${dependency.manifestPath}:${dependency.field}.${dependency.name}`
      ),
  );
  blockers.push(
    ...iwsdkSourceReferences
      .filter((reference) => !pathStartsWithAllowedRoot(reference.filePath, executableIwsdkAllowedRoots))
      .map((reference) => `source_import_outside_iwsdk_sidecar:${reference.filePath}:${reference.packageName}`),
  );
  blockers.push(
    ...iwsdkDependencies
      .map((dependency) => ({
        dependency,
        aliasTarget: iwsdkPackageNameFromSpecifier(dependency.version),
      }))
      .filter((reference): reference is { dependency: IwsdkWorkspaceDependency; aliasTarget: string } =>
        Boolean(reference.aliasTarget)
      )
      .map(({ dependency, aliasTarget }) =>
        `iwsdk_alias_specifier_not_allowed:${dependency.manifestPath}:${dependency.field}.${dependency.name}:${aliasTarget}`
      ),
  );
  blockers.push(...blockedWorkspaceScriptActions(input.scriptReferences));
  blockers.push(
    ...(input.packageManagerReferences ?? []).map((reference) =>
      `iwsdk_package_manager_reference_not_allowed:${reference.manifestPath}:${reference.location}:${reference.packageName}`
    ),
  );

  if (input.sidecarAppExists && !input.sidecarInstallApproved) {
    blockers.push("sidecar_app_present_without_operator_approval");
  }
  if (!input.sidecarAppExists && input.sidecarLockfileImporterPresent === true) {
    blockers.push("iwsdk_sidecar_lockfile_importer_without_sidecar_app");
  }

  const sidecarDependencies = iwsdkDependencies.filter((dependency) => dependency.manifestPath.startsWith(sidecarRoot));
  if (input.sidecarAppExists && input.sidecarInstallApproved && sidecarDependencies.length > 0
    && input.sidecarLockfileImporterPresent !== true) {
    blockers.push("missing_iwsdk_sidecar_lockfile_importer");
  }
  if (input.sidecarAppExists && input.sidecarInstallApproved && input.sidecarLockfileImporterPresent === true) {
    const sidecarLockfilePackageNames = input.sidecarLockfilePackageNames ?? [];
    const lockfileParityDependencies = sidecarDependencies.filter((dependency) => {
      const expectedPackageName = iwsdkPackageNameFromSpecifier(dependency.version) ?? dependency.name;
      return policy.allowedFirstSlicePackages.includes(expectedPackageName) && isExactVersion(dependency.version);
    });
    for (const dependency of lockfileParityDependencies) {
      const expectedPackageName = iwsdkPackageNameFromSpecifier(dependency.version) ?? dependency.name;
      if (!sidecarLockfilePackageNames.includes(expectedPackageName)) {
        blockers.push(`missing_iwsdk_sidecar_lockfile_dependency:${sidecarRoot.slice(0, -1)}:${expectedPackageName}`);
      }
    }
  }

  const sidecarSelection = evaluateIwsdkPreInstallPackageSelection(
    sidecarDependencies.map((dependency) => ({
      name: iwsdkPackageNameFromSpecifier(dependency.version) ?? dependency.name,
      version: dependency.version,
      license: "MIT",
      transitivePackages: [],
    })),
    { ...policy, requiredTransitivePackagesByPackageName: {} },
  );
  blockers.push(...sidecarSelection.blockers);

  for (const packageName of input.lockfilePackageNames) {
    if (policy.blockedPackages.includes(packageName)) {
      blockers.push(`blocked_package_in_lockfile:${packageName}`);
    } else if (transitivePackageIsBlocked(packageName, policy.blockedTransitivePackages)) {
      blockers.push(`blocked_transitive_package_in_lockfile:${packageName}`);
    } else if (!input.sidecarAppExists && isIwsdkWorkspacePackage(packageName)) {
      blockers.push(`iwsdk_package_in_lockfile_without_sidecar_app:${packageName}`);
    }
  }

  if (input.sidecarAppExists && input.sidecarInstallApproved) {
    appendWorkspacePackageManagerControlBlockers(input.packageManagerControls, blockers);
  }
  if (!input.packageManagerControls.workspacePostureInVerify) {
    blockers.push("iwsdk_workspace_posture_not_in_verify");
  }

  const reviewWarnings = [...sidecarSelection.reviewWarnings];
  const uniqueBlockers = dedupePreserveOrder(blockers);
  return {
    ready: uniqueBlockers.length === 0 && reviewWarnings.length === 0,
    sidecarStatus: sidecarStatusFor(input),
    blockers: uniqueBlockers,
    reviewWarnings,
  };
}

export function buildIwsdkAgentVerificationRunbook(options: {
  aiTool: IwsdkAiTool;
  mode: IwsdkAgentMode;
}): IwsdkAgentVerificationRunbook {
  const modeProfile = buildIwsdkAiModeProfiles().find((profile) => profile.mode === options.mode);
  if (!modeProfile) {
    throw new Error(`Unsupported IWSDK agent mode: ${options.mode}`);
  }

  return {
    mode: options.mode,
    modeProfile,
    aiTool: options.aiTool,
    adapterConfigTarget: adapterConfigTargetFor(options.aiTool),
    adapterSyncCommand: "iwsdk adapter sync",
    steps: [
      {
        id: "runtime-status",
        toolOrCommand: "iwsdk dev status",
        expectedEvidence: "Resolved runtime URL and managed-browser readiness are recorded before MCP calls.",
      },
      {
        id: "session-status",
        toolOrCommand: "xr_get_session_status",
        expectedEvidence: "XR session state and browser bridge readiness are available to the agent.",
      },
      {
        id: "enter-xr",
        toolOrCommand: "xr_accept_session",
        expectedEvidence: "The emulated XR session can be entered without browser console errors.",
      },
      {
        id: "first-screenshot",
        toolOrCommand: "browser_screenshot",
        expectedEvidence: "The XR station canvas is nonblank and captured at the configured screenshot size.",
      },
      {
        id: "scene-hierarchy",
        toolOrCommand: "scene_get_hierarchy",
        expectedEvidence: "Named station objects can be inspected without relying on visual screenshots alone.",
      },
      {
        id: "controller-select",
        toolOrCommand: "xr_select",
        expectedEvidence: "A right-controller select action can trigger one station UI affordance in the emulated runtime.",
      },
      {
        id: "console-errors",
        toolOrCommand: "browser_get_console_logs",
        expectedEvidence: "Recent warning/error logs are empty or captured as explicit blockers.",
      },
    ],
    doNotRunUnattended: [
      "npx iwsdk reference warmup",
      "install @meta-quest/hzdb",
      "adopt @iwsdk/vite-plugin-gltf-optimizer in production builds",
    ],
  };
}

export function buildIwsdkCodexMcpAdapterTemplate(): IwsdkCodexMcpAdapterTemplate {
  const runbook = buildIwsdkAgentVerificationRunbook({ aiTool: "codex", mode: "agent" });

  return {
    target: ".codex/config.toml",
    serverName: "iwsdk-runtime",
    tomlSnippet: [
      "[mcp_servers.iwsdk-runtime]",
      'command = "pnpm"',
      'args = ["exec", "iwsdk", "mcp", "stdio"]',
    ].join("\n"),
    prerequisites: [
      "Use only after apps/ui-xr-iwsdk-spike exists with exact IWSDK package versions installed.",
      "Run pnpm iwsdk:verify before adding the adapter to local Codex config.",
      "Keep the adapter local and reversible; do not commit .codex/config.toml changes.",
    ],
    validationCommandOrder: runbook.steps.map((step) => step.toolOrCommand),
    blockedActions: [...runbook.doNotRunUnattended],
  };
}

export function buildIwsdkViteAiDevConfigContract(): IwsdkViteAiDevConfigContract {
  return {
    status: "phase_2_after_sidecar_shell",
    sourceRecordIds: ["src-iwsdk-ai-docs-2026"],
    packageName: "@iwsdk/vite-plugin-dev",
    requiredOptions: {
      emulatorDevice: "metaQuest3",
      aiMode: "agent",
      aiTools: ["codex"],
      screenshotSize: { width: 500, height: 500 },
      verbose: true,
    },
    viteConfigSnippet: [
      "import { defineConfig } from 'vite';",
      "import { iwsdkDev } from '" + "@iwsdk/vite-plugin-dev" + "';",
      "",
      "export default defineConfig({",
      "  plugins: [",
      "    iwsdkDev({",
      "      emulator: { device: 'metaQuest3' },",
      "      ai: { mode: 'agent', tools: ['codex'], screenshotSize: { width: 500, height: 500 } },",
      "      verbose: true,",
      "    }),",
      "  ],",
      "});",
    ].join("\n"),
    requiredEvidence: [
      "vite_config_uses_iwsdk_dev_plugin",
      "ai_tools_includes_codex",
      "agent_mode_selected_for_unattended_runs",
      "quest3_emulator_selected",
      "screenshot_size_bounded",
      "adapter_sync_generates_codex_config",
      "runtime_status_records_browser_command_ready",
    ],
    blockedUntil: [
      "apps/ui-xr-iwsdk-spike_exists_with_exact_iwsdk_versions",
      "phase_1_runtime_shell_metrics_pass",
      "operator_accepts_iwsdk_install_scope",
      "license_review_accepts_transitive_dependency_posture",
    ],
    doNotRunUnattended: [
      "npx iwsdk reference warmup",
      "install @meta-quest/hzdb",
    ],
  };
}

function adapterConfigTargetFor(aiTool: IwsdkAiTool): string {
  switch (aiTool) {
    case "codex":
      return ".codex/config.toml";
    case "claude":
      return ".mcp.json";
    case "cursor":
      return ".cursor/mcp.json";
    case "copilot":
      return ".vscode/mcp.json";
  }
}

function appendWorkspacePackageManagerControlBlockers(
  controls: IwsdkWorkspacePackageManagerControls,
  blockers: string[],
): void {
  if (controls.threeOverrideExact !== true) {
    blockers.push("missing_package_manager_control_pin_three_override");
  }
  if (controls.auditScriptPresent !== true) {
    blockers.push("missing_package_manager_control_record_pnpm_audit");
  }
  if (controls.licenseScriptPresent !== true) {
    blockers.push("missing_package_manager_control_record_license_policy_report");
  }
}

function sidecarStatusFor(input: IwsdkWorkspacePostureInput): IwsdkWorkspaceSidecarStatus {
  if (!input.sidecarAppExists) {
    return "absent_contract_only";
  }
  return input.sidecarInstallApproved ? "present_approved" : "present_unapproved";
}

function pathStartsWithAllowedRoot(filePath: string, allowedRoots: string[]): boolean {
  return allowedRoots.some((root) => filePath.startsWith(root));
}

function isIwsdkWorkspacePackage(packageName: string): boolean {
  return packageName.startsWith("@iwsdk/") || packageName === "@meta-quest/hzdb";
}

function dependencyReferencesIwsdkPackage(dependency: IwsdkWorkspaceDependency): boolean {
  return isIwsdkWorkspacePackage(dependency.name) || iwsdkPackageNameFromSpecifier(dependency.version) !== undefined;
}

function iwsdkPackageNameFromSpecifier(specifier: string): string | undefined {
  const match = specifier.match(/^npm:(@iwsdk\/[^@]+|@meta-quest\/hzdb)@/);
  return match?.[1];
}

function blockedWorkspaceScriptActions(scriptReferences: IwsdkWorkspaceScriptReference[]): string[] {
  const blockedActions = [
    {
      id: "iwsdk_reference_warmup",
      pattern: /\biwsdk\s+reference\s+warmup\b/,
    },
    {
      id: "iwsdk_create",
      pattern: /(?:\biwsdk\s+create\b|@iwsdk\/create\b|\b(?:pnpm|npm|yarn|bun)\s+create\s+@iwsdk(?:@|\b))/,
    },
    {
      id: "iwsdk_starter_assets",
      pattern: /@iwsdk\/starter-assets\b/,
    },
    {
      id: "meta_quest_hzdb",
      pattern: /@meta-quest\/hzdb\b/,
    },
    {
      id: "iwsdk_gltf_optimizer",
      pattern: /@iwsdk\/vite-plugin-gltf-optimizer\b/,
    },
  ];

  return scriptReferences.flatMap((scriptReference) =>
    blockedActions
      .filter((action) => action.pattern.test(scriptReference.command))
      .map((action) =>
        `blocked_script_action:${scriptReference.manifestPath}:scripts.${scriptReference.scriptName}:${action.id}`
      )
  );
}

function appendAgentModeBrowserBlockers(evidence: IwsdkManagedBrowserEvidence, blockers: string[]): void {
  if (evidence.normalBrowserOpened !== true) {
    blockers.push("normal_browser_not_opened_independently");
  }
  if (!evidence.normalSessionId) {
    blockers.push("missing_normal_browser_session_id");
  } else if (evidence.managedSessionId && evidence.normalSessionId === evidence.managedSessionId) {
    blockers.push("normal_browser_session_not_independent");
  }
  if (!Number.isFinite(evidence.screenshotWidth) || !Number.isFinite(evidence.screenshotHeight)) {
    blockers.push("missing_agent_fixed_screenshot_size");
  }
  if (evidence.managedDevUiVisible !== false) {
    blockers.push("managed_devui_should_be_off");
  }
  if (evidence.normalDevUiVisible !== true) {
    blockers.push("normal_devui_should_be_on");
  }
}

function appendOversightModeBrowserBlockers(evidence: IwsdkManagedBrowserEvidence, blockers: string[]): void {
  if (evidence.normalBrowserOpened === true) {
    blockers.push("normal_browser_should_not_open_automatically");
  }
  if (evidence.managedDevUiVisible !== false) {
    blockers.push("managed_devui_should_be_off");
  }
}

function appendCollaborateModeBrowserBlockers(evidence: IwsdkManagedBrowserEvidence, blockers: string[]): void {
  if (evidence.normalBrowserOpened === true) {
    blockers.push("normal_browser_should_not_open_automatically");
  }
  if (evidence.managedDevUiVisible !== true) {
    blockers.push("managed_devui_should_be_on");
  }
}

function missingOrOverMax(
  value: number | undefined,
  maximum: number,
  missingBlocker: string,
  overBudgetBlocker: string,
): string | undefined {
  if (value === undefined) {
    return missingBlocker;
  }
  return value > maximum ? overBudgetBlocker : undefined;
}

function missingOrUnderMin(
  value: number | undefined,
  minimum: number,
  missingBlocker: string,
  underBudgetBlocker: string,
): string | undefined {
  if (value === undefined) {
    return missingBlocker;
  }
  return value < minimum ? underBudgetBlocker : undefined;
}

function foregroundQuestPreflightBlocker(value: boolean | undefined): string | undefined {
  if (value === true) {
    return undefined;
  }
  return value === false ? "foreground_quest_preflight_not_ready" : "missing_foreground_quest_preflight_ready";
}

function isExactVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function transitivePackageIsBlocked(transitivePackage: string, blockedTransitivePackages: string[]): boolean {
  const normalizedPackage = transitivePackage.toLowerCase();
  return blockedTransitivePackages.some((blockedPackage) => {
    const normalizedBlockedPackage = blockedPackage.toLowerCase();
    return normalizedPackage === normalizedBlockedPackage
      || (normalizedBlockedPackage.includes("sharp-libvips") && normalizedPackage.includes("sharp-libvips"));
  });
}

function licenseExpressionMatches(license: string, blockedExpression: string): boolean {
  const normalizedLicense = license.toLowerCase();
  const normalizedBlockedExpression = blockedExpression.toLowerCase();
  const escapedExpression = normalizedBlockedExpression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escapedExpression}([^a-z]|$)`).test(normalizedLicense);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}
