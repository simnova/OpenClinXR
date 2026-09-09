import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test import surface (ArchUnit-style; "a package's own tests use its public entrypoint").
 *
 * WHY: a co-located test that imports `../thing.js` pins `thing.ts` as if it were public.
 * The package can no longer rename, merge or delete it without editing tests, which is the
 * exact "evolve without upstream impact" property the packages were carved out to gain.
 * MEASURED 2026-09-07 across 40 packages with tests: 252 imports reach an internal module
 * against 122 that go through a declared entrypoint. Seven packages are already at zero.
 *
 * This replaces a more expensive idea. A sidecar `<package>-verification` package per package
 * was considered and rejected: the measured test contention is many workers editing the SAME
 * test file inside one package (four motion-compiler tests alone carry 40 excess-writer
 * events), so relocating those files moves the collision without removing it, at a cost of
 * ~143 lines of scaffolding and a pnpm-lock.yaml entry per package — and the lockfile is
 * itself the #3 serialization point. The coupling is the real defect; this rule is the cheap
 * way to gate it.
 *
 * PUBLIC means: the module a declared `exports` entry in package.json points at, plus
 * `./index.js`. A package with subpath exports may legitimately import each of them.
 *
 * AN INTERNAL IMPORT COUNTS ONLY WHEN THE MODULE IS REACHABLE FROM AN ENTRYPOINT (2026-09-08).
 * The harm above is "pins thing.ts AS IF IT WERE PUBLIC". If `thing.ts` is genuinely private —
 * nothing re-exports it from a declared entrypoint — a test importing it pins nothing a consumer
 * can see, and the package stays free to rename or merge it, because only its own tests refer to
 * it. When the module IS reachable, the test could have used the public path and should.
 *
 * This was found as a DEADLOCK, not as a preference. export-surface-budgets.ts ratchets entrypoint
 * exports down, shrink-only; this rule ratchets internal test imports down, shrink-only. A package
 * whose tests exercise an internal module could satisfy neither: removing the symbol from the
 * entrypoint broke the test, and repointing the test at the module raised this count. Measured on
 * capability-gateway (119 exports, testInternalImports ceiling 1) and shared-schemas (107, 1).
 *
 * MEASURED BEFORE THE CHANGE, so the rule is not being quietly gutted: of 234 internal test
 * imports across the tree, 206 target a module still reachable from an entrypoint and keep
 * counting; 28 stop. The rule retains 88% of its force and clause (5) of its test freezes that.
 *
 * CEILINGS ARE PER-PACKAGE AND GENERATED, sharing arch-ceiling.json with the context budget.
 * See checks/context-field-budgets.ts for why: the two hand-edited freeze tables in this
 * package are the most contended source files in the repo, because every slice edits both.
 */

export const CEILING_FILENAME = "arch-ceiling.json";

export type TestImportMeasurement = { pkg: string; internal: number; public: number };

function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

function collectExportTargets(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    into.add(value.replace(/^\.\/(?:dist|src)\//u, "./").replace(/\.d\.ts$/u, ".js"));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectExportTargets(nested, into);
    }
  }
}

/** The set of `./…js` specifiers a package declares as public, always including ./index.js. */
export function publicEntrypoints(packageJsonText: string): Set<string> {
  const out = new Set<string>(["./index.js"]);
  try {
    collectExportTargets((JSON.parse(packageJsonText) as { exports?: unknown }).exports, out);
  } catch {
    // A package.json we cannot parse contributes no entrypoints; the default still stands.
  }
  return out;
}

function walkTests(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules$|[/\\]dist$/.test(full)) walkTests(full, out);
      continue;
    }
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every module reachable from a package's declared entrypoints, as absolute .ts paths. A test
 * importing one of these could have used the public path; a test importing anything else is
 * reaching for something no consumer can see.
 */
