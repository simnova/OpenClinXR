import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sliceBriefPath } from "../../../packages/openclinxr/agent-loop/src/slice-team.js";

export const DEFAULT_OPENCLAW_RUN_NEXT_REPORT_PATH = ".openclinxr/openclaw/run-next-report.json";
const DEFAULT_WATCHDOG_IDLE_MINUTES = 60;

type StateFiles = Record<string, string>;

export type SliceSelection = {
  sliceId: string | null;
  templateId: string | null;
  source: "next-dequeue" | "backlog-table" | "legacy-plan" | null;
};

export const SLICE_TEMPLATE_MAP: Record<string, string> = {
  "admin-packet-replay-surfaces-impl": "admin-packet-replay",
  "peds-parent-nurse-garment-asset": "real-garment-v1",
  "peds-evidence-loop": "peds-evidence-loop",
  "peds-real-garment-sleeve-evidence": "real-garment-v1",
  "full-encounter-authoring-v1": "encounter-authoring-v1",
  "scenario-bank-review-packet-v1": "encounter-authoring-v1",
};

export type OpenClawRunNextInput = {
  now?: Date;
  stateFiles: StateFiles;
  gitStatusShort: string;
};

export type OpenClawRunNextPlan = {
  schemaVersion: "openclinxr.openclaw-run-next.v1";
  generatedAt: string;
  selectedSlice: string | null;
  templateId: string | null;
  sliceBriefExists: boolean;
  gitStatusShort: string;
  localReportPath: string;
  canonicalStateUpdate: {
    allowed: boolean;
    reason: string;
  };
  nextCommand: string | null;
  sliceTeam: {
    initCommand: string | null;
    teamSpawnCommand: string | null;
    verifyCommand: string | null;
  };
};

export type OpenClawWatchdogInput = {
  now?: Date;
  lastRunAt?: Date | null;
  minIdleMinutes?: number;
  gitStatusShort: string;
  leaseStatus: "none" | "held" | "unknown";
  selectedSlice: string | null;
};

export type OpenClawWatchdogDecision = {
  action: "run-next" | "idle";
  reason: string;
};

export function extractSliceIdFromText(text: string): string | null {
  const backtick = text.match(/`([a-z0-9][a-z0-9-]*)`/u)?.[1];
  if (backtick) return backtick;
  const kebab = text.match(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/u)?.[1];
  return kebab ?? null;
}

export function selectNextSlice(stateFiles: StateFiles): SliceSelection {
  const status = stateFiles["PROJECT_STATUS.md"] ?? "";
  const nextDequeue = status.match(/\*\*Next dequeue:\*\*\s*(.+?)(?:\n|$)/u)?.[1]?.trim();
  if (nextDequeue) {
    const firstOption = nextDequeue.split(/\s+or\s+/iu)[0]?.trim() ?? nextDequeue;
    const sliceId = extractSliceIdFromText(firstOption);
    if (sliceId) {
      return {
        sliceId,
        templateId: SLICE_TEMPLATE_MAP[sliceId] ?? null,
        source: "next-dequeue",
      };
    }
  }

  const backlogRow = status.match(
    /\|[^\n]+\|\n\|[-| :]+\|\n\|[^|]+\|\s*`?([a-z0-9][a-z0-9-]*)`?/u,
  )?.[1];
  if (backlogRow) {
    return {
      sliceId: backlogRow,
      templateId: SLICE_TEMPLATE_MAP[backlogRow] ?? null,
      source: "backlog-table",
    };
  }

  const plan = stateFiles["AUTONOMOUS_WORK_PLAN.md"] ?? "";
  const explicit = plan.match(/Explicit next queued:\s*(.+?)(?:\n|$)/u)?.[1]?.trim();
  if (explicit) {
    const stripped = stripMarkdownListPrefix(explicit);
    const sliceId = extractSliceIdFromText(stripped) ?? stripped;
    return {
      sliceId,
      templateId: SLICE_TEMPLATE_MAP[sliceId] ?? null,
      source: "legacy-plan",
    };
  }

  const queueMatch = plan.match(/## Active Product Advancement Queue\s*\n([\s\S]*?)(?:\n## |\n# |$)/u);
  const queue = queueMatch?.[1] ?? plan;
  const firstItem = queue
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^\d+\.\s+/.test(line) || /^[-*]\s+/.test(line));
  if (firstItem) {
    const stripped = stripMarkdownListPrefix(firstItem);
    const sliceId = extractSliceIdFromText(stripped) ?? stripped;
    return {
      sliceId,
      templateId: SLICE_TEMPLATE_MAP[sliceId] ?? null,
      source: "legacy-plan",
    };
  }

  return { sliceId: null, templateId: null, source: null };
}

export function buildSliceTeamCommands(selection: SliceSelection): OpenClawRunNextPlan["sliceTeam"] {
  const { sliceId, templateId } = selection;
  if (!sliceId) {
    return { initCommand: null, teamSpawnCommand: null, verifyCommand: null };
  }
  const initCommand = templateId
    ? `pnpm openclaw:slice:init -- --template ${templateId} --slice-id ${sliceId}`
    : null;
  return {
    initCommand,
    teamSpawnCommand: `pnpm openclaw:team-spawn -- --slice-id ${sliceId} --phase scout`,
    verifyCommand: `pnpm openclaw:slice:verify -- --slice-id ${sliceId}`,
  };
}

