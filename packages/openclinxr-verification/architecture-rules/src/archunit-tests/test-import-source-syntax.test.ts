import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entrypointReachableModules } from "../checks/test-import-surface.js";

/** A comment or a source-code string is not an executable module dependency.
 * Ordinary REDs recorded before scanner edits. Real imports and re-exports
 * remain unconditional positive controls; no ceiling or C1 assertion changes.
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
    withModules('import { value } from "./real.js";\nexport { value } from "./fixture.js";\nimport type { Shape } from \'./type.js\';\nimport \'./side-effect.js\';\nconst later = import("./dynamic.js");\n', (src) => {
      const reachable = entrypointReachableModules(src, new Set(["./index.js"]));
      expect(reachable.has(join(src, "real.ts"))).toBe(true);
      expect(reachable.has(join(src, "fixture.ts"))).toBe(true);
      expect(reachable.has(join(src, "type.ts"))).toBe(true);
      expect(reachable.has(join(src, "side-effect.ts"))).toBe(true);
      expect(reachable.has(join(src, "dynamic.ts"))).toBe(false);
    });
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
});