export function entrypointReachableModules(src: string, entrypoints: ReadonlySet<string>): Set<string> {
  const reachable = new Set<string>();
  for (const entrypoint of entrypoints) {
    const file = join(src, entrypoint.replace(/^\.\//u, "").replace(/\.js$/u, ".ts"));
    const stack = [file];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || reachable.has(current) || !existsSync(current)) continue;
      reachable.add(current);
      for (const match of readFileSync(current, "utf8").matchAll(/from "(\.[^"]+)"/gu)) {
        stack.push(normalize(join(dirname(current), (match[1] ?? "").replace(/\.js$/u, ".ts"))));
      }
    }
  }
  return reachable;
}

/** Per package: how many relative imports in its own tests reach a module it does not export. */
export function measureTestImports(): TestImportMeasurement[] {
  const root = findWorkspaceRoot();
  const packagesRoot = join(root, "packages", "openclinxr");
  const out: TestImportMeasurement[] = [];
  if (!existsSync(packagesRoot)) return out;
  for (const pkg of readdirSync(packagesRoot)) {
    const src = join(packagesRoot, pkg, "src");
    const manifest = join(packagesRoot, pkg, "package.json");
    if (!existsSync(src) || !existsSync(manifest)) continue;
    const entrypoints = publicEntrypoints(readFileSync(manifest, "utf8"));
    const reachable = entrypointReachableModules(src, entrypoints);
    let internal = 0;
    let publicCount = 0;
    for (const test of walkTests(src, [])) {
      const text = readFileSync(test, "utf8");
      for (const match of text.matchAll(/from "(\.[^"]+)"/gu)) {
        const spec = match[1] ?? "";
        const target = normalize(join(dirname(test), spec));
        const rel = `./${relative(src, target).replaceAll("\\", "/")}`;
        if (entrypoints.has(rel)) {
          publicCount += 1;
          continue;
        }
        // Only a module a consumer could also reach is "pinned as if public".
        if (reachable.has(target.replace(/\.js$/u, ".ts"))) internal += 1;
      }
    }
    if (internal > 0 || publicCount > 0) out.push({ pkg, internal, public: publicCount });
  }
  return out.sort((a, b) => b.internal - a.internal);
}

export type TestImportCeiling = { testInternalImports?: number };

export function readTestImportCeiling(pkg: string): TestImportCeiling | null {
  const file = join(findWorkspaceRoot(), "packages", "openclinxr", pkg, CEILING_FILENAME);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as TestImportCeiling;
}

export type TestImportViolation = { pkg: string; detail: string };

/**
 * One violation per package whose tests reach further into internals than its ceiling allows,
 * and one per ceiling that sits above the measurement (the ratchet only tightens). A package
 * with no ceiling entry must be at zero.
 */
export function checkTestImportSurface(
  measurements: readonly TestImportMeasurement[] = measureTestImports(),
  ceilingFor: (pkg: string) => TestImportCeiling | null = readTestImportCeiling,
): TestImportViolation[] {
  const violations: TestImportViolation[] = [];
  for (const m of measurements) {
    const ceiling = ceilingFor(m.pkg)?.testInternalImports;
    if (ceiling === undefined) {
      if (m.internal > 0) {
        violations.push({
          pkg: m.pkg,
          detail:
            `packages/openclinxr/${m.pkg}: ${m.internal} test import(s) reach a module the package does not ` +
            "export, with no ceiling. A test that imports an internal module pins it as if it were public, " +
            "so the package can no longer rename or merge it without editing tests — the opposite of the " +
            "reason it was extracted. FIX: import through the package's entrypoint, or add the module to " +
            "`exports` if it is genuinely public. Do NOT add a ceiling by hand; run pnpm arch:ceilings.",
        });
      }
      continue;
    }
    if (m.internal > ceiling) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: test internal imports rose to ${m.internal} > ceiling ${ceiling}. ` +
          "Ceilings only shrink — route the new test through the entrypoint.",
      });
      continue;
    }
    if (ceiling > m.internal) {
      violations.push({
        pkg: m.pkg,
        detail:
          `packages/openclinxr/${m.pkg}: ceiling ${ceiling} is above the measured ${m.internal} — the rot was ` +
          "fixed but the ceiling was not lowered. Run pnpm arch:ceilings.",
      });
    }
  }
  return violations;
}
