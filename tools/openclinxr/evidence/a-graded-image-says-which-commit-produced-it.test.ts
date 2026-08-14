import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The artifacts this repo ASSERTS on carry provenance. The artifacts it GRADES do not.**
 *
 * That is the wrong way round. A machine assertion re-runs on demand and can be re-derived at will; a
 * pixel grade is a human judgement made once, recorded in an issue comment, and acted on for days. It
 * is the one that most needs to say which tree it came from — and it is the one that says nothing.
 *
 * Measured 2026-08-14:
 *
 *   evidence modules writing a `.png`                          88
 *   evidence modules stamping `measuredAgainstCommit`/`treeStamp`   31
 *   `glb-grade-capture/<run>/gallery.json` commit fields            **NONE**
 *
 * The measurement artifacts (`room-decimate/pre-fix.json`, `room-materials/pre-fix.json`, …) all carry
 * `measuredAgainstCommit`. The image gallery carries `generatedAt` and nothing else.
 *
 * ## I DEMONSTRATED THIS DEFECT MYSELF, HOURS BEFORE WRITING THE TEST
 *
 * On 2026-08-14 I handed a peer reviewer four full-resolution PNGs from
 * `glb-grade-capture/2026-08-14T04-46-49Z/` and asked for an appearance grade on #381. Neither of us
 * can tell from those files which commit produced them. Main moved three times that hour. If the grade
 * comes back "the hairline still reads hard", there is no way to know whether it was taken before or
 * after the fix it is grading — and a wall-clock timestamp does not answer that, because the question
 * is about tree state, not time.
 *
 * That is #89 stated concretely, and it is also why #368 cost 105 turns: a `treeStamp` that had gone
 * stale looked like work to do.
 *
 * ## THE KNOWN-GOOD IS IN THIS REPO, IN THIRTY-ONE MODULES (SS9h)
 *
 * `measuredAgainstCommit` is an established convention with 31 existing writers, and `treeStamp`
 * (head + status/diff fingerprint) is the richer form used by the face-cue artifact. Nothing needs
 * designing. This is a wire: the gallery writer must record what the measurement writers already do.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) gallery stamped | (2) real sha | (3) images still written | result
 *   -------------------------------------------------|---------------------|--------------|--------------------------|--------
 *   a) today                                         |      **FAIL**       |     n/a      |          pass            | REFUSED
 *   b) write `generatedAt` and call it provenance    |      **FAIL**       |     n/a      |          pass            | REFUSED
 *   c) stamp a placeholder / "unknown" / empty string|        pass         |  **FAIL**    |          pass            | REFUSED
 *   d) stop writing the gallery so nothing is unstamped|      pass         |     pass     |        **FAIL**          | REFUSED
 *   e) record the real HEAD sha beside the images    |        pass         |     pass     |          pass            | ALL PASS
 *
 * **(c) is the one to watch and it is why clause (2) exists.** A field called `measuredAgainstCommit`
 * containing `"unknown"` is worse than no field: it looks like provenance in a JSON dump and answers
 * nothing. Clause (2) requires 40 hex characters that resolve to a real object in this repository.
 *
 * **(b) is the failure mode already shipping.** `generatedAt` is a wall-clock time, and the question a
 * grader needs answered is which TREE, not which minute.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are the REDS — (1) fails today, and (2) fails
 * today only because there is no field to check, which is why it asserts the field's CONTENT rather
 * than its presence and becomes a live counterweight the moment (1) is satisfied. (3) is a
 * counterweight and passes today.
 *
 * NOT TESTED:
 *   - **The other 57 png-writing modules.** Scope is the `glb-grade` gallery, which is the one feeding
 *     appearance grades to a reviewer today. A sweep of all 88 is a different, larger slice and would
 *     be the wrong place to start.
 *   - **Dirty-tree detection.** A sha alone does not say whether the working tree had uncommitted
 *     changes when the capture ran. `treeStamp`'s fingerprint form does; this contract does not require
 *     it. Naming the sha is the floor, not the ceiling.
 *   - **That anyone reads the stamp.** This puts it in the file. Whether the grading loop checks it
 *     before trusting an image is a habit, not a gate.
 *   - **Retroactive stamping.** Existing captures stay unstamped and unknowable. Nothing here dates
 *     them; they should be treated as undatable rather than assumed current.
 *
 * ## FIXED (#89)
 *
 * - `runGlbGradeCapture` now stamps every gallery with the capture-time tree: `measuredAgainstCommit`
 *   (HEAD sha) plus the full `treeStamp` (head + worktree-dirtiness fingerprint), using the existing
 *   `lib/measurement-tree-stamp.ts` convention that 31 measurement writers already use. Fail-closed:
 *   a run that cannot resolve `git rev-parse HEAD` writes no gallery at all.
 * - Both `runDir/gallery.json` and `latest/gallery.json` are the same stamped object.
 * - Clauses (1) and (2) are flipped live: the newest galleries must name a real, resolvable commit.
 * - Pre-fix captures are untouched and stay undatable — not retro-dated.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GRADE_ROOT = join(REPO_ROOT, ".openclinxr/evidence/glb-grade-capture");

