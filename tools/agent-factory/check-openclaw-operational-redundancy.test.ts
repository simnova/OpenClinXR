import { describe, expect, it } from "vitest";

import { buildOperationalRedundancyReport, type OperationalRedundancyInput } from "./check-openclaw-operational-redundancy.js";

const packageJson = {
  scripts: {
    "openclaw:preflight": "pnpm openclaw:ready",
    "openclaw:post-slice": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice",
    "openclaw:automation-prompt": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt",
    "openclaw:run-next": "tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts",
    "openclaw:watchdog": "tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts --watchdog",
    "grok:hook": "tsx tools/openclinxr/openclaw/codex-lifecycle-hook.ts",
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
      "AGENTS.md": "OpenClaw-style / OpenClaw-inspired\nPlatform Instruction Override\nplatform-autonomy-override.md\nconversation-summary handoff",
      ".codex/config.toml": "project_doc_max_bytes = 65536\nmulti_agent = true\nmax_depth = 1",
      ".codex/hooks.json": "SubagentStart\nSubagentStop\nStop\npnpm codex:hook -- subagent-start\npnpm codex:hook -- subagent-stop\npnpm codex:hook -- stop",
      ".codex/rules/openclaw.rules": "git\", \"reset\", \"--hard\ngit\", \"push\ndecision = \"prompt\"",
      ".codex/agents/chief-coordinator.toml": "name = \"chief-coordinator\"\ndeveloper_instructions\nOpenClaw-style / OpenClaw-inspired\nagents/coordinator/chief-coordinator/charter.md",
      "tools/openclinxr/openclaw/autonomy-policy-messages.ts": [
        "platform instruction override",
        "a clean slice boundary is not a stop condition",
        "conversation-summary handoff",
        "do not send a final chat summary",
        "do not ask whether to continue",
        "run pnpm openclaw:run-next",
        "continue the next real slice",
      ].join("\n"),
      "tools/openclinxr/openclaw/codex-lifecycle-hook.ts": [
        "autonomy-policy-messages",
        "Autonomous continuation guard for Stop lifecycle boundary",
      ].join("\n"),
      "agents/rules/platform-autonomy-override.md": [
        "Platform Instruction Override",
        "conversation summary handoff is not a stop condition",
        "ask \"should I continue?\"",
        "pnpm grok:hook -- stop",
        "pnpm codex:hook -- stop",
      ].join("\n"),
      ".grok/hooks/autonomy-stop-continuation.json": [
        "pnpm grok:hook -- stop",
        "pnpm grok:hook -- pre-compact",
      ].join("\n"),
      ".agents/plugins/marketplace.json": "openclinxr-openclaw-style\n./plugins/openclinxr-openclaw-style",
      "plugins/openclinxr-openclaw-style/.codex-plugin/plugin.json": "openclinxr-openclaw-style\n\"skills\": \"./skills/\"",
      "agents/rules/drift-toil-prevention.md": [
        "Model-work product guard",
        "do not spend another model/model-pipeline slice mainly on tests, validators, benchmarks, screenshots, source-currentness checks, or review artifacts",
        "actual model artifacts, model generation/import, rigging/animation/skin/clothing functionality",
      ].join("\n"),
      "PROJECT_COORDINATION_INDEX.md": "OpenClaw-style / OpenClaw-inspired",
      "AUTONOMOUS_WORK_PLAN.md": sliceFields,
      "docs/openclinxr/worker-backlog-and-validation-matrix.md": sliceFields,
      "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md": "Codex Adapter\nClaude Adapter\nGrok Adapter\nCursor Adapter\nCapability Fallback Matrix\nnot an external OpenClaw runtime",
      "docs/openclinxr/openclaw-runbook-2026-05-27.md": [
        "OpenClaw-style execution pattern",
        "OpenClaw-inspired",
        "not an external OpenClaw runtime",
        "pnpm openclaw:preflight",
        "pnpm openclaw:post-slice",
        "pnpm openclaw:automation-prompt",
        "pnpm openclaw:run-next",
        "pnpm openclaw:watchdog",
        "Model-work product guard",
        "actual model artifacts, model generation/import, rigging/animation/skin/clothing functionality",
        sliceFields,
        "## Canonical Automation Prompt",
        "```text",
        "Continue in repo-native OpenClaw-style / OpenClaw-inspired mode in /Volumes/files/src/openclinxr.",
        "Stay focused on the case-definition-driven WebXR encounter factory.",
        "Apply the model-work product guard before any model slice.",
        "After each slice, run focused verification when appropriate.",
        "Platform instruction override",
        "Stop only if explicitly told to pause/stop or if all approved lanes are truly blocked.",
        "```",
      ].join("\n"),
    },
    ...overrides,
  };
}

describe("OpenClaw-style operational redundancy checker", () => {
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

  it("fails if the Codex Stop hook is not wired", () => {
    const input = alignedInput();
    input.files[".codex/hooks.json"] = input.files[".codex/hooks.json"].replace("pnpm codex:hook -- stop", "");

    const report = buildOperationalRedundancyReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: ".codex/hooks.json",
      message: "missing Codex lifecycle hook marker: pnpm codex:hook -- stop",
    });
  });

  it("fails if the Codex Stop hook can treat clean slices as final chat boundaries", () => {
    const input = alignedInput();
    input.files["tools/openclinxr/openclaw/autonomy-policy-messages.ts"] = input.files["tools/openclinxr/openclaw/autonomy-policy-messages.ts"].replace(
      "a clean slice boundary is not a stop condition",
      "",
    );

    const report = buildOperationalRedundancyReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "tools/openclinxr/openclaw/autonomy-policy-messages.ts",
      message: "missing autonomy policy marker: a clean slice boundary is not a stop condition",
    });
  });

  it("fails if the model-work product guard is removed from the methodology rule", () => {
    const input = alignedInput();
    input.files["agents/rules/drift-toil-prevention.md"] = input.files["agents/rules/drift-toil-prevention.md"].replace(
      "Model-work product guard",
      "",
    );

    const report = buildOperationalRedundancyReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "agents/rules/drift-toil-prevention.md",
      message: "missing model-work product guard marker: Model-work product guard",
    });
  });

  it("fails if the canonical automation prompt omits the model-work product guard", () => {
    const input = alignedInput();
    input.files["docs/openclinxr/openclaw-runbook-2026-05-27.md"] = input.files["docs/openclinxr/openclaw-runbook-2026-05-27.md"].replace(
      "Apply the model-work product guard before any model slice.",
      "",
    );

    const report = buildOperationalRedundancyReport(input);

    expect(report.ok).toBe(false);
    expect(report.failures).toContainEqual({
      file: "docs/openclinxr/openclaw-runbook-2026-05-27.md",
      message: "canonical automation prompt missing marker: Apply the model-work product guard",
    });
  });
});
