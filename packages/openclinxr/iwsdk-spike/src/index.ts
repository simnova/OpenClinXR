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

export type IwsdkAgentMode = "agent" | "oversight" | "collaborate";
export type IwsdkAiTool = "codex" | "claude" | "cursor" | "copilot";

export type IwsdkAgentVerificationRunbook = {
  mode: IwsdkAgentMode;
  aiTool: IwsdkAiTool;
  adapterConfigTarget: string;
  steps: Array<{
    id: string;
    toolOrCommand: string;
    expectedEvidence: string;
  }>;
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
        name: "@iwsdk/reference",
        posture: "blocked_unattended",
        intendedUse: "Optional local IWSDK reference lookup after an operator approves model and reference-corpus downloads.",
        gates: ["operator_approval_for_model_and_corpus_downloads", "cache_location_documented"],
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
          "mcp_scene_hierarchy",
          "mcp_controller_select",
          "console_log_capture",
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

export function buildIwsdkAgentVerificationRunbook(options: {
  aiTool: IwsdkAiTool;
  mode: IwsdkAgentMode;
}): IwsdkAgentVerificationRunbook {
  return {
    mode: options.mode,
    aiTool: options.aiTool,
    adapterConfigTarget: adapterConfigTargetFor(options.aiTool),
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
