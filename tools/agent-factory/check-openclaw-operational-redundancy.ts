import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type OperationalRedundancyInput = {
  packageJson: { scripts?: Record<string, string> };
  files: Record<string, string>;
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
};

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "PROJECT_COORDINATION_INDEX.md",
  "AUTONOMOUS_WORK_PLAN.md",
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
    "not an external OpenClaw runtime",
    "pnpm openclaw:preflight",
    "pnpm openclaw:post-slice",
    "pnpm openclaw:automation-prompt",
    "pnpm openclaw:run-next",
    "pnpm openclaw:watchdog",
  ]) {
    if (!runbook.includes(marker)) {
      failures.push({ file: "docs/openclinxr/openclaw-runbook-2026-05-27.md", message: `missing operational redundancy marker: ${marker}` });
    }
  }

  if (!automationPrompt) {
    failures.push({ file: "docs/openclinxr/openclaw-runbook-2026-05-27.md", message: "canonical automation prompt could not be extracted" });
  } else {
    for (const marker of [
      "repo-native OpenClaw mode",
      "case-definition-driven WebXR encounter factory",
      "After each slice",
      "Stop only if explicitly told to pause/stop",
    ]) {
      if (!automationPrompt.includes(marker)) {
        failures.push({ file: "docs/openclinxr/openclaw-runbook-2026-05-27.md", message: `canonical automation prompt missing marker: ${marker}` });
      }
    }
  }

  for (const file of [
    "docs/openclinxr/openclaw-runbook-2026-05-27.md",
    "AUTONOMOUS_WORK_PLAN.md",
    "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  ]) {
    const text = input.files[file] ?? "";
    for (const field of requiredSliceFields) {
      if (!text.includes(field)) {
        failures.push({ file, message: `missing required per-slice field marker: ${field}` });
      }
    }
  }

  const adapters = input.files["docs/openclinxr/openclaw-tool-adapters-2026-05-27.md"] ?? "";
  for (const marker of ["Codex Adapter", "Claude Adapter", "Grok Adapter", "Cursor Adapter", "Capability Fallback Matrix"]) {
    if (!adapters.includes(marker)) {
      failures.push({ file: "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md", message: `missing host adapter marker: ${marker}` });
    }
  }

  const readme = input.files["README.md"] ?? "";
  if (!readme.includes("Copy-paste kickoff prompts")) {
    failures.push({ file: "README.md", message: "top-level README must keep copy-paste kickoff prompts for tool switching" });
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
  const report = buildOperationalRedundancyReport(loadInput());
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
    console.log("Checked OpenClaw operational redundancy: preflight, post-slice guard, automation prompt, slice ledger fields, and host adapters are aligned.");
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
