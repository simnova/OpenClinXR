/**
 * A raw `grok -p --resume` silently loses every protection `dispatch()` adds.
 *
 * MEASURED 2026-08-26. Three members of one class, all from the same cause:
 *
 *   raw resume skips the worker guard      -> unrequested doc-archive churn (#99)
 *   raw resume skips contract verification -> integrate refuses the branch (PROTO §11h)
 *   raw resume skips the vision denies     -> 26.4M-token hard 400 on #642
 *
 * The third cost a full slice tonight. `buildTextOnlyVisionDenies()` has existed since 88037391
 * (2026-08-09, #242) and `dispatch()` appends it at dispatch-worker.ts:1566 for every text-only
 * model — including `dispatch({resume})`, since there is ONE argv path. But a raw
 * `grok -p --resume` never reaches that line, so the guard was present, wired, and bypassed.
 *
 * WHY THE RAW PATH IS USED AT ALL, and it is not carelessness: `dispatch({worktree, resume})`
 * calls ensureWorktreeBaseFresh, which resets unconditionally on reuse
 * (worktree-base-freshness.ts:118-121, `git reset --hard <mainHead>` + `git clean -fd`). Its own
 * announcement says "If you needed the previous run's on-disk work, abort and resume that session
 * instead of re-dispatching." So the operator faces:
 *
 *   dispatch({resume})     gets the protections, DESTROYS the worker's tree
 *   raw grok -p --resume   preserves the tree, LOSES denies + guard + contract report
 *
 * Neither is safe. This builder makes the second one safe. It deliberately does NOT touch
 * worktree-base-freshness.ts: the reset is correct for a fresh dispatch and wrong only for a
 * resume, and changing both at once makes the blast radius the whole dispatch path.
 *
 * THE SUBTLE CONSTRAINT, measured in dispatch-chokepoint.ts and easy to get backwards:
 * the chokepoint refuses raw grok from OPENCLINXR_WORKER=1 at :294, BEFORE it evaluates the
 * sanction at :306. `mergeSanctionEnv` merges only the two sanction vars out of leading shell
 * assignments — never OPENCLINXR_WORKER. So the guard var MUST be emitted as a leading shell
 * assignment. Exported into the session it makes every subsequent raw grok undispatchable.
 *
 * claimScope: the composition of the command. It does not execute anything.
 * notEvidenceFor: that the emitted denies BIND at the grok CLI — that is the CLI's glob grammar
 * and is not tested here; nor that contract verification is restored, which no flag can do
 * (contract-verify-cli must still be run against the branch before integrate).
 */
import { describe, it, expect } from "vitest";
import { buildRawResumeCommand, RAW_RESUME_NOT_RESTORED } from "./resume-command.js";
import { buildTextOnlyVisionDenies } from "./dispatch-worker.js";

const BASE = {
  sessionId: "019fdf12-eed5-73b2-8347-bb4718c07749",
  cwd: "/Volumes/files/src/openclinxr/.grok/worktrees/issue-642",
  reason: "resume #642 preserving on-disk probe scripts",
};

describe("a raw resume carries what dispatch would have added", () => {
  // (1) THE HOLE: a text-only resume must carry every vision deny dispatch:1566 would append.
  it("emits all twelve vision denies for a text-only model", () => {
    const cmd = buildRawResumeCommand({ ...BASE, model: "deepseek-v4-flash" });
    const expected = buildTextOnlyVisionDenies();
    expect(expected.length).toBe(12);
    for (const rule of expected) {
      const at = cmd.argv.indexOf(rule);
      expect(at, `missing --deny ${rule}`).toBeGreaterThan(0);
      expect(cmd.argv[at - 1], `${rule} not preceded by --deny`).toBe("--deny");
    }
  });

  // (2) COUNTERWEIGHT: a vision-capable model must get NONE of them, or rung 3 breaks. Without
  //     this the builder could pass (1) by emitting image denies unconditionally.
  it("emits NO vision denies for a vision-capable model", () => {
    const cmd = buildRawResumeCommand({ ...BASE, model: "ox-alpha" });
    for (const rule of buildTextOnlyVisionDenies()) {
      expect(cmd.argv, `ox-alpha must not be denied ${rule}`).not.toContain(rule);
    }
    expect(cmd.argv).toContain("--resume");
  });

  // (3) The worker guard, in every case, as a LEADING SHELL ASSIGNMENT.
  it("carries the worker guard as a leading assignment, never an export", () => {
    const cmd = buildRawResumeCommand({ ...BASE, model: "ox-alpha" });
    expect(cmd.envAssignments["OPENCLINXR_WORKER"]).toBe("1");
    expect(cmd.envAssignments["GROK_SUBAGENTS"]).toBe("1");
    expect(cmd.shell.startsWith("OPENCLINXR_WORKER=1")).toBe(true);
    expect(cmd.shell, "an export would make every later raw grok undispatchable").not.toMatch(/^export /u);
  });

  // (4) The chokepoint needs a NON-EMPTY reason beside the sanction flag; an empty one is refused
  //     at readSanctionFromEnv, so emitting a command that cannot run is worse than throwing.
  it("refuses to build without a sanction reason", () => {
    expect(() => buildRawResumeCommand({ ...BASE, model: "ox-alpha", reason: "  " }))
      .toThrow(/reason/iu);
    const cmd = buildRawResumeCommand({ ...BASE, model: "ox-alpha" });
    expect(cmd.envAssignments["OPENCLINXR_RAW_GROK_SANCTIONED"]).toBe("1");
    expect(cmd.envAssignments["OPENCLINXR_RAW_GROK_REASON"]).toBe(BASE.reason);
  });

  // (5) COUNTERWEIGHT: worktree isolation denies appear ONLY when a main root is supplied. A
  //     builder that always emitted them would deny writes to main on a non-worktree resume.
  it("adds main-write denies only when the resume is worktree-bound", () => {
    const withRoot = buildRawResumeCommand({ ...BASE, model: "ox-alpha", mainRoot: "/repo" });
    expect(withRoot.argv).toContain("Write(/repo/**)");
    const withoutRoot = buildRawResumeCommand({ ...BASE, model: "ox-alpha" });
    expect(withoutRoot.argv.some((a) => a.startsWith("Write("))).toBe(false);
  });

  // (6) The builder must SAY what it cannot restore. A flag cannot re-run the proofs, and a
  //     resume that lands without a contract report is refused by integrate (§11h).
  it("names contract verification as not restored", () => {
    const cmd = buildRawResumeCommand({ ...BASE, model: "deepseek-v4-flash" });
    expect(cmd.notRestored).toBe(RAW_RESUME_NOT_RESTORED);
    expect(cmd.notRestored.join(" ")).toMatch(/contract-verify-cli/u);
  });
});
