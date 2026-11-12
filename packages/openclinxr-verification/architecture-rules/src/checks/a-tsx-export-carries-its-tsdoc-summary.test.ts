import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPackageAgentIndex, exportSummaries } from "./package-agent-index.js";

/**
 * A .tsx module re-exported through a ".js" specifier carries its TSDoc summary.
 *
 * summarySourceFiles resolved a re-export ".js" to ".ts" only and skipped any path not
 * ending ".ts", so a TSDoc on a declaration in a .tsx module never became an
 * exportSummaries entry (measured on ui-route-admin: exportSummaries {} for all "." names).
 * The resolver now tries ".ts" then ".tsx".
 */

const MANIFEST = JSON.stringify({ name: "@openclinxr/fixture-tsx" });

function withFixturePackage(
  files: Record<string, string>,
  run: (root: string, pkg: string) => void,
  pkg = "fixture-tsx",
): void {
  const root = mkdtempSync(join(tmpdir(), "tsx-summary-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, "packages", "openclinxr", pkg, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root, pkg);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("a tsx export carries its TSDoc summary", () => {
  it("resolves a .js re-export to the .tsx module's TSDoc", () => {
    withFixturePackage(
      {
        "package.json": MANIFEST,
        "src/index.ts": 'export { Foo } from "./foo.js";\n',
        "src/foo.tsx": "/** Foo renders the bar. */\nexport function Foo() { return null; }\n",
      },
      (root, pkg) => {
        const entry = join(root, "packages", "openclinxr", pkg, "src", "index.ts");
        expect(exportSummaries(entry)).toEqual({ Foo: "Foo renders the bar." });
        expect(buildPackageAgentIndex(pkg, root)?.exportSummaries).toEqual({
          Foo: "Foo renders the bar.",
        });
      },
    );
  });

  it("keeps the sibling .ts summary and lets the entrypoint re-export TSDoc win", () => {
    withFixturePackage(
      {
        "package.json": MANIFEST,
        "src/index.ts":
          'export { Foo } from "./foo.js";\n'
          + 'export { Helper } from "./helper.js";\n'
          + '/** Entry wins over the module. */\nexport { Qux } from "./qux.js";\n',
        "src/foo.tsx": "/** Foo renders the bar. */\nexport function Foo() { return null; }\n",
        "src/helper.ts": "/** Helps exactly once. */\nexport function Helper() { return null; }\n",
        "src/qux.ts": "/** Module says qux. */\nexport function Qux() { return null; }\n",
      },
      (root, pkg) => {
        const entry = join(root, "packages", "openclinxr", pkg, "src", "index.ts");
        const summaries = exportSummaries(entry);
        expect(summaries["Foo"]).toBe("Foo renders the bar.");
        expect(summaries["Helper"]).toBe("Helps exactly once.");
        expect(summaries["Qux"]).toBe("Entry wins over the module.");
      },
    );
  });

  it("prefers .ts when both bar.ts and bar.tsx exist", () => {
    withFixturePackage(
      {
        "package.json": MANIFEST,
        "src/index.ts": 'export { Bar } from "./bar.js";\n',
        "src/bar.ts": "/** Bar from ts. */\nexport function Bar() { return null; }\n",
        "src/bar.tsx": "/** Bar from tsx. */\nexport function Bar() { return null; }\n",
      },
      (root, pkg) => {
        const entry = join(root, "packages", "openclinxr", pkg, "src", "index.ts");
        expect(exportSummaries(entry)).toEqual({ Bar: "Bar from ts." });
      },
    );
  });
});
