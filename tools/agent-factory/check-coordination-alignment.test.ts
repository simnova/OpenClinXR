import { describe, expect, it } from "vitest";
import { buildCoordinationAlignmentReport } from "./check-coordination-alignment.js";

const alignedFiles = {
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
  ].join("\n"),
  "PROJECT_COORDINATION_INDEX.md": [
    "Commit-History Drift Analysis",
    "Active Product Advancement Queue",
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
  ].join("\n"),
  "AUTONOMOUS_WORK_PLAN.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Active Product Advancement Queue",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Do not run another local voice/model/source-currentness refresh unless a concrete Worker 10 implementation slice needs it.",
    "Protected Blueprint-Factory Guardrails",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
    "generated-artifact-registry-2026-05-27.md",
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
  ].join("\n"),
  "docs/openclinxr/worker-backlog-and-validation-matrix.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Active Product Advancement Order",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Do not toil on evidence refreshes.",
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
  ].join("\n"),
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md": [
    "Protected Status",
    "must not delete, weaken, bypass, rename, or reinterpret",
    "OpenClinXR is not a collection of handcrafted XR scenes",
    "blueprint-driven encounter factory",
    "Conversation Tooling Is First-Class",
    "Required Slice Gate",
  ].join("\n"),
  "docs/openclinxr/doc-authority-registry-2026-05-27.md": [
    "Doc Authority Registry",
    "Protected Rule",
    "Highest-Value Current Navigation",
    "Cleanup Candidates",
  ].join("\n"),
  "docs/openclinxr/doc-authority-registry-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"protectedRule\"",
    "\"usageRule\"",
    "\"protected-policy\"",
  ].join("\n"),
  "docs/openclinxr/generated-artifact-registry-2026-05-27.md": [
    "Generated Artifact Registry",
    "Protected Rule",
    "Cleanup Actions",
    "current representative evidence",
  ].join("\n"),
  "docs/openclinxr/generated-artifact-registry-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"protectedRule\"",
    "\"usageRule\"",
    "\"keep-current\"",
  ].join("\n"),
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
  ].join("\n"),
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
  ].join("\n"),
  "agents/adversarial/openclaw-drift-police/charter.md": [
    "OpenClaw Drift Police",
    "Detect, challenge, and correct drift",
    "Do not implement product code.",
    "pnpm docs:drift-check",
    "case-definition-driven encounter factory",
  ].join("\n"),
  "agents/adversarial/openclaw-drift-police/memory.md": [
    "OpenClaw Drift Police Memory",
    "drift should be caught by `pnpm docs:drift-check`",
    "one-off screenshot loops",
    "pivot to a product-building slice",
  ].join("\n"),
  "agents/adversarial/openclaw-drift-police/index.json": [
    "\"agent_id\": \"openclaw-drift-police\"",
    "\"team\": \"adversarial\"",
    "\"drift-hardening\"",
  ].join("\n"),
  "docs/openclinxr/evidence-index-2026-05-27.md": [
    "Evidence Index",
    "Usage Rule",
    "Full application smoke evidence",
    "Humanoid and garment pipeline evidence",
  ].join("\n"),
  "docs/openclinxr/evidence-index-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"sourceRegistry\"",
    "\"laneSummaries\"",
    "\"unindexedEvidenceCount\"",
  ].join("\n"),
  "docs/openclinxr/worktree-cleanup-handoff-2026-05-27.md": [
    "Worktree Cleanup Handoff",
    "Counts",
    "Entries",
    "cleanup commits do not accidentally absorb unrelated product work",
  ].join("\n"),
  "docs/openclinxr/worktree-cleanup-handoff-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"usageRule\"",
    "\"counts\"",
    "\"entries\"",
  ].join("\n"),
  "docs/agent-factory/README.md": [
    "Implementation-Time Steering Rule",
    "PROJECT_COORDINATION_INDEX.md",
    "focus memory",
  ].join("\n"),
  "iterations/iteration-0009/07-final-synthesis.md": [
    "do not let evidence closure become the product",
    "learner, faculty, admin, XR runtime, scenario bank, persistence, provider, or asset pipeline",
  ].join("\n"),
};

const alignedScripts = {
  "openclaw:preflight": "pnpm openclaw:ready",
  "openclaw:post-slice": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice",
  "openclaw:automation-prompt": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt",
  "openclaw:ready": "tsx tools/agent-factory/check-openclaw-readiness.ts",
  "agent:alignment": "tsx tools/agent-factory/check-coordination-alignment.ts",
  "docs:authority": "tsx tools/agent-factory/build-doc-authority-registry.ts",
  "docs:artifacts": "tsx tools/agent-factory/build-generated-artifact-registry.ts",
  "docs:drift-check": "tsx tools/agent-factory/check-openclaw-drift.ts",
  "docs:evidence-index": "tsx tools/agent-factory/build-evidence-index.ts",
  "docs:worktree-cleanup": "tsx tools/agent-factory/build-worktree-cleanup-report.ts",
  "agent:verify": "pnpm agent:alignment && pnpm agent:validate",
};

describe("coordination alignment hook", () => {
  it("passes when the coordinator index is wired into the active instruction surface", () => {
    const report = buildCoordinationAlignmentReport({
      files: alignedFiles,
      packageJson: { scripts: alignedScripts },
    });

    expect(report).toMatchObject({ ok: true, failures: [] });
  });

  it("fails when stale autonomous-plan breadcrumbs can pull agents back into evidence toil", () => {
    const report = buildCoordinationAlignmentReport({
      files: {
        ...alignedFiles,
        "AUTONOMOUS_WORK_PLAN.md": `${alignedFiles["AUTONOMOUS_WORK_PLAN.md"]}\nNext Task C slice: refresh another evidence report.\n`,
      },
      packageJson: { scripts: alignedScripts },
    });

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "AUTONOMOUS_WORK_PLAN.md",
      message: "stale historical breadcrumb remains: ^Next Task C\\b",
    });
  });

  it("fails when agent verification no longer runs the alignment hook first", () => {
    const report = buildCoordinationAlignmentReport({
      files: alignedFiles,
      packageJson: {
        scripts: {
          ...alignedScripts,
          "agent:verify": "pnpm agent:validate && pnpm agent:alignment",
        },
      },
    });

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "package.json",
      message: "agent:verify must run agent:alignment before broader agent checks",
    });
  });
});
