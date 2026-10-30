/**
 * Areas of the root tools test suite. Each area is one cached turbo task
 * (`//#test:tools:<area>`); `pnpm //#test:tools` runs them all through turbo.
 *
 * The `serial-*` areas hold every test file whose value-import closure reaches
 * a shared machine slot, one pool per area so pools run concurrently:
 * `serial-browser` (compute-slots browser-capture pool, the slotted Playwright
 * wrapper, a Playwright launch, or a portless dev server), `serial-blender`
 * (Blender pool or Blender spawn, and no browser marker), `serial-spawn`
 * (only an interpreter spawn per test case). A file reaching both the browser
 * and the Blender pool is a `serial-browser` file; every `gpu`-pool acquirer
 * without a browser marker also lands in `serial-browser` so the size-1 gpu
 * pool serializes in a single area. Those files run one at a time so slot
 * queueing does not consume their test deadlines. Every other file runs with
 * Vitest's default workers.
 *
 * The classifier is static and errs towards `serial-*`: a false positive only
 * costs speed, a false negative brings back the slot-deadline failures.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importClosureOf, stripCommentsAndStrings } from "../evidence/browser-boot-inventory.js";

export type ToolsTestArea =
  | "serial-browser"
  | "serial-blender"
  | "serial-spawn"
  | "evidence"
  | "asset-pipeline"
  | "agent-factory"
  | "openclaw"
  | "misc";

/** The three serial pools. Each keeps --maxWorkers=1 --no-file-parallelism. */
export type SerialPool = "serial-browser" | "serial-blender" | "serial-spawn";

/** Turbo task order. `serial-browser` first: it is the longest pole. */
export const TOOLS_TEST_AREAS: readonly ToolsTestArea[] = [
  "serial-browser",
  "serial-spawn",
  "serial-blender",
  "evidence",
  "asset-pipeline",
  "agent-factory",
  "openclaw",
  "misc",
];

/** Every area that runs one file at a time (all three serial pools). */
export const SERIAL_AREAS: ReadonlySet<ToolsTestArea> = new Set<ToolsTestArea>([
  "serial-browser",
  "serial-blender",
  "serial-spawn",
]);

/** True for the one-at-a-time areas. */
export function isSerialArea(area: ToolsTestArea): boolean {
  return SERIAL_AREAS.has(area);
}

/** Path prefixes for the parallel areas. A file matching none is `misc`. */
const AREA_PREFIXES: ReadonlyArray<readonly [Exclude<ToolsTestArea, SerialPool>, string]> = [
  ["evidence", "tools/openclinxr/evidence/"],
  ["asset-pipeline", "tools/openclinxr/asset-pipeline/"],
  ["agent-factory", "tools/agent-factory/"],
  ["openclaw", "tools/openclinxr/openclaw/"],
];

export function isToolsTestArea(value: string): value is ToolsTestArea {
  return (TOOLS_TEST_AREAS as readonly string[]).includes(value);
}

export function pathAreaOf(repoRel: string): Exclude<ToolsTestArea, SerialPool> {
  for (const [area, prefix] of AREA_PREFIXES) {
    if (repoRel.startsWith(prefix)) return area;
  }
  return "misc";
}

