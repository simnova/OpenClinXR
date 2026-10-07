import { describe, expect, it } from "vitest";
import { briefFromIssue } from "./board-brief.js";

/**
 * Every worker brief carries the Test loop: iterate with `pnpm test:touched`,
 * never hand-run full suites, the commit hook is the full gate.
 *
 * MEASURED 2026-10-06: two mouth slices spent roughly half their wall time
 * re-running full package suites after each edit (model 628s vs tool 652s;
 * model 668s vs tool 162s, from the grok unified log). The brief is the only
 * channel that reaches a worker before it builds the habit, so the loop lives
 * here — in the shared builder `briefFromIssue`, which both the GitHub-issue
 * path and the bothy-card path (`bothyBriefFromSlice` feeds it) pass through.
 * `boardProtocolSection` alone is card-only and cannot carry it.
 */

const BODY = `## factory_step: instrument
unblocks: staging
Observe whether the settled correction executes.

## done_when
- run:pnpm architecture
`;

const githubIssue = {
  number: 123,
  title: "Observe whether the settled correction executes",
  body: BODY,
};

const bothyCard = {
  number: 0,
  title: "Observe whether the settled correction executes",
  body: BODY,
  taskId: "tsk_4c0f66ebb0453372",
};

function promptOf(result: ReturnType<typeof briefFromIssue>): string {
  expect(result.dispatchable).toBe(true);
  if (!result.dispatchable) throw new Error("expected dispatchable brief");
  return result.prompt;
}

describe("the worker brief carries the test loop", () => {
  it("a GitHub-issue brief names test:touched as the iteration loop", () => {
    const prompt = promptOf(briefFromIssue(githubIssue));
    expect(prompt).toContain("## Test loop");
    expect(prompt).toContain("pnpm test:touched");
  });

  it("a bothy-card brief names test:touched as the iteration loop", () => {
    const prompt = promptOf(briefFromIssue(bothyCard));
    expect(prompt).toContain("## Test loop");
    expect(prompt).toContain("pnpm test:touched");
  });

  it("both briefs forbid hand-run full suites and name the commit hook as the full gate", () => {
    for (const issue of [githubIssue, bothyCard]) {
      const prompt = promptOf(briefFromIssue(issue));
      expect(prompt).toMatch(/do not run full .* suites by hand/i);
      expect(prompt).toMatch(/commit[\s\S]*full gate/i);
      expect(prompt).toMatch(/pre-commit hook/i);
    }
  });

  it("VACUITY GUARD: the section is a real block, not a passing mention", () => {
    const prompt = promptOf(briefFromIssue(githubIssue));
    const idx = prompt.indexOf("## Test loop");
    expect(idx).toBeGreaterThanOrEqual(0);
    // The block carries the mechanism (vitest related) and the measured reason.
    expect(prompt.slice(idx, idx + 1200)).toMatch(/vitest related/i);
    expect(prompt.slice(idx, idx + 1200)).toMatch(/2026-10-06/);
  });
});
