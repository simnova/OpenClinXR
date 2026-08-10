/**
 * Static browser-boot inventory for test files under `tools/` (issue #284).
 *
 * WHY THIS EXISTS
 * ---------------
 * #284 observed a geometry-only slice (issue-282) running ~35 node processes and
 * ~30 headless Chrome shells, load 61. The dev-server / browser class was never
 * gated the way #273 gated TRELLIS live bakes (`TRELLIS_LIVE_BAKE_OPT_IN`).
 *
 * This module answers the measurement question of #284 STATICALLY: which
 * `*.test.ts` files under `tools/` transitively reach a browser-booting
 * primitive, which of them are excluded from the default `//#test:tools` suite,
 * and whether each acquires its own browser/server or would receive a shared one.
 *
 * The two primitives measured (per the issue scope):
 *   - `spawnPortlessDevServer`  — lib/portless-server.ts; spawns a `pnpm --filter
 *     <pkg> dev:portless` Vite server, one process per call, no process-wide
 *     singleton.
 *   - `chromium.launch(`        — playwright; one headless Chrome shell per call.
 *
 * PURE STATIC SCAN. Reads source files only; spawns nothing, boots nothing.
 * The import graph follows VALUE imports (type-only imports are erased at
 * runtime and cannot boot anything). Call detection strips comments and string
 * literals so prose like "Prefer spawnPortlessDevServer() …" does not count.
 *
 * The definition site `lib/portless-server.ts` is excluded from caller
 * detection — it defines the function; it is not a caller.
 *
 * OUTPUT
 * ------
 * `buildBrowserBootInventory()` returns the full inventory. Running this file
 * directly writes `.openclinxr/evidence/issue-284/pre-fix.json` (the frozen
 * measurement artifact) and prints a one-line summary:
 *
 *   pnpm exec tsx tools/openclinxr/evidence/browser-boot-inventory.ts --write
 *
 * The companion test `browser-boot-inventory.test.ts` re-runs the scan and
 * fails when the recorded set no longer matches (staleness guard), so adding a
 * new browser-booting test without regenerating the inventory reds loudly
 * instead of silently drifting.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRIMITIVES = {
  server: "spawnPortlessDevServer",
  browser: "chromium.launch",
} as const;

/** Definition site of spawnPortlessDevServer — never a caller. */
const SERVER_DEFINITION_FILE = path.join("tools", "openclinxr", "evidence", "lib", "portless-server.ts");

const PACKAGE_JSON_NAME = "package.json";
const TEST_TOOLS_SCRIPT_KEY = "//#test:tools";

export type AcquisitionMode = "own" | "shared";

export type BrowserBootInventoryRow = {
  /** Repo-relative path of the test file. */
  testFile: string;
  /** True when the file is excluded from the default `//#test:tools` suite. */
  excludedFromTestTools: boolean;
  /**
   * "own"    — a module in this test's value-import closure launches its own
   *            browser/server when the test runs (one per vitest worker process).
   * "shared" — the test would receive a process-wide instance; no module in its
   *            closure launches one. RESERVED: no process-wide singleton exists
   *            in this repo today, so no row is "shared" yet.
   */
  acquisitionMode: AcquisitionMode;
  /** Closure contains a module that calls spawnPortlessDevServer(. */
  ownsServer: boolean;
  /** Closure contains a module that calls chromium.launch(. */
  ownsBrowser: boolean;
  /** Distinct repo modules in the value-import closure of the test file. */
  closureSize: number;
  /**
   * Modules directly value-imported by the TEST FILE that call a primitive.
   * This is the invoked-path estimate: the test's own capture module.
   */
  directLaunchers: string[];
  /** Every closure module that calls a primitive (static upper bound). */
  launcherModules: string[];
  /** spawnPortlessDevServer( occurrences across launcherModules (upper bound). */
  closureServerCallSites: number;
  /** chromium.launch( occurrences across launcherModules (upper bound). */
  closureBrowserCallSites: number;
  /** spawnPortlessDevServer( occurrences across directLaunchers (invoked path). */
  invokedPathServerCallSites: number;
  /** chromium.launch( occurrences across directLaunchers (invoked path). */
  invokedPathBrowserCallSites: number;
};

export type TestToolsExclusion = {
  testFile: string;
  /** One-line reason this file was excluded, read from its header/module. */
  reason: string;
};

