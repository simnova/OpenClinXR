import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integrate, integrationEvents } from "./integrate.js";
import { FACTORY_FIELD_ID } from "./board-cli.js";

/**
 * Merge is the last enforceable choke point, and merge-kill was the only mechanism that failed
 * closed on a change `pnpm architecture` passed GREEN — a SIZE_FREEZE ceiling raised 607→999. No
 * rule gate can catch that, because the gate is what got widened.
 *
 * But merge-kill exited 2 into the void: nothing called it. Until landing runs it, layers 3-6 are
 * advisory and a human is still the gate. These tests assert the ENFORCEMENT, not the script's
 * existence — the failure mode being closed is "the operator lands anyway".
 */

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** A repo whose head raises a SIZE_FREEZE ceiling — the case architecture passes but kill catches. */
function repoWithCeilingRaise(): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "integrate-"));
  repos.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "ignore" });
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);

  // Must be the REAL freeze path — checkRaisedCeiling reads that exact file at base and head.
  const freezeRel = "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts";
  mkdirSync(join(root, dirname(freezeRel)), { recursive: true });
  const freeze = join(root, freezeRel);
  writeFileSync(freeze, `export const SIZE_FREEZE = {\n  "a/b.ts": { maxLines: 607, reason: "x" },\n};\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();

  // head must live on its OWN branch: a worker lands from wt/*, and merging a SHA that is already
  // an ancestor of main is a no-op with nothing to commit.
  git(root, ["checkout", "-q", "-b", "wt/ceiling"]);
  writeFileSync(freeze, `export const SIZE_FREEZE = {\n  "a/b.ts": { maxLines: 999, reason: "x" },\n};\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "raise ceiling"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "main"]);
  return { root, base, head };
}

