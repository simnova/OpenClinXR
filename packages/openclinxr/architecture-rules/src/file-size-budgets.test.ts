import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFreezeListHonesty } from "./checks/file-size-budgets.js";

/**
 * Non-git / missing-file fallbacks for freeze-list honesty. The index-vs-HEAD
 * ratchet lives in src/checks/the-ratchet-measures-what-is-being-committed.test.ts.
 * Unconditional working-tree reads are the CI-breaking cheap pass; these cases
 * only apply when git show of both index and HEAD fail (synthetic fixtures).
 */

const ZONE_BUDGETS = [{ prefix: "packages/openclinxr/", maxLines: 10 }] as const;
const REL = "packages/openclinxr/frozen-actor.ts";

function textWithLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `const n${i} = ${i};`).join("\n");
}

describe("file-size-budgets freeze honesty fallbacks", () => {
  it("non-git fixture: working-tree over-ceiling is reported (index/HEAD unavailable)", () => {
    const root = mkdtempSync(join(tmpdir(), "ratchet-nongit-"));
    mkdirSync(join(root, "packages", "openclinxr"), { recursive: true });
    writeFileSync(join(root, REL), textWithLines(25));
    const stale = checkFreezeListHonesty({
      workspaceRoot: root,
      zoneBudgets: ZONE_BUDGETS,
      sizeFreeze: { [REL]: { maxLines: 20, reason: "fixture" } },
    });
    expect(stale).toContain(
      `${REL}: freeze ceiling 20 is below actual 25 — impossible (ceilings only shrink as files shrink)`,
    );
  });

  it("missing freeze-list path is reported as a stale entry", () => {
    const root = mkdtempSync(join(tmpdir(), "ratchet-missing-"));
    mkdirSync(join(root, "packages", "openclinxr"), { recursive: true });
    const stale = checkFreezeListHonesty({
      workspaceRoot: root,
      zoneBudgets: ZONE_BUDGETS,
      sizeFreeze: { [REL]: { maxLines: 20, reason: "fixture" } },
    });
    expect(stale).toContain(`${REL}: file no longer exists — remove freeze entry`);
  });

  it("paid-down file at-or-under zone budget still requires freeze-entry removal", () => {
    const root = mkdtempSync(join(tmpdir(), "ratchet-paiddown-"));
    mkdirSync(join(root, "packages", "openclinxr"), { recursive: true });
    writeFileSync(join(root, REL), textWithLines(10));
    const stale = checkFreezeListHonesty({
      workspaceRoot: root,
      zoneBudgets: ZONE_BUDGETS,
      sizeFreeze: { [REL]: { maxLines: 20, reason: "fixture" } },
    });
    expect(stale).toContain(
      `${REL}: now 10 lines <= zone budget 10 — remove freeze entry (paid down! ratchet must tighten)`,
    );
  });
});
