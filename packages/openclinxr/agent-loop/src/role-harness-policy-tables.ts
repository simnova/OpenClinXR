/**
 * Role policy DATA tables for role-harness-policy.ts (#363) — split data from logic.
 * buildRoleHarnessPolicies is a function, not a const table: entries resolve pathScope
 * via getRolePathScope (imported from role-harness-policy.ts). A top-level const would
 * call it mid-import-cycle, before COORD_READ in the host module is initialized (TDZ).
 * role-harness-policy.ts calls the builder once after its helpers are defined — safe.
 */
import { getRolePathScope } from "./role-harness-policy.js";
import type { RepoRoleHarnessPolicy, RolePathScope } from "./role-harness-policy.js";

// The scope table moved to role-path-scopes.ts (500-line zone budget). Re-exported so every
// existing importer of rolePathScopes keeps working.
export { rolePathScopes } from "./role-path-scopes.js";
import { rolePathScopes } from "./role-path-scopes.js";

/** Harness policy records per role — pathScope resolved via getRolePathScope at call time. */
export function buildRoleHarnessPolicies(): RepoRoleHarnessPolicy[] {
  return [
    {
      roleId: "chief-coordinator",
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Orchestration and state records only; do not patch product code.",
      pathScope: getRolePathScope("chief-coordinator"),
    },
    {
      roleId: "hrbp",
      // standard_execution → general-purpose write (roster revisions); not flash scout
      policyTier: "standard_execution",
      taskType: "specialist_review",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote:
        "Agent roster only: docs/agent-ops/**, .grok/agents|personas|roles, agents/** charters. No product apps/packages features. CLI-first MCP audit.",
      pathScope: getRolePathScope("hrbp"),
    },
    {
      roleId: "archivist",
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote:
        "Docs warehouse retrieval only: read docs/_archive + manifests + REVISION-INDEX/DOC-WAREHOUSE. Prefer zero writes; optional notes under .openclinxr/docs-archive/**. Never rewrite hot SSOT or product code. Manifests owned by pnpm docs:archive CLI.",
      pathScope: getRolePathScope("archivist"),
    },
    {
      roleId: "pmo",
      policyTier: "standard_execution",
      taskType: "specialist_review",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote:
        "PMO temporal cadence: DOC-HYGIENE-CADENCE, TEMPORAL-DECISIONS catalog/queue, REVISION-INDEX, hygiene last-run, weekly script. Prefer CLIs (docs:hygiene:*, temporal:review, docs:archive). Never product IC; never agent roster (hrbp); never cold rewrite (archivist). Analysis of due items is analysisOwnerRole — PMO only catalogs/surfaces/queues.",
      pathScope: getRolePathScope("pmo"),
    },
    {
      roleId: "openclaw-drift-police",
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Drift fixes in coordination surfaces only; never weaken protected factory guardrails.",
      pathScope: getRolePathScope("openclaw-drift-police"),
    },
    {
      roleId: "implementation-plan-gap-attacker",
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Read-only adversarial review unless explicitly assigned a non-overlapping doc fix.",
      pathScope: getRolePathScope("implementation-plan-gap-attacker"),
    },
    {
      roleId: "productivity-skeptic",
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Challenge fixture-grade progress; push toward tangible runtime/model evidence.",
      pathScope: getRolePathScope("productivity-skeptic"),
    },
    {
      roleId: "visual-realism-adversary",
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Adversary review artifacts only; do not promote B+ or readiness gates.",
      pathScope: getRolePathScope("visual-realism-adversary"),
    },
    {
      roleId: "implementation-planning-lead",
      policyTier: "standard_execution",
      taskType: "implementation_worker",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote: "Planning and sequencing guidance; implementation writes belong to the main worker unless disjoint.",
      pathScope: getRolePathScope("implementation-planning-lead"),
    },
    {
      roleId: "architect",
      policyTier: "standard_execution",
      taskType: "implementation_worker",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote:
        "Composition roots, cellix seedwork, architecture-rules, package topology docs — not feature apps. Residual host/DI/topology only; domain shells stay xr/asset.",
      pathScope: getRolePathScope("architect"),
    },
    {
      roleId: "asset-pipeline-lead",
      policyTier: "standard_execution",
      taskType: "implementation_worker",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline", "provider-boundary"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote: "May write in tools/openclinxr/asset-pipeline/, model-vetting studio, and ignored cagematch outputs when assigned.",
      pathScope: getRolePathScope("asset-pipeline-lead"),
    },
    {
      roleId: "imagine-trellis",
      policyTier: "standard_execution",
      taskType: "implementation_worker",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote:
        "TRELLIS escape-hatch imagine packs ONLY: .openclinxr/evidence/trellis-packs/** + trellis-escape-hatch/**. Model grok-4.6 via multimodal routing (grok-repo-agent-spawn.ts); never runs TRELLIS bake, no bake CLI ownership.",
      pathScope: getRolePathScope("imagine-trellis"),
    },
    {
      roleId: "rigging-animation-specialist",
      policyTier: "standard_execution",
      taskType: "implementation_worker",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw", "anny-asset-pipeline"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote: "May write rigging/animation pipeline surfaces when assigned a disjoint slice.",
      pathScope: getRolePathScope("rigging-animation-specialist"),
    },
    {
      roleId: "xr-systems-architect",
      policyTier: "standard_execution",
      taskType: "implementation_worker",
      sandboxMode: "workspace-write",
      recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote: "May write ui-xr production app, arena sidecars, and XR packages when assigned; no production IWSDK promotion.",
      pathScope: getRolePathScope("xr-systems-architect"),
    },
    {
      roleId: "pediatrics-physician",
      policyTier: "expert_review",
      taskType: "specialist_review",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Clinical wording and scenario review only; no scoring or validity claims.",
      pathScope: getRolePathScope("pediatrics-physician"),
    },
    {
      roleId: "clinical-safety-critic",
      policyTier: "expert_review",
      taskType: "specialist_review",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Safety critique and review-safe language only.",
      pathScope: getRolePathScope("clinical-safety-critic"),
    },
    {
      roleId: "license-provenance-specialist",
      policyTier: "expert_review",
      taskType: "specialist_review",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw", "provider-boundary"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Provenance and license review; do not enable paid/cloud providers.",
      pathScope: getRolePathScope("license-provenance-specialist"),
    },
    {
      roleId: "vp-engineering-delivery",
      policyTier: "frontier_thinking",
      taskType: "leadership_synthesis",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw", "turborepo-skill"],
      moonbridgeAssistOnCodex: false,
      writeScopeNote: "Leadership synthesis and sequencing judgment; not routine implementation.",
      pathScope: getRolePathScope("vp-engineering-delivery"),
    },
  ];
}
