import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OPENCLAW_RUN_NEXT_REPORT_PATH = ".openclinxr/openclaw/run-next-report.json";
const DEFAULT_WATCHDOG_IDLE_MINUTES = 60;

type StateFiles = Record<string, string>;

export type OpenClawRunNextInput = {
  now?: Date;
  stateFiles: StateFiles;
  gitStatusShort: string;
};

export type OpenClawRunNextPlan = {
  schemaVersion: "openclinxr.openclaw-run-next.v1";
  generatedAt: string;
  selectedSlice: string | null;
  gitStatusShort: string;
  localReportPath: string;
  canonicalStateUpdate: {
    allowed: boolean;
    reason: string;
  };
  nextCommand: string | null;
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

export function buildOpenClawRunNextPlan(input: OpenClawRunNextInput): OpenClawRunNextPlan {
  const selectedSlice = selectNextSlice(input.stateFiles);
  return {
    schemaVersion: "openclinxr.openclaw-run-next.v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    selectedSlice,
    gitStatusShort: input.gitStatusShort.trim(),
    localReportPath: DEFAULT_OPENCLAW_RUN_NEXT_REPORT_PATH,
    canonicalStateUpdate: {
      allowed: false,
      reason: "No product change, verification result, or blocker has been supplied.",
    },
    nextCommand: selectedSlice
      ? `pnpm openclaw:lease -- acquire --owner openclaw-run-next --slice ${shellQuote(selectedSlice)} --ttl-minutes 60`
      : null,
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

function selectNextSlice(stateFiles: StateFiles): string | null {
  const plan = stateFiles["AUTONOMOUS_WORK_PLAN.md"] ?? "";
  const explicit = plan.match(/Explicit next queued:\s*(.+?)(?:\n|$)/u)?.[1]?.trim();
  if (explicit) {
    return stripMarkdownListPrefix(explicit);
  }

  const queueMatch = plan.match(/## Active Product Advancement Queue\s*\n([\s\S]*?)(?:\n## |\n# |$)/u);
  const queue = queueMatch?.[1] ?? plan;
  const firstItem = queue
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^\d+\.\s+/.test(line) || /^[-*]\s+/.test(line));

  return firstItem ? stripMarkdownListPrefix(firstItem) : null;
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
  ];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")])));
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

async function writeLocalReport(reportPath: string, report: OpenClawRunNextPlan | (OpenClawRunNextPlan & { watchdog: OpenClawWatchdogDecision })): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const watchdog = args.includes("--watchdog");
  const stateFiles = await loadStateFiles();
  const plan = buildOpenClawRunNextPlan({ stateFiles, gitStatusShort: gitStatusShort() });

  if (!watchdog) {
    await writeLocalReport(plan.localReportPath, plan);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const decision = buildOpenClawWatchdogDecision({
    gitStatusShort: plan.gitStatusShort,
    leaseStatus: openClawLeaseStatus(),
    lastRunAt: await loadLastRunAt(plan.localReportPath),
    selectedSlice: plan.selectedSlice,
  });
  await writeLocalReport(plan.localReportPath, { ...plan, watchdog: decision });
  console.log(JSON.stringify({ ...plan, watchdog: decision }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