/** Import specifier of the slotted Playwright wrapper (acquires browser-capture). */
const BROWSER_IMPORT_MARKERS: readonly RegExp[] = [
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["'][^"'\n]*slotted-playwright[^"'\n]*["']/,
];

/** Import specifier of the compute-slots package (pool named at the call site). */
const COMPUTE_SLOTS_IMPORT_MARKER: RegExp =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["'][^"'\n]*compute-slots[^"'\n]*["']/;

/** Pool-name literals at the acquisition call site (raw source: these live in strings). */
const BROWSER_POOL_CALL_MARKER: RegExp = /withComputeSlot(Sync)?\(\s*["']browser-capture["']/;
const BLENDER_POOL_CALL_MARKER: RegExp = /withComputeSlot(Sync)?\(\s*["']blender["']/;

/**
 * Checked in the test file only, not its closure: a test that itself spawns
 * python3/node/pnpm/npx/vitest per case spends seconds of CPU per case and
 * times out under parallel workers. Shared helpers that spawn once are fine.
 */
const TEST_FILE_SPAWN_MARKER = /\b(?:spawn|spawnSync|execFile|execFileSync|execa)\(\s*["'](?:python3?|node|pnpm|npx|vitest)["']/;
/** Code markers for the browser pool, matched after comments and strings are stripped. */
const BROWSER_CALL_MARKERS: readonly RegExp[] = [
  /chromium\.launch\w*\(/,
  /spawnPortlessDevServer\(/,
];
/** Code markers for the Blender pool, matched after comments and strings are stripped. */
const BLENDER_CALL_MARKERS: readonly RegExp[] = [
  /\b(?:spawn|spawnSync|execFile|execFileSync|execa|exec|execSync)\(\s*[\w.]*[Bb]lender/,
];
/**
 * A test that spawns tsx/node per case spends seconds of CPU per test; under
 * parallel workers those cases outrun their 5 s deadline (large-file-guard).
 */
const TSX_SPAWN_MARKER: RegExp =
  /\b(?:spawn|spawnSync|execFile|execFileSync|execa)\(\s*(?:TSX|tsx|process\.execPath)\b/;

/**
 * Workspace packages whose own source acquires a slot, split by pool. A
 * package whose tree reaches both pools (e.g. factory-stations) is a browser
 * package: the browser-capture pool (size 1) is the tightest, and the
 * browser+blender tie rule routes such files to `serial-browser` anyway.
 */
export function slotPackagePools(root: string): { browser: string[]; blender: string[] } {
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

  const browser: string[] = [];
  const blender: string[] = [];
  for (const [name, { srcDir }] of pkgs) {
    const marks = sourceTreeSlotMarks(srcDir);
    if (marks.browser) browser.push(name);
    else if (marks.blender) blender.push(name);
  }
  browser.sort();
  blender.sort();
  return { browser, blender };
}

/** Deprecated alias: every slot-owning package regardless of pool. */
export function slotPackageNames(root: string): string[] {
  const { browser, blender } = slotPackagePools(root);
  return [...browser, ...blender].sort();
}

/** Which pools a package source tree acquires. */
function sourceTreeSlotMarks(dir: string): { browser: boolean; blender: boolean } {
  const marks = { browser: false, blender: false };
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return marks;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      const sub = sourceTreeSlotMarks(full);
      marks.browser ||= sub.browser;
      marks.blender ||= sub.blender;
    } else if (/\.[cm]?[jt]sx?$/.test(e.name) && !/\.test\./.test(e.name)) {
      const file = fileSlotMarks(full, [], []);
      marks.browser ||= file.browser;
      marks.blender ||= file.blender;
    }
    if (marks.browser && marks.blender) return marks;
  }
  return marks;
}

interface FileSlotMarks {
  browser: boolean;
  blender: boolean;
  tsxSpawn: boolean;
}

const marksCache = new Map<string, FileSlotMarks>();

function packageImportHit(src: string, packageNames: readonly string[]): boolean {
  for (const name of packageNames) {
    if (src.includes(`"${name}"`) || src.includes(`'${name}'`) || src.includes(`"${name}/`) || src.includes(`'${name}/`)) {
      return true;
    }
  }
  return false;
}

/** Per-file slot markers. `browser`/`blender` cover acquisition; `tsxSpawn` the interpreter-spawn marker. */
function fileSlotMarks(
  file: string,
  browserPackages: readonly string[],
  blenderPackages: readonly string[],
): FileSlotMarks {
  const key = `${file}\0${browserPackages.length}\0${blenderPackages.length}`;
  const cached = marksCache.get(key);
  if (cached !== undefined) return cached;
  const out: FileSlotMarks = { browser: false, blender: false, tsxSpawn: false };
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    marksCache.set(key, out);
    return out;
  }
  const blenderPoolCall = BLENDER_POOL_CALL_MARKER.test(src);
  const computeSlotsImport = COMPUTE_SLOTS_IMPORT_MARKER.test(src);
  // A bare compute-slots import with no Blender call acquires some other
  // (size-1) pool or only reads status: keep it in serial-browser so every
  // gpu/ambiguous acquirer serializes in the same area. A Blender call site
  // in the same closure routes to serial-blender instead.
  out.browser =
    BROWSER_IMPORT_MARKERS.some((re) => re.test(src)) ||
    BROWSER_POOL_CALL_MARKER.test(src) ||
    (computeSlotsImport && !blenderPoolCall) ||
    packageImportHit(src, browserPackages);
  const stripped = stripCommentsAndStrings(src);
  if (!out.browser && BROWSER_CALL_MARKERS.some((re) => re.test(stripped))) out.browser = true;
  // The browser+blender tie rule: a file reaching both pools is a browser file.
  if (!out.browser) {
    out.blender =
      blenderPoolCall ||
      packageImportHit(src, blenderPackages) ||
      BLENDER_CALL_MARKERS.some((re) => re.test(stripped));
  }
  out.tsxSpawn = TSX_SPAWN_MARKER.test(stripped);
  marksCache.set(key, out);
  return out;
}

/**
 * Which serial pool a test file belongs in, or null when it runs parallel.
 * Tie rule: a file reaching both the browser and the Blender pool is a
 * `serial-browser` file. `serial-spawn` is only for files whose sole marker
 * is spawning an interpreter (test-file literal spawn or a tsx/node spawn in
 * the closure).
 */
export function serialPoolOf(
  absTestFile: string,
  browserPackages: readonly string[],
  blenderPackages: readonly string[],
): SerialPool | null {
  let testFileSpawn = false;
  try {
    testFileSpawn = TEST_FILE_SPAWN_MARKER.test(readFileSync(absTestFile, "utf8"));
  } catch {
    // unreadable: fall through to the closure scan
  }
  let browser = false;
  let blender = false;
  let tsxSpawn = false;
  for (const file of importClosureOf(absTestFile)) {
    const marks = fileSlotMarks(file, browserPackages, blenderPackages);
    browser ||= marks.browser;
    blender ||= marks.blender;
    tsxSpawn ||= marks.tsxSpawn;
    if (browser) break;
  }
  if (browser) return "serial-browser";
  if (blender) return "serial-blender";
  if (testFileSpawn || tsxSpawn) return "serial-spawn";
  return null;
}

/** True when the test file's value-import closure reaches a shared slot. */
export function usesSharedSlot(absTestFile: string, packageNames: readonly string[]): boolean {
  // Only the union matters for the boolean: pass every name as a browser
  // package so any mention counts, whichever pool it belongs to.
  try {
    if (TEST_FILE_SPAWN_MARKER.test(readFileSync(absTestFile, "utf8"))) return true;
  } catch {
    // unreadable: fall through to the closure scan
  }
  for (const file of importClosureOf(absTestFile)) {
    const marks = fileSlotMarks(file, packageNames, []);
    if (marks.browser || marks.blender || marks.tsxSpawn) return true;
  }
  return false;
}

/** Assign every manifest file to exactly one area. */
export function assignAreas(manifestRel: readonly string[], root: string): Map<string, ToolsTestArea> {
  const { browser, blender } = slotPackagePools(root);
  const out = new Map<string, ToolsTestArea>();
  for (const rel of manifestRel) {
    const pool = serialPoolOf(path.resolve(root, rel), browser, blender);
    out.set(rel, pool ?? pathAreaOf(rel));
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
