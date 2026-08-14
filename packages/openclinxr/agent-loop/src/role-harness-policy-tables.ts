/**
 * Role policy DATA tables for role-harness-policy.ts (#363) — split data from logic.
 * buildRoleHarnessPolicies is a function, not a const table: entries resolve pathScope
 * via getRolePathScope (imported from role-harness-policy.ts). A top-level const would
 * call it mid-import-cycle, before COORD_READ in the host module is initialized (TDZ).
 * role-harness-policy.ts calls the builder once after its helpers are defined — safe.
 */
import { getRolePathScope } from "./role-harness-policy.js";
import type { RepoRoleHarnessPolicy, RolePathScope } from "./role-harness-policy.js";

/** Path scope definitions per role. readRoots = writeRoots + COORD_READ + agents/<role-dir>/** + slice brief/handoffs */
export const rolePathScopes: Record<string, RolePathScope> = {
  "chief-coordinator": {
    writeRoots: [
      "PROJECT_STATUS.md",
      "README.md",
      "docs/index.html",
      "docs/styles.css",
      "docs/agent-ops/**",
      "docs/openclinxr/worker-backlog-and-validation-matrix.md",
      "operator-*.md",
      ".openclinxr/slices/**",
      ".openclinxr/epics/**",
      "agents/coordinator/chief-coordinator/**",
      "tools/openclinxr/openclaw/**",
    ],
    readRoots: [],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/chief-coordinator.json"],
    preferredCli: [
      "pnpm openclaw:*",
      "pnpm openclaw:epic",
      "pnpm env:doctor",
      "pnpm agent:alignment",
      "pnpm docs:drift-check",
    ],
  },
  hrbp: {
    writeRoots: [
      "docs/agent-ops/**",
      "README.md",
      ".grok/agents/**",
      ".grok/personas/**",
      ".grok/roles/**",
      "agents/**/charter.md",
      "agents/**/memory.md",
    ],
    readRoots: [],
    forbidden: ["apps/**", "packages/openclinxr/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/hrbp.json"],
    preferredCli: ["pnpm agent:harness:sync", "pnpm agent:alignment"],
  },
  archivist: {
    // Prefer zero agent writes; manifests owned by pnpm docs:archive CLI.
    // Residual notes only under .openclinxr/docs-archive/** (+ own memory dir).
    writeRoots: [
      ".openclinxr/docs-archive/**",
      "agents/coordinator/archivist/**",
    ],
    readRoots: [
      "docs/_archive/**",
      "docs/agent-ops/DOC-WAREHOUSE.md",
      "docs/agent-ops/REVISION-INDEX.md",
      "docs/openclinxr/doc-authority-registry-2026-05-27.md",
      "docs/openclinxr/doc-authority-registry-2026-05-27.json",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
      ".openclinxr/slice-archive/**",
    ],
    forbidden: [
      "apps/**",
      "packages/**",
      "docs/agent-ops/PATH-SCOPE.md",
      "docs/agent-ops/CEO-VOICE.md",
      "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
      "docs/openclinxr/openclaw-runbook-2026-05-27.md",
      "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
      "AGENTS.md",
      "PROJECT_STATUS.md",
    ],
    outputRoots: [".openclinxr/slices/**/handoffs/archivist.json"],
    preferredCli: ["pnpm docs:archive status", "rg"],
  },
  pmo: {
    // Temporal cadence owner — hygiene + temporal-decision catalog; CLIs do the heavy lifts.
    writeRoots: [
      "docs/agent-ops/DOC-HYGIENE-CADENCE.md",
      "docs/agent-ops/REVISION-INDEX.md",
      "docs/agent-ops/DOC-WAREHOUSE.md",
      "docs/agent-ops/TEMPORAL-DECISIONS.md",
      "docs/agent-ops/temporal-decisions-catalog.json",
      "docs/agent-ops/temporal-review-queue.md",
      ".openclinxr/docs-hygiene/**",
      ".openclinxr/temporal-review/**",
      "agents/coordinator/pmo/**",
      "tooling/scripts/docs-hygiene-weekly.sh",
      ".grok/hooks/session-start-docs-hygiene.json",
    ],
    readRoots: [
      "docs/agent-ops/**",
      "docs/_archive/**",
      ".openclinxr/slice-archive/**",
      "PROJECT_STATUS.md",
      "AGENTS.md",
      ".grok/hooks/**",
    ],
    forbidden: [
      "apps/**",
      "packages/**",
      "docs/agent-ops/PATH-SCOPE.md",
      "docs/agent-ops/CEO-VOICE.md",
      "docs/agent-ops/COMPOSITION-ROOTS.md",
    ],
    outputRoots: [".openclinxr/slices/**/handoffs/pmo.json"],
    preferredCli: [
      "pnpm docs:hygiene:measure",
      "pnpm docs:hygiene:run",
      "pnpm docs:hygiene:session-start",
      "pnpm temporal:review",
      "pnpm temporal:due",
      "pnpm temporal:queue",
      "pnpm docs:archive status",
      "pnpm openclaw:checkpoint:archive",
      "pnpm openclaw:worktree:list",
    ],
  },
  "openclaw-drift-police": {
    writeRoots: [
      "docs/openclinxr/**",
      ".openclinxr/**",
      "agents/adversarial/openclaw-drift-police/**",
    ],
    readRoots: [],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/openclaw-drift-police.json"],
  },
  "implementation-plan-gap-attacker": {
    writeRoots: [
      "agents/adversarial/implementation-plan-gap-attacker/**",
    ],
    readRoots: [".openclinxr/slices/**/handoffs/**"],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/implementation-plan-gap-attacker.json"],
  },
  "productivity-skeptic": {
    writeRoots: [
      "agents/adversarial/productivity-skeptic/**",
    ],
    readRoots: [".openclinxr/slices/**/handoffs/**"],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/productivity-skeptic.json"],
  },
  "visual-realism-adversary": {
    writeRoots: [
      "agents/adversarial/visual-realism-adversary/**",
    ],
    readRoots: ["docs/**", ".openclinxr/slices/**/handoffs/**"],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/visual-realism-adversary.json"],
  },
  "implementation-planning-lead": {
    // Product-under-os: authoring/runtime wiring packages (was docs-only — blocked Q1/Q4 delivery)
    // apps/ui-admin: Q4 admin-ui-emission-bind (faculty review/replay bind to runtime emission)
    writeRoots: [
      "docs/openclinxr/**",
      "agents/core/implementation-planning-lead/**",
      "packages/openclinxr/scenario-runtime/**",
      "packages/openclinxr/review-workflow/**",
      "packages/openclinxr/shared-schemas/**",
      "packages/openclinxr/exam-assembly/**",
      "tools/openclinxr/**",
      "apps/ui-admin/**",
    ],
    readRoots: [".openclinxr/slices/**/handoffs/**", "packages/openclinxr/**", "apps/api/**", "apps/ui-admin/**"],
    forbidden: [
      "apps/ui-xr/**",
      "apps/arena/**",
      "packages/openclinxr/data-mongodb/**",
      "packages/openclinxr/asset-registry/**",
      "tools/openclinxr/asset-pipeline/**",
    ],
    outputRoots: [".openclinxr/slices/**/handoffs/implementation-planning-lead.json"],
    preferredCli: [
      "pnpm --filter @openclinxr/scenario-runtime test",
      "pnpm --filter @openclinxr/ui-admin test",
      "pnpm --filter @openclinxr/agent-loop test",
    ],
  },
  architect: {
    writeRoots: [
      "packages/cellix/**",
      "packages/openclinxr/architecture-rules/**",
      "packages/openclinxr/config-rolldown/**",
      "docs/agent-ops/COMPOSITION-ROOTS.md",
      "docs/madr/**",
      "agents/core/architect/**",
    ],
    readRoots: [],
    forbidden: [
      "apps/**",
      "packages/openclinxr/domain/**",
      "packages/openclinxr/scenario-runtime/**",
      "packages/openclinxr/data-mongodb/**",
      "packages/openclinxr/ui-shared/**",
      "tools/openclinxr/asset-pipeline/**",
    ],
    outputRoots: [".openclinxr/slices/**/handoffs/architect.json"],
    preferredCli: [
      "pnpm --filter @openclinxr/architecture-rules",
      "pnpm boundaries",
    ],
  },
  "asset-pipeline-lead": {
    writeRoots: [
      "tools/openclinxr/asset-pipeline/**",
      "apps/arena/model-vetting-studio/**",
      "tools/openclinxr/evidence/**",
      "docs/assets/**",
    ],
    readRoots: [],
    forbidden: ["apps/ui-admin/**", "apps/api/**", "packages/data-mongodb/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/asset-pipeline-lead.json"],
    preferredCli: ["pnpm --filter @openclinxr/asset-pipeline"],
  },
  "imagine-trellis": {
    // TRELLIS escape-hatch pack worker. Writes ONLY imagine packs the bake CLI consumes.
    // Model: task/role always triggers multimodal -> grok-4.6 in grok-repo-agent-spawn.ts
    // (image_gen/Read are Grok-only; never DeepSeek). No preferredCli = no bake CLI ownership.
    writeRoots: [
      ".openclinxr/evidence/trellis-packs/**",
      ".openclinxr/evidence/trellis-escape-hatch/**",
    ],
    readRoots: [],
    forbidden: ["tools/openclinxr/asset-pipeline/**", "apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/imagine-trellis.json"],
  },
  "rigging-animation-specialist": {
    writeRoots: [
      "tools/openclinxr/asset-pipeline/**",
      "tools/openclinxr/evidence/**",
    ],
    readRoots: [],
    forbidden: ["apps/api/**", "apps/ui-admin/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/rigging-animation-specialist.json"],
    preferredCli: ["pnpm --filter @openclinxr/asset-pipeline"],
  },
  "xr-systems-architect": {
    writeRoots: [
      "apps/ui-xr/**",
      "apps/arena/**",
      "packages/openclinxr/arena/**",
      "packages/openclinxr/xr/**",
      "tools/openclinxr/evidence/**",
    ],
    readRoots: [],
    forbidden: ["apps/api/**", "packages/data-mongodb/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/xr-systems-architect.json"],
    preferredCli: [
      "pnpm --filter @openclinxr/ui-xr",
      "pnpm asset:ui-xr:peds-adaptive-dialogue-capture",
      "pnpm asset:model-vetting:turntable-capture",
    ],
  },
  "pediatrics-physician": {
    writeRoots: [
      "agents/physicians/**",
      "packages/openclinxr/scenario-fixtures/**",
    ],
    readRoots: [],
    forbidden: ["apps/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/pediatrics-physician.json"],
  },
  "clinical-safety-critic": {
    writeRoots: [
      "agents/adversarial/clinical-safety-critic/**",
    ],
    readRoots: [],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/clinical-safety-critic.json"],
  },
  "license-provenance-specialist": {
    writeRoots: [
      "agents/legal/**",
      "docs/**",
      "tools/**",
    ],
    readRoots: [],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/license-provenance-specialist.json"],
  },
  "vp-engineering-delivery": {
    writeRoots: [
      "agents/leadership/**",
      "PROJECT_STATUS.md",
      "docs/**",
    ],
    readRoots: [],
    forbidden: ["apps/**", "packages/**"],
    outputRoots: [".openclinxr/slices/**/handoffs/vp-engineering-delivery.json"],
  },
};

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
