/**
 * Path scope DATA for every repo role: what each may write, read, and must not touch.
 *
 * Split out of role-harness-policy-tables.ts on 2026-09-08 at 512 lines against the 500-line zone
 * budget. The seam is data vs behaviour: this file is the table, that one builds the harness
 * policies from it. The budget is shrink-only and raising it was not an option, which is the point
 * of the rule — a policy table nobody can add a role to is a table that stops describing the repo.
 */
import type { RolePathScope } from "./role-harness-policy.js";

/** readRoots = writeRoots + COORD_READ + agents/<role-dir>/** + slice brief/handoffs */
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
      // Verified unowned 2026-10-20 (live-ci-repair slice-verify): HRBP owned charters and
      // memory but not its own roster index, which chief-coordinator touched red. Exact file only.
      "agents/coordinator/hrbp/index.json",
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
      // Future semantic ownership per HRBP ACCEPT_BOUNDED (final-role-owner-review):
      // narrow doc-authority-registry instrumentation only; prior violations NOT retrocompliant.
      // Exact literals only — no tools/** wildcard.
      "tools/agent-factory/build-doc-authority-registry.ts",
      "tools/agent-factory/doc-authority-registry/append.ts",
      "tools/agent-factory/doc-authority-registry/append.test.ts",
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
      // The product-API lane: no role owned apps/api or rest, so a worker correctly refused it.
      "apps/api/**",
      "packages/openclinxr/rest/**",
      // Same omission, same cause, found 2026-09-08. The composition-root migration took
      // apps/ui-admin from 11,941 lines to 239 by moving its behaviour into these three packages,
      // and left the ownership behind on the app. This role already owns apps/ui-admin/**.
      "packages/openclinxr/ui-route-admin/**",
      "packages/openclinxr/ui-route-shared/**",
      "packages/openclinxr/ui-shared/**",
      // agent-loop holds the harness policy that tools/openclinxr/** consumes, and this role
      // already owns tools/openclinxr/**. Splitting a policy from its only consumers had no owner.
      // NOTE: role-harness-policy.ts itself stays under the HRBP path-scope-policy sole-author
      // lock — PL edits there require HRBP review; this root grants no lock bypass.
      "packages/openclinxr/agent-loop/**",
      "packages/openclinxr/factory-stations/**",
      // Prospective 2026-10-24 (ph207 HRBP ACCEPT_BOUNDED): verified unowned across
      // ALL 18 roles — the assembled-exam API harness has no owner, and this role
      // already owns its consumer lane (apps/api, rest, exam-assembly, runtime).
      // Exact literal only — no tests/** wildcard; the optional second harness
      // test stays unadmitted. HELD: no harness-source edits until Main adopts
      // this policy + PL actual author review.
      "tests/openclinxr/helpers/assembled-exam-harness.ts",
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
      "packages/openclinxr-verification/architecture-rules/**",
      "packages/openclinxr/config-rolldown/**",
      "docs/agent-ops/COMPOSITION-ROOTS.md",
      "docs/madr/**",
      "agents/core/architect/**",
      // Verified unowned 2026-10-20 (live-ci-repair slice-verify): no role owned the
      // compute-facade implementation packages or the dependency lockfile. Exact roots only —
      // no packages/** or apps/** widening; feature/factory/capacity stays refused.
      "packages/openclinxr/compute-slots/**",
      "packages/openclinxr/service-local-compute/**",
      "pnpm-lock.yaml",
      // Verified unowned 2026-10-20 (root-package-role slice-verify): no role owned root
      // package.json (composition/test root for //#test:tools wiring). Exact file only -
      // no pnpm-workspace.yaml/vitest.config.ts/apps/packages broadening.
      "package.json",
      // Prospective 2026-10-21 (workspace-yaml-owner HRBP review): no role owns root
      // pnpm-workspace.yaml (verified unowned across ALL 18 roles; the 2026-10-20
      // package.json/pnpm-lock.yaml admission above was narrow root composition files
      // ONLY, explicitly no YAML). Architect is the composition/dependency owner
      // (package.json + pnpm-lock.yaml), so this exact literal belongs here
      // prospectively — no *.yaml/*.yml wildcard, no vitest.config.ts/other root
      // yaml broadening. HELD: no adoption until this policy is Main-adopted +
      // architect actual adoption review + user 1.4 consent.
      "pnpm-workspace.yaml",
      // Prospective 2026-10-24 (ci-config-ownership slice-verify): verified unowned
      // across ALL 18 roles — cold-CI repair needs .github/workflows/ci.yml +
      // turbo.json but no role owned either; knip.json also unowned. Architect is
      // the composition/dependency owner (package.json + pnpm-lock.yaml +
      // pnpm-workspace.yaml), so these 3 exact literals belong here prospectively —
      // no .github/** or *.json wildcard, no other root json/yml broadening.
      ".github/workflows/ci.yml",
      "turbo.json",
      "knip.json",
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
      // 2026-10-21: `-F` is the pnpm filter alias (verified identical help/filter
      // behavior); saves prompt chars vs `--filter` under the hard 4500 guard.
      "pnpm -F @openclinxr/architecture-rules",
      "pnpm boundaries",
    ],
  },
  "asset-pipeline-lead": {
    writeRoots: [
      "tools/openclinxr/asset-pipeline/**",
      "apps/arena/model-vetting-studio/**",
      "tools/openclinxr/evidence/**",
      "docs/assets/**",
      // The registry is this pipeline's output contract, and implementation-planning-lead is
      // explicitly forbidden from it (see its `forbidden`), so the boundary stays coherent.
      "packages/openclinxr/asset-registry/**",
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
      // motion-compiler had no owner; it is the humanoid motion pipeline, so it belongs here.
      "packages/openclinxr/motion-compiler/**",
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
      // packages/openclinxr/xr/ has never existed; every package this role makes is xr-<name>.
      "packages/openclinxr/xr-*/**",
      "tools/openclinxr/evidence/**",
      // Verified unowned 2026-10-20 (live-ci-repair slice-verify): stations/mouth-verifier
      // had no owner (XR touched it red). Exact package root only.
      "packages/openclinxr/stations/mouth-verifier/**",
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
