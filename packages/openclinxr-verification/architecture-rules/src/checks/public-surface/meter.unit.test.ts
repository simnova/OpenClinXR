import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declaredEntrypoints, resolveEntrypointSource } from "./resolve.js";
import { discoverConsumers } from "./consumers.js";
import { requireApplied, requireReviewedGroup } from "./gates.js";

/**
 * Unit-config entry to the public-surface meter: the same contract the archunit suite
 * runs, selectable through the `vitest run src/checks/public-surface` proof.
 */

function withTree(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "surface-unit-"));
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

const manifest = (name: string): string =>
  JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } });

describe("public-surface meter (unit entry)", () => {
  it("(12) COUNTERWEIGHT: absent groups fail without touching the tree", () => {
    withTree(
      {
        "packages/openclinxr/fixture-u/package.json": manifest("@openclinxr/fixture-u"),
        "packages/openclinxr/fixture-u/src/index.ts": "export const hello = 1;\n",
      },
      (root) => {
        expect(requireReviewedGroup(root, "psr-absent").ok).toBe(false);
        expect(requireApplied(root, "psr-absent").ok).toBe(false);
      },
    );
  });

  it("(13) declared entrypoints expose a source for built-output resolution", () => {
    withTree(
      {
        "packages/openclinxr/fixture-v/package.json": JSON.stringify({
          name: "@openclinxr/fixture-v",
          exports: {
            ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
            "./extra": { types: "./dist/extra.d.ts", default: "./dist/extra.js" },
          },
        }),
        "packages/openclinxr/fixture-v/src/index.ts": "export const hello = 1;\n",
        "packages/openclinxr/fixture-v/src/extra.ts": "export const more = 2;\n",
      },
      (root) => {
        const entries = declaredEntrypoints(root, "packages/openclinxr/fixture-v", "@openclinxr/fixture-v");
        expect(entries.map((entry) => entry.specifier)).toEqual([".", "./extra"]);
        for (const entry of entries) {
          expect(resolveEntrypointSource(root, entry) !== undefined, entry.specifier).toBe(true);
        }
      },
    );
  });

  it("(14) static, dynamic, require, re-export, and computed consumers are found", () => {
    withTree(
      {
        "packages/openclinxr/fixture-w/package.json": manifest("@openclinxr/fixture-w"),
        "packages/openclinxr/fixture-w/src/index.ts": "export const hello = 1;\n",
        "apps/consumer-a/static.ts": "import { hello } from '@openclinxr/fixture-w';\nconsole.log(hello);\n",
        "apps/consumer-a/dynamic.mts": "const mod = await import(\"@openclinxr/fixture-w\");\nconsole.log(mod);\n",
        "tools/consumer-b/using.cjs": "const mod = require('@openclinxr/fixture-w');\nconsole.log(mod);\n",
        "packages/openclinxr/other/src/re-export.ts": "export { hello } from \"@openclinxr/fixture-w\";\n",
        "apps/consumer-a/computed.js": "const mod = await import(\"@openclinxr/fixture-w\");\nconsole.log(mod[\"hello\"]);\n",
      },
      (root) => {
        const hits = discoverConsumers(root).get("@openclinxr/fixture-w") ?? [];
        const forms = new Set(hits.map((hit) => hit.form));
        for (const form of ["static", "dynamic", "require", "re-export", "computed"] as const) {
          expect(forms.has(form), form).toBe(true);
        }
      },
    );
  });
});
