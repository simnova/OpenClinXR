import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * A citation into archived reasoning must name something SEARCHABLE, never a line number.
 *
 * MEASURED 2026-08-29. Splitting PROTO_VERIFY_DELEGATION.md (284,792 chars, ~71,000 est. tokens
 * resident every turn) into an operative half and a cold archive broke exactly one of the eight
 * references to it from `tools/`: `PROTO_VERIFY_DELEGATION.md:3424`. Every other citation names a
 * section or the document itself and still resolves by grep; only the line number could not survive
 * a move.
 *
 * The line number was ALWAYS fragile — it would have broken on any edit above line 3424, and the
 * split merely exposed it. That is the point of this contract: an anchor survives edits, moves, and
 * re-splits, and a line number survives none of them.
 *
 * This is the same dangling-reference class markdown-references.ts was built for after the
 * 2026-08-05 purge, arriving from the other direction: there a document moved and left pointers
 * behind; here a document is DELIBERATELY moved, and the pointers must be built to survive it.
 *
 * Scope: citations INTO the two PROTO_VERIFY_DELEGATION files. It does not police line references
 * to source code, where a line number is an ordinary and useful address that lives beside the code
 * it names and moves with it under review.
 */

const CITE_BY_LINE = /PROTO_VERIFY_DELEGATION[A-Za-z0-9._-]*\.md:\d+/;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter((p) => /\.(ts|tsx|js|mjs|md|py|json)$/u.test(p));
}

function citationsByLine(): string[] {
  const hits: string[] = [];
  for (const file of trackedFiles()) {
    // The archive itself quotes historical prose verbatim; it is the record, not a live citation.
    if (file.includes("/_archive/")) continue;
    // WORKING TREE, not HEAD. A pre-commit gate must judge what is about to be committed; reading
    // HEAD would pass a commit that introduces a line citation and fail one that removes it.
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // deleted-but-still-tracked during a rename
    }
    text.split("\n").forEach((line, i) => {
      const m = CITE_BY_LINE.exec(line);
      if (m) hits.push(`${file}:${i + 1} cites ${m[0]}`);
    });
  }
  return hits;
}

describe("archived reasoning is cited by anchor, not by line", () => {
  it("no tracked file cites PROTO_VERIFY_DELEGATION by line number", () => {
    const hits = citationsByLine();
    expect(
      hits,
      `Cite archived reasoning by a grep anchor, not a line number. A line number breaks on any edit\n`
        + `above it and on every move; an anchor survives both. Replace with the searchable phrase, e.g.\n`
        + `  grep "never been validated on hardware" in\n`
        + `  docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md\n\n`
        + hits.join("\n"),
    ).toEqual([]);
  });

  /**
   * COUNTERWEIGHT. Without this, a pattern that matches nothing — a typo in the regex, a filter that
   * drops every file — satisfies the clause above and the guard means nothing. This proves the
   * detector fires on the exact shape it exists to catch.
   */
  it("COUNTERWEIGHT: the detector fires on a line-number citation", () => {
    expect(CITE_BY_LINE.test("see PROTO_VERIFY_DELEGATION.md:3424 for the budget claim")).toBe(true);
    expect(CITE_BY_LINE.test("PROTO_VERIFY_DELEGATION-incident-archive.md:3040")).toBe(true);
  });

  it("COUNTERWEIGHT: anchors and section citations are NOT flagged", () => {
    for (const ok of [
      'grep "never been validated on hardware" in the incident archive',
      "PROTO_VERIFY_DELEGATION section 9s records that trap",
      "PROTO_VERIFY_DELEGATION §7p asked for a gated pre-fix artifact",
      "docs/_archive/agent-rules/2026-08/PROTO_VERIFY_DELEGATION-incident-archive.md",
    ]) {
      expect(CITE_BY_LINE.test(ok), `must not flag: ${ok}`).toBe(false);
    }
  });

  it("the detector actually scans a non-empty file set", () => {
    // Guards the "filter dropped everything" failure the counterweight above cannot see.
    expect(trackedFiles().length).toBeGreaterThan(100);
  });
});
