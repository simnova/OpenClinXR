import type { HarnessKind } from "./role-harness-policy.js";
import { scoreWeights } from "./types.js";
import type {
  ScoreDimension,
  AgentTeam,
  AgentRole,
  AgentMemoryEntry,
  AgentMemoryIndex,
  SerializableAgentMemoryIndex,
  IterationDebt,
  IterationRisk,
  IterationScorecard,
  LegacyScorecard,
  MaturityTrend,
  MaturityDelta,
  WorkOrderStage,
  AgentWorkOrder,
  NextAction,
  LeadershipGate,
  AgentLoopPlan,
  SerializableAgentLoopPlan,
  AgentDispatchPacket,
  BackgroundAgentTaskType,
  BackgroundAgentModelName,
  BackgroundAgentReasoningEffort,
  BackgroundAgentPolicyTier,
  ModelAssistBridge,
  BackgroundAgentModelRecommendation,
  AgentWorkflowSkillId,
  AgentWorkflowSkillRecommendation,
  RecommendBackgroundAgentModelInput,
  CreateAgentLoopPlanInput,
  EvaluateMaturityDeltaInput,
} from "./types.js";
import {
  openaiEquivalentForTier,
  policyTierForTaskType,
  rationaleForTaskType,
  harnessModelForTask,
  mapToRecord,
  compareMemoryEntries,
  groupEntries,
  lowDimensions,
  leadershipBlockers,
  workOrdersFor,
  leadershipAgentsFor,
  nextActionsFor,
  agentsForDimensions,
  dimensionsForOwnerOrText,
  priorityDimensions,
  ownerForDimension,
  isClinicalSpecialtyDimension,
  isLegalDimension,
  uniqueAgentIds,
  uniqueSkillRecommendations,
  matchesAny,
  roundScore,
} from "./internal.js";

export function recommendBackgroundAgentModel(input: RecommendBackgroundAgentModelInput): BackgroundAgentModelRecommendation {
  const harness = input.harness ?? "openai_default";
  const policyTier = policyTierForTaskType(input.taskType);
  const { model, reasoningEffort } = harnessModelForTask(input.taskType, harness);
  const openaiEq = openaiEquivalentForTier(policyTier);
  const recommendation: BackgroundAgentModelRecommendation = {
    taskType: input.taskType,
    model,
    reasoningEffort,
    policyTier,
    rationale: rationaleForTaskType(input.taskType),
    harness,
    ...(openaiEq !== undefined ? { openaiEquivalent: openaiEq } : {}),
    productionPipelineAssistNote:
      "Factory asset generation and scene optimization may require agentic evaluation behind a swappable ModelAssistProvider; procedural-only pipelines are a goal, not the current guarantee.",
  };

  if (harness === "codex" && (policyTier === "fast_bounded" || policyTier === "expert_review")) {
    recommendation.codexAssistBridge = "moonbridge";
    recommendation.rationale = `${recommendation.rationale} Codex Desktop cannot select DeepSeek directly; optional Moonbridge first-pass assist is allowed for bounded review only.`;
  } else {
    recommendation.codexAssistBridge = "none";
  }

  return recommendation;
}

export function recommendAgentModelForWorkOrder(order: Pick<AgentWorkOrder, "stage">): BackgroundAgentModelRecommendation {
  switch (order.stage) {
    case "core_revision":
      return recommendBackgroundAgentModel({ taskType: "implementation_worker" });
    case "physician_specialty_review":
    case "legal_governance_review":
      return recommendBackgroundAgentModel({ taskType: "specialist_review" });
    case "adversarial_counterplan":
      return recommendBackgroundAgentModel({ taskType: "adversarial_review" });
    case "leadership_preflight":
      return recommendBackgroundAgentModel({ taskType: "leadership_preflight" });
    case "leadership_review":
      return recommendBackgroundAgentModel({ taskType: "leadership_synthesis" });
  }
}

