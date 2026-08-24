import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: the loop enumerates unfinished work before it selects work.
 *
 * MEASURED 2026-08-22, do not re-derive. The superagent diagnosed the loop's missing step:
 *
 *   "Your tick enumerates STATES (harvest -> killed-check -> collision-check) and then calls a
 *    selector. Nothing in the pipeline ever builds the candidate list from the world. Sweep is an
 *    ENUMERATION step, and there is no enumeration step."
 *
 * In one hour the operator found four pieces of unfinished work the loop had not: lip-sync recorded as
 * "on hold" when 8 cards were closed and 1 open; eyebrows/lashes/teeth/tongue already done (#542); a
 * Rhubarb lane assigned and never dispatched; an IWSDK release we were already pinned to. All four are
 * queries, not judgement.
 *
 * THE COUNTER MUST NOT BE A NAIVE GREP — measured, and I walked into it myself:
 *
 *   grep -c 'it\.fails('  a-live-rule-refuses-an-unflipped-plant.test.ts  -> 1   FALSE POSITIVE
 *   live:                 a-live-rule-refuses-an-unflipped-plant.test.ts  -> GREEN, 0 remaining
 *
 * That file DOCUMENTS the marker in prose, so a regex over raw source counts its own header. The
 * correct instrument already ships: `countPlantedItFails` behind the `live:` rule (#570), which strips
 * comments and string bodies before matching. A sweep that over-counts trains the reader to discount
 * it, which is exactly how the pulse's own alarm went unheard for nine hours.
 *
 * KNOWN-GOOD / KNOWN-BAD PAIR, both real files on main:
 *   GREEN by live:, false-positive by grep  -> a-live-rule-refuses-an-unflipped-plant.test.ts
 *   GENUINELY 3 unflipped                   -> shoulder-raycast-coverage.test.ts
 *
 * claimScope: whether a sweep entry point exists and whether its RED count uses the comment/string-
 * stripping counter rather than a raw regex.
 * notEvidenceFor: the other four sweep queries (S2-S5), the SWEEP report line, or whether anyone reads it.
 */

const ROOT = join(import.meta.dirname, "../../..");
const PROSE_FILE = "packages/openclinxr/agent-loop/src/a-live-rule-refuses-an-unflipped-plant.test.ts";
/**
 * DISCOVERED, not frozen (2026-08-24). This was a hardcoded path and it has now rotted TWICE: first
 * when #583 flipped the shoulder plant's three clauses, and again here — `db323030` flipped the last
 * of them, leaving four `it.fails` mentions in that file's header prose and ZERO live. The counter
 * was right and the fixture was stale, so a clause designed to prove the counter honest instead
 * failed the slice that did the work it was watching for.
 *
 * Clause (3) prescribes "re-pick the fixture", which is correct and treats the symptom: whichever
 * file is picked next is one landed slice away from the same rot. The fixture is now DISCOVERED from
 * the tree, which keeps the author's stated intent — count "what the world actually carries, not a
 * frozen example" — while surviving product progress.
 *
 * Both teeth are preserved: a counter returning 0 for everything finds no live-RED file here, and a
 * counter returning N for everything fails on PROSE_FILE below.
 */
const redCandidates = (): string[] => {
  const out = execFileSync("grep", ["-rl", "--exclude-dir=node_modules", "--exclude-dir=dist",
    "--include=*.test.ts", "it.fails", "tools", "packages", "apps"],
    { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".test.ts"));
  return out.filter((f) => f !== PROSE_FILE);
};

const naiveGrepCount = (rel: string): number =>
  (readFileSync(join(ROOT, rel), "utf8").match(/\bit\.fails\(/gu) ?? []).length;

describe("the sweep counts planted REDs, not prose", () => {
  it("(0) VACUITY GUARD: the known-good/known-bad pair both ship and differ", () => {
    // Without this, (2) could pass by either fixture vanishing rather than by the counter being right.
    expect(existsSync(join(ROOT, PROSE_FILE)), "the prose-documenting plant must ship").toBe(true);
    expect(redCandidates().length, "some file must mention it.fails, or the pair is moot").toBeGreaterThanOrEqual(1);
    expect(naiveGrepCount(PROSE_FILE), "the prose file must still trip a naive grep, or this test is moot")
      .toBeGreaterThan(0);
  });

  it("(1) RED: a sweep entry point exists and reports the unfinished inventory", async () => {
    const mod = await import("./openclaw-sweep.js") as Record<string, unknown>;
    const fn = mod["summariseUnfinishedInventory"];
    expect(
      typeof fn,
      "tools/openclinxr/openclaw/openclaw-sweep.ts does not export summariseUnfinishedInventory() — "
        + "the loop has no enumeration step, which is the whole defect",
    ).toBe("function");
    const out = await (fn as (root: string) => Promise<Record<string, unknown>>)(ROOT);
    for (const k of ["reds", "oldestRedId", "undispatchable", "uncarded", "quietThreads"]) {
      expect(out, `the inventory must report ${k}`).toHaveProperty(k);
    }
  });

  it("(2) RED + COUNTERWEIGHT: the RED count strips prose, and still finds the real ones", async () => {
    // Refuses the cheap fix: shelling out to grep. The prose file must NOT be counted; a genuinely
    // red file must be. A counter that returns 0 for both, or N for both, fails here.
    // #583: the shoulder plant RESOLVED (all three clauses flipped), so the fixture moved to a
    // file whose unflipped clauses are live right now — the sweep must count what the world
    // actually carries, not a frozen example. Fixture: dispatch-binds-the-role-charter.test.ts.
    const mod = await import("./openclaw-sweep.js") as Record<string, unknown>;
    const count = mod["plantedRedCount"] as ((root: string, rel: string) => number) | undefined;
    expect(typeof count, "the sweep must expose its per-file counter for verification").toBe("function");
    expect(count!(ROOT, PROSE_FILE), `${PROSE_FILE} documents it.fails in prose and has none remaining`).toBe(0);
    const candidates = redCandidates();
    // Short-circuits on the first hit. Counting all 192 candidates proves nothing extra and the
    // counter reads each file — a filter over the whole set pushed this clause past 120s.
    let live = 0;
    let firstLive = "";
    for (const f of candidates) {
      if (count!(ROOT, f) >= 1) { live = 1; firstLive = f; break; }
    }
    expect(
      live,
      firstLive ? "" :
      `no file in the tree counts as carrying a live unflipped clause, across ${candidates.length} `
        + "candidates that mention it.fails at all. Either every plant is flipped (say so and retire "
        + "this clause) or the counter returns 0 for everything, which is the defect it guards",
    ).toBeGreaterThanOrEqual(1);
  });

  it("(3) COUNTERWEIGHT: the naive instrument really does disagree — the defect is not hypothetical", () => {
    // Pins the reason clause (2) exists. If a future edit removes the prose, this fails and clause (2)
    // becomes vacuous — that is the signal to re-pick the fixture, not to weaken the counter.
    expect(
      naiveGrepCount(PROSE_FILE),
      "a raw regex over the prose file counts its own documentation — this is the measured false positive",
    ).toBeGreaterThanOrEqual(1);
  });
});

/**
 * ## FIXED (#584)
 *
 * Both REDs flipped to live `it()` after `tools/openclinxr/openclaw/openclaw-sweep.ts` landed:
 *
 * - (1) imports the module, finds all five keys, and `summariseUnfinishedInventory(ROOT)`
 *   resolves in ~850 ms (S1 walk + S2 gh + S3 git log + S4 npm + S5 sessions, parallelised).
 * - (2) `plantedRedCount(ROOT, PROSE_FILE)` = 0 (stripper holds) and
 *   `plantedRedCount` on a discovered live-RED file is >= 1. The naive grep still counts the
 *   prose file (clause 3 unchanged), so the counter is doing real work.
 *
 * Measured traps fixed on the way, recorded in openclaw-sweep.ts's header: gh ANSI-decorates
 * JSON under FORCE_COLOR (parse failed until NO_COLOR + strip); node_modules vendored tests
 * poisoned the S3 walk (1449 junk hits); worktree mtimes are checkout times, so S3 uses
 * `git log --diff-filter=A` instead.
 */

/**
 * A PLANT IS CARDED IF IT CITES A CARD — IN ITS PATH OR IN ITS BODY.
 *
 * MEASURED 2026-08-24 across the 24 recently-added plants this check flagged: **22 cite an issue
 * number in their content**, several citing three. Only 2 genuinely have none, and both trace to
 * commits rather than cards.
 *
 * Reading the path alone was described as "structurally incompatible" with this repo's naming
 * convention and written off as unfixable noise. It is neither: plants are named for the OBSERVABLE
 * they assert, deliberately, and the card is recorded in the header where the reasoning lives. The
 * instrument read the wrong place and saturated at 24 where the honest answer is 2.
 */
describe("a plant is carded by its body, not only its filename", () => {
  const write = async (dir: string, rel: string, body: string) => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { dirname, join: j } = await import("node:path");
    mkdirSync(dirname(j(dir, rel)), { recursive: true });
    writeFileSync(j(dir, rel), body, "utf8");
  };

  it("(1) counts a prose-named plant that cites its card in the header as CARDED", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: j } = await import("node:path");
    const { countUncardedRecentFiles } = await import("./openclaw-sweep.js");

    const root = mkdtempSync(j(tmpdir(), "sweep-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t"); git("config", "user.name", "t");

    // The real convention: named for the observable, card in the header.
    await write(root, "tools/a-declared-body-shape-reaches-the-baked-body.test.ts",
      "/** MEASURED per #576 — the numeric identity must reach a macro. */\nexport {};\n");
    // Genuinely uncarded: no number anywhere.
    await write(root, "tools/an-orphan-plant-with-no-card.test.ts", "/** no card cited */\nexport {};\n");
    git("add", "-A"); git("commit", "-qm", "plants");

    const r = countUncardedRecentFiles(root);
    expect(r.files.some((f) => f.includes("declared-body-shape")),
      "a header citing #576 is a carded plant — the filename is deliberately prose").toBe(false);
    expect(r.files.some((f) => f.includes("orphan-plant")),
      "a plant citing no card anywhere is genuinely uncarded").toBe(true);
    expect(r.count, "exactly one of the two is uncarded").toBe(1);
  });

  it("(2) an unreadable path stays UNCARDED — the failure direction is conservative", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: j } = await import("node:path");
    const { countUncardedRecentFiles } = await import("./openclaw-sweep.js");

    const root = mkdtempSync(j(tmpdir(), "sweep-"));
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    await write(root, "tools/a-plant-that-gets-deleted.test.ts", "/** cites #999 */\nexport {};\n");
    git("add", "-A"); git("commit", "-qm", "plant");
    rmSync(j(root, "tools/a-plant-that-gets-deleted.test.ts"));

    // Added in history, absent from disk: must not be silently treated as carded.
    expect(countUncardedRecentFiles(root).count,
      "an unreadable file counts as uncarded rather than assumed fine").toBe(1);
  });
});