/** Field names this repo already uses for provenance, in 31 existing writers. */
const STAMP_KEYS = ["measuredAgainstCommit", "treeStamp", "headCommit", "commit"] as const;
const SHA40 = /^[0-9a-f]{40}$/;

type Gallery = { dir: string; json: Record<string, unknown> | null; stampKey: string | null; sha: string | null };

/** Newest real capture run — never `latest`, which is a symlink/copy of whichever ran last. */
function newestGalleries(limit = 3): Gallery[] {
  if (!existsSync(GRADE_ROOT)) return [];
  const runs = readdirSync(GRADE_ROOT)
    .filter((d) => d !== "latest" && existsSync(join(GRADE_ROOT, d, "gallery.json")))
    .map((d) => ({ d, mtime: statSync(join(GRADE_ROOT, d, "gallery.json")).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return runs.map(({ d }) => {
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(readFileSync(join(GRADE_ROOT, d, "gallery.json"), "utf8")) as Record<string, unknown>;
    } catch {
      json = null;
    }
    const stampKey = json ? (STAMP_KEYS.find((k) => k in json) ?? null) : null;
    const raw = stampKey && json ? json[stampKey] : null;
    const sha =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && typeof (raw as { head?: unknown }).head === "string"
          ? (raw as { head: string }).head
          : null;
    return { dir: d, json, stampKey, sha };
  });
}

const galleries = newestGalleries();

/** Does this 40-hex string name an object that exists in THIS repository? */
function resolvesInRepo(sha: string): boolean {
  if (!SHA40.test(sha)) return false;
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireGalleries(): void {
  expect(
    galleries.length,
    `glb-grade capture runs with a gallery.json under ${GRADE_ROOT}`,
  ).toBeGreaterThanOrEqual(1);
  for (const g of galleries) {
    expect(g.json, `${g.dir}/gallery.json parses`).not.toBeNull();
  }
}

describe("a graded image says which commit produced it", () => {
  it("(1) RED: the grade gallery records the commit it was captured against", () => {
    // Refuses (b): `generatedAt` is a wall-clock time. A grader needs the TREE, not the minute.
    requireGalleries();
    const unstamped = galleries
      .filter((g) => g.stampKey === null)
      .map(
        (g) =>
          `${g.dir}/gallery.json carries none of [${STAMP_KEYS.join(", ")}] — a reviewer handed these PNGs cannot tell which tree produced them (it has generatedAt only)`,
      );
    expect(unstamped, "grade galleries with no commit provenance").toEqual([]);
  });

  it("(2) RED: the recorded commit is a real sha, not a placeholder", () => {
    // Refuses (c): a field containing "unknown" looks like provenance in a dump and answers nothing.
    requireGalleries();
    const bogus = galleries
      .filter((g) => !g.sha || !resolvesInRepo(g.sha))
      .map(
        (g) =>
          `${g.dir}: ${g.sha === null ? "no sha recorded" : `"${g.sha}" is not a 40-hex commit resolvable in this repo`}`,
      );
    expect(bogus, "grade galleries whose recorded commit is absent or unreal").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the capture still writes its images", () => {
    // Refuses (d): deleting the gallery removes the unstamped artifact and the evidence with it.
    requireGalleries();
    const empty = galleries
      .filter((g) => {
        const assets = join(GRADE_ROOT, g.dir, "assets");
        if (!existsSync(assets)) return true;
        return !readdirSync(assets).some((a) =>
          existsSync(join(assets, a)) && readdirSync(join(assets, a)).some((f) => f.endsWith(".png")),
        );
      })
      .map((g) => `${g.dir}: no PNG under assets/ — the capture stopped producing images`);
    expect(empty, "grade runs that produced no images").toEqual([]);
  });
});
