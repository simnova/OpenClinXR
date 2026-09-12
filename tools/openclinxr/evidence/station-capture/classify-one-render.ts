/**
 * One real station-environment capture, classified.
 *
 * The wait-name and page-diagnostic instruments already landed. This script
 * points them at a single shipped case and writes which class stopped the
 * render. It does not change wait budgets or repair the cause.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureStationEnvironmentRooms } from "../ui-xr-environment-room-capture.js";

export const RENDER_CAUSE_REPORT_REL =
  "tools/openclinxr/evidence/station-capture/render-cause-2026-09-12.md";

/** Closed vocab from formatStationCapturePageDiagnostics (page-diagnostics.ts). */
export const TIMEOUT_CLASSES = [
  "page exception",
  "failed request",
  "unresponsive main thread or silent page",
  "console output",
] as const;

export type TimeoutClass = (typeof TIMEOUT_CLASSES)[number];

/**
 * The wait never reaches a timeout when the Playwright predicate itself throws.
 * Measured 2026-09-12 on ed_chest_pain_priority_v2: `browserPageWindow` is
 * types-only (browser-dom.d.ts) and throws ReferenceError inside the page.
 * Sibling already recorded this: model-vetting-glb-grade-capture.ts uses
 * globalThis for that reason (measured 2026-09-11).
 */
export const PREDICATE_ERROR_CLASS =
  "wait-predicate reference error (browserPageWindow types-only alias)" as const;

export type RenderStopClass =
  | TimeoutClass
  | typeof PREDICATE_ERROR_CLASS
  | "did not stop"
  | "unclassified";

const DEFAULT_CASE = "ed_chest_pain_priority_v2";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export function parseDiagnosticsFromTimeoutMessage(message: string): {
  waitName: string | null;
  classification: RenderStopClass | null;
  pageErrors: string;
  console: string;
  failedRequests: string;
} {
  const waitMatch = message.match(/^(.+?) wait timed out:/u);
  const classMatch = message.match(/pageDiagnostics classification: ([^\n]+)/u);
  const errorsMatch = message.match(/^pageErrors: ([^\n]*)/mu);
  const consoleMatch = message.match(/^console: ([^\n]*)/mu);
  const failedMatch = message.match(/^failedRequests: ([^\n]*)/mu);
  const rawClass = classMatch?.[1]?.trim() ?? "";
  const timeoutClass = (TIMEOUT_CLASSES as readonly string[]).includes(rawClass)
    ? (rawClass as TimeoutClass)
    : null;
  const predicateError =
    message.includes("browserPageWindow is not defined")
    || /waitForFunction: ReferenceError/u.test(message);
  return {
    waitName: waitMatch?.[1]?.trim() ?? null,
    classification: predicateError
      ? PREDICATE_ERROR_CLASS
      : timeoutClass,
    pageErrors: errorsMatch?.[1]?.trim() ?? "",
    console: consoleMatch?.[1]?.trim() ?? "",
    failedRequests: failedMatch?.[1]?.trim() ?? "",
  };
}

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

