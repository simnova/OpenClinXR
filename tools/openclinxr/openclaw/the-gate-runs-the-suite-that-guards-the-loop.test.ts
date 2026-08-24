import { describe, expect, it } from "vitest";
import { stepsForProfile } from "./agentic-hook-runner.js";

/**
 * OBSERVABLE: the pre-commit gate cannot see the suite that implements the delegation loop.
 *
 * The profile runs: integrate gate (no-op unless a land), docs:drift-check, agent:alignment,
 * `@openclinxr/architecture-rules` over FOUR files path-scoped, and openclaw:post-slice. It never
 * runs `tools/openclinxr/openclaw/` — the directory holding the dispatcher, the board writer, the
 * sweep, the hook runner itself, and every contract guarding them.
 *
 * MEASURED 2026-08-24. One `pnpm exec vitest run tools/openclinxr/openclaw/` on a CLEAN tree
 * reported 8 failures across 5 files. Every failing source was clean at HEAD — none was caused by
 * uncommitted work:
 *
 *   agentic-hook-runner.test.ts   red since 2026-08-06 (f87967652) — EIGHTEEN DAYS. The integrate
 *                                 gate was added to this very profile and the step list it asserts
 *                                 was never updated.
 *   board-cli.test.ts (x4)        red since 2026-08-19 (41cb8231a) — #449 replaced the membership
 *                                 scan with a GraphQL lookup; the fake threw `unexpected gh argv`.
 *   the-sweep-counts-...test.ts   its fixture named a repo file as a permanent unflipped RED, and
 *                                 the slice that flipped it broke the test.
 *
 * All three are ordinary staleness that any run would have caught the same afternoon. Each was
 * broken by a commit touching `tools/openclinxr/openclaw/` itself, so a path-scoped rule would have
 * caught all three.
 *
 * THE DECISION, and it is deliberately the narrow one. Not "run everything on every commit" — the
 * profile is intentionally path-scoped, and `classifyArchitectureInvocation` OMITS the architecture
 * step for staged files that cannot introduce architecture violations. A blanket suite run fights
 * that design and taxes every commit in the repo. The rule here mirrors the existing one: the suite
 * runs when, and only when, a staged file lives in the directory it guards.
 *
 * claimScope: that a staged file under tools/openclinxr/openclaw/ adds a step running that suite,
 *   and that staging elsewhere does not.
 * notEvidenceFor: whether any OTHER suite has the same blind spot (not surveyed), what CI runs, the
 *   right friction budget for a pre-commit hook, or whether the suite currently passes.
 */

const OPENCLAW_FILE = "tools/openclinxr/openclaw/dispatch-worker.ts";
const UNRELATED_FILE = "PROJECT_STATUS.md";

const labels = (staged: string[]): string[] => stepsForProfile("pre-commit", staged).map((s) => s.label);
const hasOpenclawStep = (staged: string[]): boolean =>
  stepsForProfile("pre-commit", staged).some((s) =>
    /openclaw/iu.test(s.label) && /suite|vitest|contract/iu.test(`${s.label} ${s.cmd ?? ""}`));

describe("the gate runs the suite that guards the loop", () => {
  it.fails("(1) a staged openclaw file adds a step that runs the openclaw suite", () => {
    expect(
      hasOpenclawStep([OPENCLAW_FILE]),
      "dispatch-worker.ts is staged and nothing runs the contracts guarding it. Three files sat red "
        + "for 18, 5 and 2 days behind exactly this gap",
    ).toBe(true);
  });

  it("(2) COUNTERWEIGHT: staging an unrelated file does NOT pay for the suite", () => {
    // Refuses the over-correction of running everything on every commit. The profile is path-scoped
    // by design and this rule must respect that, or it taxes every doc edit in the repo.
    //
    // NOT an it.fails: this asserts a state that is ALREADY correct (nothing adds an openclaw step
    // today), so it is a counterweight that must survive the fix — not a RED. Marking it it.fails
    // asserted the wrong direction and the first run caught it.
    expect(
      hasOpenclawStep([UNRELATED_FILE]),
      "a PROJECT_STATUS.md edit cannot break the delegation loop and must not pay ~21s for it",
    ).toBe(false);
  });

  it("(3) COUNTERWEIGHT: the existing architecture omission still holds", () => {
    // Guards against a fix that reaches its goal by making the profile unconditional. This clause
    // passes today and must keep passing — 40779411 amended it once already.
    expect(labels([UNRELATED_FILE]).some((l) => l.toLowerCase().includes("architecture"))).toBe(false);
    expect(labels([OPENCLAW_FILE]).length, "an openclaw commit still runs the standing guards").toBeGreaterThan(2);
  });

  it("(4) VACUITY GUARD: the detector can tell the two cases apart at all", () => {
    // Without this, (1) and (2) could both pass by `hasOpenclawStep` always returning the same value.
    // Pins that the profile is a function of the staged set, not a constant.
    expect(labels([UNRELATED_FILE])).not.toEqual([]);
    expect(labels([OPENCLAW_FILE])).not.toEqual([]);
  });
});
