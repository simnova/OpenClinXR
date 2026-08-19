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

/**
 * Board-as-dequeue-queue (issue #448) — the Factory field on project 7.
 *
 * Field id and option ids are GitHub project node ids; option ids are resolved at runtime by NAME
 * from `gh project field-list` so the four non-Idle stages never need re-hardcoding when the
 * board drifts. (Measured on the live board: Planted = `53aeb5a6` — documented, not pinned.)
 */
export const FACTORY_PROJECT_NUMBER = 7;
export const FACTORY_OWNER = "simnova";
export const FACTORY_FIELD_ID = "PVTSSF_lADOAAIjts4BW0-vzhfup8E";
export const FACTORY_FIELD_NAME = "Factory";
export const FACTORY_STAGES = ["Idle", "Planted", "Dispatched", "Landed", "Graded"] as const;
export type FactoryStage = (typeof FACTORY_STAGES)[number];

/** Injected gh command runner — the test seam for every board write. */
export type GhCommandRunner = (argv: string[]) => string;

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
  session?: string;
  body?: string;
  repo: string;
  pr?: number;
  verdict?: string;
  method?: string;
  stage?: string;
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
    } else if (arg === "--session" && argv[i + 1]) {
      flags.session = argv[i + 1];
      i += 1;
    } else if (arg === "--role" && argv[i + 1]) {
      flags.role = argv[++i];
    } else if (arg === "--body" && argv[i + 1]) {
      flags.body = argv[++i];
    } else if (arg === "--repo" && argv[i + 1]) {
      flags.repo = argv[++i]!;
    } else if (arg === "--pr" && argv[i + 1]) {
      flags.pr = Number(argv[++i]);
    } else if (arg === "--verdict" && argv[i + 1]) {
      flags.verdict = argv[++i];
    } else if (arg === "--method" && argv[i + 1]) {
      flags.method = argv[++i];
    } else if (arg === "--stage" && argv[i + 1]) {
      flags.stage = argv[++i];
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

/**
 * A status comment may carry the worker's grok `sessionId`. That id is the ONLY way to
 * `--resume` a worker later, and it otherwise lives just in the dispatching process's memory —
 * so it dies with the orchestrator session. Persisting it on the issue makes a dead worker
 * recoverable by whoever picks the slice up next, including a different orchestrator.
 * It is coordination metadata (an opaque uuid), never product data.
 */
export function buildStatusCommentBody(role: string, body: string, session?: string): string {
  assertCoordinationOnlyBody(body);
  assertCoordinationOnlyBody(role);
  if (session !== undefined && !/^[0-9a-f-]{16,64}$/i.test(session)) {
    throw new Error(`--session must be an opaque session id (hex + dashes), got: ${session}`);
  }
  return [
    `**role:** \`${role}\``,
    ...(session ? [`**worker session:** \`${session}\` — resume with \`grok -p "<delta>" --resume ${session}\``] : []),
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

/** Default gh runner for the machine writers (dispatch/integrate) — throws on failure. */
export function defaultGhRunner(argv: string[]): string {
  const [bin, ...args] = argv;
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
  return (result.stdout ?? "").trim();
}

/**
 * The issue number backing a slice, or null when the slice has no card.
 *
 * Resolution order: the board record (`.openclinxr/openclaw/board-<slice>.json`, written by
 * slice-open) first, then the `issue-<n>` slice-id convention the dispatch ledger uses. null means
 * "no card exists" — the caller decides whether that is a skip (integrate) or a warning (dispatch).
 */
export function resolveIssueNumberForSlice(repoRoot: string, sliceId: string): number | null {
  const recordPath = boardRecordPath(repoRoot, sliceId);
  if (existsSync(recordPath)) {
    try {
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { issueNumber?: number | null };
      if (typeof record.issueNumber === "number") return record.issueNumber;
    } catch {
      // An unreadable board record is not this function's problem — fall through to the id parse.
    }
  }
  const match = /^issue-(\d+)$/.exec(sliceId.trim());
  return match ? Number(match[1]) : null;
}

/** gh project item-edit argv — the single Factory write (issue #448). */
export function planFactoryStageWrite(input: {
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string;
  stage: FactoryStage;
}): GhCommandPlan {
  const argv = [
    "gh",
    "project",
    "item-edit",
    "--project-id",
    input.projectId,
    "--id",
    input.itemId,
    "--field-id",
    input.fieldId,
    "--single-select-option-id",
    input.optionId,
  ];
  return {
    argv,
    display: `gh project item-edit --project-id <project> --id ${input.itemId} --field-id ${input.fieldId} --single-select-option-id ${input.optionId}  # Factory=${input.stage}`,
  };
}

/** Resolve the single-select option id for a stage from `gh project field-list` JSON. */
export function resolveFactoryOptionId(fieldListJson: string, fieldId: string, stage: FactoryStage): string {
  const parsed = JSON.parse(fieldListJson) as {
    fields?: Array<{ id?: string; name?: string; options?: Array<{ id?: string; name?: string }> }>;
  };
  const field = (parsed.fields ?? []).find((f) => f.id === fieldId || f.name === FACTORY_FIELD_NAME);
  if (!field) {
    throw new Error(
      `Factory field not found on project ${FACTORY_PROJECT_NUMBER} (id ${fieldId} or name ${FACTORY_FIELD_NAME}) — the dequeue queue is not wired`,
    );
  }
  const option = (field.options ?? []).find((o) => o.name === stage);
  if (!option?.id) {
    throw new Error(
      `Factory stage "${stage}" has no option on project ${FACTORY_PROJECT_NUMBER} — expected one of ${FACTORY_STAGES.join(", ")}`,
    );
  }
  return option.id;
}

export type FactoryFieldWriteResult =
  | { ok: true; issueNumber: number; itemId: string; stage: FactoryStage; plans: GhCommandPlan[] }
  | { ok: false; skipped: true; reason: "no-issue"; plans: [] };

/**
 * The shared Factory-field verb (issue #448) — called by the planter (CLI), the dispatcher
 * (Dispatched), the integrator (Landed) and the grader (CLI). Ensures membership (`item-add` when
 * the card is not yet on the board) then writes the single-select option.
 *
 * THROWS on any gh failure — the caller decides whether that means refuse (dispatch) or a loud
 * recorded warning (integrate). Returns `skipped` when the slice has no board card.
 */
export function setFactoryField(
  repoRoot: string,
  sliceId: string,
  stage: FactoryStage,
  options?: {
    repo?: string;
    projectNumber?: number;
    owner?: string;
    issueNumber?: number;
    dryRun?: boolean;
    runner?: GhCommandRunner;
    fieldId?: string;
  },
): FactoryFieldWriteResult {
  const repo = options?.repo ?? DEFAULT_BOARD_REPO;
  const projectNumber = options?.projectNumber ?? FACTORY_PROJECT_NUMBER;
  const owner = options?.owner ?? FACTORY_OWNER;
  const fieldId = options?.fieldId ?? FACTORY_FIELD_ID;
  const runner = options?.runner ?? defaultGhRunner;
  const issueNumber = options?.issueNumber ?? resolveIssueNumberForSlice(repoRoot, sliceId);
  if (issueNumber === null) {
    return { ok: false, skipped: true, reason: "no-issue", plans: [] };
  }

  const plans: GhCommandPlan[] = [];
  const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  const planProjectView: GhCommandPlan = {
    argv: ["gh", "project", "view", String(projectNumber), "--owner", owner, "--format", "json", "-q", ".id"],
    display: `gh project view ${projectNumber} --owner ${owner} --format json -q .id`,
  };
  const planItemList: GhCommandPlan = {
    argv: ["gh", "project", "item-list", String(projectNumber), "--owner", owner, "--format", "json", "--limit", "1000"],
    display: `gh project item-list ${projectNumber} --owner ${owner} --format json --limit 1000  # membership scan`,
  };
  const planItemAdd: GhCommandPlan = {
    argv: ["gh", "project", "item-add", String(projectNumber), "--owner", owner, "--url", issueUrl, "--format", "json"],
    display: `gh project item-add ${projectNumber} --owner ${owner} --url ${issueUrl} --format json`,
  };
  const planFieldList: GhCommandPlan = {
    argv: ["gh", "project", "field-list", String(projectNumber), "--owner", owner, "--format", "json"],
    display: `gh project field-list ${projectNumber} --owner ${owner} --format json  # resolve Factory option for ${stage}`,
  };

  if (options?.dryRun) {
    return {
      ok: true,
      issueNumber,
      itemId: "<item-id>",
      stage,
      plans: [planProjectView, planItemList, planItemAdd, planFieldList, planFactoryStageWrite({
        projectId: "<project-id>",
        itemId: "<item-id>",
        fieldId,
        optionId: "<option-id>",
        stage,
      })],
    };
  }

  plans.push(planProjectView);
  const projectId = runner(planProjectView.argv).trim();

  plans.push(planItemList);
  const itemListJson = runner(planItemList.argv);
  const itemList = JSON.parse(itemListJson) as { items?: Array<{ id?: string; content?: { number?: number } | null }> };
  let itemId = (itemList.items ?? []).find(
    (item) => item.content != null && Number(item.content.number) === issueNumber,
  )?.id;

  if (!itemId) {
    // Card not on the board — ensure membership (issue #448 hole 4: no item-add existed).
    plans.push(planItemAdd);
    itemId = parseItemAddId(runner(planItemAdd.argv));
  }

  plans.push(planFieldList);
  const optionId = resolveFactoryOptionId(runner(planFieldList.argv), fieldId, stage);

  const writePlan = planFactoryStageWrite({ projectId, itemId, fieldId, optionId, stage });
  plans.push(writePlan);
  runner(writePlan.argv);

  return { ok: true, issueNumber, itemId, stage, plans };
}

/** gh project item-add prints the new item id (raw or as --format json). */
function parseItemAddId(stdout: string): string {
  const trimmed = stdout.trim();
  if (/^PVTI_[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { id?: string };
    if (typeof parsed.id === "string" && /^PVTI_/.test(parsed.id)) return parsed.id;
  } catch {
    // fall through to the refusal below
  }
  throw new Error(`could not parse item id from gh project item-add output: ${trimmed.slice(0, 200)}`);
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
    session?: string;
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

  const commentBody = buildStatusCommentBody(input.role, input.body, input.session);
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
  pnpm openclaw:board -- factory --slice-id <id> --stage Planted|Dispatched|Landed|Graded [--dry-run]

All commands support --dry-run (print gh command, do not execute).
Artifact: .openclinxr/openclaw/board-<sliceId>.json (ignored runtime; per-slice write-scope only).
factory: write the board's Factory field (the dequeue queue). Workers NEVER call this — the
orchestrator plants/lands/grades; dispatch() and integrate() write Dispatched/Landed mechanically.

${NO_PRODUCT_DATA_BANNER}
`);
}

/** PR review COMMENT plan (feedback surface — a single account can always comment). */
export function planGhPrReview(input: { repo: string; pr: number; body: string }): GhCommandPlan {
  const argv = ["gh", "pr", "review", String(input.pr), "--repo", input.repo, "--comment", "--body", input.body];
  return { argv, display: `gh pr review ${input.pr} --repo ${input.repo} --comment --body <${input.body.length}c>` };
}

/**
 * Commit-status plan — the identity-agnostic MERGE GATE (relaxation A; needs PAT statuses:write).
 * approve → success, request-changes → failure, on context agent-review/<role>. Branch protection
 * requiring agent-review/* enforces review-before-merge WITHOUT a second identity (verified 2026-08-04).
 */
export function planGhReviewStatus(input: { repo: string; sha: string; role: string; verdict: string }): GhCommandPlan {
  const state = input.verdict === "approve" ? "success" : "failure";
  const context = `agent-review/${input.role}`;
  const argv = ["gh", "api", `repos/${input.repo}/statuses/${input.sha}`, "-f", `state=${state}`, "-f", `context=${context}`, "-f", `description=${input.role}: ${input.verdict}`];
  return { argv, display: `gh api repos/${input.repo}/statuses/${input.sha} state=${state} context=${context}` };
}

/** review: post PR review feedback (comment) AND set the agent-review/<role> merge-gate status. */
export function cmdReview(input: { repo: string; pr: number; verdict: string; role: string; body: string; dryRun: boolean }): {
  reviewPlan: GhCommandPlan; statusPlan: GhCommandPlan; sha: string; state: string;
} {
  if (!input.repo) throw new Error("review requires --repo");
  if (!input.pr) throw new Error("review requires --pr");
  if (input.verdict !== "approve" && input.verdict !== "request-changes") {
    throw new Error("review requires --verdict approve|request-changes");
  }
  if (!input.role) throw new Error("review requires --role");
  if (!input.body) throw new Error("review requires --body");
  assertCoordinationOnlyBody(input.body);

  const reviewBody = `${NO_PRODUCT_DATA_BANNER}\n\n**${input.role} review — ${input.verdict}**\n\n${input.body}`;
  let sha = "<PR_HEAD_SHA>"; // dry-run placeholder; resolved live below
  if (!input.dryRun) {
    const res = spawnSync("gh", ["pr", "view", String(input.pr), "--repo", input.repo, "--json", "headRefOid", "-q", ".headRefOid"], { encoding: "utf8" });
    if (res.status !== 0) throw new Error(`could not resolve PR #${input.pr} head SHA: ${res.stderr || res.stdout}`);
    sha = String(res.stdout).trim();
  }
  const reviewPlan = planGhPrReview({ repo: input.repo, pr: input.pr, body: reviewBody });
  const statusPlan = planGhReviewStatus({ repo: input.repo, sha, role: input.role, verdict: input.verdict });
  runGh(reviewPlan, input.dryRun);
  runGh(statusPlan, input.dryRun);
  return { reviewPlan, statusPlan, sha, state: input.verdict === "approve" ? "success" : "failure" };
}

export function planGhMerge(input: { repo: string; pr: number; method: string }): GhCommandPlan {
  const m = input.method === "merge" ? "--merge" : input.method === "rebase" ? "--rebase" : "--squash";
  const argv = ["gh", "pr", "merge", String(input.pr), "--repo", input.repo, m, "--delete-branch"];
  return { argv, display: `gh pr merge ${input.pr} --repo ${input.repo} ${m} --delete-branch` };
}

/** Read the agent-review/<role> commit status on a PR head (live). */
export function readReviewStatus(repo: string, pr: number, role: string): { state: string; found: boolean } {
  const shaRes = spawnSync("gh", ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid", "-q", ".headRefOid"], { encoding: "utf8" });
  if (shaRes.status !== 0) throw new Error(`could not resolve PR #${pr}: ${shaRes.stderr}`);
  const sha = String(shaRes.stdout).trim();
  const st = spawnSync("gh", ["api", `repos/${repo}/commits/${sha}/status`], { encoding: "utf8" });
  if (st.status !== 0) throw new Error(`could not read status of ${sha}: ${st.stderr}`);
  const data = JSON.parse(String(st.stdout)) as { statuses?: Array<{ context: string; state: string }> };
  const found = (data.statuses ?? []).find((x) => x.context === `agent-review/${role}`);
  return { state: found?.state ?? "missing", found: !!found };
}

/**
 * merge: single-account WORKAROUND for the review gate. Self-approve is blocked by GitHub and
 * branch protection is admin-bypassable, so we enforce the gate in the TOOL: refuse to merge unless
 * `agent-review/<role>` is success. The OpenClaw loop merges via this → cannot merge unreviewed work.
 */
export function cmdMerge(input: { repo: string; pr: number; role: string; method: string; dryRun: boolean }): {
  gate: { role: string; state: string; passed: boolean }; mergePlan: GhCommandPlan;
} {
  if (!input.repo) throw new Error("merge requires --repo");
  if (!input.pr) throw new Error("merge requires --pr");
  if (!input.role) throw new Error("merge requires --role (required reviewer, e.g. skeptic)");
  const mergePlan = planGhMerge({ repo: input.repo, pr: input.pr, method: input.method || "squash" });
  if (input.dryRun) {
    return { gate: { role: input.role, state: "<live-check>", passed: false }, mergePlan };
  }
  const st = readReviewStatus(input.repo, input.pr, input.role);
  const passed = st.state === "success";
  if (!passed) {
    throw new Error(
      `REVIEW GATE BLOCKED merge of PR #${input.pr}: agent-review/${input.role} is "${st.state}" (need success). Run \`openclaw:board review --pr ${input.pr} --repo ${input.repo} --verdict approve --role ${input.role} --body "..."\` first.`,
    );
  }
  runGh(mergePlan, false);
  return { gate: { role: input.role, state: st.state, passed }, mergePlan };
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

    if (flags.command === "review") {
      const result = cmdReview({
        repo: flags.repo,
        pr: flags.pr ?? 0,
        verdict: flags.verdict ?? "",
        role: flags.role ?? "",
        body: flags.body ?? "",
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, sha: result.sha, state: result.state, reviewPlan: result.reviewPlan, statusPlan: result.statusPlan }, null, 2));
      } else {
        console.log(`review ${flags.dryRun ? "DRY-RUN " : ""}pr=#${flags.pr} role=${flags.role} verdict=${flags.verdict} → agent-review/${flags.role}=${result.state}`);
      }
      return;
    }

    if (flags.command === "merge") {
      const result = cmdMerge({
        repo: flags.repo,
        pr: flags.pr ?? 0,
        role: flags.role ?? "",
        method: flags.method ?? "squash",
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, gate: result.gate, mergePlan: result.mergePlan }, null, 2));
      } else {
        console.log(`merge ${flags.dryRun ? "DRY-RUN " : ""}pr=#${flags.pr} gate=agent-review/${flags.role}:${result.gate.state} → ${result.gate.passed ? "MERGED" : (flags.dryRun ? "would-check" : "BLOCKED")}`);
      }
      return;
    }

    if (flags.command === "factory") {
      if (!flags.sliceId) throw new Error("factory requires --slice-id");
      if (!flags.stage) throw new Error("factory requires --stage Planted|Dispatched|Landed|Graded");
      const stage = flags.stage as FactoryStage;
      if (!(FACTORY_STAGES as readonly string[]).includes(stage)) {
        throw new Error(`factory --stage must be one of ${FACTORY_STAGES.join(", ")}`);
      }
      const result = setFactoryField(repoRoot, flags.sliceId, stage, {
        repo: flags.repo,
        dryRun: flags.dryRun,
      });
      if (!result.ok) {
        console.log(`factory ${flags.dryRun ? "DRY-RUN " : ""}slice=${flags.sliceId}: no board card — skipped`);
        return;
      }
      if (flags.dryRun) {
        for (const plan of result.plans) console.log(`DRY-RUN: ${plan.display}`);
        return;
      }
      if (flags.json) {
        console.log(JSON.stringify({ ok: true, issueNumber: result.issueNumber, itemId: result.itemId, stage: result.stage }, null, 2));
      } else {
        console.log(`factory slice=${flags.sliceId} issue=#${result.issueNumber} → Factory=${result.stage}`);
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
