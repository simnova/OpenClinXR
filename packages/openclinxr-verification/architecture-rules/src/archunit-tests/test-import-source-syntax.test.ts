import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entrypointReachableModules, publicEntrypoints } from "../checks/test-import-surface.js";

/** A comment or a source-code string is not an executable module dependency.
 * Ordinary REDs recorded before scanner edits. Real imports and re-exports
 * remain unconditional positive controls; no ceiling or C1 assertion changes.
 * MADR 0060 decision 10: literal dynamic imports count exactly like static ones.
 */
function withModules(body: string, check: (src: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "import-source-syntax-"));
  const src = join(root, "src");
  try {
    mkdirSync(src);
    writeFileSync(join(src, "index.ts"), body);
    for (const name of ["real", "comment", "fixture", "type", "side-effect", "dynamic"]) {
      writeFileSync(join(src, `${name}.ts`), "export const value = 1;\n");
    }
    check(src);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the import boundary measures declarations rather than quoted source", () => {
  it("retains real imports and export-from declarations in the reachable graph", () => {
    withModules('import { value } from "./real.js";\nexport { value } from "./fixture.js";\nimport type { Shape } from \'./type.js\';\nimport \'./side-effect.js\';\nconst later = await import("./dynamic.js");\n', (src) => {
      const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
      expect(reachable.has(join(src, "real.ts"))).toBe(true);
      expect(reachable.has(join(src, "fixture.ts"))).toBe(true);
      expect(reachable.has(join(src, "type.ts"))).toBe(true);
      expect(reachable.has(join(src, "side-effect.ts"))).toBe(true);
      expect(reachable.has(join(src, "dynamic.ts"))).toBe(true);
    });
  });

  it("follows a literal dynamic import of an internal module, including no-substitution template literals", () => {
    withModules('const a = await import("./dynamic.js");\nconst b = await import(`./real.js`);\n', (src) => {
      const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
      expect(reachable.has(join(src, "dynamic.ts"))).toBe(true);
      expect(reachable.has(join(src, "real.ts"))).toBe(true);
    });
  });

  it("does not follow a non-literal dynamic import into the reachable graph", () => {
    withModules(
      'const name = "./dynamic.js";\nconst a = await import(name);\nconst b = await import(`./${name}.js`);\nconst c = await import("@openclinxr/other");\nconst d = await import("node:fs");\n',
      (src) => {
        const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
        expect(reachable.has(join(src, "dynamic.ts"))).toBe(false);
        expect(reachable.has(join(src, "real.ts"))).toBe(false);
      },
    );
  });

  it("does not turn explanatory comments into executable dependencies", () => {
    withModules('/* Historical control: import { value } from "./comment.js"; */\n', (src) => {
      expect(entrypointReachableModules(src, new Set(["./index.js"])).has(join(src, "comment.ts"))).toBe(false);
    });
  });

  it("does not turn a quoted destructive source fixture into an executable dependency", () => {
    withModules("const control = 'import { value } from \"./fixture.js\";';\n", (src) => {
      expect(entrypointReachableModules(src, new Set(["./index.js"])).has(join(src, "fixture.ts"))).toBe(false);
    });
  });

  it("does not turn a commented or quoted dynamic import into an executable dependency", () => {
    withModules(
      '/* await import("./comment.js"); */\nconst fixture = \'await import("./fixture.js");\';\nconst quoted = "await import(\\"./dynamic.js\\")";\nconst backtick = "await import(`./dynamic.js`)";\n',
      (src) => {
        const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
        expect(reachable.has(join(src, "comment.ts"))).toBe(false);
        expect(reachable.has(join(src, "fixture.ts"))).toBe(false);
        expect(reachable.has(join(src, "dynamic.ts"))).toBe(false);
      },
    );
  });

  it("counts a test dynamic import of a reachable internal module, not the entrypoint or a private module", () => {
    const root = mkdtempSync(join(tmpdir(), "import-source-count-"));
    const src = join(root, "src");
    try {
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "index.ts"), 'export { value } from "./internal.js";\n');
      writeFileSync(join(src, "internal.ts"), "export const value = 1;\n");
      writeFileSync(join(src, "private.ts"), "export const hidden = 2;\n");
      const entrypoints = publicEntrypoints(JSON.stringify({ exports: { ".": "./dist/index.js" } }));
      const reachable = entrypointReachableModules(src, entrypoints);
      // A test `await import("./internal.js")` targets a reachable module: it counts as internal.
      expect(reachable.has(join(src, "internal.ts"))).toBe(true);
      // A test `await import("./index.js")` targets a declared entrypoint: public, not internal.
      expect(entrypoints.has("./index.js")).toBe(true);
      // A test `await import("./private.js")` targets nothing a consumer can see: it does not count.
      expect(reachable.has(join(src, "private.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
