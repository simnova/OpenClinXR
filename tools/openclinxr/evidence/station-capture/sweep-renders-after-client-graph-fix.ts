/**
 * Sequential station-environment capture of every shipped bundle.
 *
 * Known-good (render-cause-2026-09-12.md): ed_chest_pain_priority_v2 resolves in
 * 20 s and writes a manifest after the client-graph fix. This script points the
 * same capture at the rest of the population, one case at a time, and records
 * the diagnostic class of every failure. It does not repair causes, wait
 * budgets, or grade pixels.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import {
  captureStationEnvironmentRooms,
  shippedStationIds,
  type RoomCaptureManifestEntry,
} from "../ui-xr-environment-room-capture.js";
import {
  parseDiagnosticsFromTimeoutMessage,
  PREDICATE_ERROR_CLASS,
  TIMEOUT_CLASSES,
  type RenderStopClass,
} from "./classify-one-render.js";

export const SWEEP_REPORT_REL =
  "tools/openclinxr/evidence/station-capture/render-sweep-after-the-client-graph-fix-2026-09-12.md";

export const SWEEP_OUTCOMES = ["rendered", "timeout", "other-error"] as const;
export type SweepOutcome = (typeof SWEEP_OUTCOMES)[number];

export type SweepRow = {
  caseId: string;
  outcome: SweepOutcome;
  classification: RenderStopClass;
  durationMs: number;
  waitName: string | null;
  pageErrors: string;
  consoleText: string;
  failedRequests: string;
  liveLine: string;
  message: string;
};

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const ALLOWED_CLASSES: readonly string[] = [
  ...TIMEOUT_CLASSES,
  PREDICATE_ERROR_CLASS,
  "did not stop",
  "unclassified",
];

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function formatLiveLine(entry: RoomCaptureManifestEntry): string {
  const shell = entry.liveShell;
  return (
    `env=${shell.environmentId}`
    + ` depth=${String(shell.roomDepthMeters)}`
    + ` floor=${String(shell.floorColor)}`
    + ` cam=${String(shell.cameraFraming)}`
  );
}

async function captureOne(input: {
  caseId: string;
  baseUrl: string;
  jobTmp: string;
}): Promise<SweepRow> {
  const started = Date.now();
  const outputDir = path.join(input.jobTmp, input.caseId);
  mkdirSync(outputDir, { recursive: true });
  try {
    const manifest = await captureStationEnvironmentRooms({
      scenarioIds: [input.caseId],
      outputDir,
      baseUrl: input.baseUrl,
    });
    const entry = manifest.entries[0];
    if (entry === undefined) {
      return {
        caseId: input.caseId,
        outcome: "other-error",
        classification: "unclassified",
        durationMs: Date.now() - started,
        waitName: null,
        pageErrors: "",
        consoleText: "",
        failedRequests: "",
        liveLine: "",
        message: "capture returned without throwing and wrote zero manifest entries",
      };
    }
    return {
      caseId: input.caseId,
      outcome: "rendered",
      classification: "did not stop",
      durationMs: Date.now() - started,
      waitName: null,
      pageErrors: "",
      consoleText: "",
      failedRequests: "",
      liveLine: formatLiveLine(entry),
      message: "capture completed without throwing",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const parsed = parseDiagnosticsFromTimeoutMessage(message);
    const classification = parsed.classification ?? "unclassified";
    const outcome: SweepOutcome = parsed.waitName ? "timeout" : "other-error";
    return {
      caseId: input.caseId,
      outcome,
      classification,
      durationMs: Date.now() - started,
      waitName: parsed.waitName,
      pageErrors: parsed.pageErrors,
      consoleText: parsed.console,
      failedRequests: parsed.failedRequests,
      liveLine: "",
      message,
    };
  }
}

export function renderSweepReport(input: {
  treeSha: string;
  startedAt: string;
  finishedAt: string;
  serverUrl: string;
  rows: readonly SweepRow[];
}): string {
  const renderedCount = input.rows.filter((row) => row.outcome === "rendered").length;
  const timeoutCount = input.rows.filter((row) => row.outcome === "timeout").length;
  const otherCount = input.rows.filter((row) => row.outcome === "other-error").length;
  const sections = input.rows.map((row) => {
    const wait = row.waitName ?? "(none)";
    return [
      `### \`${row.caseId}\``,
      `- outcome: ${row.outcome}`,
      `- classification: ${row.classification}`,
      `- durationMs: ${String(row.durationMs)}`,
      `- wait that fired: ${wait}`,
      `- pageErrors: ${row.pageErrors || "(none)"}`,
      `- console: ${row.consoleText || "(none)"}`,
      `- failedRequests: ${row.failedRequests || "(none)"}`,
      `- live: ${row.liveLine || "(none)"}`,
      "",
      "```",
      row.message.slice(0, 800),
      "```",
      "",
    ].join("\n");
  });
  return [
    "# Render sweep after the client-graph fix (2026-09-12)",
    "",
    "Instrument-only. Each shipped station is captured one at a time against a",
    "shared portless ui-xr server. Failures keep the pageDiagnostics class; this",
    "file does not repair them, change wait budgets, or grade how the rooms look.",
    "",
    `- tree: \`${input.treeSha}\``,
    `- startedAt: ${input.startedAt}`,
    `- finishedAt: ${input.finishedAt}`,
    `- server: ${input.serverUrl}`,
    `- command: \`captureStationEnvironmentRooms({ scenarioIds: [<one>] })\` per station`,
    `- populationSource: \`shippedStationIds()\` (bundle dirs under apps/ui-xr/public/xr-assets/generated)`,
    `- population: ${String(input.rows.length)}`,
    `- rendered: ${String(renderedCount)} of ${String(input.rows.length)}`,
    `- timeout: ${String(timeoutCount)} of ${String(input.rows.length)}`,
    `- other-error: ${String(otherCount)} of ${String(input.rows.length)}`,
    "",
    "Count formula: rendered = count(rows where outcome=rendered).",
    "Rendered means the capture returned and wrote one manifest entry.",
    "It is not a pixel grade.",
    "",
    "## Discriminator",
    "",
    "Timeout bag (page-diagnostics.ts): pageErrors.length > 0 → page exception;",
    "else failedRequests.length > 0 → failed request;",
    "else all three lists empty → unresponsive main thread or silent page;",
    "else → console output.",
    `Predicate-error class: \`${PREDICATE_ERROR_CLASS}\`.`,
    "Success class: `did not stop` (shell wait resolved; manifest written).",
    "",
    "## Stations",
    "",
    ...sections,
    "claimScope: how many of the shipped station-environment captures resolve",
    "on this tree after the served client-graph no longer reaches a node: builtin.",
    "notEvidenceFor: wait-budget changes; repairs of any failure class; whether",
    "a rendered room is worth looking at; Quest readiness; clinical realism.",
    "",
    `CLAIM: ${String(renderedCount)} of ${String(input.rows.length)} shipped stations rendered (shell wait resolved and a manifest entry was written) on this tree after the client-graph fix.`,
    "NOT TESTED: whether any case that renders produces a room worth looking at — nobody has graded these pixels.",
    "",
  ].join("\n");
}

export function parseRenderedHeadline(body: string): { rendered: number; of: number } | null {
  const match = body.match(/^- rendered: (\d+) of (\d+)$/m);
  if (!match) return null;
  return { rendered: Number(match[1]), of: Number(match[2]) };
}

export function parseStationRows(body: string): Array<{
  caseId: string;
  outcome: string;
  classification: string;
  durationMs: number;
}> {
  const rows: Array<{
    caseId: string;
    outcome: string;
    classification: string;
    durationMs: number;
  }> = [];
  const heading = /^### `([^`]+)`$/gm;
  const ids: Array<{ id: string; index: number }> = [];
  for (const match of body.matchAll(heading)) {
    const id = match[1];
    if (id === undefined || match.index === undefined) continue;
    ids.push({ id, index: match.index });
  }
  for (let i = 0; i < ids.length; i += 1) {
    const start = ids[i];
    if (start === undefined) continue;
    const end = ids[i + 1]?.index ?? body.length;
    const block = body.slice(start.index, end);
    const outcome = block.match(/^- outcome: (.+)$/m)?.[1]?.trim() ?? "";
    const classification = block.match(/^- classification: (.+)$/m)?.[1]?.trim() ?? "";
    const durationMs = Number(block.match(/^- durationMs: (\d+)$/m)?.[1] ?? "NaN");
    rows.push({
      caseId: start.id,
      outcome,
      classification,
      durationMs,
    });
  }
  return rows;
}

export function isAllowedSweepClass(named: string): boolean {
  return ALLOWED_CLASSES.includes(named);
}

export async function sweepRendersAfterClientGraphFix(): Promise<{
  rendered: number;
  of: number;
  reportPath: string;
}> {
  const caseIds = shippedStationIds();
  if (caseIds.length === 0) {
    throw new Error(
      "shippedStationIds() is empty; no learner-runtime-bundle.v1.json under apps/ui-xr/public/xr-assets/generated",
    );
  }
  const treeSha = gitSha();
  const startedAt = new Date().toISOString();
  const jobTmp = path.join(
    process.env.OPENCLINXR_JOB_TMP ?? tmpdir(),
    `ocxr-station-sweep-${process.pid}-${Date.now()}`,
  );
  mkdirSync(jobTmp, { recursive: true });

  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    readyTimeoutMs: 180_000,
  });
  const rows: SweepRow[] = [];
  try {
    for (let i = 0; i < caseIds.length; i += 1) {
      const caseId = caseIds[i];
      if (caseId === undefined) continue;
      process.stdout.write(`sweep: ${String(i + 1)}/${String(caseIds.length)} ${caseId}\n`);
      const row = await captureOne({
        caseId,
        baseUrl: server.url,
        jobTmp,
      });
      rows.push(row);
      process.stdout.write(
        `sweep: ${caseId} outcome=${row.outcome} class=${row.classification} durationMs=${String(row.durationMs)}\n`,
      );
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }

  const finishedAt = new Date().toISOString();
  const report = renderSweepReport({
    treeSha,
    startedAt,
    finishedAt,
    serverUrl: server.url,
    rows,
  });
  const reportPath = path.join(REPO_ROOT, SWEEP_REPORT_REL);
  writeFileSync(reportPath, report, "utf8");
  const rendered = rows.filter((row) => row.outcome === "rendered").length;
  process.stdout.write(
    `wrote ${reportPath}\nrendered: ${String(rendered)} of ${String(rows.length)}\n`,
  );
  return { rendered, of: rows.length, reportPath };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("sweep-renders-after-client-graph-fix.ts")
    || process.argv[1].endsWith("sweep-renders-after-client-graph-fix.js"));

if (isDirectRun) {
  sweepRendersAfterClientGraphFix().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