export function recommendWorkflowSkillsForWorkOrder(
  order: Pick<AgentWorkOrder, "stage" | "goal" | "dimensions" | "memoryTopics">,
): AgentWorkflowSkillRecommendation[] {
  const text = [
    order.stage,
    order.goal,
    ...order.dimensions,
    ...order.memoryTopics,
  ].join(" ").toLowerCase();
  const recommendations: AgentWorkflowSkillRecommendation[] = [];

  if (matchesAny(text, ["graphql", "apollo", "schema", "operation", "resolver", "codegen"])) {
    recommendations.push({
      id: "apollo-graphql-skills",
      name: "Apollo GraphQL Skills",
      sourceUrl: "https://github.com/apollographql/skills",
      sourceRecordId: "src-apollo-graphql-skills-2026",
      useWhen: "Use for GraphQL schema, operation, Apollo Client, Rover, and GraphQL MCP review.",
      guardrails: [
        "Treat as advisory workflow guidance, not a runtime dependency.",
        "Back recommendations with generated documents, repository tests, and selected GraphQL Code Generator/Apollo versions.",
      ],
    });
  }

  if (matchesAny(text, ["turbo", "turborepo", "monorepo", "package task", "package-task", "cache", "affected", "ci pipeline", "continuous integration"])) {
    recommendations.push({
      id: "turborepo-skill",
      name: "Turborepo Skill",
      sourceUrl: "https://github.com/vercel/turborepo/blob/main/skills/turborepo/SKILL.md",
      sourceRecordId: "src-turborepo-skill-2026",
      useWhen: "Use for package task orchestration, cache behavior, affected-package execution, and CI build graph design.",
      guardrails: [
        "Keep task logic package-local and root scripts delegated through turbo run.",
        "Keep anonymous telemetry disabled in repo scripts and keep remote caching opt-in.",
      ],
    });
  }

  if (matchesAny(text, ["ant design", "antd", "admin ui", "component props", "table", "form", "design token", "design system", "semantic class"])) {
    recommendations.push({
      id: "ant-design-cli-skill",
      name: "Ant Design CLI Skill",
      sourceUrl: "https://github.com/ant-design/ant-design-cli/blob/main/skills/antd/SKILL.md",
      sourceRecordId: "src-ant-design-cli-skill-2026",
      useWhen: "Use for Ant Design 6 component props, demos, semantic class names, tokens, and doctor checks.",
      guardrails: [
        "Prefer package-managed execution over an untracked global install.",
        "Query exact-version APIs with JSON output before writing or changing Ant Design components.",
        "Keep AntD CLI lint advisory until the local ERR_REQUIRE_ESM failure is resolved.",
      ],
    });
  }

  if (matchesAny(text, ["storybook", "story", "visual", "component state", "workshop"])) {
    recommendations.push({
      id: "storybook-mcp",
      name: "Storybook MCP Addon",
      sourceUrl: "https://storybook.js.org/docs/ai/mcp/overview",
      sourceRecordId: "src-storybook-addon-mcp-2026",
      useWhen: "Use when Storybook stories become maintained admin/XR component artifacts for local agent inspection.",
      guardrails: [
        "Keep optional until Storybook and addon packages are installed deliberately.",
        "Use alongside component tests rather than as a replacement for repository verification.",
      ],
    });
  }

  if (matchesAny(text, [
    "asset pipeline",
    "asset generation",
    "blender",
    "rigging",
    "animation",
    "medical equipment",
    "mesh",
    "material",
    "scene fidelity",
    "avatar",
  ])) {
    recommendations.push({
      id: "blender-mcp",
      name: "Blender MCP Candidate",
      sourceUrl: "https://www.blender.org/lab/mcp-server/",
      sourceRecordId: "src-blender-mcp-operator-reference-2026",
      sourceRecordIds: [
        "src-blender-license-2026",
        "src-blender-mcp-operator-reference-2026",
      ],
      useWhen: "Use for optional local Blender scene, mesh, rigging, material, generated-equipment, and screenshot automation assessment.",
      guardrails: [
        "Do not install or configure Blender MCP without an explicit proposal and local-only security review.",
        "Keep GPL Blender executable posture separate from generated artwork and review every add-on/server license independently.",
        "Treat MCP evidence as local-only developer automation until production or CI usage is explicitly approved.",
        "Keep the existing Blender CLI bake and asset-production readiness checks as the baseline until MCP adds measurable value.",
      ],
    });
  }

  if (matchesAny(text, ["iwsdk", "immersive web sdk", "webxr", "xr input", "controller input", "scene graph", "spatial ui", "locomotion", "ecs debugging"])) {
    recommendations.push({
      id: "meta-iwsdk-mcp",
      name: "Meta Immersive Web SDK MCP Tooling",
      sourceUrl: "https://iwsdk.dev/ai/",
      sourceRecordId: "src-iwsdk-ai-docs-2026",
      sourceRecordIds: [
        "src-meta-iwsdk-github-2026",
        "src-iwsdk-ai-docs-2026",
        "src-iwsdk-npm-metadata-2026-05-04",
        "src-iwsdk-local-spike-2026-05-04",
        "src-openclinxr-iwsdk-spike-plan-2026-05-04",
      ],
      useWhen: "Use for optional WebXR scene inspection, controller input simulation, ECS debugging, XR screenshots, and IWSDK spike planning.",
      guardrails: [
        "Keep advisory until a committed isolated spike resolves the observed Vite 8 compatibility peer mismatch, Node 22 execution path, package weight, and Quest 3 behavior.",
        "For Codex-oriented MCP verification, generate the .codex/config.toml adapter entry deliberately and call xr_get_session_status before accepting or manipulating an XR session.",
        "Do not use optional @meta-quest/hzdb without legal review because npm metadata reports UNLICENSED.",
        "Treat sharp/libvips LGPL and Unknown pmndrs license metadata from the local scratch spike as dependency-governance blockers until resolved.",
        "Do not run reference warmup or model/corpus downloads unattended.",
      ],
    });
  }

  if (
    matchesAny(text, [
      "openclaw",
      "repo-agent",
      "autonomous",
      "lease",
      "run-next",
      "coordination",
      "rehydrate",
      "heartbeat",
    ])
  ) {
    recommendations.push({
      id: "openclinxr-openclaw",
      name: "OpenClinXR OpenClaw Bridge",
      useWhen: "Use for OpenClaw-style autonomy, repo-agent consultation, lease/run-next, and cross-harness alignment.",
      guardrails: [
        "Rehydrate from AGENTS.md and the three state snapshots before selecting work.",
        "Canonical state updates belong in coordination files, not chat summaries.",
      ],
    });
  }

  if (
    matchesAny(text, [
      "anny",
      "humanoid",
      "rigging",
      "skin",
      "clothing",
      "glb",
      "model vetting",
      "cagematch",
      "blender",
      "mpfb2",
      "realvisxl",
      "stablegen",
    ])
  ) {
    recommendations.push({
      id: "anny-asset-pipeline",
      name: "Anny Asset Pipeline",
      useWhen: "Use for Anny-compatible humanoid generation, Blender rigging, preflight, and cagematch promotion gates.",
      guardrails: [
        "Keep Anny output candidate-only until license, provenance, rig, actor-role mapping, and visual evidence gates clear.",
        "Do not promote real-Anny, B+, Quest, production, learner, clinical, or scoring readiness from fixture evidence.",
      ],
    });
  }

  if (
    matchesAny(text, [
      "provider",
      "moonbridge",
      "deepseek",
      "comfyui",
      "stablegen",
      "realvisxl",
      "paid api",
      "credentials",
      "license",
      "provenance",
      "model assist",
      "anny",
      "cagematch",
      "model vetting",
    ])
  ) {
    recommendations.push({
      id: "provider-boundary",
      name: "Provider Boundary",
      useWhen: "Use when work touches local-only or approval-gated providers, credentials, paid APIs, or model-assist bridges.",
      guardrails: [
        "Moonbridge is a Codex Desktop-only optional first-pass assist bridge; Grok should prefer direct DeepSeek when available.",
        "Production pipelines may use swappable ModelAssistProvider bridges for agentic evaluation, not as readiness claims.",
        "Do not enable paid/cloud providers or credentials without explicit approval.",
      ],
    });
  }

  if (order.dimensions.includes("architecture_coherence") || matchesAny(text, ["architecture", "boundary", "boundaries", "import", "cycle", "archunit"])) {
    recommendations.push({
      id: "archunitts",
      name: "ArchUnitTS",
      sourceUrl: "https://github.com/LukasNiessen/ArchUnitTS",
      sourceRecordId: "src-archunit-ts-github-2026",
      useWhen: "Use to turn architecture decisions into executable package, import, and dependency-boundary checks.",
      guardrails: [
        "Prefer narrow rules with clear ownership and low false-positive risk.",
        "Keep rules in package-local tests so pnpm verify and Turbo package tasks enforce them.",
      ],
    });
  }

  return uniqueSkillRecommendations(recommendations);
}

