/**
 * OpenClaw board CLI — HOT operational/collab state on GitHub via `gh`.
 *
 * State-plane split (see EXEC_REHYDRATE + openclaw-board skill):
 *   - HOT: task/delegation/comms/review → GitHub issues/comments (this CLI)
 *   - COLD/SSOT: PROJECT_STATUS.md, worker-backlog, handoffs, agents/** memory
 *
 * ALL commands support --dry-run (print gh argv, do NOT execute).
 * NEVER post product/clinical data — coordination metadata only.
 *
 * Runtime artifact (ignored): .openclinxr/openclaw/board-<sliceId>.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const BOARD_SCHEMA = "openclinxr.board-slice.v1" as const;
export const DEFAULT_BOARD_REPO = "simnova/OpenClinXR";
export const BOARD_ARTIFACT_DIR = ".openclinxr/openclaw";

/** Fixed checklist steps after per-role items (always present). */
export const BOARD_FIXED_CHECKLIST = ["verify", "review", "orchestrator"] as const;

/**
 * Banner included on every issue body / status comment.
 * Agents must not paste product, clinical, PHI, scores, or scenario content.
 */
export const NO_PRODUCT_DATA_BANNER =
  "GUARD: coordination metadata only. NEVER post product, clinical, PHI, scores, scenario dialogue, or learner data on this board.";

export type BoardSliceRecord = {
  schemaVersion: typeof BOARD_SCHEMA;
  issueNumber: number | null;
  url: string | null;
  sliceId: string;
  roles: string[];
  title: string;
  repo: string;
  dryRun: boolean;
  createdAt: string;
  closedAt?: string;
};

export type GhCommandPlan = {
  /** Full argv for spawnSync("gh", argv.slice(1)) or print — argv[0] is always "gh". */
  argv: string[];
  /** Shell-ish single line for logs/tests (body may be truncated in display helpers). */
  display: string;
};

export type BoardCliFlags = {
  command: string;
  sliceId?: string;
  title?: string;
  roles?: string[];
  role?: string;
  body?: string;
  repo: string;
  dryRun: boolean;
  json: boolean;
  help: boolean;
};

export function boardRecordRelativePath(sliceId: string): string {
  return path.join(BOARD_ARTIFACT_DIR, `board-${sliceId}.json`);
}

export function boardRecordPath(repoRoot: string, sliceId: string): string {
  return path.join(repoRoot, boardRecordRelativePath(sliceId));
}

export function parseBoardArgs(argv: string[]): BoardCliFlags {
  const flags: BoardCliFlags = {
    command: "help",
    repo: DEFAULT_BOARD_REPO,
    dryRun: false,
    json: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--slice-id" && argv[i + 1]) {
      flags.sliceId = argv[++i];
    } else if (arg === "--title" && argv[i + 1]) {
      flags.title = argv[++i];
    } else if (arg === "--roles" && argv[i + 1]) {
      flags.roles = String(argv[++i])
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
    } else if (arg === "--role" && argv[i + 1]) {
      flags.role = argv[++i];
    } else if (arg === "--body" && argv[i + 1]) {
      flags.body = argv[++i];
    } else if (arg === "--repo" && argv[i + 1]) {
      flags.repo = argv[++i]!;
    } else if (arg.startsWith("--")) {
      if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) i += 1;
    } else {
      positional.push(arg);
    }
  }
  if (positional[0]) flags.command = positional[0]!;
  return flags;
}

/** Reject obvious product/clinical payloads (coordination-only surface). */
export function assertCoordinationOnlyBody(text: string): void {
  const lower = text.toLowerCase();
  const banned = [
    "phi:",
    "patient name",
    "ssn",
    "date of birth",
    "mrn:",
    "clinical diagnosis",
    "licensure score",
    "exam equivalence",
    "hipaa",
  ];
  for (const token of banned) {
    if (lower.includes(token)) {
      throw new Error(
        `Board body rejected: contains product/clinical token "${token}". ${NO_PRODUCT_DATA_BANNER}`,
      );
    }
  }
  // Soft size guard — coordination BLUF stays small
  if (text.length > 12_000) {
    throw new Error(
      `Board body rejected: ${text.length} chars exceeds coordination-only limit (12000). ${NO_PRODUCT_DATA_BANNER}`,
    );
  }
}

