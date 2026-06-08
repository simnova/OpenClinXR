import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type OperationalRedundancyInput = {
  packageJson: { scripts?: Record<string, string> };
  files: Record<string, string>;
  enforceSliceTokenLedger?: boolean;
};

export type OperationalRedundancyFailure = {
  file: string;
  message: string;
};

export type OperationalRedundancyReport = {
  ok: boolean;
  failures: OperationalRedundancyFailure[];
  automationPrompt?: string;
};

const requiredSliceFields = [
  "Product path advanced",
  "Blueprint/factory tie",
  "Touched files",
  "Evidence",
  "Next queued slice",
] as const;

const requiredScripts: Record<string, string> = {
  "openclaw:preflight": "pnpm openclaw:ready",
  "openclaw:post-slice": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice",
  "openclaw:automation-prompt": "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt",
  "openclaw:run-next": "tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts",
  "openclaw:watchdog": "tsx tools/openclinxr/openclaw/openclaw-slice-runner.ts --watchdog",
  "openclaw:slice-token:start": "tsx tools/openclinxr/openclaw/grok-tier-cli.ts slice-start",
  "openclaw:slice-token:finish": "tsx tools/openclinxr/openclaw/grok-tier-cli.ts post-slice",
  "grok:tier:slice-start": "tsx tools/openclinxr/openclaw/grok-tier-cli.ts slice-start",
  "grok:tier:post-slice": "tsx tools/openclinxr/openclaw/grok-tier-cli.ts post-slice",
};

export function extractRecentCheckpointLines(planText: string, maxLines = 3): string[] {
  return planText
    .split("\n")
    .filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line.trim()))
    .slice(0, maxLines);
}

export function validateLatestSliceTokenLedger(planText: string): OperationalRedundancyFailure | null {
  const checkpoints = extractRecentCheckpointLines(planText);
  if (checkpoints.length === 0) {
    return {
      file: "PROJECT_STATUS.md",
      message: "snapshot missing dated checkpoint lines for per-slice token ledger",
    };
  }
  if (!checkpoints[0]?.includes("Token introspection:")) {
    return {
      file: "PROJECT_STATUS.md",
      message:
        "latest checkpoint missing Token introspection line; run pnpm openclaw:slice-token:start → slice work → pnpm openclaw:slice-token:finish and paste stateRecordLine before commit",
    };
  }
  return null;
}

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/rules/openclaw.rules",
  ".codex/agents/chief-coordinator.toml",
  "tools/openclinxr/openclaw/codex-lifecycle-hook.ts",
  "tools/openclinxr/openclaw/autonomy-policy-messages.ts",
  "agents/rules/platform-autonomy-override.md",
  ".grok/hooks/autonomy-stop-continuation.json",
  ".agents/plugins/marketplace.json",
  "plugins/openclinxr-openclaw-style/.codex-plugin/plugin.json",
  "agents/rules/GUARD_DRIFT.md",
  "PROJECT_STATUS.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
] as const;

