#!/usr/bin/env tsx
/**
 * Migrate a package from source-first exports to build-emitting (MADR 0033).
 *
 * Applies the pattern validated by the @cellix/provider-contracts pilot:
 *   1. tsconfig.json      -> emit declarations to dist/, EXCLUDE test files
 *   2. tsconfig.vitest.json -> re-include tests for typechecking (NOT optional:
 *      excluding tests from the build config silently drops them from typecheck)
 *   3. package.json       -> exports point at dist, add build script, typecheck via vitest config
 *
 * Idempotent: re-running on a migrated package is a no-op. Verification is the caller's job —
 * this script only rewrites config.
 *
 * Usage: tsx tools/openclinxr/migrate-package-to-build-emitting.ts <pkg-dir> [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_EXCLUDES = ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "dist"];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}
function writeJson(path: string, value: unknown, dry: boolean): void {
  if (dry) return;
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function migrate(pkgDir: string, dry = false): string[] {
  const notes: string[] = [];
  const tsconfigPath = join(pkgDir, "tsconfig.json");
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(tsconfigPath) || !existsSync(pkgPath)) return [`SKIP ${pkgDir}: missing tsconfig/package.json`];

  // 1. build tsconfig
  const ts = readJson(tsconfigPath);
  const co = (ts.compilerOptions ?? {}) as Record<string, unknown>;
  co.noEmit = false;
  co.declaration = true;
  co.declarationMap = true;
  co.outDir = "dist";
  co.rootDir = "src";
  ts.compilerOptions = co;
  ts.exclude = TEST_EXCLUDES;
  writeJson(tsconfigPath, ts, dry);
  notes.push("tsconfig.json: emit->dist, tests excluded");

  // 2. test typecheck config (the non-optional half)
  const vitestPath = join(pkgDir, "tsconfig.vitest.json");
  writeJson(vitestPath, {
    extends: "./tsconfig.json",
    compilerOptions: { noEmit: true },
    include: ["src/**/*.ts", "src/**/*.tsx"],
    exclude: ["dist"],
  }, dry);
  notes.push("tsconfig.vitest.json: tests re-included for typecheck");

  // 3. package.json
  const pkg = readJson(pkgPath);
  const exports = (pkg.exports ?? {}) as Record<string, unknown>;
  const rewritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "string" && value.startsWith("./src/")) {
      const base = value.replace(/^\.\/src\//, "").replace(/\.tsx?$/, "");
      rewritten[key] = { types: `./dist/${base}.d.ts`, default: `./dist/${base}.js` };
    } else {
      rewritten[key] = value;
    }
  }
  pkg.exports = rewritten;
  pkg.files = ["dist"];
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  scripts.build = "tsgo --build";
  if (scripts.typecheck) scripts.typecheck = "tsgo --noEmit -p tsconfig.vitest.json";
  pkg.scripts = scripts;
  writeJson(pkgPath, pkg, dry);
  notes.push("package.json: exports->dist, +build, typecheck->vitest config");
  return notes;
}

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error("usage: migrate-package-to-build-emitting.ts <pkg-dir> [--dry-run]");
  process.exit(1);
}
for (const note of migrate(dir, flags.includes("--dry-run"))) console.log(`  ${note}`);
