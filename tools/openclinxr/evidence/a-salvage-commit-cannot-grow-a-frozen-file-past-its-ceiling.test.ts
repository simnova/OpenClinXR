import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMergeKill, type MergeKillReport } from "../openclaw/merge-kill.js";

/**
 * **OBSERVABLE: a branch that grows a SIZE_FREEZE file past its ceiling is refused at the land
 * boundary, by name.**
 *
 * ## MEASURED ON HEAD 81d06dd6, 2026-08-23 — do not re-derive
 *
 * `runMergeKill` has exactly one freeze criterion: `checkRaisedCeiling` (merge-kill.ts:393-433). It
 * compares the SIZE_FREEZE map at `base` against the map at `head` and kills when a `maxLines`
 * value RISES or a new entry appears. It never reads the size of any file the map governs.
 *
 * So the map is defended and the ratchet is not. A commit that grows a frozen file while leaving
 * `file-size-budgets.ts` untouched passes every one of the criteria wired at merge-kill.ts:808-822 —
 * `forbidden-class`, `added-suppression`, `deleted-test`, `raised-ceiling`,
 * `empty-diff-with-passing-proofs`, `contract-not-verified`, `hook-bypass`, `proof-file-gutted`,
 * `gitignored-proof-target`. Clause (1) below is that measurement, hermetically.
 *
 * The incident (#574, #587): an orchestrator salvage-commit at maxTurns grew
 * `packages/openclinxr/asset-registry/src/index.ts` from 2842 to 2850 lines against a ceiling of
 * 2843. Nothing refused it at integrate. The NEXT worker on that branch discovered it as a blocked
 * commit and spent part of its resumed session reading `checkFileSizeBudgets` to find out why. That
 * cost belongs to the actor that caused the growth, at the moment it tried to land.
 *
 * Verified on this head, sourced from the tree, not invented:
 *
 *     file-size-budgets.ts:47   "packages/openclinxr/asset-registry/src/index.ts": maxLines 2843
 *     wc -l on that file        2842                     (shrunk back below its ceiling since #574)
 *     SIZE_FREEZE entries       31 maxLines keys
 *
 * ## THE RULING THIS ENCODES (superagent, 2026-08-23) — recorded on #587
 *
 * NO blanket escape clause. Two classes must not be conflated: A-class author-chosen growth (a
 * worker adds code to a frozen file — refuse it) and B-class mechanism-generated drift (a salvage,
 * a merge artifact). The presumption stays "no escape"; carve nothing until a SECOND B-class
 * instance appears. The documented path for the rare case is a separate, dated, operator-authorised
 * commit touching only `file-size-budgets.ts` — precedent `0be925b6` (2026-08-13), shrunk back by
 * #363. Explicitly rejected: a per-commit `RATCHET-EXEMPT` trailer, and a net-zero-across-package
 * honesty split.
 *
 * Two properties of the existing design this must NOT change, both pinned below:
 *   - thresholds are untouched. This card measures compliance with ceilings; it does not move one.
 *   - the gate reads COMMITTED CONTENT, never the working tree. #361 rejected reading the dirty
 *     tree in writing, because a shared checkout fabricates both false reds and false greens.
 *     Clause (6) is that property as an assertion rather than a comment.
 *
 * ## HERMETIC BY CONSTRUCTION
 *
 * Every fixture is a throwaway git repo under `tmpdir()` carrying a miniature `file-size-budgets.ts`
 * in the real path merge-kill looks for. Nothing runs against this repo's own history. Clause (7) is
 * the single deliberate exception and it reads the shipped tree only to pin a relation (file <=
 * ceiling), never a literal, so an operator-authorised raise does not red it.
 *
 * claimScope: whether the land boundary refuses a branch whose committed content puts a SIZE_FREEZE
 *   file above its ceiling, and whether the existing freeze-map defence survives that addition.
 * notEvidenceFor: whether any ceiling is the right ceiling; whether B-class drift deserves an escape
 *   clause (one instance is not a class); whether `pnpm architecture` or the pre-commit budget check
 *   behave correctly — this is the integrate path only.
 */

const SIZE_FREEZE_PATH = "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts";
const FROZEN_FILE = "apps/god.ts";
const UNFROZEN_FILE = "apps/free.ts";
const CEILING = 10;

