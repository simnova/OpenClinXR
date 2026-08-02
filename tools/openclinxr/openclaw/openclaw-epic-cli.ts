/**
 * OpenClaw epic continuity — multi-slice outer loop helpers.
 *
 * Schema: openclinxr.epic-brief.v1
 * Commands: init | status | next | apply-header | plan | help
 *
 * Does NOT spawn agents. Prints the command sequence the orchestrator must run.
 * apply-header can write PROJECT_STATUS.md Next dequeue (SSOT advancement).
 *
 * See docs/agent-ops/OPENCLAW-EPIC-CONTINUITY.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EPIC_SCHEMA = "openclinxr.epic-brief.v1" as const;
export const EPICS_DIR = ".openclinxr/epics";
export const ACTIVE_EPIC_POINTER = ".openclinxr/epics/ACTIVE";

export type EpicSliceStep = {
  sliceId: string;
  templateId?: string | null;
  goal: string;
  q_gate?: string;
  /** When true, verify ok advances cursor */
  requiresVerifyOk?: boolean;
};

export type EpicBrief = {
  schemaVersion: typeof EPIC_SCHEMA;
  id: string;
  title: string;
  goal: string;
  doneWhen: string[];
  outOfScope: string[];
  writeSurfaces: string[];
  stopConditions: {
    projectStatusPaused: boolean;
    maxHours?: number | null;
    maxEstimatedUsd?: number | null;
    allLanesBlocked: boolean;
    /**
     * Agentic thrash circuit-breaker (wall clock of *token-burning* agent work on the same slice task).
     * Does NOT count long scripted builds/tests/captures that are not burning model tokens.
     */
    maxAgenticToilMinutesPerSlice?: number | null;
    /** When true (default), pure CLI/script runtime without model turns does not trip thrash. */
    excludeScriptedNonTokenWorkFromToil?: boolean;
    /** Max failed execute cycles on same slice before blocked (default 2). */
    maxExecuteRetriesPerSlice?: number | null;
  };
  autonomy: {
    mayCommit: boolean;
    mayPush: boolean;
    requireCleanTreeForAdvance: boolean;
  };
  slices: EpicSliceStep[];
  cursor: number;
  status: "active" | "paused" | "completed" | "blocked";
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

export function epicPath(repoRoot: string, epicId: string): string {
  return path.join(repoRoot, EPICS_DIR, epicId, "brief.json");
}

export function loadEpic(repoRoot: string, epicId: string): EpicBrief {
  const full = epicPath(repoRoot, epicId);
  if (!existsSync(full)) {
    throw new Error(`Epic not found: ${full}`);
  }
  return JSON.parse(readFileSync(full, "utf8")) as EpicBrief;
}

export function saveEpic(repoRoot: string, epic: EpicBrief): void {
  const dir = path.join(repoRoot, EPICS_DIR, epic.id);
  mkdirSync(dir, { recursive: true });
  epic.updatedAt = new Date().toISOString();
  writeFileSync(path.join(dir, "brief.json"), `${JSON.stringify(epic, null, 2)}\n`, "utf8");
}

export function setActiveEpic(repoRoot: string, epicId: string): void {
  mkdirSync(path.join(repoRoot, EPICS_DIR), { recursive: true });
  writeFileSync(path.join(repoRoot, ACTIVE_EPIC_POINTER), `${epicId}\n`, "utf8");
}

export function getActiveEpicId(repoRoot: string): string | null {
  const p = path.join(repoRoot, ACTIVE_EPIC_POINTER);
  if (!existsSync(p)) return null;
  const id = readFileSync(p, "utf8").trim();
  return id || null;
}

export function currentSlice(epic: EpicBrief): EpicSliceStep | null {
  if (epic.status === "completed") return null;
  if (epic.cursor < 0 || epic.cursor >= epic.slices.length) return null;
  return epic.slices[epic.cursor] ?? null;
}

export function readVerifyOk(repoRoot: string, sliceId: string): boolean {
  const verifyPath = path.join(repoRoot, ".openclinxr/openclaw", `slice-verify-${sliceId}.json`);
  if (!existsSync(verifyPath)) return false;
  try {
    const v = JSON.parse(readFileSync(verifyPath, "utf8")) as { ok?: boolean; sliceId?: string };
    return v.ok === true && (v.sliceId === undefined || v.sliceId === sliceId);
  } catch {
    return false;
  }
}

/** Replace **Next dequeue:** line in PROJECT_STATUS.md */
export function applyNextDequeueHeader(
  projectStatusText: string,
  nextDequeueLine: string,
  options?: { closeSliceId?: string | null; closeNote?: string },
): { text: string; changed: boolean } {
  const line = nextDequeueLine.startsWith("**Next dequeue:**")
    ? nextDequeueLine
    : `**Next dequeue:** ${nextDequeueLine}`;
  let text = projectStatusText;
  let changed = false;
  if (/\*\*Next dequeue:\*\*.+/u.test(text)) {
    text = text.replace(/\*\*Next dequeue:\*\*.+/u, line);
    changed = true;
  } else {
    // Insert after Current Priority if possible
    if (/## Current Priority/u.test(text)) {
      text = text.replace(
        /(## Current Priority[\s\S]*?\n)/u,
        `$1\n${line}\n`,
      );
      changed = true;
    } else {
      text = `${line}\n\n${text}`;
      changed = true;
    }
  }

  if (options?.closeSliceId) {
    const id = options.closeSliceId;
    const note = options.closeNote ?? "closed via openclaw:epic advance";
    // Best-effort: mark Active Work table row for this slice as closed if present
    const rowRe = new RegExp(`(\\|\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|[^\\n]*)`, "u");
    if (rowRe.test(text) && !text.match(rowRe)?.[0]?.includes("closed") && !text.match(rowRe)?.[0]?.includes("verify ok")) {
      text = text.replace(rowRe, `$1 · ${note}`);
      changed = true;
    }
  }

  return { text, changed };
}

export function applyNextDequeueToFile(
  repoRoot: string,
  nextDequeue: string,
  options?: { closeSliceId?: string | null; dryRun?: boolean },
): { changed: boolean; path: string } {
  const statusPath = path.join(repoRoot, "PROJECT_STATUS.md");
  const raw = readFileSync(statusPath, "utf8");
  const { text, changed } = applyNextDequeueHeader(raw, nextDequeue, {
    closeSliceId: options?.closeSliceId,
  });
  if (changed && !options?.dryRun) {
    writeFileSync(statusPath, text, "utf8");
  }
  return { changed, path: statusPath };
}

export function advanceEpicCursor(epic: EpicBrief): {
  epic: EpicBrief;
  closedSliceId: string | null;
  nextSlice: EpicSliceStep | null;
  completed: boolean;
} {
  const closed = currentSlice(epic);
  const closedSliceId = closed?.sliceId ?? null;
  const nextCursor = epic.cursor + 1;
  if (nextCursor >= epic.slices.length) {
    epic.cursor = epic.slices.length;
    epic.status = "completed";
    return { epic, closedSliceId, nextSlice: null, completed: true };
  }
  epic.cursor = nextCursor;
  epic.status = "active";
  return { epic, closedSliceId, nextSlice: epic.slices[nextCursor] ?? null, completed: false };
}

export function buildEpicPlan(repoRoot: string, epic: EpicBrief): {
  epicId: string;
  status: string;
  cursor: number;
  current: EpicSliceStep | null;
  verifyOk: boolean;
  commands: string[];
  message: string;
} {
  const cur = currentSlice(epic);
  if (!cur) {
    return {
      epicId: epic.id,
      status: epic.status,
      cursor: epic.cursor,
      current: null,
      verifyOk: false,
      commands: [],
      message: epic.status === "completed" ? "Epic completed — no further slices." : "No current slice.",
    };
  }
  const verifyOk = readVerifyOk(repoRoot, cur.sliceId);
  const commands: string[] = [
    `pnpm openclaw:lease -- acquire --owner epic-${epic.id} --slice ${cur.sliceId} --ttl-minutes 90`,
    `pnpm openclaw:slice-token:start -- --slice-id ${cur.sliceId} --current-tier tier3_deepseek_pro_execute`,
  ];
  if (!existsSync(path.join(repoRoot, ".openclinxr/slices", cur.sliceId, "brief.json"))) {
    if (cur.templateId) {
      commands.push(
        `pnpm openclaw:slice:init -- --template ${cur.templateId} --slice-id ${cur.sliceId}`,
      );
    } else {
      commands.push(`# create brief manually: .openclinxr/slices/${cur.sliceId}/brief.json`);
    }
  }
  commands.push(
    `pnpm openclaw:team-spawn -- --slice-id ${cur.sliceId} --phase scout`,
    `# orchestrator: spawn_subagent from team-spawn report (isolation=worktree for writers)`,
    `pnpm openclaw:slice:verify -- --slice-id ${cur.sliceId}`,
    `pnpm openclaw:worktree:promote -- --slice-id ${cur.sliceId} --role <writer-role>`,
    `pnpm openclaw:slice-token:finish`,
    `pnpm openclaw:epic -- advance --epic-id ${epic.id}   # after verify ok`,
    `pnpm openclaw:epic -- apply-header --epic-id ${epic.id}`,
    `pnpm openclaw:post-slice`,
  );
  return {
    epicId: epic.id,
    status: epic.status,
    cursor: epic.cursor,
    current: cur,
    verifyOk,
    commands,
    message: verifyOk
      ? `Slice ${cur.sliceId} already verify ok — run: pnpm openclaw:epic -- advance --epic-id ${epic.id}`
      : `Execute slice ${cur.sliceId} (${cur.goal.slice(0, 80)}…)`,
  };
}

export function createExampleEpic(): EpicBrief {
  const now = new Date().toISOString();
  return {
    schemaVersion: EPIC_SCHEMA,
    id: "pre-epic-continuity-dry-run",
    title: "Pre-epic continuity dry-run (kit validation)",
    goal: "Prove epic cursor + Next dequeue header apply + pathScope for root docs without multi-hour product work.",
    doneWhen: [
      "Epic status completed after advancing through kit validation slices or single meta-slice",
      "apply-header can write PROJECT_STATUS Next dequeue",
      "README.md in a role writeRoots so worktree promote can land root docs",
    ],
    outOfScope: [
      "Product apps feature work",
      "Quest/clinical claims",
      "Force-push / hook skip without BOD",
    ],
    writeSurfaces: [
      "PROJECT_STATUS.md",
      "README.md",
      "docs/agent-ops/**",
      "docs/index.html",
      ".openclinxr/epics/**",
      "tools/openclinxr/openclaw/**",
      "packages/openclinxr/agent-loop/**",
    ],
    stopConditions: {
      projectStatusPaused: true,
      maxHours: 4,
      maxEstimatedUsd: 25,
      allLanesBlocked: true,
    },
    autonomy: {
      mayCommit: true,
      mayPush: false,
      requireCleanTreeForAdvance: false,
    },
    slices: [
      {
        sliceId: "openclaw-pre-epic-kit-v1",
        templateId: null,
        goal: "Land epic CLI + header apply + pathScope + continuity docs",
        q_gate: "Q5",
        requiresVerifyOk: false,
      },
    ],
    cursor: 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
    notes: "Scaffold epic created by openclaw:epic init --example",
  };
}

function parseArgs(argv: string[]): {
  command: string;
  epicId?: string;
  dryRun: boolean;
  example: boolean;
  nextDequeue?: string;
} {
  const args = argv.filter((a) => a !== "--");
  const command = args[0] ?? "help";
  let epicId: string | undefined;
  let dryRun = false;
  let example = false;
  let nextDequeue: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--example") example = true;
    else if ((a === "--epic-id" || a === "--id") && args[i + 1]) {
      epicId = args[++i];
    } else if (a === "--next" && args[i + 1]) {
      nextDequeue = args[++i];
    }
  }
  return { command, epicId, dryRun, example, nextDequeue };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === "--help") {
    console.log(`openclaw-epic — multi-slice continuity

Usage:
  pnpm openclaw:epic -- init --epic-id <id> [--example]
  pnpm openclaw:epic -- status [--epic-id <id>]
  pnpm openclaw:epic -- plan [--epic-id <id>]
  pnpm openclaw:epic -- advance [--epic-id <id>] [--dry-run]
  pnpm openclaw:epic -- apply-header [--epic-id <id>] [--next "slice-id (Q4) …"] [--dry-run]
  pnpm openclaw:epic -- set-active --epic-id <id>

Does not spawn subagents. Orchestrator runs the printed commands.
Docs: docs/agent-ops/OPENCLAW-EPIC-CONTINUITY.md
`);
    return;
  }

  if (args.command === "init") {
    const id = args.epicId ?? (args.example ? "pre-epic-continuity-dry-run" : "");
    if (!id) {
      console.error("init requires --epic-id or --example");
      process.exitCode = 1;
      return;
    }
    const epic = args.example
      ? { ...createExampleEpic(), id }
      : {
          ...createExampleEpic(),
          id,
          title: id,
          goal: "Fill goal",
          slices: [
            {
              sliceId: `${id}-slice-0`,
              goal: "First slice — replace",
              requiresVerifyOk: true,
            },
          ],
        };
    epic.id = id;
    saveEpic(repoRoot, epic);
    setActiveEpic(repoRoot, id);
    console.log(JSON.stringify({ initialized: id, path: epicPath(repoRoot, id), active: true }, null, 2));
    return;
  }

  const epicId = args.epicId ?? getActiveEpicId(repoRoot);
  if (!epicId && args.command !== "set-active") {
    console.error("No --epic-id and no ACTIVE epic. Run init first.");
    process.exitCode = 1;
    return;
  }

  if (args.command === "set-active") {
    if (!args.epicId) {
      console.error("set-active requires --epic-id");
      process.exitCode = 1;
      return;
    }
    setActiveEpic(repoRoot, args.epicId);
    console.log(JSON.stringify({ active: args.epicId }, null, 2));
    return;
  }

  const epic = loadEpic(repoRoot, epicId!);

  if (args.command === "status") {
    const cur = currentSlice(epic);
    console.log(
      JSON.stringify(
        {
          id: epic.id,
          status: epic.status,
          cursor: epic.cursor,
          total: epic.slices.length,
          currentSliceId: cur?.sliceId ?? null,
          verifyOk: cur ? readVerifyOk(repoRoot, cur.sliceId) : false,
          goal: epic.goal,
          autonomy: epic.autonomy,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.command === "plan") {
    const plan = buildEpicPlan(repoRoot, epic);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (args.command === "advance") {
    const cur = currentSlice(epic);
    if (!cur) {
      console.log(JSON.stringify({ ok: false, message: "No current slice" }, null, 2));
      process.exitCode = 1;
      return;
    }
    if (cur.requiresVerifyOk !== false && !readVerifyOk(repoRoot, cur.sliceId)) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            message: `Slice ${cur.sliceId} requires verify ok before advance`,
            hint: `pnpm openclaw:slice:verify -- --slice-id ${cur.sliceId}`,
          },
          null,
          2,
        ),
      );
      process.exitCode = 2;
      return;
    }
    const result = advanceEpicCursor(epic);
    if (!args.dryRun) {
      saveEpic(repoRoot, result.epic);
    }
    const nextLine = result.nextSlice
      ? `${result.nextSlice.sliceId}${result.nextSlice.q_gate ? ` (${result.nextSlice.q_gate})` : ""} — ${result.nextSlice.goal}`
      : "(epic completed — set Next dequeue from product backlog)";
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: args.dryRun,
          closedSliceId: result.closedSliceId,
          nextSliceId: result.nextSlice?.sliceId ?? null,
          completed: result.completed,
          suggestedNextDequeue: nextLine,
          applyHeaderCommand: `pnpm openclaw:epic -- apply-header --epic-id ${epic.id} --next ${JSON.stringify(nextLine)}`,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.command === "apply-header") {
    const cur = currentSlice(epic);
    let next = args.nextDequeue;
    if (!next) {
      if (epic.status === "completed") {
        next = "wire-api-durableStore-consumer-v1 (Q4) — or set explicitly via --next";
      } else if (cur) {
        next = `${cur.sliceId}${cur.q_gate ? ` (${cur.q_gate})` : ""} — ${cur.goal}`;
      } else {
        console.error("Nothing to apply");
        process.exitCode = 1;
        return;
      }
    }
    const result = applyNextDequeueToFile(repoRoot, next, {
      closeSliceId: null,
      dryRun: args.dryRun,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: args.dryRun,
          changed: result.changed,
          nextDequeue: next,
          path: result.path,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