export type BrowserBootInventory = {
  generatedAt: string;
  method: string;
  primitives: string[];
  totalTestFiles: number;
  browserBootingTestFiles: number;
  excludedAmongBrowserBooting: number;
  /** Minimum browsers a single //#test:tools run boots: one per browser-owning file. */
  minBrowsersPerSuiteRun: number;
  /** Minimum dev servers a single //#test:tools run boots: one per server-owning file. */
  minServersPerSuiteRun: number;
  /** Sum of closureBrowserCallSites — static worst case. */
  staticUpperBoundBrowsers: number;
  /** Sum of closureServerCallSites — static worst case. */
  staticUpperBoundServers: number;
  rows: BrowserBootInventoryRow[];
  /** The 13 files already excluded from //#test:tools — the known-good precedent. */
  testToolsExclusions: TestToolsExclusion[];
};

/** Known-good column: why each of the 13 existing excludes was excluded (read from source). */
export const TEST_TOOLS_EXCLUSION_REASONS: Readonly<Record<string, string>> = {
  "tools/openclinxr/evidence/blueprint-voice-simulation-spike.test.ts":
    "voice-simulation SPIKE (unproven lane-C class); builds external-provider voice simulation plans",
  "tools/openclinxr/evidence/check-github-pages-site.test.ts":
    "validates the LIVE GitHub Pages site — network-dependent",
  "tools/openclinxr/evidence/iwsdk-evidence-contract-check.test.ts":
    "IWSDK sidecar MCP tooling inventory — execs the IWSDK toolchain",
  "tools/openclinxr/evidence/iwsdk-workspace-posture-check.test.ts":
    "IWSDK workspace posture report — execs the IWSDK toolchain",
  "tools/openclinxr/evidence/model-vetting-actor-player-runtime-evidence.test.ts":
    "model-vetting runtime evidence class — asserts on docs snapshots of hardware/headset-gated evidence",
  "tools/openclinxr/evidence/model-vetting-capture-manifest.test.ts":
    "model-vetting capture manifest — asserts on gitignored cagematch artifacts absent in worktrees",
  "tools/openclinxr/evidence/model-vetting-runtime-hook-bindings.test.ts":
    "model-vetting runtime hook bindings evidence — docs-snapshot assertions",
  "tools/openclinxr/evidence/model-vetting-runtime-mapping-evidence.test.ts":
    "model-vetting runtime mapping evidence — docs-snapshot assertions",
  "tools/openclinxr/factory/encounter-asset-generation-queue.test.ts":
    "factory asset-generation QUEUE — orchestrates character/animation/environment generation and asset-bake (the #273 class)",
  "tools/openclinxr/factory/encounter-publication-payloads.test.ts":
    "heavy factory publication-payload path",
  "tools/openclinxr/factory/encounter-runtime-selection-review-packet.test.ts":
    "runtime selection review packet — exercises persistTurnsToMongo (MongoDB persistence)",
  "tools/openclinxr/factory/publish-generated-learner-runtime-bundle.test.ts":
    "publishes a generated learner runtime bundle — heavy build/package path",
  "tools/openclinxr/openclaw/agentic-hook-runner.test.ts":
    "runs the real agentic hook stack — expensive/recursive",
};

export function findRepoRoot(startDir: string = fileURLToPath(new URL(".", import.meta.url))): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, PACKAGE_JSON_NAME);
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { scripts?: Record<string, string> };
        if (typeof pkg.scripts?.[TEST_TOOLS_SCRIPT_KEY] === "string") return dir;
      } catch {
        // fall through to parent
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("browser-boot-inventory: repo root (package.json with //#test:tools) not found");
    dir = parent;
  }
}

