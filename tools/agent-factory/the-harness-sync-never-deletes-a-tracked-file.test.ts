import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: `scripts/sync-harness-agent-files.sh` is the command the repo tells agents to run
 * after any rule edit (`agents/rules/README.md`). On 2026-08-24 running it DESTROYED 12 TRACKED
 * FILES — every Claude-native skill, including `measure-before-claiming` and `contract-design`.
 *
 * MECHANISM, measured: line 23 wipes `.claude/skills/*` and the line immediately after it says
 *
 *     echo "  Skills: config [skills].paths only (no symlinks)"
 *
 * — the script no longer MANAGES skills at all. The wipe is vestigial from an older symlink-based
 * layout, so it deletes and never repopulates. The rules directories survive only because they ARE
 * regenerated three lines later; skills are not.
 *
 * It failed closed by luck, not design: `.agents/skills/model-routing/SKILL.md` is a symlink INTO
 * `.claude/skills/`, so the wipe left a dangling link and `docs:drift-check` crashed on `statSync`.
 * Had that symlink not existed the deletion would have been silent, and the next commit would have
 * carried it.
 *
 * This clause resolves the script's own `rm -rf` globs against the working tree and asks git which
 * of the resulting paths are tracked. It is not a grep for a filename — the glob is expanded and
 * every hit is checked, so it stays true if someone adds a new wipe target later.
 *
 * The predicate is deletion WITHOUT regeneration, not deletion. The rules directories are wiped on
 * the same line and rebuilt by the `ln -sfn` loops below it, so their removal is net-zero; the first
 * version of this clause flagged all 62 of them and over-claimed. Skills are the real defect because
 * nothing writes them back.
 *
 * claimScope: that no tracked path deleted by this script is left absent by it.
 * notEvidenceFor: that the script's OUTPUT is correct, that the symlinks it writes resolve, or that
 *   any other script is safe. A sync script may regenerate a mirror; it must never destroy a source.
 */

const REPO = join(import.meta.dirname, "../..");

/** Every path the script's `rm -rf` lines would remove, with globs expanded against the tree. */
function pathsRemovedBy(script: string): string[] {
  const out: string[] = [];
  for (const line of script.split("\n")) {
    const m = /^\s*rm\s+-rf\s+(.+?)(?:\s+2>\/dev\/null)?(?:\s*\|\|.*)?$/.exec(line);
    if (!m) continue;
    for (const raw of m[1]!.trim().split(/\s+/)) {
      const target = raw.replace(/^["']|["']$/g, "");
      if (!target || target.startsWith("-")) continue;
      // `ls -d` expands the glob exactly as the shell would, against the real tree.
      try {
        const listed = execFileSync("bash", ["-c", `ls -d ${target} 2>/dev/null || true`],
          { cwd: REPO, encoding: "utf8" });
        for (const p of listed.split("\n").filter(Boolean)) out.push(p.trim());
      } catch { /* an unmatched glob removes nothing */ }
    }
  }
  return out;
}

/**
 * Directories the script writes symlinks into — the ones whose wipe is net-zero because the loops
 * below rebuild them. Destination is the last quoted argument of an `ln -sfn`; the shell variable in
 * its final segment is dropped, leaving the directory.
 */
function directoriesRepopulatedBy(script: string): string[] {
  const dirs = new Set<string>();
  for (const m of script.matchAll(/ln\s+-sfn\s+"[^"]+"\s+"([^"]+)"/g)) {
    const dest = m[1]!;
    const slash = dest.lastIndexOf("/");
    if (slash > 0) dirs.add(dest.slice(0, slash));
  }
  return [...dirs];
}

function trackedUnder(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const listed = execFileSync("git", ["ls-files", "--", ...paths], { cwd: REPO, encoding: "utf8" });
  return listed.split("\n").filter(Boolean);
}

describe("the harness sync never deletes a tracked file", () => {
  it("(1) every tracked path the sync DELETES is a path the sync REGENERATES", () => {
    const script = readFileSync(join(REPO, "scripts/sync-harness-agent-files.sh"), "utf8");
    const removed = pathsRemovedBy(script);
    expect(removed.length, "the script must still contain rm targets, or this clause is vacuous")
      .toBeGreaterThan(0);

    const rebuilt = directoriesRepopulatedBy(script);
    expect(rebuilt.length, "the script must still write symlinks, or this clause is vacuous")
      .toBeGreaterThan(0);

    const orphaned = trackedUnder(removed)
      .filter((f) => !rebuilt.some((dir) => f.startsWith(`${dir}/`)));

    expect(orphaned,
      `sync deletes tracked file(s) nothing regenerates: ${orphaned.slice(0, 15).join(", ")}`)
      .toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the expander actually finds tracked files when pointed at them", () => {
    // Refuses the vacuous pass. If `pathsRemovedBy` silently returned nothing, or `git ls-files`
    // were mis-invoked, clause (1) would be green about nothing. Point the same two helpers at a
    // directory known to be tracked and require a non-empty answer.
    const removed = pathsRemovedBy("rm -rf agents/rules/*.md 2>/dev/null || true");
    expect(removed.length, "glob expansion must resolve against the tree").toBeGreaterThan(5);
    expect(trackedUnder(removed).length, "these are tracked and the helper must say so")
      .toBeGreaterThan(5);
    // And the regeneration parser must not simply return everything, which would excuse any deletion.
    const dirs = directoriesRepopulatedBy(readFileSync(join(REPO, "scripts/sync-harness-agent-files.sh"), "utf8"));
    expect(dirs, "skills are NOT regenerated — if this set grows to cover them the clause is dead")
      .not.toContain(".claude/skills");
  });
});
