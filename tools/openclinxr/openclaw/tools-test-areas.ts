/**
 * Areas of the root tools test suite. Each area is one cached turbo task
 * (`//#test:tools:<area>`); `pnpm //#test:tools` runs them all through turbo.
 *
 * The `serial` area holds every test file whose value-import closure reaches a
 * shared machine slot: the compute-slot pools (browser, Blender, GPU), a
 * Playwright launch, a portless dev server, or a Blender spawn, plus files
 * that spawn tsx/node per test case. Those files run
 * one at a time so slot queueing does not consume their test deadlines. Every
 * other file runs with Vitest's default workers.
 *
 * The classifier is static and errs towards `serial`: a false positive only
 * costs speed, a false negative brings back the slot-deadline failures.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importClosureOf, stripCommentsAndStrings } from "../evidence/browser-boot-inventory.js";

export type ToolsTestArea =
  | "serial"
  | "evidence"
  | "asset-pipeline"
  | "agent-factory"
  | "openclaw"
  | "misc";

/** Turbo task order. `serial` first: it is the longest pole. */
export const TOOLS_TEST_AREAS: readonly ToolsTestArea[] = [
  "serial",
  "evidence",
  "asset-pipeline",
  "agent-factory",
  "openclaw",
  "misc",
];

/** Path prefixes for the parallel areas. A file matching none is `misc`. */
const AREA_PREFIXES: ReadonlyArray<readonly [ToolsTestArea, string]> = [
  ["evidence", "tools/openclinxr/evidence/"],
  ["asset-pipeline", "tools/openclinxr/asset-pipeline/"],
  ["agent-factory", "tools/agent-factory/"],
  ["openclaw", "tools/openclinxr/openclaw/"],
];

export function isToolsTestArea(value: string): value is ToolsTestArea {
  return (TOOLS_TEST_AREAS as readonly string[]).includes(value);
}

export function pathAreaOf(repoRel: string): Exclude<ToolsTestArea, "serial"> {
  for (const [area, prefix] of AREA_PREFIXES) {
    if (repoRel.startsWith(prefix)) return area as Exclude<ToolsTestArea, "serial">;
  }
  return "misc";
}

/** Import specifiers of the slot package or the slotted Playwright wrapper. */
const SLOT_IMPORT_MARKERS: readonly RegExp[] = [
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["'][^"'\n]*(?:compute-slots|slotted-playwright)[^"'\n]*["']/,
];

/**
 * Checked in the test file only, not its closure: a test that itself spawns
 * python3/node/pnpm/npx/vitest per case spends seconds of CPU per case and
 * times out under parallel workers. Shared helpers that spawn once are fine.
 */
const TEST_FILE_SPAWN_MARKER = /\b(?:spawn|spawnSync|execFile|execFileSync|execa)\(\s*["'](?:python3?|node|pnpm|npx|vitest)["']/;
/** Code markers, matched after comments and strings are stripped. */
const SLOT_CALL_MARKERS: readonly RegExp[] = [
  /chromium\.launch\w*\(/,
  /spawnPortlessDevServer\(/,
  /\b(?:spawn|spawnSync|execFile|execFileSync|execa|exec|execSync)\(\s*[\w.]*[Bb]lender/,
  // A test that spawns tsx/node per case spends seconds of CPU per test; under
  // parallel workers those cases outrun their 5 s deadline (large-file-guard).
  /\b(?:spawn|spawnSync|execFile|execFileSync|execa)\(\s*(?:TSX|tsx|process\.execPath)\b/,
];

/**
 * Workspace packages whose own source acquires a slot. Importing any of these
 * by name marks a file serial. Dependents are not followed: a package that only
 * depends on a slot owner (e.g. through devDependencies) does not acquire a slot.
 */
export function slotPackageNames(root: string): string[] {
  const pkgs = new Map<string, { srcDir: string }>();
  const scan = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "package.json")) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
          name?: string;
        };
        if (pkg.name) {
          pkgs.set(pkg.name, { srcDir: path.join(dir, "src") });
        }
      } catch {
        // not a package
      }
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) scan(path.join(dir, e.name), depth + 1);
    }
  };
  scan(path.join(root, "packages"), 0);
  scan(path.join(root, "apps"), 0);

  const owners = new Set<string>();
  for (const [name, { srcDir }] of pkgs) {
    if (sourceTreeHasSlotMarker(srcDir)) owners.add(name);
  }
  return [...owners].sort();
}

function sourceTreeHasSlotMarker(dir: string): boolean {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && sourceTreeHasSlotMarker(full)) return true;
    } else if (/\.[cm]?[jt]sx?$/.test(e.name) && !/\.test\./.test(e.name)) {
      if (fileHasSlotMarker(full, [])) return true;
    }
  }
  return false;
}

const markerCache = new Map<string, boolean>();

function fileHasSlotMarker(file: string, packageNames: readonly string[]): boolean {
  const key = `${file}\0${packageNames.length}`;
  const cached = markerCache.get(key);
  if (cached !== undefined) return cached;
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    markerCache.set(key, false);
    return false;
  }
  let hit = SLOT_IMPORT_MARKERS.some((re) => re.test(src));
  if (!hit) {
    for (const name of packageNames) {
      if (src.includes(`"${name}"`) || src.includes(`'${name}'`) || src.includes(`"${name}/`) || src.includes(`'${name}/`)) {
        hit = true;
        break;
      }
    }
  }
  if (!hit) {
    const stripped = stripCommentsAndStrings(src);
    hit = SLOT_CALL_MARKERS.some((re) => re.test(stripped));
  }
  markerCache.set(key, hit);
  return hit;
}

