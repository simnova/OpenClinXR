import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

const OPENCLAW_REMINDER =
  "OpenClaw-style / OpenClaw-inspired workflow: use AGENTS.md + snapshots, prefer pnpm openclaw:run-next, lease before real edits, and keep no-op runner/watchdog output out of canonical state.";

export function buildCodexLifecycleHookDecision(
  mode: CodexLifecycleHookMode,
  payloadText: string,
): CodexLifecycleHookDecision {
  switch (mode) {
    case "session-start":
      return {
        mode,
        message: `${OPENCLAW_REMINDER} Project Codex hooks are active after /hooks trust.`,
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
        message:
          "OpenClaw-style compact reminder: re-read AGENTS.md and the snapshot heads of PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, and worker backlog, then continue the selected slice.",
        runGuards: false,
        guardCommand: null,
        reason: "Rehydration reminder only.",
      };
    case "subagent-start":
      return {
        mode,
        message:
          "OpenClaw-style subagent reminder: map to a repo role, confirm /Volumes/files/src/openclinxr plus AGENTS/state/agents/tools exist, then read the canonical role charter and memory before reporting.",
        runGuards: false,
        guardCommand: null,
        reason: "Subagent role-mapping guidance only.",
      };
    case "subagent-stop":
      return {
        mode,
        message:
          "OpenClaw-style subagent closeout: return concise findings, blockers, and recommended next slice; parent agent owns integration and canonical state updates.",
        runGuards: false,
        guardCommand: null,
        reason: "Subagent closeout guidance only.",
      };
    case "user-prompt-submit":
      return {
        mode,
        message:
          "OpenClaw-style prompt reminder: for heartbeat/continue/autonomy prompts, use pnpm openclaw:run-next and execute only real selected slices.",
        runGuards: false,
        guardCommand: null,
        reason: "Prompt-scoped guidance only.",
      };
    case "stop":
      return {
        mode,
        message:
          "OpenClaw-style stop reminder: do not append no-op heartbeat records; durable state changes belong only after product changes, verification evidence, or blockers.",
        runGuards: false,
        guardCommand: null,
        reason: "Stop guidance only.",
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
