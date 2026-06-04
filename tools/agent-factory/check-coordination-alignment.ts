import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type CoordinationAlignmentInput = {
  files: Record<string, string | undefined>;
  packageJson?: {
    scripts?: Record<string, string>;
  };
};

export type CoordinationAlignmentFailure = {
  file: string;
  message: string;
};

export type CoordinationAlignmentReport = {
  ok: boolean;
  checkedFiles: string[];
  failures: CoordinationAlignmentFailure[];
};

const requiredFiles = [
  "AGENTS.md",
  "PROJECT_COORDINATION_INDEX.md",
  "AUTONOMOUS_WORK_PLAN.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.json",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
  "docs/openclinxr/evidence-index-2026-05-27.md",
  "docs/openclinxr/evidence-index-2026-05-27.json",
  "agents/adversarial/openclaw-drift-police/charter.md",
  "agents/adversarial/openclaw-drift-police/memory.md",
  "agents/adversarial/openclaw-drift-police/index.json",
  "agents/coordinator/chief-coordinator/charter.md",
  "agents/coordinator/chief-coordinator/memory.md",
  "agents/core/implementation-planning-lead/charter.md",
  "agents/core/asset-pipeline-lead/charter.md",
  "agents/core/xr-systems-architect/charter.md",
  "docs/agent-factory/README.md",
  "iterations/iteration-0009/07-final-synthesis.md",
] as const;

