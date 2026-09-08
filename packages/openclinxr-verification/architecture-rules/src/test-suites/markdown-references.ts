import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBrokenReferenceFreezeIsHonest,
  checkMarkdownReferencesResolve,
  unresolvedReferences,
} from "../checks/markdown-references.js";

/**
 * Guards the failure class the green gates missed: content removed, pointers left behind.
 *
 * The live-tree assertions below prove the CURRENT state is clean. The fixture assertions prove the
 * detector can actually FAIL — a rule that cannot fail is worthless, and asserting an empty array
 * against a passing tree would pass just as happily if the checker returned nothing at all.
 */
export function describeMarkdownReferenceTests(): void {
  describe("markdown references resolve (shrink-only)", () => {
    it("adds no new unresolved references", () => {
      const violations = checkMarkdownReferencesResolve();
      expect(violations, violations.join("\n")).toEqual([]);
    });

    it("keeps the freeze honest — ceilings track actual and only shrink", () => {
      const violations = checkBrokenReferenceFreezeIsHonest();
      expect(violations, violations.join("\n")).toEqual([]);
    });
  });

  describe("markdown reference detector (fixture-level — proves it can fail)", () => {
    const withFixture = (body: string, run: (file: string) => void): void => {
      const dir = mkdtempSync(join(tmpdir(), "md-refs-"));
      const file = join(dir, "doc.md");
      writeFileSync(file, body);
      try {
        run(file);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it("flags a markdown link to a file that does not exist", () => {
      // The purge shape: the pointer survives, the target does not.
      withFixture("See [the plan](docs/openclinxr/deleted-thing.md) for detail.", (file) => {
        expect(unresolvedReferences(file)).toContain("docs/openclinxr/deleted-thing.md");
      });
    });

    it("flags a backticked path that does not exist", () => {
      withFixture("Successor is `docs/agent-ops/gone.md` now.", (file) => {
        expect(unresolvedReferences(file)).toContain("docs/agent-ops/gone.md");
      });
    });

    it("does NOT flag a bare filename in prose", () => {
      // An earlier ad-hoc version counted these and produced ~105 false positives, because a
      // filename mentioned in a sentence is not a pointer to follow.
      withFixture("The `AGENTS.md` contract and PROJECT_STATUS.md both matter.", (file) => {
        expect(unresolvedReferences(file)).toEqual([]);
      });
    });

    it("does NOT flag template placeholders, globs, or URLs", () => {
      withFixture(
        "See `docs/agent-ops/YYYY-MM-DD-review.md`, `docs/**/*.md`, and [spec](https://x.dev/a.md).",
        (file) => {
          expect(unresolvedReferences(file)).toEqual([]);
        },
      );
    });

    it("resolves a reference relative to the referring file, not only the workspace root", () => {
      const dir = mkdtempSync(join(tmpdir(), "md-refs-"));
      writeFileSync(join(dir, "sibling.md"), "target");
      writeFileSync(join(dir, "doc.md"), "See [sibling](sibling.md).");
      try {
        expect(unresolvedReferences(join(dir, "doc.md"))).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