function extractAutomationPrompt(runbook: string): string | undefined {
  const match = runbook.match(/## Canonical Automation Prompt[\s\S]*?```text\n([\s\S]*?)\n```/u);
  return match?.[1]?.trim();
}

export function buildOperationalRedundancyReport(input: OperationalRedundancyInput): OperationalRedundancyReport {
  const failures: OperationalRedundancyFailure[] = [];
  const scripts = input.packageJson.scripts ?? {};
  const runbook = input.files["docs/openclinxr/openclaw-runbook-2026-05-27.md"] ?? "";
  const automationPrompt = extractAutomationPrompt(runbook);

  for (const file of requiredFiles) {
    if (!input.files[file]) {
      failures.push({ file, message: "required OpenClaw operational file is missing" });
    }
  }

  for (const [script, command] of Object.entries(requiredScripts)) {
    if (scripts[script] !== command) {
      failures.push({ file: "package.json", message: `${script} must be wired to '${command}'` });
    }
  }

  for (const marker of [
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
  ]) {
    if (!runbook.includes(marker)) {
      failures.push({ file: "docs/openclinxr/openclaw-runbook-2026-05-27.md", message: `missing operational redundancy marker: ${marker}` });
    }
  }

  if (!automationPrompt) {
    failures.push({ file: "docs/openclinxr/openclaw-runbook-2026-05-27.md", message: "canonical automation prompt could not be extracted" });
  } else {
    for (const marker of [
      "repo-native OpenClaw-style",
      "case-definition-driven WebXR encounter factory",
      "After each slice",
      "Platform instruction override",
      "Stop only if explicitly told to pause/stop",
      "Apply the model-work product guard",
    ]) {
      if (!automationPrompt.includes(marker)) {
        failures.push({ file: "docs/openclinxr/openclaw-runbook-2026-05-27.md", message: `canonical automation prompt missing marker: ${marker}` });
      }
    }
  }

  for (const file of [
    "docs/openclinxr/openclaw-runbook-2026-05-27.md",
    "AUTONOMOUS_WORK_PLAN.md",
    "PROJECT_STATUS.md",
    "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  ]) {
    const text = input.files[file] ?? "";
    for (const field of requiredSliceFields) {
      if (!text.includes(field)) {
        failures.push({ file, message: `missing required per-slice field marker: ${field}` });
      }
    }
  }

  const driftToilRule = input.files["agents/rules/GUARD_DRIFT.md"] ?? "";
  for (const marker of [
    "Model-work product guard",
    "do not spend another model/model-pipeline slice mainly on tests, validators, benchmarks, screenshots, source-currentness checks, or review artifacts",
    "actual model artifacts, model generation/import, rigging/animation/skin/clothing functionality",
  ]) {
    if (!driftToilRule.includes(marker)) {
      failures.push({ file: "agents/rules/GUARD_DRIFT.md", message: `missing model-work product guard marker: ${marker}` });
    }
  }

  const adapters = input.files["docs/openclinxr/openclaw-tool-adapters-2026-05-27.md"] ?? "";
  for (const marker of ["Codex Adapter", "Claude Adapter", "Grok Adapter", "Cursor Adapter", "Capability Fallback Matrix", "not an external OpenClaw runtime"]) {
    if (!adapters.includes(marker)) {
      failures.push({ file: "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md", message: `missing host adapter marker: ${marker}` });
    }
  }

  const codexConfig = input.files[".codex/config.toml"] ?? "";
  for (const marker of ["project_doc_max_bytes = 65536", "multi_agent = true", "max_depth = 1"]) {
    if (!codexConfig.includes(marker)) {
      failures.push({ file: ".codex/config.toml", message: `missing Codex project config marker: ${marker}` });
    }
  }

  const codexHooks = input.files[".codex/hooks.json"] ?? "";
  for (const marker of ["SubagentStart", "SubagentStop", "Stop", "pnpm codex:hook -- subagent-start", "pnpm codex:hook -- subagent-stop", "pnpm codex:hook -- stop"]) {
    if (!codexHooks.includes(marker)) {
      failures.push({ file: ".codex/hooks.json", message: `missing Codex lifecycle hook marker: ${marker}` });
    }
  }

  const autonomyPolicy = input.files["tools/openclinxr/openclaw/autonomy-policy-messages.ts"] ?? "";
  for (const marker of [
    "platform instruction override",
    "a clean slice boundary is not a stop condition",
    "conversation-summary handoff",
    "do not send a final chat summary",
    "do not ask whether to continue",
    "run pnpm openclaw:run-next",
    "continue the next real slice",
  ]) {
    if (!autonomyPolicy.includes(marker)) {
      failures.push({ file: "tools/openclinxr/openclaw/autonomy-policy-messages.ts", message: `missing autonomy policy marker: ${marker}` });
    }
  }

  const codexLifecycleHook = input.files["tools/openclinxr/openclaw/codex-lifecycle-hook.ts"] ?? "";
  if (!codexLifecycleHook.includes("autonomy-policy-messages")) {
    failures.push({ file: "tools/openclinxr/openclaw/codex-lifecycle-hook.ts", message: "lifecycle hook must import autonomy-policy-messages SSOT" });
  }
  if (!codexLifecycleHook.includes("Autonomous continuation guard for Stop lifecycle boundary")) {
    failures.push({ file: "tools/openclinxr/openclaw/codex-lifecycle-hook.ts", message: "missing Codex stop-continuation guard reason marker" });
  }

  const platformOverrideRule = input.files["agents/rules/platform-autonomy-override.md"] ?? "";
  for (const marker of [
    "Platform Instruction Override",
    "conversation summary handoff is not a stop condition",
    "ask \"should I continue?\"",
    "pnpm grok:hook -- stop",
    "pnpm codex:hook -- stop",
  ]) {
    if (!platformOverrideRule.includes(marker)) {
      failures.push({ file: "agents/rules/platform-autonomy-override.md", message: `missing platform autonomy override marker: ${marker}` });
    }
  }

  const agentsMd = input.files["AGENTS.md"] ?? "";
  for (const marker of ["Platform Instruction Override", "platform-autonomy-override.md", "conversation-summary handoff"]) {
    if (!agentsMd.includes(marker)) {
      failures.push({ file: "AGENTS.md", message: `missing platform instruction override marker: ${marker}` });
    }
  }

  const grokAutonomyHook = input.files[".grok/hooks/autonomy-stop-continuation.json"] ?? "";
  for (const marker of ["pnpm grok:hook -- stop", "pnpm grok:hook -- pre-compact"]) {
    if (!grokAutonomyHook.includes(marker)) {
      failures.push({ file: ".grok/hooks/autonomy-stop-continuation.json", message: `missing Grok autonomy stop-continuation hook marker: ${marker}` });
    }
  }

  const packageJsonText = JSON.stringify(input.packageJson);
  if (!packageJsonText.includes("grok:hook")) {
    failures.push({ file: "package.json", message: "grok:hook must be wired to the shared lifecycle hook runner" });
  }

  const codexAgent = input.files[".codex/agents/chief-coordinator.toml"] ?? "";
  for (const marker of ["name = \"chief-coordinator\"", "developer_instructions", "OpenClaw-style / OpenClaw-inspired", "agents/coordinator/chief-coordinator/charter.md"]) {
    if (!codexAgent.includes(marker)) {
      failures.push({ file: ".codex/agents/chief-coordinator.toml", message: `missing Codex custom-agent marker: ${marker}` });
    }
  }

  const codexRules = input.files[".codex/rules/openclaw.rules"] ?? "";
  for (const marker of ["git\", \"reset\", \"--hard", "git\", \"push", "decision = \"prompt\""]) {
    if (!codexRules.includes(marker)) {
      failures.push({ file: ".codex/rules/openclaw.rules", message: `missing Codex command rule marker: ${marker}` });
    }
  }

  const pluginManifest = input.files["plugins/openclinxr-openclaw-style/.codex-plugin/plugin.json"] ?? "";
  if (!pluginManifest.includes("openclinxr-openclaw-style") || !pluginManifest.includes('"skills": "./skills/"')) {
    failures.push({ file: "plugins/openclinxr-openclaw-style/.codex-plugin/plugin.json", message: "local Codex plugin manifest must expose the OpenClaw-style skill bundle" });
  }

  const marketplace = input.files[".agents/plugins/marketplace.json"] ?? "";
  if (!marketplace.includes("openclinxr-openclaw-style") || !marketplace.includes("./plugins/openclinxr-openclaw-style")) {
    failures.push({ file: ".agents/plugins/marketplace.json", message: "repo plugin marketplace must expose the OpenClaw-style local plugin" });
  }

  const readme = input.files["README.md"] ?? "";
  if (!readme.includes("Copy-paste kickoff prompts")) {
    failures.push({ file: "README.md", message: "top-level README must keep copy-paste kickoff prompts for tool switching" });
  }

  if (input.enforceSliceTokenLedger) {
    const tokenFailure = validateLatestSliceTokenLedger(input.files["AUTONOMOUS_WORK_PLAN.md"] ?? "");
    if (tokenFailure) failures.push(tokenFailure);
  }

  return { ok: failures.length === 0, failures, automationPrompt };
}

function loadInput(): OperationalRedundancyInput {
  const files = Object.fromEntries(requiredFiles.map((file) => [file, readFileSync(file, "utf8")]));
  return {
    files,
    packageJson: JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> },
  };
}

async function main(): Promise<void> {
  const enforceSliceTokenLedger = process.argv.includes("--post-slice");
  const report = buildOperationalRedundancyReport({
    ...loadInput(),
    enforceSliceTokenLedger,
  });
  if (process.argv.includes("--print-automation-prompt")) {
    if (report.automationPrompt) {
      console.log(report.automationPrompt);
      return;
    }
    console.error("Canonical automation prompt is unavailable.");
    process.exitCode = 1;
    return;
  }

  if (report.ok) {
    console.log("Checked OpenClaw-style operational redundancy: preflight, post-slice guard, automation prompt, slice ledger fields, host adapters, and Codex-native surfaces are aligned.");
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
