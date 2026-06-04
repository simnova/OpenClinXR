import { describe, expect, it } from "vitest";

import { buildOperationalRedundancyReport, type OperationalRedundancyInput } from "./check-openclaw-operational-redundancy.js";

const packageJson = {
  scripts: {
    "openclaw:preflight": "pnpm openclaw:ready",
    "openclaw:post-slice": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice",
    "openclaw:automation-prompt": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt",
    "openclaw:run-next": "tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts",
    "openclaw:watchdog": "tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts --watchdog",
  },
};

const sliceFields = [
  "Product path advanced",
  "Blueprint/factory tie",
  "Touched files",
  "Evidence",
  "Next queued slice",
].join("\n");

function alignedInput(overrides: Partial<OperationalRedundancyInput> = {}): OperationalRedundancyInput {
  return {
    packageJson,
    files: {
      "README.md": "Copy-paste kickoff prompts",
      "AGENTS.md": "OpenClaw",
      "PROJECT_COORDINATION_INDEX.md": "OpenClaw",
      "AUTONOMOUS_WORK_PLAN.md": sliceFields,
      "docs/openclinxr/worker-backlog-and-validation-matrix.md": sliceFields,
      "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md": "Codex Adapter\nClaude Adapter\nGrok Adapter\nCursor Adapter\nCapability Fallback Matrix",
      "docs/openclinxr/openclaw-runbook-2026-05-27.md": [
        "OpenClaw-style execution pattern",
        "not an external OpenClaw runtime",
        "pnpm openclaw:preflight",
        "pnpm openclaw:post-slice",
        "pnpm openclaw:automation-prompt",
        "pnpm openclaw:run-next",
        "pnpm openclaw:watchdog",
        sliceFields,
        "## Canonical Automation Prompt",
        "```text",
        "Continue in repo-native OpenClaw mode in /Volumes/files/src/openclinxr.",
        "Stay focused on the case-definition-driven WebXR encounter factory.",
        "After each slice, run focused verification when appropriate.",
        "Stop only if explicitly told to pause/stop or if all approved lanes are truly blocked.",
        "```",
      ].join("\n"),
    },
    ...overrides,
  };
}

describe("OpenClaw operational redundancy checker", () => {
  it("passes when preflight, post-slice, prompt, and ledger guardrails are aligned", () => {
    expect(buildOperationalRedundancyReport(alignedInput())).toMatchObject({ ok: true, failures: [] });
  });

  it("fails when the preflight script is missing", () => {
    const report = buildOperationalRedundancyReport(alignedInput({
      packageJson: { scripts: {} },
    }));

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "package.json",
      message: "openclaw:preflight must be wired to 'pnpm openclaw:ready'",
    });
  });

  it("fails when the quiet slice runner script is missing", () => {
    const input = alignedInput({
      packageJson: {
        scripts: {
          "openclaw:preflight": "pnpm openclaw:ready",
          "openclaw:post-slice": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice",
          "openclaw:automation-prompt": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt",
        },
      },
    });

    const report = buildOperationalRedundancyReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "package.json",
      message: "openclaw:run-next must be wired to 'tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts'",
    });
  });

  it("fails if the runbook claims pattern without clarifying no external runtime", () => {
    const input = alignedInput();
    input.files["docs/openclinxr/openclaw-runbook-2026-05-27.md"] = input.files["docs/openclinxr/openclaw-runbook-2026-05-27.md"].replace("not an external OpenClaw runtime", "");
    const report = buildOperationalRedundancyReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "docs/openclinxr/openclaw-runbook-2026-05-27.md",
      message: "missing operational redundancy marker: not an external OpenClaw runtime",
    });
  });
});
