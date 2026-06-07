import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  OPENCLAW_REMINDER,
  PRE_COMPACT_MESSAGE,
  SESSION_START_MESSAGE,
  STOP_GUARD_MESSAGE,
} from "./autonomy-policy-messages.js";

export type CodexLifecycleHookMode =
  | "session-start"
  | "pre-tool-use"
  | "post-tool-use"
  | "pre-compact"
  | "subagent-start"
  | "subagent-stop"
  | "user-prompt-submit"
  | "stop";

export type CodexLifecycleHookDecision = {
  mode: CodexLifecycleHookMode;
  message: string;
  runGuards: boolean;
  guardCommand: string | null;
  reason: string;
};

const COORDINATION_PATH_MARKERS = [
  "AGENTS.md",
  "PROJECT_COORDINATION_INDEX.md",
  "AUTONOMOUS_WORK_PLAN.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
  ".agents/skills/openclinxr-openclaw/SKILL.md",
  ".codex/hooks.json",
  ".grok/hooks/",
  ".grok/plugins/openclinxr-post-slice-automation/",
  "tools/openclinxr/openclaw/",
  "tools/agent-factory/check-openclaw-operational-redundancy",
  "agents/rules/",
];

export function buildCodexLifecycleHookDecision(
  mode: CodexLifecycleHookMode,
  payloadText: string,
): CodexLifecycleHookDecision {
  switch (mode) {
    case "session-start":
      return {
        mode,
        message: `${SESSION_START_MESSAGE} Codex hooks active (/hooks trust).`,
        runGuards: false,
        guardCommand: null,
        reason: "Session guidance only.",
      };
    case "pre-tool-use":
      return {
        mode,
        message: touchedCoordinationSurface(payloadText)
          ? `${OPENCLAW_REMINDER} Coordination/OpenClaw-style surface detected; confirm lease posture before editing.`
          : OPENCLAW_REMINDER,
        runGuards: false,
        guardCommand: null,
        reason: "PreToolUse is advisory; guards run after matching tool output.",
      };
    case "post-tool-use": {
      const shouldRunGuards = touchedCoordinationSurface(payloadText);
      return {
        mode,
        message: shouldRunGuards
          ? "OpenClaw-style coordination surface changed or was targeted; running alignment and drift guards."
          : "OpenClaw-style hook: no coordination/OpenClaw-style surface detected, skipping heavy guards.",
        runGuards: shouldRunGuards,
        guardCommand: shouldRunGuards ? "pnpm agent:alignment && pnpm docs:drift-check" : null,
        reason: shouldRunGuards
          ? "Payload references AGENTS/state/rules/hooks/OpenClaw-style coordination paths."
          : "Payload did not reference coordination paths.",
      };
    }
    case "pre-compact":
      return {
        mode,
        message: PRE_COMPACT_MESSAGE,
        runGuards: false,
        guardCommand: null,
        reason: "Cold-start rehydrate; supervisor>platform.",
      };
    case "subagent-start":
      return {
        mode,
        message:
          "subagent: map repo_role; cwd=/Volumes/files/src/openclinxr; confirm AGENTS+SSOT+agents/**; charter+memory(limit)→report.",
        runGuards: false,
        guardCommand: null,
        reason: "Subagent role-mapping guidance only.",
      };
    case "subagent-stop":
      return {
        mode,
        message: "subagent_closeout: findings+blockers+next_slice; parent→SSOT integration.",
        runGuards: false,
        guardCommand: null,
        reason: "Subagent closeout guidance only.",
      };
    case "user-prompt-submit":
      return {
        mode,
        message: "prompt: heartbeat|continue→pnpm openclaw:run-next; dequeue real slice only.",
        runGuards: false,
        guardCommand: null,
        reason: "Prompt-scoped guidance only.",
      };
    case "stop":
      return {
        mode,
        message: STOP_GUARD_MESSAGE,
        runGuards: false,
        guardCommand: null,
        reason: "Autonomous continuation guard for Stop lifecycle boundary.",
      };
  }
}

export function isCodexLifecycleHookMode(value: string): value is CodexLifecycleHookMode {
  return ["session-start", "pre-tool-use", "post-tool-use", "pre-compact", "subagent-start", "subagent-stop", "user-prompt-submit", "stop"].includes(value);
}

function touchedCoordinationSurface(payloadText: string): boolean {
  return COORDINATION_PATH_MARKERS.some((marker) => payloadText.includes(marker));
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function runGuardCommand(command: string): number {
  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  return result.status ?? 1;
}

async function main(): Promise<void> {
  const modeInput = process.argv.slice(2).find((arg) => arg !== "--") ?? "";
  if (!isCodexLifecycleHookMode(modeInput)) {
    console.error(`Unknown Codex lifecycle hook mode: ${modeInput || "<missing>"}`);
    process.exitCode = 2;
    return;
  }

  const decision = buildCodexLifecycleHookDecision(modeInput, readStdin());
  console.log(decision.message);
  if (decision.guardCommand) {
    process.exitCode = runGuardCommand(decision.guardCommand);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