export function buildOpenClawRunNextPlan(input: OpenClawRunNextInput): OpenClawRunNextPlan {
  const selection = selectNextSlice(input.stateFiles);
  const sliceBriefExists = selection.sliceId
    ? existsSync(path.join(process.cwd(), sliceBriefPath(selection.sliceId)))
    : false;
  const sliceTeam = buildSliceTeamCommands(selection);

  let nextCommand: string | null = null;
  if (selection.sliceId) {
    if (!sliceBriefExists && sliceTeam.initCommand) {
      nextCommand = sliceTeam.initCommand;
    } else if (sliceTeam.teamSpawnCommand) {
      nextCommand = sliceTeam.teamSpawnCommand;
    } else {
      nextCommand = `pnpm openclaw:lease -- acquire --owner openclaw-run-next --slice ${shellQuote(selection.sliceId)} --ttl-minutes 60`;
    }
  }

  return {
    schemaVersion: "openclinxr.openclaw-run-next.v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    selectedSlice: selection.sliceId,
    templateId: selection.templateId,
    sliceBriefExists,
    gitStatusShort: input.gitStatusShort.trim(),
    localReportPath: DEFAULT_OPENCLAW_RUN_NEXT_REPORT_PATH,
    canonicalStateUpdate: {
      allowed: false,
      reason: "No product change, verification result, or blocker has been supplied.",
    },
    nextCommand,
    sliceTeam,
  };
}

export function buildOpenClawWatchdogDecision(input: OpenClawWatchdogInput): OpenClawWatchdogDecision {
  if (input.leaseStatus === "held") {
    return { action: "idle", reason: "An active OpenClaw lease is already held." };
  }
  if (input.leaseStatus === "unknown") {
    return { action: "idle", reason: "Lease status is unknown." };
  }
  if (!isCleanGitStatus(input.gitStatusShort)) {
    return { action: "idle", reason: "Working tree is not clean." };
  }
  if (!input.selectedSlice) {
    return { action: "idle", reason: "No queued slice was found." };
  }
  if (input.lastRunAt && !isStale(input.lastRunAt, input.now ?? new Date(), input.minIdleMinutes ?? DEFAULT_WATCHDOG_IDLE_MINUTES)) {
    return { action: "idle", reason: "Previous runner report is still fresh." };
  }
  return {
    action: "run-next",
    reason: "Clean tree, no active lease, stale runner report, and a queued slice is available.",
  };
}

function stripMarkdownListPrefix(value: string): string {
  return value.replace(/^(?:\d+\.|[-*])\s+/u, "").trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function isCleanGitStatus(gitStatusShort: string): boolean {
  return gitStatusShort
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => line.startsWith("## "));
}

function isStale(lastRunAt: Date, now: Date, minIdleMinutes: number): boolean {
  return now.getTime() - lastRunAt.getTime() >= minIdleMinutes * 60_000;
}

async function loadStateFiles(): Promise<StateFiles> {
  const files = [
    "PROJECT_STATUS.md",
    "docs/openclinxr/worker-backlog-and-validation-matrix.md",
    "AUTONOMOUS_WORK_PLAN.md",
  ];
  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        return [file, await readFile(file, "utf8")] as const;
      } catch {
        return [file, ""] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function gitStatusShort(): string {
  const result = spawnSync("git", ["status", "--short", "--branch"], { encoding: "utf8" });
  return result.stdout || result.stderr || "";
}

function leaseStatusFromText(text: string): OpenClawWatchdogInput["leaseStatus"] {
  if (/No OpenClaw automation lease exists|"status":\s*"none"/u.test(text)) {
    return "none";
  }
  if (/held by|"status":\s*"held"/u.test(text)) {
    return "held";
  }
  return "unknown";
}

function openClawLeaseStatus(): OpenClawWatchdogInput["leaseStatus"] {
  const result = spawnSync("pnpm", ["openclaw:lease", "--", "status"], { encoding: "utf8" });
  return leaseStatusFromText(`${result.stdout}\n${result.stderr}`);
}

async function loadLastRunAt(reportPath: string): Promise<Date | null> {
  try {
    const parsed = JSON.parse(await readFile(reportPath, "utf8")) as Partial<OpenClawRunNextPlan>;
    return parsed.generatedAt ? new Date(parsed.generatedAt) : null;
  } catch {
    return null;
  }
}

async function writeLocalReport(
  reportPath: string,
  report: OpenClawRunNextPlan | (OpenClawRunNextPlan & { watchdog: OpenClawWatchdogDecision }),
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const watchdog = args.includes("--watchdog");
  const dryRun = args.includes("--dry-run");
  const stateFiles = await loadStateFiles();
  const plan = buildOpenClawRunNextPlan({ stateFiles, gitStatusShort: gitStatusShort() });

  if (!watchdog) {
    if (!dryRun) {
      await writeLocalReport(plan.localReportPath, plan);
    }
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const decision = buildOpenClawWatchdogDecision({
    gitStatusShort: plan.gitStatusShort,
    leaseStatus: openClawLeaseStatus(),
    lastRunAt: await loadLastRunAt(plan.localReportPath),
    selectedSlice: plan.selectedSlice,
  });
  const output = { ...plan, watchdog: decision };
  if (!dryRun) {
    await writeLocalReport(plan.localReportPath, output);
  }
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}