/** Parse the 13 `--exclude` paths out of the `//#test:tools` script. */
export function parseTestToolsExcludes(root: string): string[] {
  const pkg = JSON.parse(readFileSync(path.join(root, PACKAGE_JSON_NAME), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = pkg.scripts?.[TEST_TOOLS_SCRIPT_KEY] ?? "";
  const excludes: string[] = [];
  for (const m of script.matchAll(/--exclude\s+(\S+)/g)) {
    const value = m[1];
    if (value !== undefined) excludes.push(value);
  }
  return [...new Set(excludes)];
}

type DirEntry = { name: string; kind: "file" | "dir" };

function listDir(dir: string): DirEntry[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((d) =>
      d.isDirectory()
        ? { name: d.name, kind: "dir" as const }
        : { name: d.name, kind: "file" as const },
    );
  } catch {
    return [];
  }
}

function walkTestFiles(dir: string, acc: string[] = []): string[] {
  for (const ent of listDir(dir)) {
    const full = path.join(dir, ent.name);
    if (ent.kind === "dir") {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
      walkTestFiles(full, acc);
    } else if (ent.name.endsWith(".test.ts") || ent.name.endsWith(".test.tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Extract relative import specifiers, split into value-imports and type-only imports. */
export function extractRelativeImports(src: string): { value: string[]; type: string[] } {
  const value = new Set<string>();
  const type = new Set<string>();
  // import ... from "..." / export ... from "..."
  const fromRe = /(?:^|[;\n}])\s*(?:import|export)\s+([^;]*?)\s+from\s+["'](\.[^"']+)["']/g;
  for (const m of src.matchAll(fromRe)) {
    const clause = (m[1] ?? "").trim();
    const spec = m[2];
    if (spec === undefined) continue;
    if (/^type(?:\s|[{*])/.test(clause)) {
      type.add(spec);
    } else {
      value.add(spec);
    }
  }
  // side-effect import: import "./x"
  const sideEffectRe = /(?:^|[;\n}])\s*import\s+["'](\.[^"']+)["']/g;
  for (const m of src.matchAll(sideEffectRe)) {
    const spec = m[1];
    if (spec !== undefined) value.add(spec);
  }
  // dynamic import: import("./x")
  const dynamicRe = /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const m of src.matchAll(dynamicRe)) {
    const spec = m[1];
    if (spec !== undefined) value.add(spec);
  }
  return { value: [...value], type: [...type] };
}

export function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const clean = spec.split(/[?#]/)[0] ?? "";
  if (clean === "." || clean === "..") return null;
  const base = path.resolve(path.dirname(fromFile), clean);
  const candidates: string[] = [];
  const ext = path.extname(base);
  if (ext === "") {
    candidates.push(base + ".ts", base + ".tsx", base + ".mts", base + ".cts", base + ".js");
  } else if (ext === ".js") {
    candidates.push(base, base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  } else if (ext === ".jsx") {
    candidates.push(base, base.slice(0, -4) + ".tsx");
  } else {
    candidates.push(base);
  }
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      // ignore
    }
  }
  try {
    if (existsSync(base) && statSync(base).isDirectory()) {
      for (const idx of [path.join(base, "index.ts"), path.join(base, "index.js"), path.join(base, "index.tsx")]) {
        if (existsSync(idx)) return idx;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Transitive closure over VALUE imports only (type imports cannot boot anything). */
export function importClosureOf(startFile: string): Set<string> {
  const seen = new Set<string>();
  const stack = [startFile];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { value } = extractRelativeImports(src);
    for (const spec of value) {
      const resolved = resolveImport(file, spec);
      if (resolved !== null) stack.push(resolved);
    }
  }
  return seen;
}

/** Remove string literals and comments so call detection does not fire on prose. */
export function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gs, "``")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

type LauncherAnalysis = {
  launcherModules: string[];
  serverCallSites: number;
  browserCallSites: number;
};

function analyzeClosure(closure: Set<string>, root: string): LauncherAnalysis {
  const launcherModules: string[] = [];
  let serverCallSites = 0;
  let browserCallSites = 0;
  for (const file of closure) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === SERVER_DEFINITION_FILE) continue;
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const stripped = stripCommentsAndStrings(src);
    const servers = countOccurrences(stripped, `${PRIMITIVES.server}(`);
    const browsers = countOccurrences(stripped, `${PRIMITIVES.browser}(`);
    if (servers === 0 && browsers === 0) continue;
    launcherModules.push(rel);
    serverCallSites += servers;
    browserCallSites += browsers;
  }
  return { launcherModules, serverCallSites, browserCallSites };
}

function directLaunchersOf(testFile: string, launcherSet: Set<string>): string[] {
  let src: string;
  try {
    src = readFileSync(testFile, "utf8");
  } catch {
    return [];
  }
  const { value } = extractRelativeImports(src);
  const direct = new Set<string>();
  for (const spec of value) {
    const resolved = resolveImport(testFile, spec);
    if (resolved !== null && launcherSet.has(resolved)) direct.add(resolved);
  }
  return [...direct].sort();
}

export function buildBrowserBootInventory(root: string = findRepoRoot()): BrowserBootInventory {
  const testFiles = walkTestFiles(path.join(root, "tools")).sort();
  const excludes = new Set(parseTestToolsExcludes(root).map((p) => p.split(path.sep).join("/")));
  const rows: BrowserBootInventoryRow[] = [];
  for (const tf of testFiles) {
    const rel = path.relative(root, tf).split(path.sep).join("/");
    const closure = importClosureOf(tf);
    const analysis = analyzeClosure(closure, root);
    const ownsServer = analysis.serverCallSites > 0;
    const ownsBrowser = analysis.browserCallSites > 0;
    if (!ownsServer && !ownsBrowser) continue;
    const launcherSet = new Set(analysis.launcherModules.map((p) => path.join(root, p.split("/").join(path.sep))));
    const direct = directLaunchersOf(tf, launcherSet);
    let invokedServer = 0;
    let invokedBrowser = 0;
    for (const dl of direct) {
      let src: string;
      try {
        src = readFileSync(dl, "utf8");
      } catch {
        continue;
      }
      const stripped = stripCommentsAndStrings(src);
      invokedServer += countOccurrences(stripped, `${PRIMITIVES.server}(`);
      invokedBrowser += countOccurrences(stripped, `${PRIMITIVES.browser}(`);
    }
    rows.push({
      testFile: rel,
      excludedFromTestTools: excludes.has(rel),
      acquisitionMode: "own",
      ownsServer,
      ownsBrowser,
      closureSize: closure.size,
      directLaunchers: direct.map((p) => path.relative(root, p).split(path.sep).join("/")),
      launcherModules: analysis.launcherModules,
      closureServerCallSites: analysis.serverCallSites,
      closureBrowserCallSites: analysis.browserCallSites,
      invokedPathServerCallSites: invokedServer,
      invokedPathBrowserCallSites: invokedBrowser,
    });
  }
  const testToolsExclusions: TestToolsExclusion[] = parseTestToolsExcludes(root)
    .sort()
    .map((testFile) => ({
      testFile,
      reason: TEST_TOOLS_EXCLUSION_REASONS[testFile] ?? "reason not recorded — read the file header",
    }));
  return {
    generatedAt: new Date().toISOString(),
    method:
      "static import-graph scan of tools/**/*.test.ts; value imports only; call detection after stripping comments and string literals",
    primitives: [
      `${PRIMITIVES.server} (lib/portless-server.ts — boots a Vite dev server)`,
      `${PRIMITIVES.browser} (playwright — boots a headless Chrome shell)`,
    ],
    totalTestFiles: testFiles.length,
    browserBootingTestFiles: rows.length,
    excludedAmongBrowserBooting: rows.filter((r) => r.excludedFromTestTools).length,
    minBrowsersPerSuiteRun: rows.filter((r) => r.ownsBrowser).length,
    minServersPerSuiteRun: rows.filter((r) => r.ownsServer).length,
    staticUpperBoundBrowsers: rows.reduce((acc, r) => acc + r.closureBrowserCallSites, 0),
    staticUpperBoundServers: rows.reduce((acc, r) => acc + r.closureServerCallSites, 0),
    rows,
    testToolsExclusions,
  };
}

export const DEFAULT_PRE_FIX_PATH = path.join(
  ".openclinxr",
  "evidence",
  "issue-284",
  "pre-fix.json",
);

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const outIdx = args.indexOf("--out");
  const out = outIdx !== -1 && args[outIdx + 1] !== undefined ? args[outIdx + 1] : undefined;
  const root = findRepoRoot();
  const inventory = buildBrowserBootInventory(root);
  const outPath = path.resolve(root, out ?? DEFAULT_PRE_FIX_PATH);
  if (write) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
    console.log(`browser-boot-inventory: wrote ${path.relative(root, outPath)}`);
  }
  console.log(
    `browser-boot-inventory: ${inventory.browserBootingTestFiles}/${inventory.totalTestFiles} test files reach a browser-booting primitive; `
      + `${inventory.excludedAmongBrowserBooting} excluded; min ${inventory.minBrowsersPerSuiteRun} browsers / `
      + `${inventory.minServersPerSuiteRun} dev servers per //#test:tools run (upper bound `
      + `${inventory.staticUpperBoundBrowsers} / ${inventory.staticUpperBoundServers}).`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
