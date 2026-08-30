import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import BASELINE from "./cited-evidence-baseline.json" with { type: "json" };

/**
 * **OBSERVABLE: a commit can cite an evidence file that is not in the repo, and exit 0.**
 *
 * `.openclinxr` is gitignored. `git add` on an ignored path SKIPS IT AND EXITS ZERO, so f4e94b1a
 * committed a planted contract and silently dropped the `pre-fix.json` its own commit message, the
 * plant's immutable header and the card comment all cite as the measurement they rest on. Three
 * citations to a file not in the tree, and nothing failed.
 *
 * 682 files under `.openclinxr/evidence` ARE tracked, by force-add convention, so the ignore rule is
 * not the policy — it is a trap that the policy walks past.
 *
 * The general defect, in an external reviewer's words: "command exited zero" and "file exists
 * locally" are not evidence that a cited artifact exists in the committed tree. That is the same
 * family as a green gate that verified nothing, and this repo has now hit it twice.
 *
 * ## What this checks
 *
 * Every `.openclinxr/evidence/...` path cited by a TRACKED file must resolve in HEAD. Not on disk —
 * in HEAD, because a proof run against a working tree certifies a tree nobody will ever have again.
 *
 * ## A RATCHET, because the tree already carries 1,916 of these
 *
 * Installing this as an absolute gate would red the whole repo on arrival, and a gate nobody can
 * land past gets deleted. `cited-evidence-baseline.json` records the dangling set at the commit that
 * introduced this file. The assertion is that today's set is a SUBSET of it: a NEW dangling citation
 * fails and is named, and landing a missing file shrinks the live set while still passing.
 *
 * The baseline is a debt register, not a permission. Every entry is a citation that resolves to
 * nothing for anyone who clones this repo.
 *
 * ## What it does NOT check, deliberately
 *
 * Whether the cited file's CONTENT still says what the citing text claims. A path that resolves can
 * still hold a stale measurement; that is a different instrument and this one should not imply it.
 * Citations in untracked files, which are nobody's contract yet.
 */

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/** Paths under the ignored evidence root, cited from anywhere in the tracked tree. */
const CITATION = /\.openclinxr\/evidence\/[A-Za-z0-9._\/-]+\.[A-Za-z0-9]+/g;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function citationsInTrackedFiles(): { file: string; path: string }[] {
  // Search the INDEX, not the working tree: an untracked file's citations are not yet a promise.
  // `-I` skips binaries; a hit inside a .png is a byte coincidence, not a citation.
  let out = "";
  try {
    out = git("grep", "-I", "-o", "-E", CITATION.source, "HEAD", "--", ".");
  } catch (error) {
    // git grep exits 1 when nothing matches, which is a legitimate empty result rather than an error.
    if ((error as { status?: number }).status !== 1) throw error;
    return [];
  }
  const found: { file: string; path: string }[] = [];
  for (const line of out.split("\n")) {
    // HEAD:<file>:<match>
    const match = /^HEAD:([^:]+):(.+)$/.exec(line);
    if (match) found.push({ file: match[1]!, path: match[2]! });
  }
  return found;
}

/**
 * ONE tree listing, not one `cat-file` per path. The first version spawned git 2,333 times and timed
 * out at 5 s — an instrument slow enough to be disabled is an instrument nobody runs.
 */
function headPaths(): Set<string> {
  return new Set(git("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean));
}

describe("a cited evidence path must exist in HEAD", () => {
  it("every .openclinxr/evidence path cited by a tracked file resolves in the committed tree", () => {
    const citations = citationsInTrackedFiles();

    // COUNTERWEIGHT, first: this gate must not pass by finding nothing. If the citation pattern ever
    // stops matching — a path convention changes, `git grep` output shape changes — the loop below
    // iterates zero times and reports success over an unexamined tree. That is the exact failure
    // this file exists to catch, arriving from inside the file.
    expect(
      citations.length,
      "no evidence citations found at all — the pattern or the grep is broken, not the tree",
    ).toBeGreaterThan(0);

    const inHead = headPaths();
    const known = new Set(BASELINE.paths);
    const missing = [...new Set(citations.map((c) => c.path))].filter((p) => !inHead.has(p));
    const regressions = missing
      .filter((p) => !known.has(p))
      .map((p) => ({ path: p, citedBy: [...new Set(citations.filter((c) => c.path === p).map((c) => c.file))] }));

    expect(
      regressions,
      `NEW cited evidence is absent from HEAD. \`.openclinxr\` is gitignored and \`git add\` on an ignored path exits 0 without staging — force-add each path explicitly, or drop the citation:\n${regressions
        .map((m) => `  ${m.path}\n      cited by: ${m.citedBy.join(", ")}`)
        .join("\n")}`,
    ).toEqual([]);

    // The baseline is a DEBT REGISTER. A stale entry — a path that now resolves — must be removed in
    // the commit that lands the file, or the register stops describing the debt and the ratchet stops
    // ratcheting.
    const stale = [...known].filter((p) => inHead.has(p));
    expect(
      stale,
      `these paths now resolve and must be removed from cited-evidence-baseline.json:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});
