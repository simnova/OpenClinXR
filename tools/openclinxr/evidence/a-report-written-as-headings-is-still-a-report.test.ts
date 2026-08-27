/**
 * #733 — a complete worker report written as markdown headings is refused as `worker-never-spoke`.
 *
 * THE DEFECT, MEASURED 2026-08-27 — do not re-derive this.
 *
 *   integrate.ts declares
 *     WORKER_REPORT_SECTIONS = [/IN-SCOPE:/i, /OUT-OF-SCOPE:/i, /CLAIM:/i, /NOT TESTED:/i]
 *   and `isWorkerReport` requires EVERY one to match. Each pattern demands a trailing colon.
 *
 *   #696's worker posted a full report with all four sections as headings:
 *     ## IN-SCOPE
 *     ## OUT-OF-SCOPE (seen, not fixing)
 *     ## CLAIM
 *     ## NOT TESTED
 *   Counted against those four patterns, every one is ZERO. `integrate` fired `worker-never-spoke`
 *   on a slice whose worker had spoken in detail and answered a question I could not answer myself.
 *
 *   Cost: two harvests. #641's worker had to be resumed to post a report; #696's was resumed AND
 *   still refused. My own brief asked for "sections IN-SCOPE / OUT-OF-SCOPE / CLAIM / NOT TESTED"
 *   and never mentioned punctuation, so no worker reading it could have known.
 *
 * WHAT MUST NOT CHANGE. The gate exists because seven slices landed with the worker mute and every
 * comment was the orchestrator's. The author clause, the marker clause, and the requirement that ALL
 * FOUR sections appear all stay. Accepting a heading is strictly narrower than "any comment at all".
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#733)` block below.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const INTEGRATE = resolve(REPO, "tools/openclinxr/openclaw/integrate.ts");

/** The shape #696's worker actually posted. Not a stand-in — these are its real headings. */
const HEADING_REPORT = [
  "Factory: Landed (wt/issue-696 @ 49eedbd2)",
  "",
  "## IN-SCOPE",
  "- dispatch-worker.ts now writes backgroundJobsAliveAtExit on every terminal ledger row.",
  "",
  "## OUT-OF-SCOPE (seen, not fixing)",
  "- pnpm architecture reds in this worktree: markdown-references reports unresolved refs.",
  "",
  "## CLAIM",
  "The ledger now carries a harness-observed background-job signal.",
  "",
  "## NOT TESTED",
  "Whether detaching the worker's background job is the right remedy.",
].join("\n");

/** The colon form, which already works and must keep working. */
const COLON_REPORT = [
  "IN-SCOPE: wired the thing",
  "OUT-OF-SCOPE: nothing seen",
  "CLAIM: the thing is wired",
  "NOT TESTED: whether it is correct",
].join("\n");

/** An orchestrator-shaped comment carrying none of the skeleton — the state the gate exists for. */
const NOT_A_REPORT = "Dispatched. deepseek-v4-flash, role asset-pipeline-lead, 200 turns.";

async function isWorkerReport(): Promise<(body: string) => boolean> {
  const mod = (await import(INTEGRATE)) as { isWorkerReport?: (b: string) => boolean };
  if (typeof mod.isWorkerReport !== "function") {
    throw new Error("integrate.ts does not export isWorkerReport");
  }
  return mod.isWorkerReport;
}

describe("#733 a worker report written as headings is still a worker report", () => {
  it.fails("(1) RED: the heading form is recognised as a report", async () => {
    const fn = await isWorkerReport();
    expect(fn(HEADING_REPORT)).toBe(true);
  });

  it("(2) the known-good column: the colon form still works", async () => {
    // If this fails the fix replaced one accepted shape with another instead of widening.
    const fn = await isWorkerReport();
    expect(fn(COLON_REPORT)).toBe(true);
  });

  it("(3) COUNTERWEIGHT: a comment carrying none of the skeleton is still refused", async () => {
    // The cheapest wrong fix is to accept any comment, which restores the exact mute-worker state
    // the gate was built to refuse — seven slices landed that way.
    const fn = await isWorkerReport();
    expect(fn(NOT_A_REPORT)).toBe(false);
  });

  it("(4) COUNTERWEIGHT: a PARTIAL report is still refused", async () => {
    // All four sections must appear. Three is not a report.
    const fn = await isWorkerReport();
    expect(fn("## IN-SCOPE\nx\n## OUT-OF-SCOPE\ny\n## CLAIM\nz")).toBe(false);
  });

  it("(5) COUNTERWEIGHT: the marker and author clauses are not deleted", () => {
    const src = readFileSync(INTEGRATE, "utf8");
    expect(src).toContain("WORKER_REPORT_MARKERS");
    expect(src).toMatch(/comment\.author\.login !== orchestratorLogin/);
  });
});