function repoWithBenignChange(): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "integrate-"));
  repos.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "ignore" });
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  writeFileSync(join(root, "readme.md"), "hello\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "-b", "wt/benign"]);
  writeFileSync(join(root, "readme.md"), "hello\nworld\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "benign"]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "main"]);
  return { root, base, head };
}

describe("integrate — merge-kill enforced at the land boundary", () => {
  it("REFUSES to land when merge-kill fires, and leaves the tree untouched", () => {
    const { root, base, head } = repoWithCeilingRaise();
    const before = git(root, ["rev-parse", "HEAD"]).trim();

    const result = integrate({
      repoRoot: root, base, head, slice: "probe",
      contract: { proofsOk: true, proofs: [{ rule: "run:true", passed: true, detail: "ok" }] },
      dryRun: false,
    });

    expect(result.landed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.killReport.killed).toBe(true);
    expect(result.killReport.findings.some((f) => f.id === "raised-ceiling")).toBe(true);
    // The point: refusing must have NO land side effect, not merely report a failure afterwards.
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  it("records NO integration event for a refused land", () => {
    const { root, base, head } = repoWithCeilingRaise();
    integrate({
      repoRoot: root, base, head, slice: "probe",
      contract: { proofsOk: true, proofs: [{ rule: "run:true", passed: true, detail: "ok" }] },
      dryRun: false,
    });
    expect(integrationEvents(root)).toHaveLength(0);
  });

  it("lands a clean head and records an integration event", () => {
    const { root, base, head } = repoWithBenignChange();
    const result = integrate({
      repoRoot: root, base, head, slice: "clean-slice",
      contract: { proofsOk: true, proofs: [{ rule: "run:true", passed: true, detail: "ok" }] },
      dryRun: false,
    });

    expect(result.killReport.killed).toBe(false);
    expect(result.landed).toBe(true);
    expect(result.exitCode).toBe(0);

    // The event replaces regexing "Merge branch 'wt/…'" out of commit subjects, which under-reported
    // land rate as 33% when the true figure was 100% — slices integrated by taking intended files
    // leave no such subject.
    const events = integrationEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]?.slice).toBe("clean-slice");
    expect(events[0]?.head).toBe(head);
  });

  it("refuses a merge with NO contract at all — absence is not innocence", () => {
    const { root, base, head } = repoWithBenignChange();
    const result = integrate({ repoRoot: root, base, head, slice: "uncontracted", dryRun: false });
    expect(result.landed).toBe(false);
    expect(result.killReport.findings.some((f: { id: string }) => f.id === "contract-not-verified")).toBe(true);
  });

  it("refuses when the layer-3 contract failed, even if the diff itself is clean", () => {
    const { root, base, head } = repoWithBenignChange();
    const result = integrate({
      repoRoot: root, base, head, slice: "unproven",
      contract: { proofsOk: false, proofs: [{ rule: "run:x", passed: false, detail: "boom" }] },
      dryRun: false,
    });
    expect(result.landed).toBe(false);
    expect(result.killReport.killed).toBe(true);
  });
});

/**
 * Contract precedence: an anchored merge re-verify outranks a stale dispatch ledger.
 *
 * INCIDENT (#43): the worker failed one proof, was resumed, fixed it and committed. The ledger still
 * held `proofsOk: false` from the first attempt, so integrate refused a slice whose every proof
 * passed on independent re-run against the exact commit being landed. The ledger records what a
 * dispatch OBSERVED once; the merge report records proofs RE-EXECUTED against the candidate tree.
 * Stale-beats-fresh was the wrong precedence.
 *
 * The anchor is what keeps this a strengthening rather than a loosening: a report may only outrank
 * the ledger when its `headSha` IS the commit about to land. Everything else falls through — which
 * is why these cases assert refusal rather than merely asserting the happy path.
 */
describe("merge-report precedence is anchored to the landing commit", () => {
  const report = (over: Record<string, unknown> = {}) => ({
    sliceId: "slice-x",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    proofsOk: true,
    checks: [{ rule: "run:true", passed: true, detail: "ok" }],
    ...over,
  });

  /** Mirrors the guard in mergeVerifyContractForSlice without touching the filesystem. */
  const usable = (r: ReturnType<typeof report>, landingSha: string | undefined, slice = "slice-x") => {
    if (r.sliceId !== undefined && r.sliceId !== slice) return false;
    if (r.proofsOk === undefined) return false;
    if (!r.headSha || !landingSha || r.headSha !== landingSha) return false;
    return true;
  };

  const LANDING = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("uses a report that verified the exact commit being landed", () => {
    expect(usable(report(), LANDING)).toBe(true);
  });

  it("REFUSES a report anchored to a different commit", () => {
    // Otherwise a stale pass could bless work it never saw.
    expect(usable(report({ headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }), LANDING)).toBe(false);
  });

  it("REFUSES an unanchored report, even when its proofs passed", () => {
    // "Some tree at this path passed once" is not a claim about this commit.
    expect(usable(report({ headSha: undefined }), LANDING)).toBe(false);
  });

  it("REFUSES when the landing commit cannot be resolved", () => {
    expect(usable(report(), undefined)).toBe(false);
  });

  it("REFUSES a report for a different slice", () => {
    expect(usable(report({ sliceId: "slice-y" }), LANDING)).toBe(false);
  });

  it("does not coerce a failing report into a pass", () => {
    // Precedence changes WHICH record is authoritative, never what it says.
    const failing = report({ proofsOk: false });
    expect(usable(failing, LANDING)).toBe(true);
    expect(failing.proofsOk).toBe(false);
  });
});

describe("the rebuild target list is captured before the merge (#203 retro)", () => {
  it("packagesNeedingRebuild is called on a range that still contains the change", () => {
    // 8144ca5 added a post-merge rebuild that NEVER FIRED: after `git merge` the head branch is an
    // ancestor of base, so `git diff base...head` is empty and the detector returns []. Measured on
    // the #203 land, which changed packages/openclinxr/asset-registry/src/**:
    //
    //   post-merge  main...wt/issue-203    -> []
    //   pre-merge   main~1...wt/issue-203  -> ['@openclinxr/asset-registry']
    //
    // I probed the FUNCTION with a simulated pre-merge range and passed it, then wired the call in
    // AFTER the commit. Unit-testing the helper could never catch that — the bug was always WHEN it
    // ran. This test reads the source order, which is the only thing that binds it.
    const source = readFileSync(
      new URL("./integrate.ts", import.meta.url),
      "utf8",
    );
    const captureAt = source.indexOf("packagesNeedingRebuild(input.repoRoot, input.base, input.head)");
    const mergeAt = source.indexOf('execFileSync("git", ["merge"');
    const rebuildAt = source.indexOf('execFileSync("pnpm", ["--filter", pkg, "build"]');

    expect(captureAt, "packagesNeedingRebuild is never called in integrate()").toBeGreaterThan(-1);
    expect(mergeAt, "no git merge in integrate()").toBeGreaterThan(-1);
    expect(rebuildAt, "no rebuild step in integrate()").toBeGreaterThan(-1);

    expect(
      captureAt,
      "rebuild targets are captured AFTER the merge — `base...head` is empty by then and the "
      + "rebuild will silently never fire (this is the 8144ca5 bug)",
    ).toBeLessThan(mergeAt);

    expect(
      rebuildAt,
      "the rebuild runs before the merge — it must run after the commit so the sources are on the branch",
    ).toBeGreaterThan(mergeAt);
  });
});

/**
 * ISSUE #448 — a landing whose worker never spoke is refused, and a landed card is marked Landed.
 *
 * The comment check runs against the board (via an injected gh runner — no live gh in tests) and
 * requires the STRICTER reading: a comment authored outside the orchestrator login, or a comment
 * body carrying the worker directive's report markers (UNABLE: / "cannot pass" / "Factory:").
 * Orchestrator bookkeeping comments (the #441-#446 state) do not satisfy it.
 */
describe("issue #448 — the board is the dequeue queue (integrate side)", () => {
  const FIELD_LIST_JSON = JSON.stringify({
    fields: [
      {
        id: FACTORY_FIELD_ID,
        name: "Factory",
        type: "ProjectV2SingleSelectField",
        options: [
          { id: "o-idle", name: "Idle" },
          { id: "53aeb5a6", name: "Planted" },
          { id: "o-dispatched", name: "Dispatched" },
          { id: "o-landed", name: "Landed" },
          { id: "o-graded", name: "Graded" },
        ],
      },
    ],
  });

  function fakeGh(input: { comments: string; login?: string }) {
    const calls: string[][] = [];
    const runner = (argv: string[]): string => {
      calls.push(argv);
      const joined = argv.join(" ");
      if (joined.includes("issue view")) return input.comments;
      if (joined.includes("api user")) return input.login ?? "gidich";
      if (joined.includes("project view 7")) return "PVT_1";
      if (joined.includes("project item-list 7")) {
        return JSON.stringify({ items: [{ id: "PVTI_448", content: { type: "Issue", number: 448 } }] });
      }
      if (joined.includes("project field-list 7")) return FIELD_LIST_JSON;
      if (joined.includes("project item-edit")) return "";
      throw new Error(`unexpected gh argv in integrate fake: ${joined}`);
    };
    return { runner, calls };
  }

  const greenContract = { proofsOk: true, proofs: [{ rule: "run:true", passed: true, detail: "ok" }] };

  it("REFUSES an issue-backed landing whose worker never spoke (orchestrator-only comments)", () => {
    const { root, base, head } = repoWithBenignChange();
    // The #441-#446 state: every comment is the orchestrator's own bookkeeping.
    const { runner } = fakeGh({
      comments: JSON.stringify([
        { author: { login: "gidich" }, body: "**resolution**\n\nverify ok; slice closed" },
        { author: { login: "gidich" }, body: "CLAIM: wired. NOT TESTED: nothing." },
      ]),
    });
    const result = integrate({ repoRoot: root, base, head, slice: "issue-448", contract: greenContract, ghRunner: runner });
    expect(result.landed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.killReport.findings.some((f) => f.id === "worker-never-spoke")).toBe(true);
    // The refusal must have NO land side effect.
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(base);
    expect(integrationEvents(root)).toHaveLength(0);
  });

  it("REFUSES an issue-backed landing with ZERO comments (#447 state)", () => {
    const { root, base, head } = repoWithBenignChange();
    const { runner } = fakeGh({ comments: "[]" });
    const result = integrate({ repoRoot: root, base, head, slice: "issue-448", contract: greenContract, ghRunner: runner });
    expect(result.landed).toBe(false);
    expect(result.killReport.findings.some((f) => f.id === "worker-never-spoke")).toBe(true);
  });

  it("LANDS when the worker commented with the directive markers, and marks the card Landed", () => {
    const { root, base, head } = repoWithBenignChange();
    const { runner, calls } = fakeGh({
      comments: JSON.stringify([
        { author: { login: "gidich" }, body: "**resolution**\n\nverify ok; slice closed" },
        { author: { login: "gidich" }, body: "Factory: Dispatched — work complete, proofs green" },
      ]),
    });
    const result = integrate({ repoRoot: root, base, head, slice: "issue-448", contract: greenContract, ghRunner: runner });
    expect(result.landed).toBe(true);
    expect(result.exitCode).toBe(0);
    // The integrator (machine) wrote Factory=Landed after the land.
    const edits = calls.filter((c) => c.includes("item-edit"));
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.flat().join(" ")).toContain("--single-select-option-id o-landed");
    expect(integrationEvents(root)).toHaveLength(1);
  });

  it("LANDS and warns (does not fail) when the Landed board write fails after the merge", () => {
    const { root, base, head } = repoWithBenignChange();
    const runner = (argv: string[]): string => {
      const joined = argv.join(" ");
      if (joined.includes("issue view")) {
        return JSON.stringify([{ author: { login: "gidich" }, body: "Factory: Dispatched" }]);
      }
      if (joined.includes("api user")) return "gidich";
      throw new Error("gh: network down");
    };
    const result = integrate({ repoRoot: root, base, head, slice: "issue-448", contract: greenContract, ghRunner: runner });
    // The land succeeded; the stale board row is a warning, not a refusal.
    expect(result.landed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(integrationEvents(root)).toHaveLength(1);
  });

  it("skips the comment check for slices with no board card (no gh calls)", () => {
    const { root, base, head } = repoWithBenignChange();
    const calls: string[][] = [];
    const runner = (argv: string[]): string => {
      calls.push(argv);
      throw new Error("should never run gh for a card-less slice");
    };
    const result = integrate({ repoRoot: root, base, head, slice: "clean-slice", contract: greenContract, ghRunner: runner });
    expect(result.landed).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