/** True when the test file's value-import closure reaches a shared slot. */
export function usesSharedSlot(absTestFile: string, packageNames: readonly string[]): boolean {
  try {
    if (TEST_FILE_SPAWN_MARKER.test(readFileSync(absTestFile, "utf8"))) return true;
  } catch {
    // unreadable: fall through to the closure scan
  }
  for (const file of importClosureOf(absTestFile)) {
    if (fileHasSlotMarker(file, packageNames)) return true;
  }
  return false;
}

/** Assign every manifest file to exactly one area. */
export function assignAreas(manifestRel: readonly string[], root: string): Map<string, ToolsTestArea> {
  const packageNames = slotPackageNames(root);
  const out = new Map<string, ToolsTestArea>();
  for (const rel of manifestRel) {
    out.set(rel, usesSharedSlot(path.resolve(root, rel), packageNames) ? "serial" : pathAreaOf(rel));
  }
  return out;
}

/** Turbo task for an area; its package.json script is `test:tools:<area>`. */
export function turboTaskName(area: ToolsTestArea): string {
  return `//#test:tools:${area}`;
}

/** Inputs every area shares: the runner, its routing modules and the Vitest config. */
export const SHARED_TURBO_INPUTS: readonly string[] = [
  "tools/openclinxr/openclaw/run-tools-tests.ts",
  "tools/openclinxr/openclaw/tools-test-areas.ts",
  "tools/openclinxr/openclaw/project-test-scope.ts",
  "tools/openclinxr/evidence/browser-boot-inventory.ts",
  "tools/openclinxr/evidence/browser-boot-inventory/**",
  "packages/cellix/config-vitest/src/**",
  "vitest.config.ts",
  "tsconfig.tools-relaxed.json",
];

/**
 * Glob for one imported file. Directories are cut at depth 3 under tools/ and
 * depth 4 elsewhere (`packages/<group>/<pkg>/src/**`); a file shallower than
 * the cut is listed exactly so one top-level file does not pull in its tree.
 */
export function inputGlobFor(repoRel: string): string {
  const parts = repoRel.split("/");
  const cap = parts[0] === "tools" ? 3 : 4;
  if (parts.length - 1 < cap) return repoRel;
  return `${parts.slice(0, cap).join("/")}/**`;
}

/** Turbo inputs per area, from the relative-import closure of the area's files. */
export function areaTurboInputs(root: string, areas: Map<string, ToolsTestArea>): Map<ToolsTestArea, string[]> {
  const globs = new Map<ToolsTestArea, Set<string>>(TOOLS_TEST_AREAS.map((a) => [a, new Set(SHARED_TURBO_INPUTS)]));
  for (const [rel, area] of areas) {
    for (const abs of importClosureOf(path.resolve(root, rel))) {
      const fileRel = path.relative(root, abs).split(path.sep).join("/");
      if (fileRel.startsWith("..") || fileRel.split("/").includes("node_modules")) continue;
      globs.get(area)!.add(inputGlobFor(fileRel));
    }
  }
  const out = new Map<ToolsTestArea, string[]>();
  for (const [area, set] of globs) {
    const dirGlobs = [...set].filter((g) => g.endsWith("/**")).map((g) => g.slice(0, -2));
    // Drop exact files already covered by a directory glob.
    out.set(area, [...set].filter((g) => g.endsWith("/**") || !dirGlobs.some((d) => g.startsWith(d))).sort());
  }
  return out;
}

type TurboTask = { inputs?: string[]; [key: string]: unknown };
type TurboJson = { tasks: Record<string, TurboTask> };

/** Expected globs missing from turbo.json, as `task: glob` lines. */
export function checkTurboInputs(
  root: string,
  areas: Map<string, ToolsTestArea>,
  selected: readonly ToolsTestArea[],
): string[] {
  const turbo = JSON.parse(readFileSync(path.join(root, "turbo.json"), "utf8")) as TurboJson;
  const expected = areaTurboInputs(root, areas);
  const stale: string[] = [];
  for (const area of selected) {
    const task = turboTaskName(area);
    const have = new Set(turbo.tasks[task]?.inputs ?? []);
    if (turbo.tasks[task] === undefined) stale.push(`${task}: task missing`);
    for (const g of expected.get(area) ?? []) if (!have.has(g)) stale.push(`${task}: ${g}`);
  }
  return stale;
}

/** Rewrite the area tasks in turbo.json. Returns true when the file changed. */
export function syncTurboInputs(root: string, areas: Map<string, ToolsTestArea>): boolean {
  const file = path.join(root, "turbo.json");
  const before = readFileSync(file, "utf8");
  const turbo = JSON.parse(before) as TurboJson;
  const expected = areaTurboInputs(root, areas);
  const tasks: Record<string, TurboTask> = {};
  for (const [name, task] of Object.entries(turbo.tasks)) {
    if (name.startsWith("//#test:tools:")) continue;
    tasks[name] = task;
    if (name === "dev") {
      for (const area of TOOLS_TEST_AREAS) {
        tasks[turboTaskName(area)] = { cache: true, inputs: expected.get(area) ?? [], outputs: [] };
      }
    }
  }
  turbo.tasks = tasks;
  const after = `${JSON.stringify(turbo, null, 2)}\n`;
  if (after === before) return false;
  writeFileSync(file, after);
  return true;
}