function renderReport(input: {
  caseId: string;
  treeSha: string;
  startedAt: string;
  finishedAt: string;
  outcome: "timeout" | "succeeded" | "other-error";
  waitName: string | null;
  classification: RenderStopClass;
  pageErrors: string;
  console: string;
  failedRequests: string;
  message: string;
}): string {
  return [
    "# Station-environment capture render cause (one case)",
    "",
    "Instrument-only. The wait-name + three-way pageDiagnostics bag landed;",
    "this file records what they said on one real capture, not a repair.",
    "",
    `- caseId: \`${input.caseId}\``,
    `- tree: \`${input.treeSha}\``,
    `- startedAt: ${input.startedAt}`,
    `- finishedAt: ${input.finishedAt}`,
    `- command: \`captureStationEnvironmentRooms({ scenarioIds: [${input.caseId}] })\` via \`tools/openclinxr/evidence/ui-xr-environment-room-capture.ts\``,
    `- outcome: ${input.outcome}`,
    `- wait that fired: ${input.waitName ?? "(none — rethrowNamedWaitTimeout only prefixes Timeout)"}`,
    `- classification: ${input.classification}`,
    `- pageErrors: ${input.pageErrors || "(none)"}`,
    `- console: ${input.console || "(none)"}`,
    `- failedRequests: ${input.failedRequests || "(none)"}`,
    "",
    "## Discriminator",
    "",
    "Timeout bag (page-diagnostics.ts): pageErrors.length > 0 → page exception;",
    "else failedRequests.length > 0 → failed request;",
    "else all three lists empty → unresponsive main thread or silent page;",
    "else → console output.",
    "",
    "Predicate-error class (this run): Playwright `page.waitForFunction` throws",
    "`ReferenceError: browserPageWindow is not defined` on the first eval.",
    "`browserPageWindow` is types-only (`tools/openclinxr/evidence/browser-dom.d.ts`).",
    "Sibling measured 2026-09-11: `model-vetting-glb-grade-capture.ts` switched the",
    "same closure to `globalThis` for that reason. `rethrowNamedWaitTimeout` does",
    "not decorate this path because the message does not include `Timeout`.",
    "The 2026-09-03 rollup's 180 s Timeout is therefore a different (older) class;",
    "on this tree the render station never reaches a wait budget.",
    "",
    "## Full error / completion message",
    "",
    "```",
    input.message.slice(0, 4000),
    "```",
    "",
    "claimScope: which diagnostic class stopped this one case's station-environment capture.",
    "notEvidenceFor: the fix for that class; the other fourteen cases; wait budgets; the rollup.",
    "",
    `CLAIM: one live capture of ${input.caseId} classified as ${input.classification} (wait=${input.waitName ?? "none"}).`,
    "NOT TESTED: the fix; the other fourteen cases.",
    "",
  ].join("\n");
}

export async function classifyOneRender(caseId = DEFAULT_CASE): Promise<{
  classification: RenderStopClass;
  reportPath: string;
}> {
  const treeSha = gitSha();
  const startedAt = new Date().toISOString();
  const jobTmp = path.join(
    process.env.OPENCLINXR_JOB_TMP ?? tmpdir(),
    `ocxr-station-capture-${process.pid}-${Date.now()}`,
  );
  mkdirSync(jobTmp, { recursive: true });

  let outcome: "timeout" | "succeeded" | "other-error" = "succeeded";
  let message = "capture completed without throwing";
  let waitName: string | null = null;
  let classification: RenderStopClass = "did not stop";
  let pageErrors = "";
  let consoleText = "";
  let failedRequests = "";

  try {
    await captureStationEnvironmentRooms({
      scenarioIds: [caseId],
      outputDir: jobTmp,
    });
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
    const parsed = parseDiagnosticsFromTimeoutMessage(message);
    waitName = parsed.waitName;
    pageErrors = parsed.pageErrors;
    consoleText = parsed.console;
    failedRequests = parsed.failedRequests;
    if (parsed.waitName && parsed.classification) {
      outcome = "timeout";
      classification = parsed.classification;
    } else if (parsed.waitName) {
      outcome = "timeout";
      classification = "unclassified";
    } else {
      outcome = "other-error";
      classification = parsed.classification ?? "unclassified";
    }
  }

  const finishedAt = new Date().toISOString();
  const report = renderReport({
    caseId,
    treeSha,
    startedAt,
    finishedAt,
    outcome,
    waitName,
    classification,
    pageErrors,
    console: consoleText,
    failedRequests,
    message,
  });
  const reportPath = path.join(REPO_ROOT, RENDER_CAUSE_REPORT_REL);
  writeFileSync(reportPath, report, "utf8");
  process.stdout.write(`wrote ${reportPath}\nclassification: ${classification}\n`);
  return { classification, reportPath };
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("classify-one-render.ts")
    || process.argv[1].endsWith("classify-one-render.js"));

if (isDirectRun) {
  const caseId = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? DEFAULT_CASE;
  classifyOneRender(caseId).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
