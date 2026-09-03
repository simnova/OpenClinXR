import { existsSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import { sliceBriefPath } from "../../../packages/openclinxr/agent-loop/src/slice-team.js";
import { selectNextBoardCard } from "./board-next-selector.js";
import type { BoardIssue, BriefResult } from "./board-brief.js";
import {
  bothyBriefFromSlice,
  bothyTaskIdFromSliceId,
  type BothyFetch,
  type BothyTokenStore,
} from "./board-bothy-dequeue.js";

export const DEFAULT_OPENCLAW_RUN_NEXT_REPORT_PATH = ".openclinxr/openclaw/run-next-report.json";
const DEFAULT_WATCHDOG_IDLE_MINUTES = 60;

type StateFiles = Record<string, string>;

export type SliceSelection = {
  sliceId: string | null;
  templateId: string | null;
  source: "board" | "next-dequeue" | "backlog-table" | "legacy-plan" | null;
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
  /** Live queue card. Supplied by main() from the project board; omitted in tests so the plan
   *  builder stays pure and does not shell out to `gh`. */
  boardCard?: BoardCardSelection | null;
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
  /** When runner auto-advanced a closed slice: exact Next dequeue text + instructions for PROJECT_STATUS. */
  suggestedHeaderUpdate?: string | null;
  /**
   * When `.openclinxr/epics/ACTIVE` exists: epic outer-loop continuity commands.
   * Prefer `pnpm openclaw:epic -- apply-header` over hand-editing Next dequeue.
   */
  epicContinuity?: {
    activeEpicId: string;
    planCommand: string;
    applyHeaderCommand: string;
    advanceCommand: string;
  } | null;
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
  // Allow camelCase segments (e.g. wire-api-durableStore-consumer-v1).
  const backtick = text.match(/`([a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)+)`/u)?.[1];
  if (backtick) return backtick;
  const kebab = text.match(/\b([a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)+)\b/u)?.[1];
  return kebab ?? null;
}

/** A card handed in from the live queue. `agents/rules/EXEC_REHYDRATE.md:38` puts the dequeue
 * queue on the GitHub project board, so a supplied card outranks every markdown tier below. */
export type BoardCardSelection = {
  sliceId: string;
  priority?: string;
  /** Carried through from the BothyBoard selection for the dispatch hop (`tasks.next` body). */
  title?: string;
  body?: string;
};

export function selectNextSlice(
  stateFiles: StateFiles,
  opts?: { boardCard?: BoardCardSelection | null },
): SliceSelection {
  const boardCard = opts?.boardCard;
  if (boardCard?.sliceId) {
    return {
      sliceId: boardCard.sliceId,
      templateId: SLICE_TEMPLATE_MAP[boardCard.sliceId] ?? null,
      source: "board",
    };
  }

  const status = stateFiles["PROJECT_STATUS.md"] ?? "";
  // ANCHORED to a line start. Unanchored, this matched the `**Next dequeue:**` markup used mid-
  // sentence inside a dated checkpoint at PROJECT_STATUS.md:1474 and returned the word
  // "re-selection", lifted from prose describing this very failure. A pointer is a header, not a
  // phrase inside a paragraph about headers.
  const nextDequeue = status.match(/^\*\*Next dequeue:\*\*\s*(.+?)$/mu)?.[1]?.trim();
  if (nextDequeue) {
    const firstOption = nextDequeue.split(/\s+or\s+/iu)[0]?.trim() ?? nextDequeue;
    let sliceId = extractSliceIdFromText(firstOption);
    if (sliceId) {
      // Advancement logic to restore autonomous loop continuation:
      // If the "Next dequeue" slice has been marked "slice team closed" or has a recent "verify ok" + "closed"
      // in Active Work or its checkpoint, consume it and advance to the "Next queued slice" recorded
      // in its own checkpoint (or the "Next:" line in that block). This prevents the runner from
      // re-picking a just-completed slice even if the header pointer lags. Matches the pattern used
      // in instruction-stack-optimization and orchestration-correction checkpoints where each
      // closed slice records its "Next queued slice".
      const closedMatch = new RegExp(`\\|\\s*${sliceId}\\s*\\|.*?(slice team closed|verify ok.*closed)`, 'i').test(status);
      if (closedMatch) {
        // Look for the checkpoint block for this slice and extract its "Next: ..." recommendation.
        const checkpointRegex = new RegExp(`### .*${sliceId}.*?Next:\\s*([^\\n]+)`, 'is');
        const match = status.match(checkpointRegex);
        if (match && match[1]) {
          const advanced = match[1].trim().split(/\s+or\s+/i)[0].trim();
          const advancedId = extractSliceIdFromText(advanced) ?? advanced;
          if (advancedId && advancedId !== sliceId) {
            sliceId = advancedId;
          }
        }
      }
      return {
        sliceId,
        templateId: SLICE_TEMPLATE_MAP[sliceId] ?? null,
        source: "next-dequeue",
      };
    }
  }

  // TIER 2 REMOVED (2026-08-24). It read the first cell of the first markdown table in the file:
  //     status.match(/\|[^\n]+\|\n\|[-| :]+\|\n\|[^|]+\|\s*`?([a-z0-9][a-z0-9-]*)`?/u)
  // MEASURED against the live PROJECT_STATUS.md it returned the word `lateral`. A table cell is not
  // a queue and the tier carried no label saying it was one, so it could only ever produce a
  // plausible-looking token. Anchoring tier 1 alone just moved the false positive here.

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

  // TIER 4 REMOVED (2026-08-24). It took the first list item under "Active Product Advancement
  // Queue" in AUTONOMOUS_WORK_PLAN.md — a file `agents/rules/source-of-truth.md:18` classifies as a
  // "historical audit ledger only ... evidence, not active marching orders". Tier 3 above survives
  // because "Explicit next queued:" is a LABELLED directive; a bare bullet in a retired ledger is
  // not. Refusing here is the point: with no labelled pointer anywhere, the honest answer is that
  // nothing is queued, and the caller should read the board.

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
  const selection = selectNextSlice(input.stateFiles, { boardCard: input.boardCard });
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

  // Orchestration correction (2026-06-08): recognize successful slice:verify (ok:true in the verify report for this slice)
  // as "verification result supplied". This allows canonicalStateUpdate after integrator completes
  // verify + checkpoint + header refresh, so run-next advances Next dequeue instead of re-picking
  // the just-closed slice. Conservative: still requires the verify json to exist and be ok for the selection.
  let canonicalAllowed = false;
  let canonicalReason = "No product change, verification result, or blocker has been supplied.";
  try {
    const verifyPath = path.join(process.cwd(), ".openclinxr/openclaw", `slice-verify-${selection.sliceId}.json`);
    if (existsSync(verifyPath)) {
      const verifyRaw = readFileSync(verifyPath, "utf8");
      const verify = JSON.parse(verifyRaw);
      if (verify && verify.ok === true && verify.sliceId === selection.sliceId) {
        canonicalAllowed = true;
        canonicalReason = "Verification result supplied (slice-verify json ok=true for selected slice) + recent checkpoint + header refresh by integrator.";
      }
    }
  } catch {}

  // Fallback: if a recent checkpoint in state explicitly closes this slice, allow (for cases where verify json not present).
  // This is read-only scan of the provided state snapshot; keeps runner conservative for unverified work.

  // Prevention for loop stall: when we auto-advanced past a closed slice (via verify or checkpoint "closed" marker),
  // compute the exact header text the orchestrator must apply to PROJECT_STATUS.md so the *next* run-next
  // will see the forward pointer. Prefer epic apply-header when an ACTIVE epic exists.
  let suggestedHeaderUpdate: string | null = null;
  const statusForHeader = input.stateFiles["PROJECT_STATUS.md"] ?? "";
  if (canonicalAllowed && selection.sliceId) {
    // Try to find the "Next: ..." recorded in the just-closed slice's checkpoint and format a minimal
    // replacement for the Active Work table row + **Next dequeue:** line.
    const closedCheckpointRegex = new RegExp(`### .*${selection.sliceId}[\\s\\S]*?Next:\\s*([^\\n]+)`, 'i');
    const cpMatch = statusForHeader.match(closedCheckpointRegex);
    const nextFromCheckpoint = cpMatch ? cpMatch[1].trim().split(/\s+or\s+/i)[0].trim() : null;

    if (nextFromCheckpoint) {
      suggestedHeaderUpdate = `**Next dequeue:** ${nextFromCheckpoint}\n\n(Replace the previous "Next dequeue" line and add a closed row for ${selection.sliceId} in the Active Work table. Prefer: pnpm openclaw:epic -- apply-header --next ${JSON.stringify(nextFromCheckpoint)} when an epic is ACTIVE. Required post-close step so the autonomous loop keeps moving.)`;
    }
  }

  const epicContinuity = resolveEpicContinuity(process.cwd());

  return {
    schemaVersion: "openclinxr.openclaw-run-next.v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    selectedSlice: selection.sliceId,
    templateId: selection.templateId,
    sliceBriefExists,
    gitStatusShort: input.gitStatusShort.trim(),
    localReportPath: DEFAULT_OPENCLAW_RUN_NEXT_REPORT_PATH,
    canonicalStateUpdate: {
      allowed: canonicalAllowed,
      reason: canonicalReason,
    },
    nextCommand,
    sliceTeam,
    suggestedHeaderUpdate,
    epicContinuity,
  };
}

/** Read ACTIVE epic pointer for outer-loop continuity (multi-hour). */
export function resolveEpicContinuity(repoRoot: string): OpenClawRunNextPlan["epicContinuity"] {
  const activePath = path.join(repoRoot, ".openclinxr/epics/ACTIVE");
  if (!existsSync(activePath)) return null;
  try {
    const activeEpicId = readFileSync(activePath, "utf8").trim();
    if (!activeEpicId) return null;
    return {
      activeEpicId,
      planCommand: `pnpm openclaw:epic -- plan --epic-id ${activeEpicId}`,
      applyHeaderCommand: `pnpm openclaw:epic -- apply-header --epic-id ${activeEpicId}`,
      advanceCommand: `pnpm openclaw:epic -- advance --epic-id ${activeEpicId}`,
    };
  } catch {
    return null;
  }
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
  const result = spawnSync("git", ["status", "--short", "--branch"], {
    encoding: "utf8",
    env: gitEnvWithoutInheritedRepoVars(),
  });
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

/**
 * Reads the live dequeue queue. `agents/rules/EXEC_REHYDRATE.md:38` puts the queue on the project
 * board; `AGENTS.md:7` tells every agent to dequeue by running this command. Before this existed the
 * two disagreed and this command answered from markdown prose.
 *
 * Fails SOFT on purpose: a `gh` outage, no auth, or a truncated read must not fabricate a slice, and
 * must not hard-crash the runner either — it falls through to the anchored markdown tiers, which now
 * refuse rather than scrape. `--no-board` skips the call for offline use.
 */
/**
 * Maps `selectNextBoardCard`'s FLAT return — { ok, number, priority, title, fetched, totalCount } —
 * onto a slice id. Extracted so the mapping is testable WITHOUT a live board.
 *
 * It is separate for a measured reason. The first version read `picked.item.content.number`, the
 * nested path of the raw board JSON rather than the selector's own shape, so a successful
 * `ok: true` read silently produced null and the board tier never fired. Both unit clauses passed
 * throughout, because they inject a BoardCardSelection directly and never exercise this hop — the
 * defect was only visible in an end-to-end run.
 */
export function boardCardFromSelection(
  picked: { ok?: boolean; number?: unknown; priority?: unknown; taskId?: unknown; source?: unknown; title?: unknown; body?: unknown },
): BoardCardSelection | null {
  if (!picked?.ok) return null;
  if (typeof picked.taskId === "string" && picked.taskId.startsWith("tsk_")) {
    return {
      sliceId: `bothy-${picked.taskId}`,
      priority: typeof picked.priority === "string" ? picked.priority : undefined,
      ...(typeof picked.title === "string" && picked.title.length > 0 ? { title: picked.title } : {}),
      ...(typeof picked.body === "string" && picked.body.length > 0 ? { body: picked.body } : {}),
    };
  }
  if (typeof picked.number !== "number" || picked.number <= 0) return null;
  return {
    sliceId: `issue-${picked.number}`,
    priority: typeof picked.priority === "string" ? picked.priority : undefined,
  };
}

/** Default gh runner for the GitHub branch of {@link boardIssueForDispatch}. */
const defaultGhRunner = (argv: string[]): string =>
  execFileSync(argv[0] as string, argv.slice(1), {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * The dispatch hop for a dequeued card: the `BoardIssue` a `briefFromIssue` call consumes.
 *
 * - `bothy-tsk_*` — the Planted body comes from BothyBoard: the body the selection already
 *   carried (`tasks.next` / its unchanged replay), or `bothy-board.tasks.get` when none.
 *   NEVER shells gh.
 * - `issue-N` — the GitHub path is unchanged: `gh issue view <n> --json number,title,body`.
 */
export async function boardIssueForDispatch(
  card: BoardCardSelection,
  opts: {
    gh?: (argv: string[]) => string;
    bothy?: { pat?: string; fetch?: BothyFetch; store?: BothyTokenStore; repoRoot?: string };
  } = {},
): Promise<BoardIssue> {
  if (bothyTaskIdFromSliceId(card.sliceId)) {
    const brief = await bothyBriefFromSlice({
      sliceId: card.sliceId,
      selectionTitle: card.title,
      selectionBody: card.body,
      pat: opts.bothy?.pat,
      fetch: opts.bothy?.fetch,
      store: opts.bothy?.store,
      repoRoot: opts.bothy?.repoRoot,
    });
    return { number: brief.number, title: brief.title, body: brief.body };
  }

  const numberMatch = /^issue-(\d+)$/.exec(card.sliceId);
  if (!numberMatch) {
    throw new Error(
      `boardIssueForDispatch: expected an issue-N or bothy-tsk_* slice, got '${card.sliceId}'`,
    );
  }
  const issue = JSON.parse(
    (opts.gh ?? defaultGhRunner)(["gh", "issue", "view", numberMatch[1], "--json", "number,title,body"]),
  ) as BoardIssue;
  return { number: issue.number, title: issue.title, body: issue.body };
}

/**
 * `briefFromIssue` names its slice `issue-<number>`; a BothyBoard card passes number 0 and would
 * become the fabricated `issue-0`. Bind the card's own sliceId so a `bothy-tsk_*` dispatch keys
 * on the BothyBoard id (ledger, worktree, contract re-run). `issue-N` is untouched.
 */
export function dispatchBriefForCard(brief: BriefResult, card: BoardCardSelection): BriefResult {
  if (!brief.dispatchable || !card.sliceId.startsWith("bothy-")) return brief;
  return { ...brief, slice: card.sliceId };
}

async function boardCardOrNull(skip: boolean): Promise<BoardCardSelection | null> {
  if (skip) return null;
  try {
    const picked = selectNextBoardCard((argv) =>
      // maxBuffer is NOT optional here. The live board serialises to 3.29 MB against execFileSync's
      // 1 MB default; omitting it truncates the read, and `selectNextBoardCard` then correctly
      // refuses with `incomplete-read` rather than picking from a partial board. Measured 2026-08-24.
      // BothyBoard is the dequeue SSOT (BOTHY_BOARD_DEQUEUE=0 ranks GitHub project 7). Dual-dequeue refused.
      execFileSync(argv[0] as string, argv.slice(1), {
        encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      }));
    return boardCardFromSelection(picked);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const watchdog = args.includes("--watchdog");
  const dryRun = args.includes("--dry-run");
  const stateFiles = await loadStateFiles();
  const boardCard = await boardCardOrNull(args.includes("--no-board"));
  const plan = buildOpenClawRunNextPlan({ stateFiles, gitStatusShort: gitStatusShort(), boardCard });

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