export function buildRoleTaskList(roles: string[]): string[] {
  const items: string[] = [];
  for (const role of roles) {
    items.push(`- [ ] role: ${role}`);
  }
  for (const step of BOARD_FIXED_CHECKLIST) {
    items.push(`- [ ] ${step}`);
  }
  return items;
}

export function buildSliceIssueBody(input: {
  sliceId: string;
  title: string;
  roles: string[];
}): string {
  const taskList = buildRoleTaskList(input.roles).join("\n");
  return [
    `## OpenClaw slice board`,
    ``,
    `**sliceId:** \`${input.sliceId}\``,
    `**title:** ${input.title}`,
    ``,
    `### Task list (role-decomposed)`,
    taskList,
    ``,
    `### Agent comms`,
    `Post status with:`,
    `\`pnpm openclaw:board status --slice-id ${input.sliceId} --role <role> --body '<terse BLUF + evidence>'\``,
    ``,
    `### ${NO_PRODUCT_DATA_BANNER}`,
    ``,
  ].join("\n");
}

export function buildStatusCommentBody(role: string, body: string): string {
  assertCoordinationOnlyBody(body);
  assertCoordinationOnlyBody(role);
  return [
    `**role:** \`${role}\``,
    ``,
    body.trim(),
    ``,
    `---`,
    NO_PRODUCT_DATA_BANNER,
  ].join("\n");
}

export function buildCloseCommentBody(resolution: string): string {
  assertCoordinationOnlyBody(resolution);
  return [
    `**resolution**`,
    ``,
    resolution.trim(),
    ``,
    `---`,
    NO_PRODUCT_DATA_BANNER,
  ].join("\n");
}

export function planGhIssueCreate(input: {
  repo: string;
  title: string;
  body: string;
}): GhCommandPlan {
  assertCoordinationOnlyBody(input.body);
  assertCoordinationOnlyBody(input.title);
  const argv = [
    "gh",
    "issue",
    "create",
    "--repo",
    input.repo,
    "--title",
    input.title,
    "--body",
    input.body,
  ];
  return { argv, display: formatArgvForDisplay(argv) };
}

export function planGhIssueComment(input: {
  issueNumber: number;
  repo: string;
  body: string;
}): GhCommandPlan {
  assertCoordinationOnlyBody(input.body);
  const argv = [
    "gh",
    "issue",
    "comment",
    String(input.issueNumber),
    "--repo",
    input.repo,
    "--body",
    input.body,
  ];
  return { argv, display: formatArgvForDisplay(argv) };
}

export function planGhIssueClose(input: {
  issueNumber: number;
  repo: string;
  comment?: string;
}): GhCommandPlan {
  const argv = [
    "gh",
    "issue",
    "close",
    String(input.issueNumber),
    "--repo",
    input.repo,
  ];
  if (input.comment) {
    assertCoordinationOnlyBody(input.comment);
    argv.push("--comment", input.comment);
  }
  return { argv, display: formatArgvForDisplay(argv) };
}

