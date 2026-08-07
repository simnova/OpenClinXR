import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#148) — `dispatch()` reuses an existing worktree without resetting it, so a
 * second dispatch on the same slice inherits the previous run's commits and working tree.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — a first dispatch must still create a worktree, and a
 * caller-supplied path must still be honoured. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS CORRUPTED A LIVE DISPATCH TODAY. THAT IS WHY IT IS SUBSTRATE WITH A SLOT.
 *
 * #139 landed, I graded the pixels, and reverted it (`5430b3a`). I then planted a new contract
 * (`9d54d28`) and re-dispatched the same issue. I polled the worktree and found:
 *
 *   - `HEAD` at `6b1c2db` — **the reverted commit**, so the worker's base still contained the change
 *     I had removed from main
 *   - **no copy of the newly planted contract**, because it was committed to main after that HEAD
 *   - ten dirty files of leftover doc-archive churn from the previous run — `PROJECT_STATUS.md`,
 *     `docs/_archive/**`, wiki topics, an archive manifest — none of which the brief asked for and
 *     all of which the brief explicitly forbade
 *
 * I killed it, `reset --hard`, `clean -fd`, `checkout -B wt/issue-139 main`, and re-dispatched.
 *
 * Per the escalation rules this is an **ENVIRONMENT failure, not a worker failure**, and the rung does
 * not roll back. But it is also silent: nothing in the dispatch output says "reusing a stale base".
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MECHANISM, TRACED — do not re-derive
 *
 * `dispatch-worker.ts:429-435`
 *
 *     const target = join(WORKTREE_ROOT, name);
 *     if (!existsSync(target)) {
 *       mkdirSync(WORKTREE_ROOT, { recursive: true });
 *       execFileSync("git", ["worktree", "add", "-b", branch ?? `wt/${name}`, target], …);
 *     }
 *
 * When the directory exists the whole block is skipped. `prepareWorktreeForWorker` then runs, but it
 * only provisions `node_modules` and assets — it never touches the branch or the working tree.
 *
 * So the reuse path is silent by construction, and it gets worse the more a slice is retried: exactly
 * the slices where a stale base is most damaging are the ones most likely to hit it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether a reused worktree is **reset to main** or **refused**. Resetting is convenient and
 *    silently discards anything uncommitted there; refusing is loud and makes the orchestrator clean
 *    up. I lean reset-with-a-loud-log and I am not certain — a worker's in-progress work has been
 *    worth recovering before (§7i records two slices where a resume saved 80–100 turns).
 *  - What "reset" means. `reset --hard` plus `clean -fd` plus `checkout -B <branch> main` is what I
 *    did by hand; whether `clean -fd` is safe in general is your call, since it deletes untracked
 *    files including any evidence a previous run wrote.
 *  - Whether the caller-supplied absolute-path branch (`dispatch-worker.ts:417-427`) gets the same
 *    treatment. It is used by tests with synthetic paths, so it probably must not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a reused worktree start from main, and is satisfiable by deleting and recreating the
 * worktree every time — which throws away the `node_modules` provisioning that §6c's retro found
 * three workers blocked on. (2) forbids that by requiring preparation to be preserved. (3) is green
 * today and forbids buying either by breaking first-dispatch creation or the caller-supplied path.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectWorktreeBaseFreshness()`. What must not
 * change: the check runs against a REAL git worktree, not a mock — the defect is in what git state
 * survives reuse, and a mocked filesystem cannot show that.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: what git state a reused worktree starts from. Says NOTHING about `node_modules`
 * provisioning (that works), the isolation deny, or anything a worker does once it is running.
 */

const load = async () => import("./worktree-base-freshness.js") as Promise<Record<string, unknown>>;

type ReuseOutcome = {
  /** Slice name the worktree belongs to. */
  slice: string;
  /** Commit the worktree sat on before the second dispatch prepared it. */
  headBefore: string;
  /** Commit it sits on after preparation. */
  headAfter: string;
  /** Main's tip at the time of preparation. */
  mainHead: string;
  /** Files dirty in the worktree before preparation. */
  dirtyBefore: number;
  /** Files dirty after preparation. */
  dirtyAfter: number;
  /** True when preparation emitted something the orchestrator can see about the reuse. */
  reuseWasAnnounced: boolean;
  /** True when node_modules survived preparation, so the tree is still ready to run. */
  nodeModulesPresentAfter: boolean;
};

type Inspect = () => Promise<{ reuse: ReuseOutcome; freshCreate: ReuseOutcome }>;

describe("a reused worktree starts from main (#148)", () => {
  it.fails("a second dispatch does not inherit the previous run's commits or dirt", async () => {
    // dispatch-worker.ts:429 skips `git worktree add` when the directory exists, and
    // prepareWorktreeForWorker never touches the branch. A retried slice therefore starts from
    // whatever the last run left, including work that has since been reverted on main.
    const mod = await load();
    const inspect = mod["inspectWorktreeBaseFreshness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.reuse.headAfter, "reused worktree did not start from main").toBe(report.reuse.mainHead);
    expect(report.reuse.dirtyAfter, "reused worktree kept the previous run's dirty files").toBe(0);
  }, 900_000);

  it.fails("the reuse is announced rather than silent", async () => {
    // Kills the cheap satisfaction of the first contract: resetting quietly discards whatever was
    // there. §7i records two slices where a killed worker's in-progress work was worth 80-100 turns,
    // so a silent reset can throw away something recoverable. The orchestrator must be told.
    const mod = await load();
    const inspect = mod["inspectWorktreeBaseFreshness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.reuse.reuseWasAnnounced, "the worktree was reused with no signal to the caller").toBe(true);
  }, 900_000);

  it.fails("first-dispatch creation and node_modules survive (COUNTERWEIGHT)", async () => {
    // The cheapest satisfaction is deleting and recreating the worktree every time, which throws away
    // the provisioning three separate workers were blocked on (§6c's first retro sweep).
    const mod = await load();
    const inspect = mod["inspectWorktreeBaseFreshness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.freshCreate.headAfter, "a first dispatch no longer starts from main").toBe(report.freshCreate.mainHead);
    expect(report.reuse.nodeModulesPresentAfter, "reuse threw away node_modules provisioning").toBe(true);
    expect(report.freshCreate.nodeModulesPresentAfter, "first dispatch is not provisioned").toBe(true);
  }, 900_000);
});
