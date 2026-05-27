import { describe, expect, it } from "vitest";
import { buildOpenClawDriftReport, type OpenClawDriftInput } from "./check-openclaw-drift.js";

function alignedInput(overrides: Partial<OpenClawDriftInput> = {}): OpenClawDriftInput {
  const markdownFiles = [
    "AGENTS.md",
    "PROJECT_COORDINATION_INDEX.md",
    "AUTONOMOUS_WORK_PLAN.md",
    "docs/openclinxr/worker-backlog-and-validation-matrix.md",
    "docs/openclinxr/openclaw-runbook-2026-05-27.md",
    "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
  ];
  const generatedArtifactFiles = ["docs/openclinxr/generated-artifact-registry-2026-05-27.json"];
  return {
    files: {
      "AGENTS.md": "openclaw-runbook-2026-05-27.md\nopenclaw-tool-adapters-2026-05-27.md\ndocs:drift-check\nRequired Per-Slice Record",
      "PROJECT_COORDINATION_INDEX.md": "openclaw-runbook-2026-05-27.md\nopenclaw-tool-adapters-2026-05-27.md\ndocs:drift-check\nRequired Per-Slice Record",
      "AUTONOMOUS_WORK_PLAN.md": "openclaw-runbook-2026-05-27.md\ndocs:drift-check",
      "docs/openclinxr/worker-backlog-and-validation-matrix.md": "openclaw-runbook-2026-05-27.md\ndocs:drift-check",
      "docs/openclinxr/openclaw-runbook-2026-05-27.md": "protected OpenClaw control surface\nRequired Per-Slice Record\nCanonical Automation Prompt\npnpm docs:drift-check\ncase-definition-driven WebXR encounter factory\nopenclaw-tool-adapters-2026-05-27.md",
      "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md": "protected OpenClaw control surface\nOpenClaw is repo-native, not Codex-native\nCapability Fallback Matrix\nUniversal OpenClaw Prompt\nCodex Adapter\nClaude Adapter\nGrok Adapter\nCursor Adapter\nDrift Police Rule For All Hosts",
      "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md": "Protected Status",
      "docs/openclinxr/doc-authority-registry-2026-05-27.json": "{}",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.json": "{}",
    },
    markdownFiles,
    generatedArtifactFiles,
    docRegistry: { entries: markdownFiles.map((path) => ({ path, authority: "protected-policy" })) },
    artifactRegistry: { entries: generatedArtifactFiles.map((path) => ({ path, authority: "keep-current" })) },
    packageJson: {
      scripts: {
        "docs:drift-check": "tsx tools/agent-factory/check-openclaw-drift.ts",
        "agent:verify": "pnpm agent:alignment && pnpm agent:validate",
      },
    },
    ...overrides,
  };
}

describe("OpenClaw drift checker", () => {
  it("passes when canonical OpenClaw files, registries, and scripts are aligned", () => {
    expect(buildOpenClawDriftReport(alignedInput())).toMatchObject({ ok: true, failures: [] });
  });

  it("fails when a new Markdown artifact is not in the authority registry", () => {
    const report = buildOpenClawDriftReport(alignedInput({
      markdownFiles: ["AGENTS.md", "docs/openclinxr/random-status.md"],
    }));

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "docs/openclinxr/random-status.md",
      message: "Markdown file is not registered in the doc authority registry; run pnpm docs:authority or remove the scattered artifact",
    });
  });

  it("fails when generated artifacts are not classified", () => {
    const report = buildOpenClawDriftReport(alignedInput({
      generatedArtifactFiles: ["docs/openclinxr/unregistered-smoke.json"],
    }));

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "docs/openclinxr/unregistered-smoke.json",
      message: "generated artifact is not registered in the generated artifact registry; run pnpm docs:artifacts or ignore/delete the local artifact",
    });
  });

  it("fails when canonical files stop linking the runbook and drift checker", () => {
    const input = alignedInput();
    input.files["AGENTS.md"] = "openclaw-runbook-2026-05-27.md";
    const report = buildOpenClawDriftReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "AGENTS.md",
      message: "missing OpenClaw drift marker: docs:drift-check",
    });
  });
});