/** Quote for display only (not a full shell escaper). */
export function formatArgvForDisplay(argv: string[]): string {
  return argv
    .map((part) => {
      if (part === "") return '""';
      if (/[\s'"$`\\]/.test(part) || part.includes("\n")) {
        return `'${part.replace(/'/g, `'\\''`)}'`;
      }
      return part;
    })
    .join(" ");
}

export function parseIssueCreateUrl(stdout: string): { issueNumber: number; url: string } {
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/);
  if (!urlMatch) {
    throw new Error(`Could not parse issue URL from gh output: ${stdout.slice(0, 200)}`);
  }
  return { issueNumber: Number(urlMatch[1]), url: urlMatch[0]! };
}

export function loadBoardRecord(repoRoot: string, sliceId: string): BoardSliceRecord {
  const p = boardRecordPath(repoRoot, sliceId);
  if (!existsSync(p)) {
    throw new Error(
      `Board record not found for slice "${sliceId}": ${boardRecordRelativePath(sliceId)}. Run slice-open first.`,
    );
  }
  const raw = JSON.parse(readFileSync(p, "utf8")) as BoardSliceRecord;
  if (raw.sliceId !== sliceId) {
    throw new Error(`Board record sliceId mismatch: expected ${sliceId}, got ${raw.sliceId}`);
  }
  return raw;
}

export function saveBoardRecord(repoRoot: string, record: BoardSliceRecord): string {
  const p = boardRecordPath(repoRoot, record.sliceId);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return p;
}

/**
 * One-liner injected into each role spawn task when team-spawn --board is set.
 */
export function boardStatusDirective(sliceId: string, roleId: string): string {
  return `On completion, post status: \`pnpm openclaw:board status --slice-id ${sliceId} --role ${roleId} --body '<terse BLUF status + evidence>'\`.`;
}

export function appendBoardStatusDirective(spawnPrompt: string, sliceId: string, roleId: string): string {
  const line = boardStatusDirective(sliceId, roleId);
  if (spawnPrompt.includes("pnpm openclaw:board status")) return spawnPrompt;
  return `${spawnPrompt.trimEnd()}\n\n${line}\n`;
}

function runGh(plan: GhCommandPlan, dryRun: boolean): { stdout: string; executed: boolean } {
  if (dryRun) {
    console.log(`DRY-RUN: ${plan.display}`);
    return { stdout: "", executed: false };
  }
  const [bin, ...args] = plan.argv;
  const result = spawnSync(bin!, args, {
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || `gh exit ${result.status}`).trim();
    throw new Error(`gh failed (${result.status}): ${err}`);
  }
  return { stdout: (result.stdout ?? "").trim(), executed: true };
}

export function cmdSliceOpen(
  repoRoot: string,
  input: {
    sliceId: string;
    title: string;
    roles: string[];
    repo: string;
    dryRun: boolean;
  },
): { record: BoardSliceRecord; plan: GhCommandPlan; recordPath: string } {
  if (!input.sliceId) throw new Error("slice-open requires --slice-id");
  if (!input.title) throw new Error("slice-open requires --title");
  if (!input.roles.length) throw new Error("slice-open requires --roles <r1,r2,...>");

  const body = buildSliceIssueBody({
    sliceId: input.sliceId,
    title: input.title,
    roles: input.roles,
  });
  const plan = planGhIssueCreate({
    repo: input.repo,
    title: input.title,
    body,
  });

  let issueNumber: number | null = null;
  let url: string | null = null;
  if (!input.dryRun) {
    const { stdout } = runGh(plan, false);
    const parsed = parseIssueCreateUrl(stdout);
    issueNumber = parsed.issueNumber;
    url = parsed.url;
  } else {
    runGh(plan, true);
  }

  const record: BoardSliceRecord = {
    schemaVersion: BOARD_SCHEMA,
    issueNumber,
    url,
    sliceId: input.sliceId,
    roles: input.roles,
    title: input.title,
    repo: input.repo,
    dryRun: input.dryRun,
    createdAt: new Date().toISOString(),
  };
  const recordPath = saveBoardRecord(repoRoot, record);
  return { record, plan, recordPath };
}

export function cmdStatus(
  repoRoot: string,
  input: {
    sliceId: string;
    role: string;
    body: string;
    dryRun: boolean;
  },
): { plan: GhCommandPlan; issueNumber: number; commentBody: string } {
  if (!input.sliceId) throw new Error("status requires --slice-id");
  if (!input.role) throw new Error("status requires --role");
  if (!input.body) throw new Error("status requires --body");

  const record = loadBoardRecord(repoRoot, input.sliceId);
  if (record.issueNumber == null) {
    throw new Error(
      `Board record for ${input.sliceId} has no issueNumber (dry-run open?). Re-run slice-open without --dry-run, or seed issueNumber in ${boardRecordRelativePath(input.sliceId)}.`,
    );
  }

  const commentBody = buildStatusCommentBody(input.role, input.body);
  const plan = planGhIssueComment({
    issueNumber: record.issueNumber,
    repo: record.repo,
    body: commentBody,
  });
  runGh(plan, input.dryRun);
  return { plan, issueNumber: record.issueNumber, commentBody };
}

export function cmdClose(
  repoRoot: string,
  input: {
    sliceId: string;
    body: string;
    dryRun: boolean;
  },
): { closePlan: GhCommandPlan; commentPlan: GhCommandPlan; issueNumber: number } {
  if (!input.sliceId) throw new Error("close requires --slice-id");
  if (!input.body) throw new Error("close requires --body");

  const record = loadBoardRecord(repoRoot, input.sliceId);
  if (record.issueNumber == null) {
    throw new Error(
      `Board record for ${input.sliceId} has no issueNumber. Cannot close.`,
    );
  }

  const commentBody = buildCloseCommentBody(input.body);
  const commentPlan = planGhIssueComment({
    issueNumber: record.issueNumber,
    repo: record.repo,
    body: commentBody,
  });
  const closePlan = planGhIssueClose({
    issueNumber: record.issueNumber,
    repo: record.repo,
    comment: commentBody,
  });

  // Prefer single close --comment when not dry-run; dry-run prints both plans for test clarity.
  if (input.dryRun) {
    console.log(`DRY-RUN: ${commentPlan.display}`);
    console.log(`DRY-RUN: ${closePlan.display}`);
  } else {
    runGh(closePlan, false);
    const closed: BoardSliceRecord = {
      ...record,
      closedAt: new Date().toISOString(),
    };
    saveBoardRecord(repoRoot, closed);
  }

  return { closePlan, commentPlan, issueNumber: record.issueNumber };
}

function printHelp(): void {
  console.log(`openclaw board — HOT slice state on GitHub (gh)

Usage:
  pnpm openclaw:board -- slice-open --slice-id <id> --title <t> --roles <r1,r2,..> [--repo ${DEFAULT_BOARD_REPO}] [--dry-run]
  pnpm openclaw:board -- status --slice-id <id> --role <r> --body <text> [--dry-run]
  pnpm openclaw:board -- close --slice-id <id> --body <resolution> [--dry-run]

All commands support --dry-run (print gh command, do not execute).
Artifact: .openclinxr/openclaw/board-<sliceId>.json (ignored runtime; per-slice write-scope only).

${NO_PRODUCT_DATA_BANNER}
`);
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const flags = parseBoardArgs(process.argv.slice(2));

  if (flags.help || flags.command === "help") {
    printHelp();
    return;
  }

  try {
    if (flags.command === "slice-open") {
      const result = cmdSliceOpen(repoRoot, {
        sliceId: flags.sliceId ?? "",
        title: flags.title ?? "",
        roles: flags.roles ?? [],
        repo: flags.repo,
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, ...result.record, recordPath: result.recordPath, plan: result.plan }, null, 2));
      } else {
        console.log(
          `slice-open ${flags.dryRun ? "DRY-RUN " : ""}slice=${result.record.sliceId} issue=${result.record.issueNumber ?? "n/a"} → ${result.recordPath}`,
        );
      }
      return;
    }

    if (flags.command === "status") {
      const result = cmdStatus(repoRoot, {
        sliceId: flags.sliceId ?? "",
        role: flags.role ?? "",
        body: flags.body ?? "",
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, issueNumber: result.issueNumber, plan: result.plan }, null, 2));
      } else {
        console.log(
          `status ${flags.dryRun ? "DRY-RUN " : ""}issue=#${result.issueNumber} role=${flags.role}`,
        );
      }
      return;
    }

    if (flags.command === "close") {
      const result = cmdClose(repoRoot, {
        sliceId: flags.sliceId ?? "",
        body: flags.body ?? "",
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              issueNumber: result.issueNumber,
              closePlan: result.closePlan,
              commentPlan: result.commentPlan,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          `close ${flags.dryRun ? "DRY-RUN " : ""}issue=#${result.issueNumber}`,
        );
      }
      return;
    }

    printHelp();
    process.exitCode = 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await main();
}
