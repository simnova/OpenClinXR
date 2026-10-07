import { describe, expect, it } from "vitest";
import { isFullSuiteRun, NUDGE_LINE, warnForSequence } from "./full-suite-nudge.js";

/**
 * The full-suite nudge warns on repeat full-suite runs and never blocks.
 * The fixture list below is the contract: iteration commands stay silent,
 * the first full suite passes quietly, the 2nd+ each get one line.
 */
const FIXTURE: string[] = [
  "pnpm test:touched",
  "pnpm exec vitest run tools/openclinxr/openclaw/board-brief.test.ts",
  "pnpm --filter @openclinxr/agent-loop test",
  "pnpm exec turbo run test --filter @openclinxr/agent-loop --force",
  "pnpm test",
  "pnpm -r test",
  "OPENCLINXR_HOOK_AFFECTED=1 pnpm test && pnpm architecture",
  "pnpm --filter @openclinxr/agent-loop test src/index.test.ts",
];

describe("full-suite-nudge", () => {
  it("classifies the three full-suite shapes and nothing else", () => {
    expect(isFullSuiteRun("pnpm --filter @openclinxr/agent-loop test")).toBe(true);
    expect(isFullSuiteRun("pnpm -r test")).toBe(true);
    expect(isFullSuiteRun("pnpm --recursive test")).toBe(true);
    expect(isFullSuiteRun("pnpm test")).toBe(true);
    expect(isFullSuiteRun("pnpm test --force")).toBe(true);
    expect(isFullSuiteRun("pnpm test:touched")).toBe(false);
    expect(isFullSuiteRun("pnpm exec vitest run tools/openclinxr/openclaw/board-brief.test.ts")).toBe(false);
    expect(isFullSuiteRun("pnpm exec turbo run test --filter @openclinxr/agent-loop --force")).toBe(false);
    expect(isFullSuiteRun("pnpm --filter @openclinxr/agent-loop test src/index.test.ts")).toBe(false);
    expect(isFullSuiteRun("pnpm architecture")).toBe(false);
  });

  it("warns on the 2nd+ full-suite run in a fixture command list", () => {
    const out = warnForSequence(FIXTURE);
    // Iteration first: silent.
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    // First full suite: silent.
    expect(out[2]).toBeNull();
    // turbo-scoped run is not a full suite: silent.
    expect(out[3]).toBeNull();
    // 2nd, 3rd, 4th full suites (incl. the && chain's pnpm test half): warn.
    expect(out[4]).toBe(NUDGE_LINE(2));
    expect(out[5]).toBe(NUDGE_LINE(3));
    expect(out[6]).toBe(NUDGE_LINE(4));
    // File-scoped filter run: silent.
    expect(out[7]).toBeNull();
  });

  it("the nudge line carries the loop, and there is no deny path", () => {
    expect(NUDGE_LINE(2)).toContain("pnpm test:touched");
    expect(NUDGE_LINE(2)).toMatch(/^full suite run #2 this session;/u);
    // warnForSequence returns text or null only — no verdict object, no block.
    for (const v of warnForSequence(FIXTURE)) {
      expect(typeof v === "string" || v === null).toBe(true);
    }
  });
});