const requiredMarkers: Record<string, string[]> = {
  "AGENTS.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Instruction Source-Of-Truth Order",
    "Anti-Toil Product Advancement Gate",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
    "generated-artifact-registry-2026-05-27.md",
    "openclaw-runbook-2026-05-27.md",
    "openclaw-tool-adapters-2026-05-27.md",
    "agents/adversarial/openclaw-drift-police/charter.md",
    "docs:drift-check",
    "Required Per-Slice Record",
    "Conversation tooling is first-class",
    "Hyper Token-Efficient & Long-Run Practices",
    "Efficient Rehydration + Working Model",
    "snapshots-first",
    "openclaw:lease",
    "UI-XR runtime evidence consumer",
    "Apple M1 Max 64 GB",
  ],
  "PROJECT_COORDINATION_INDEX.md": [
    "Commit-History Drift Analysis",
    "Active Product Advancement Queue",
    "Current State Snapshot",
    "Evidence-Toil Stop Rule",
    "Sub-Agent Work Order Template",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Protected Blueprint-Factory Guardrails",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
    "generated-artifact-registry-2026-05-27.md",
    "openclaw-runbook-2026-05-27.md",
    "openclaw-tool-adapters-2026-05-27.md",
    "docs:drift-check",
    "Required Per-Slice Record",
    "OpenClaw Drift Police",
    "Efficient Rehydration + Working Model",
    "Efficiency Quick Ref",
    "UI-XR runtime evidence consumer",
    "Apple M1 Max 64 GB",
    "openclaw:lease",
  ],
  "AUTONOMOUS_WORK_PLAN.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Active Product Advancement Queue",
    "Current State Snapshot",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Do not run another local voice/model/source-currentness refresh unless a concrete Worker 10 implementation slice needs it.",
    "Protected Blueprint-Factory Guardrails",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
    "generated-artifact-registry-2026-05-27.md",
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
    "Efficient Rehydration + Working Model",
    "Efficiency Quick Ref",
    "UI-XR runtime evidence consumer",
    "openclaw:lease",
    "Apple M1 Max 64 GB",
  ],
  "docs/openclinxr/worker-backlog-and-validation-matrix.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Active Product Advancement Order",
    "Current State Snapshot",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Do not toil on evidence refreshes.",
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
    "Efficient Rehydration + Working Model",
    "Efficiency Quick Ref",
    "UI-XR runtime evidence consumer",
    "openclaw:lease",
  ],
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md": [
    "Protected Status",
    "must not delete, weaken, bypass, rename, or reinterpret",
    "OpenClinXR is not a collection of handcrafted XR scenes",
    "blueprint-driven encounter factory",
    "Conversation Tooling Is First-Class",
    "Required Slice Gate",
  ],
  "docs/openclinxr/doc-authority-registry-2026-05-27.md": [
    "Doc Authority Registry",
    "Protected Rule",
    "Highest-Value Current Navigation",
    "Cleanup Candidates",
  ],
  "docs/openclinxr/doc-authority-registry-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"protectedRule\"",
    "\"usageRule\"",
    "\"protected-policy\"",
  ],
  "docs/openclinxr/generated-artifact-registry-2026-05-27.md": [
    "Generated Artifact Registry",
    "Protected Rule",
    "Cleanup Actions",
    "current representative evidence",
  ],
  "docs/openclinxr/generated-artifact-registry-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"protectedRule\"",
    "\"usageRule\"",
    "\"keep-current\"",
  ],
  "docs/openclinxr/openclaw-runbook-2026-05-27.md": [
    "protected OpenClaw control surface",
    "OpenClaw-style execution pattern",
    "not an external OpenClaw runtime",
    "OpenClaw Start Sequence",
    "Required Per-Slice Record",
    "Canonical Automation Prompt",
    "pnpm openclaw:ready",
    "pnpm openclaw:preflight",
    "pnpm openclaw:post-slice",
    "pnpm openclaw:automation-prompt",
    "pnpm docs:drift-check",
    "case-definition-driven WebXR encounter factory",
    "agents/adversarial/openclaw-drift-police/",
    "openclaw-tool-adapters-2026-05-27.md",
    "Token-Efficient & Long-Run Hyper-Opt Rules",
    "snapshots-first",
    "Efficiency Quick Ref",
  ],
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md": [
    "protected OpenClaw control surface",
    "OpenClaw is repo-native, not Codex-native",
    "Capability Fallback Matrix",
    "Universal OpenClaw Prompt",
    "Codex Adapter",
    "Claude Adapter",
    "Grok Adapter",
    "Cursor Adapter",
    "Drift Police Rule For All Hosts",
  ],
  "agents/adversarial/openclaw-drift-police/charter.md": [
    "OpenClaw Drift Police",
    "Detect, challenge, and correct drift",
    "Do not implement product code.",
    "pnpm docs:drift-check",
    "case-definition-driven encounter factory",
    "Hyper Token-Efficient",
    "snapshots",
    "lease",
    "UI-XR",
  ],
  "agents/adversarial/openclaw-drift-police/memory.md": [
    "OpenClaw Drift Police Memory",
    "drift should be caught by `pnpm docs:drift-check`",
    "one-off screenshot loops",
    "pivot to a product-building slice",
    "2026-05-28 hyper-optimization",
    "Efficiency Quick Ref",
  ],
  "agents/adversarial/openclaw-drift-police/index.json": [
    "\"agent_id\": \"openclaw-drift-police\"",
    "\"team\": \"adversarial\"",
    "\"drift-hardening\"",
    "2026-05-28",
    "UI-XR consumer",
  ],
  "docs/openclinxr/evidence-index-2026-05-27.md": [
    "Evidence Index",
    "Usage Rule",
    "Full application smoke evidence",
    "Humanoid and garment pipeline evidence",
  ],
  "docs/openclinxr/evidence-index-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"sourceRegistry\"",
    "\"laneSummaries\"",
    "\"unindexedEvidenceCount\"",
  ],
  "docs/agent-factory/README.md": [
    "Implementation-Time Steering Rule",
    "PROJECT_COORDINATION_INDEX.md",
    "focus memory",
  ],
  "iterations/iteration-0009/07-final-synthesis.md": [
    "do not let evidence closure become the product",
    "learner, faculty, admin, XR runtime, scenario bank, persistence, provider, or asset pipeline",
  ],
  "agents/coordinator/chief-coordinator/charter.md": [
    "Chief Coordinator",
    "Coordinate the full Core, Adversarial",
    "rehydrate",
    "snapshots",
    "lease",
    "OpenClaw",
  ],
  "agents/coordinator/chief-coordinator/memory.md": [
    "Chief Coordinator Memory",
    "2026-05-28 hyper-optimization",
    "Current State Snapshots",
    "Efficiency Quick Ref",
  ],
  "agents/core/implementation-planning-lead/charter.md": [
    "Implementation Planning Lead",
    "Convert mature architecture into executable code plans",
    "snapshots",
    "Efficiency Quick Ref",
    "lease",
    "OpenClaw continuous",
  ],
  "agents/core/asset-pipeline-lead/charter.md": [
    "Asset Pipeline Lead",
    "Own humanoid, clothing, skin",
    "snapshots",
    "lease",
    "UI-XR",
    "M1 Max",
    "blueprint",
  ],
  "agents/core/xr-systems-architect/charter.md": [
    "XR Systems Architect",
    "Protect the plan from unrealistic headset",
    "snapshots",
    "lease",
    "UI-XR runtime evidence consumer",
    "M1 Max 64GB",
  ],
};

