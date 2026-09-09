import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unusedEntrypointExports } from "../checks/unused-entrypoint-exports.js";

/**
 * OBSERVABLE: the 42 packages under packages/openclinxr publish 2,931 symbols from their root
 * entrypoints, median 59 each. The CellixJS reference publishes a median of 2 and its widest
 * entrypoint publishes 44; ours publishes 220. The export-surface budget in this repo is 25 and
 * 31 of the 42 entrypoints exceed it.
 *
 * This gate does NOT enforce the shrink — export-surface-budgets.ts already ratchets that,
 * shrink-only, through per-package arch-ceiling.json. This proves the SEARCH that makes the shrink
 * affordable is honest about what it is: a marker check over identifier names, wrong in both
 * directions, whose proof is the compiler.
 *
 * Clause (4) asserts a KNOWN FALSE NEGATIVE on purpose. A limitation stated only in prose is not
 * enforced, and this repo has already paid for that: PROTO_VERIFY_DELEGATION reached 4,456 lines
 * of instruction that no test read. Written as a clause, the limitation fails loudly if someone
 * "fixes" the tool into claiming more than a name search can support.
 *
 * notEvidenceFor: that any listed symbol is safe to delete. Only pnpm packages:typecheck:agent,
 * the package's own suite, and the ui-xr and api suites establish that.
 */

function withFixture(
  files: Record<string, string>,
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "unused-exports-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const PKG = "packages/openclinxr/fixture-package";

describe("unused entrypoint exports", () => {
  it("(1) the live tree reports a real population, so the fixture clauses are not the whole gate", () => {
    const reports = unusedEntrypointExports();
    expect(reports.length).toBeGreaterThan(20);
    const published = reports.reduce((sum, r) => sum + r.published, 0);
    expect(published).toBeGreaterThan(1000);
    // Sorted largest-surface-first, which is the order a shrink campaign consumes it in.
    for (let i = 1; i < reports.length; i += 1) {
      expect(reports[i - 1]!.unreferencedOutside.length).toBeGreaterThanOrEqual(
        reports[i]!.unreferencedOutside.length,
      );
    }
  });

  it("(2) a symbol referenced OUTSIDE the package is not reported", () => {
    withFixture(
      {
        [`${PKG}/src/index.ts`]: "export const usedOutside = 1;\nexport const onlyInside = 2;\n",
        "apps/consumer/src/main.ts": 'import { usedOutside } from "@openclinxr/fixture-package";\nconsole.log(usedOutside);\n',
      },
      (root) => {
        const report = unusedEntrypointExports(root)[0];
        expect(report?.published).toBe(2);
        expect(report?.unreferencedOutside).toEqual(["onlyInside"]);
      },
    );
  });

  it("(3) COUNTERWEIGHT: a symbol used only inside its own package IS reported", () => {
    // Without this, a tool that reported nothing would satisfy clause (2) perfectly.
    withFixture(
      {
        [`${PKG}/src/index.ts`]: "export const onlyInside = 2;\n",
        [`${PKG}/src/other.ts`]: 'import { onlyInside } from "./index.js";\nconsole.log(onlyInside);\n',
      },
      (root) => {
        expect(unusedEntrypointExports(root)[0]?.unreferencedOutside).toEqual(["onlyInside"]);
      },
    );
  });

  it("(4) KNOWN FALSE NEGATIVE: a symbol reached only through a string is reported as unused", () => {
    // Recorded as a clause rather than a caveat. A name search cannot see a dynamic key, so a
    // worker acting on this list without the typecheck proof will delete a live export. If this
    // clause ever fails, the tool started claiming more than a name search supports and the
    // brief's "proof is the compiler" instruction has to be revisited with it.
    withFixture(
      {
        [`${PKG}/src/index.ts`]: "export const handlers = { reachedByKey: () => 1 };\nexport const reachedByKey = 1;\n",
        "apps/consumer/src/main.ts": 'const key = "reached" + "ByKey";\nconsole.log(key);\n',
      },
      (root) => {
        expect(unusedEntrypointExports(root)[0]?.unreferencedOutside).toContain("reachedByKey");
      },
    );
  });

  it("(5) KNOWN FALSE POSITIVE: an unrelated local of the same name marks a symbol used", () => {
    withFixture(
      {
        [`${PKG}/src/index.ts`]: "export const parse = 1;\n",
        "apps/consumer/src/main.ts": "const parse = (s: string) => s.trim();\nconsole.log(parse('x'));\n",
      },
      (root) => {
        expect(unusedEntrypointExports(root)[0]?.unreferencedOutside).toEqual([]);
      },
    );
  });
});
