import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Diagnosis (IMMUTABLE) — BothyBoard tsk_3d58a7161a0a9bee.
 *
 * `pnpm packages:build` failed on the Azure Functions tsdown graph:
 *   RolldownError, plugin tsdown:deps
 *   tinyglobby / fdir / picomatch not in deps.onlyBundle
 *   Imported by tools/agent-factory/lib.ts (via tinyglobby)
 *
 * Three production sources load tools/ through a string assigned to a const, then
 * `await import(specifier)`, commented as deliberately non-static so the default
 * build graph stays tools-free. Rolldown constant-folds the literal and resolves
 * it anyway. Measured 2026-09-04 in this worktree: dropping `@vite-ignore` on
 * `world-compile-routes.ts` reintroduced the RolldownError for fdir, picomatch,
 * and tinyglobby imported by tinyglobby/dist/index.mjs.
 *
 * Adding those names to `onlyBundle` is the error's own suggestion and the
 * card's named counterweight: it would ship a filesystem globber into the
 * deploy artifact that 72bd8601 existed to shrink.
 *
 * Known-good: `await import(/* @vite-ignore *\/ specifier)` (d0aad7b1, also
 * `scenario-promotion-io.ts:307`).
 *
 * ## FIXED (tsk_3d58a7161a0a9bee)
 * Gate the two properties that actually keep the globber out: `@vite-ignore` on
 * every tools/ dynamic import in production sources, and `onlyBundle` refusing
 * tinyglobby/fdir/picomatch. Bundle size on origin/main after packages:build:
 * deploy/dist/index.js = 1,006,100 B (globber string refs 0). A later fix that
 * grows the artifact to include the globber is the wrong fix even if green.
 */

const apiSrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const GLOBBER_PACKAGES = ["tinyglobby", "fdir", "picomatch"] as const;

function productionSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

function findToolsImportViolations(text: string, label: string): string[] {
  const violations: string[] = [];
  const toolsConsts = new Map<string, string>();
  for (const m of text.matchAll(/\bconst\s+(\w+)\s*=\s*["'`]((?:\.\.\/)+tools\/[^"'`]+)["'`]/g)) {
    const name = m[1];
    const spec = m[2];
    if (name && spec) toolsConsts.set(name, spec);
  }
  for (const match of text.matchAll(/await import\(([^)]+)\)/g)) {
    const arg = match[1] ?? "";
    const hasIgnore = arg.includes("@vite-ignore");
    const ident = arg.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const toolsPath = toolsConsts.get(ident);
    const inlineTools = /["'`](?:\.\.\/)+tools\//.test(arg);
    if ((toolsPath || inlineTools) && !hasIgnore) {
      violations.push(
        `${label}: await import(${arg.trim()}) pulls ${toolsPath ?? "inline tools/"} without @vite-ignore`,
      );
    }
  }
  return violations;
}

describe("Azure Functions bundle must not pull tinyglobby", () => {
  it("flags the measured leak (const tools specifier + import without @vite-ignore)", () => {
    const leak = `
      const compileSpecifier = "../../../tools/openclinxr/factory/encounter-materialization-compile.js";
      const compileModule = (await import(compileSpecifier)) as WorldCompileModule;
    `;
    expect(findToolsImportViolations(leak, "probe")).toEqual([
      "probe: await import(compileSpecifier) pulls ../../../tools/openclinxr/factory/encounter-materialization-compile.js without @vite-ignore",
    ]);
  });

  it("keeps @vite-ignore on every tools/ dynamic import in production sources", () => {
    const violations: string[] = [];
    for (const file of productionSourceFiles(apiSrcRoot)) {
      violations.push(
        ...findToolsImportViolations(readFileSync(file, "utf8"), path.relative(apiSrcRoot, file)),
      );
    }
    expect(violations).toEqual([]);
  });

  it("does not list filesystem globbers in onlyBundle (counterweight)", async () => {
    const { openClinXrAzureFunctionsTsdownConfig } = await import("../tsdown.config.js");
    const only = openClinXrAzureFunctionsTsdownConfig.deps?.onlyBundle;
    const names = Array.isArray(only) ? only.filter((item): item is string => typeof item === "string") : [];
    for (const pkg of GLOBBER_PACKAGES) {
      expect(names).not.toContain(pkg);
    }
  });
});