/** A contract that is verified, so `contract-not-verified` cannot mask the criterion under test. */
const okContract = {
  proofsOk: true as const,
  proofs: [{ rule: "exists:README.md", passed: true, detail: "found" }],
};

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "freeze-test",
      GIT_AUTHOR_EMAIL: "freeze-test@example.com",
      GIT_COMMITTER_NAME: "freeze-test",
      GIT_COMMITTER_EMAIL: "freeze-test@example.com",
    },
  });
}

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

/** The shape merge-kill's `parseSizeFreezeCeilings` reads: `"path": { maxLines: N, reason }`. */
function sizeFreezeSource(entries: Record<string, number>): string {
  const body = Object.entries(entries)
    .map(([path, n]) => `  "${path}": { maxLines: ${n}, reason: "fixture freeze" },`)
    .join("\n");
  return `export const SIZE_FREEZE = {\n${body}\n};\n`;
}

function lines(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `export const l${i} = ${i};`).join("\n")}\n`;
}

/**
 * A repo whose `main` is exactly at its ceiling, and a branch `wt/salvage` carrying `headLines` of
 * the frozen file. The freeze map is IDENTICAL on both sides — this is the case `checkRaisedCeiling`
 * is blind to by construction.
 */
function repoWithFrozenFileAt(headLines: number, options?: { headCeiling?: number }): string {
  const root = mkdtempSync(join(tmpdir(), "frozen-file-"));
  git(root, ["init", "-q", "-b", "main"]);
  write(root, "README.md", "fixture");
  write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ [FROZEN_FILE]: CEILING }));
  write(root, FROZEN_FILE, lines(CEILING));
  write(root, UNFROZEN_FILE, lines(3));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "seed at ceiling"]);
  git(root, ["checkout", "-q", "-b", "wt/salvage"]);
  write(root, FROZEN_FILE, lines(headLines));
  if (options?.headCeiling !== undefined) {
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ [FROZEN_FILE]: options.headCeiling }));
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "WIP salvage at maxTurns"]);
  git(root, ["checkout", "-q", "main"]);
  return root;
}

function kill(root: string): MergeKillReport {
  return runMergeKill({ repoRoot: root, base: "main", head: "wt/salvage", contract: okContract });
}

function killIds(report: MergeKillReport): string[] {
  return report.findings.filter((f) => f.severity === "kill").map((f) => f.id);
}

describe("a salvage commit cannot grow a frozen file past its ceiling", () => {
  it.fails("(1) RED: a branch putting a frozen file above its ceiling is refused", () => {
    // 18 lines against a ceiling of 10, freeze map untouched on both sides. Today every criterion
    // passes and the branch lands: the ratchet's only merge-time defence guards the MAP, not the
    // FILES the map governs.
    const report = kill(repoWithFrozenFileAt(18));
    expect(report.killed, "a committed frozen file 8 lines over its ceiling must not reach main").toBe(true);
  });

  it.fails("(2) RED: the refusal names the file, its measured count, and its ceiling", () => {
    // #574's session time went on working out WHY a commit was blocked. A bare kill id reproduces
    // exactly that. The evidence line must carry all three facts so the actor can act on it without
    // reading checkFileSizeBudgets.
    const report = kill(repoWithFrozenFileAt(18));
    const excerpts = report.findings
      .filter((f) => f.severity === "kill")
      .flatMap((f) => f.evidence.map((e) => `${e.file} ${e.excerpt}`))
      .join("\n");
    expect(excerpts, "the refusal must name the path").toContain(FROZEN_FILE);
    expect(excerpts, "the refusal must name the measured line count (18)").toMatch(/\b18\b/u);
    expect(excerpts, "the refusal must name the ceiling (10)").toMatch(/\b10\b/u);
  });

  it("(3) KNOWN-GOOD COLUMN: a branch growing an UNFROZEN file lands unchanged", () => {
    // Pins the premise of (1). Without it, (1) is satisfiable by killing every branch that touches
    // any file, which would refuse ordinary work and be indistinguishable from a green.
    const root = mkdtempSync(join(tmpdir(), "unfrozen-file-"));
    git(root, ["init", "-q", "-b", "main"]);
    write(root, "README.md", "fixture");
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ [FROZEN_FILE]: CEILING }));
    write(root, FROZEN_FILE, lines(CEILING));
    write(root, UNFROZEN_FILE, lines(3));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "seed at ceiling"]);
    git(root, ["checkout", "-q", "-b", "wt/salvage"]);
    write(root, UNFROZEN_FILE, lines(400));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "grow an unfrozen file"]);
    git(root, ["checkout", "-q", "main"]);
    expect(killIds(kill(root)), "an unfrozen file has no ceiling to breach").toEqual([]);
  });

  it("(4) KNOWN-GOOD COLUMN: the existing raised-ceiling criterion still fires", () => {
    // The new criterion must be ADDITIVE. #587 does not weaken the map defence, which merge-kill's
    // own header calls the only mechanism that failed closed on a change `pnpm architecture` passed
    // green (a ceiling raised 607 -> 999).
    const root = repoWithFrozenFileAt(CEILING, { headCeiling: 999 });
    expect(killIds(kill(root)), "raising a maxLines value is still a kill").toContain("raised-ceiling");
  });

  it("(5) COUNTERWEIGHT: raising the ceiling to fit the growth is still refused", () => {
    // The cheapest green for (1) is to widen the entry so the file is legal. That is the escape
    // hatch the ruling refuses by name: a raise must be its own dated, operator-authorised commit
    // touching only file-size-budgets.ts, never a clause of the branch that needed it.
    const root = repoWithFrozenFileAt(18, { headCeiling: 20 });
    expect(kill(root).killed, "growing the file AND widening its entry must not land").toBe(true);
    expect(killIds(kill(root)), "the map defence is what catches this one").toContain("raised-ceiling");
  });

  it("(6) COUNTERWEIGHT: the gate reads committed content, never the working tree", () => {
    // The second cheap implementation — stat the file on disk — would let a shared checkout's dirt
    // refuse a clean branch, and would clear a dirty-clean branch whose COMMIT is over. #361
    // rejected working-tree reads in writing. Here the branch is at its ceiling and the working
    // tree is 40 lines over; the land must not be refused for tree state nobody committed.
    const root = mkdtempSync(join(tmpdir(), "dirty-tree-"));
    git(root, ["init", "-q", "-b", "main"]);
    write(root, "README.md", "fixture");
    write(root, SIZE_FREEZE_PATH, sizeFreezeSource({ [FROZEN_FILE]: CEILING }));
    write(root, FROZEN_FILE, lines(CEILING));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "seed at ceiling"]);
    git(root, ["checkout", "-q", "-b", "wt/salvage"]);
    write(root, "README.md", "fixture, edited"); // a real diff that touches no frozen file
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "innocent branch"]);
    git(root, ["checkout", "-q", "main"]);
    write(root, FROZEN_FILE, lines(50)); // 40 lines over, uncommitted, on a shared checkout
    expect(killIds(kill(root)), "uncommitted dirt is not a landing").toEqual([]);
  });

  it("(7) COUNTERWEIGHT: the shipped tree still respects the ratchet this card measures", () => {
    // Pins the RELATION, not a literal, so the sanctioned operator-authorised raise does not red
    // this clause. Measured 2026-08-23: entry 2843, file 2842. A fixture-only contract could be
    // satisfied by a criterion that never runs against real paths; this is the one line that reads
    // the shipped tree, and it is a compliance check, not a threshold change.
    const source = readFileSync(join(process.cwd(), SIZE_FREEZE_PATH), "utf8");
    const target = "packages/openclinxr/asset-registry/src/index.ts";
    const entryLine = source.split("\n").find((line) => line.includes(`"${target}"`));
    expect(entryLine, `${target} must still carry a SIZE_FREEZE entry`).toBeDefined();
    const ceiling = Number(/maxLines\s*:\s*(\d+)/u.exec(entryLine ?? "")?.[1]);
    expect(Number.isFinite(ceiling), "the entry must carry a numeric maxLines").toBe(true);
    expect(existsSync(join(process.cwd(), target)), "the frozen file must exist to be measured").toBe(true);
    const measured = readFileSync(join(process.cwd(), target), "utf8").split("\n").length - 1;
    expect(measured, `${target} is ${measured} lines against a ceiling of ${ceiling}`).toBeLessThanOrEqual(ceiling);
  });
});