const staleAutonomousBreadcrumbPatterns = [
  /^Next Task C\b/mu,
  /^Next Worker \d+\b/mu,
  /^Current continuation default after the 2026-05-21 validation-hardening pass\b/mu,
];

export function buildCoordinationAlignmentReport(input: CoordinationAlignmentInput): CoordinationAlignmentReport {
  const failures: CoordinationAlignmentFailure[] = [];

  for (const file of requiredFiles) {
    const text = input.files[file];
    if (typeof text !== "string") {
      failures.push({ file, message: "required coordination file is missing" });
      continue;
    }

    for (const marker of requiredMarkers[file] ?? []) {
      if (!text.includes(marker)) {
        failures.push({ file, message: `missing alignment marker: ${marker}` });
      }
    }
  }

  const autonomousPlan = input.files["AUTONOMOUS_WORK_PLAN.md"] ?? "";
  for (const pattern of staleAutonomousBreadcrumbPatterns) {
    if (pattern.test(autonomousPlan)) {
      failures.push({
        file: "AUTONOMOUS_WORK_PLAN.md",
        message: `stale historical breadcrumb remains: ${pattern.source}`,
      });
    }
  }

  const scripts = input.packageJson?.scripts ?? {};
  if (scripts["openclaw:preflight"] !== "pnpm openclaw:ready") {
    failures.push({
      file: "package.json",
      message: "openclaw:preflight script must run the readiness gate",
    });
  }
  if (scripts["openclaw:post-slice"] !== "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice") {
    failures.push({
      file: "package.json",
      message: "openclaw:post-slice script must run the operational redundancy checker",
    });
  }
  if (scripts["openclaw:automation-prompt"] !== "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt") {
    failures.push({
      file: "package.json",
      message: "openclaw:automation-prompt script must print the canonical automation prompt",
    });
  }
  if (scripts["openclaw:ready"] !== "tsx tools/agent-factory/check-openclaw-readiness.ts") {
    failures.push({
      file: "package.json",
      message: "openclaw:ready script must run the OpenClaw readiness checker",
    });
  }
  if (scripts["agent:alignment"] !== "tsx tools/agent-factory/check-coordination-alignment.ts") {
    failures.push({
      file: "package.json",
      message: "agent:alignment script must run the coordination alignment hook",
    });
  }
  if (scripts["docs:authority"] !== "tsx tools/agent-factory/build-doc-authority-registry.ts") {
    failures.push({
      file: "package.json",
      message: "docs:authority script must regenerate the Markdown authority registry",
    });
  }
  if (scripts["docs:artifacts"] !== "tsx tools/agent-factory/build-generated-artifact-registry.ts") {
    failures.push({
      file: "package.json",
      message: "docs:artifacts script must regenerate the generated artifact registry",
    });
  }
  if (scripts["docs:drift-check"] !== "tsx tools/agent-factory/check-openclaw-drift.ts") {
    failures.push({
      file: "package.json",
      message: "docs:drift-check script must run the OpenClaw drift checker",
    });
  }
  if (scripts["docs:evidence-index"] !== "tsx tools/agent-factory/build-evidence-index.ts") {
    failures.push({
      file: "package.json",
      message: "docs:evidence-index script must regenerate the evidence navigation index",
    });
  }
  if (scripts["docs:worktree-cleanup"] !== "tsx tools/agent-factory/build-worktree-cleanup-report.ts") {
    failures.push({
      file: "package.json",
      message: "docs:worktree-cleanup script must regenerate the local worktree cleanup cache",
    });
  }
  if (!scripts["agent:verify"]?.startsWith("pnpm agent:alignment && ")) {
    failures.push({
      file: "package.json",
      message: "agent:verify must run agent:alignment before broader agent checks",
    });
  }

  return {
    ok: failures.length === 0,
    checkedFiles: [...requiredFiles, "package.json"],
    failures,
  };
}

function loadInputFromWorkspace(): CoordinationAlignmentInput {
  const files: Record<string, string | undefined> = {};
  for (const file of requiredFiles) {
    files[file] = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }

  return {
    files,
    packageJson: JSON.parse(readFileSync("package.json", "utf8")) as CoordinationAlignmentInput["packageJson"],
  };
}

async function main(): Promise<void> {
  const report = buildCoordinationAlignmentReport(loadInputFromWorkspace());

  if (report.ok) {
    console.log(`Checked coordination alignment across ${report.checkedFiles.length} files.`);
    return;
  }

  for (const failure of report.failures) {
    console.error(`${failure.file}: ${failure.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
