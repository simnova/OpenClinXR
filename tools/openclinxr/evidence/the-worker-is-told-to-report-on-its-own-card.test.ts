import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SUBSTRATE — WORKERS NEVER REPORT STATUS, AND IT IS AN INSTRUCTION GAP, NOT A PERMISSION GAP.
 *
 * ## THE DEFECT, MEASURED
 *
 * Across five recent slices (#429, #431, #433, #434, #435) workers made **zero** `gh` invocations.
 * The orchestrator performed 100% of board writes — every comment, close, label and Factory field.
 *
 * **`gh` is not denied.** `dispatch-worker.ts` mentions `gh` zero times; its only denies are
 * `Write(mainRoot/**)` and `Edit(mainRoot/**)` plus the text-only vision denies. So nothing was
 * blocking status reporting — nobody ever asked for it.
 *
 * That matters because the two things a worker knows and the orchestrator does not — `UNABLE:` and
 * "this proof cannot pass as written" — currently reach me only in a dispatch log I have to read.
 * On the worker's own card they are durable and visible to the lead. This session lost a cycle to
 * exactly that: #428's worker correctly reported an unsatisfiable proof in a `resolutionNote` I did
 * not see until after the contract had already failed.
 *
 * ## WHY A DIRECTIVE AND NOT A BRIEF LINE
 *
 * A brief line binds one slice. `WORKER_TONE_DIRECTIVE` and `WORKER_OUTPUT_BUDGET_DIRECTIVE` are
 * baked into every worker prompt by the baker — and as of `b39f7633` that baker finally reaches
 * dispatched workers, so a directive added there now arrives everywhere. Wiring the existing
 * mechanism rather than repeating myself in every brief (D1).
 *
 * ## SCOPE IS DELIBERATELY NARROW — COORDINATION METADATA ONLY
 *
 * Comment on your OWN issue. Report `UNABLE:`, "proof cannot pass as written", and a
 * `Factory: Dispatched|Landed` line. **Never** close, label, or write the Factory project field —
 * those stay with the orchestrator, because a worker that can close its own card can mark its own
 * homework. And never product or clinical content on GitHub.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no reporting instruction anywhere                 |FAIL | pass| pass| pass| REFUSED
 *   b) grant the worker close/label too                          | pass|FAIL | pass| pass| REFUSED
 *   c) re-author the instruction inside dispatch-worker.ts       | pass| pass| pass|FAIL | REFUSED
 *   d) emit it for every string, including unknown roles         | pass| pass|FAIL | pass| REFUSED
 *
 * **(b) is the one to watch.** `gh issue close` is one word longer than `gh issue comment` and it
 * hands a worker the ability to declare its own slice done. Clause (2) forbids the string.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) is the sole RED**. (2), (3) and (4) pass today
 * — vacuously, because no directive exists — and become load-bearing the moment (1) is green.
 *
 * NOT TESTED: that a worker OBEYS the directive. A prompt containing an instruction is not a
 * comment on a card. The proof is the next product dispatch — grep its session for
 * `gh issue comment`; zero after that means the line did not bind. No `gh` deny is to be added
 * either way.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DIRECTIVES = join(REPO_ROOT, "packages/openclinxr/agent-loop/src/worker-directives.ts");
const DISPATCHER = join(REPO_ROOT, "tools/openclinxr/openclaw/dispatch-worker.ts");
/** Computed so a not-yet-exported symbol cannot break compilation (SS383/SS352). */
const SPECIFIER = ["../openclaw/dispatch", "worker.js"].join("-");
const ROLE = "xr-systems-architect";

type Composer = (roleId: string, repoRoot?: string) => string;
const mod = (await import(SPECIFIER)) as { buildRoleCharterAppendix?: Composer };
const appendix: Composer = mod.buildRoleCharterAppendix!;

describe("every dispatched worker is told to report on its own card", () => {
  it("(1) RED: the baked prompt instructs the worker to comment on its own issue", () => {
    const text = appendix(ROLE);
    expect(text, "the worker must be told to comment on its own issue").toContain("gh issue comment");
    expect(text, "UNABLE: must be a reportable state on the card").toMatch(/UNABLE/);
    expect(text, "a proof that cannot pass must be reportable on the card").toMatch(/proof|cannot pass/i);
  });

  it("(2) COUNTERWEIGHT: the worker is NOT granted close, label or the Factory field", () => {
    // Refuses (b). `gh issue close` is one word from `gh issue comment` and lets a worker mark its
    // own homework. Closing, labelling and the project field stay with the orchestrator.
    const text = appendix(ROLE);
    for (const forbidden of ["gh issue close", "gh issue edit", "item-edit", "--single-select-option-id"]) {
      expect(text, `the directive must not authorise ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("(3) COUNTERWEIGHT: an unknown role still yields an empty appendix and does not throw", () => {
    // Refuses (d). A directive emitted unconditionally would break the degrade-to-empty behaviour
    // proven when the charter binding landed.
    expect(() => appendix("not-a-real-role")).not.toThrow();
    expect(appendix("not-a-real-role"), "unknown role must stay empty").toBe("");
  });

  it("(4) NET: the directive lives with the other worker directives, not in the dispatcher", () => {
    // Refuses (c), the D1 violation — a second place for the worker contract to drift.
    const dispatcher = readFileSync(DISPATCHER, "utf8");
    expect(dispatcher, "the dispatcher must not re-author the reporting instruction").not.toContain("gh issue comment");
    const directives = readFileSync(DIRECTIVES, "utf8");
    expect(directives, "worker-directives.ts is where standing worker contract text lives").toMatch(
      /export const WORKER_TONE_DIRECTIVE/,
    );
  });
});
