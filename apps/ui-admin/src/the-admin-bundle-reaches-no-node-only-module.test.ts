import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: every ui-admin page is blank on main. The vite-built bundle
 * evaluates packages/openclinxr/compute-slots/src/slots.ts at load:
 * node:async_hooks top-level `new AsyncLocalStorage` plus
 * `new Int32Array(new SharedArrayBuffer(4))`.
 *
 * R0 CHAIN (main, read-only static imports, workspace resolved via
 * package.json exports dist -> src):
 *   apps/ui-admin/src/main.tsx:4 ("./app.js")
 *   -> apps/ui-admin/src/app.tsx:3 (@openclinxr/ui-route-admin ".")
 *   -> packages/openclinxr/ui-route-admin/src/index.ts:49 (./seed-blueprint-workbench.js)
 *   -> packages/openclinxr/ui-route-admin/src/seed-blueprint-workbench.tsx:33 (./seed-worldview-queue.js)
 *   -> packages/openclinxr/ui-route-admin/src/seed-worldview-queue.tsx:5 (./environment-generation-queue-panel.js)
 *   -> packages/openclinxr/ui-route-admin/src/environment-generation-queue-panel.tsx:11 (@openclinxr/ui-shared/admin-factory-station-cards)
 *   -> packages/openclinxr/ui-shared/src/admin-factory-station-cards.tsx:4 (./admin-factory-station-cards-mod.js)
 *   -> packages/openclinxr/ui-shared/src/admin-factory-station-cards-mod.tsx:1 (@openclinxr/factory-stations/catalog)
 *   -> packages/openclinxr/factory-stations/src/catalog.ts:10 (@openclinxr/factory-station-core/runner)
 *   -> packages/openclinxr/factory-station-core/src/runner.ts:56 (./spawn-blender.js)
 *   -> packages/openclinxr/factory-station-core/src/spawn-blender.ts:2 (@openclinxr/service-local-compute/local)
 *   -> packages/openclinxr/service-local-compute/src/local.ts:21 (@openclinxr/compute-slots/slots)
 *   -> packages/openclinxr/compute-slots/src/slots.ts:1 (node:async_hooks, ALS)
 *
 * Import extraction: only node:fs + a regex over static import/export-from
 * statements (no typescript API). `import type` / `export type` statements are
 * skipped; third-party node_modules are never followed.
 */

// NOT TESTED: rendered appearance; live Blender; Quest.

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const ROOT = repoRoot();

const BARE_BUILTINS = new Set([
  "async_hooks",
  "fs",
  "fs/promises",
  "path",
  "child_process",
  "worker_threads",
  "os",
  "crypto",
  "url",
  "util",
  "stream",
]);

function isOffendingSpecifier(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  if (BARE_BUILTINS.has(spec) || BARE_BUILTINS.has(spec.split("/")[0] ?? "")) {
    // Only bare builtins in the known list; relative/third-party fall through.
    if (!spec.startsWith(".") && !spec.startsWith("@")) return true;
  }
  if (spec === "@openclinxr/compute-slots" || spec.startsWith("@openclinxr/compute-slots/")) return true;
  return false;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
}

/** Static import/export-from specifiers, skipping `import type` / `export type`. */
function staticSpecifiers(text: string): string[] {
  const clean = stripComments(text);
  const specs: string[] = [];
  const importRe = /import\s+(?:type\b[^;]*?;|(?:[^;]*?\sfrom\s+)?["']([^"']+)["']\s*;?)/g;
  for (const m of clean.matchAll(importRe)) {
    const full = m[0];
    if (/^\s*import\s+type\b/.test(full)) continue;
    if (m[1] !== undefined) specs.push(m[1]);
  }
  const exportRe = /export\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/g;
  for (const m of clean.matchAll(exportRe)) {
    if (m[1] !== undefined) specs.push(m[1]);
  }
  return specs;
}

function readPackageExports(packageName: string): Record<string, string> | null {
  const pjPath = join(ROOT, "packages/openclinxr", packageName.replace("@openclinxr/", ""), "package.json");
  if (!existsSync(pjPath)) return null;
  const pj = JSON.parse(readFileSync(pjPath, "utf8")) as {
    exports?: Record<string, { default?: string } | string>;
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(pj.exports ?? {})) {
    if (typeof value === "string") out[key] = value;
    else if (value.default !== undefined) out[key] = value.default;
  }
  return out;
}

function distToSrc(packageDir: string, distPath: string): string | null {
  // dist/foo.js -> src/foo.ts (.ts first, then .tsx); dist/foo-entry.js likewise.
  const relPath = distPath.replace(/^\.\/dist\//, "").replace(/^\.\/dist$/, "index.js").replace(/\.js$/, "");
  for (const ext of [".ts", ".tsx", ".mts"]) {
    const candidate = join(packageDir, "src", `${relPath}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  // directory index fallback
  for (const ext of [".ts", ".tsx"]) {
    const candidate = join(packageDir, "src", relPath, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveWorkspace(spec: string): string | null {
  const match = /^(?<pkg>@openclinxr\/[^/]+)(?<sub>\/.*)?$/.exec(spec);
  if (match?.groups === undefined) return null;
  const pkg = match.groups["pkg"] as string;
  const rawSub = (match.groups["sub"] as string | undefined) ?? ".";
  const key = rawSub === "." ? "." : `.${rawSub}`;
  const exportsMap = readPackageExports(pkg);
  if (exportsMap === null) return null;
  const distPath = exportsMap[key];
  if (distPath === undefined) return null;
  const packageDir = join(ROOT, "packages/openclinxr", pkg.replace("@openclinxr/", ""));
  return distToSrc(packageDir, distPath);
}

function resolveRelative(spec: string, fromFile: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts"), join(base, "index.tsx")];
  // Specifiers end in .js (e.g. ./app.js -> ./app.tsx); strip and retry.
  const stripped = base.replace(/\.js$/, "");
  if (stripped !== base) candidates.push(stripped, `${stripped}.ts`, `${stripped}.tsx`, join(stripped, "index.ts"));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const stat = BunSafeIsFile(candidate);
      if (stat) return candidate;
    }
  }
  return null;
}

function BunSafeIsFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

type Chain = string[];

function walkGraph(entry: string): { files: Map<string, string[]>; parents: Map<string, Chain> } {
  const files = new Map<string, string[]>(); // file -> static specifiers
  const parents = new Map<string, Chain>(); // file -> one chain from entry
  parents.set(entry, [entry]);
  const queue: string[] = [entry];
  const seen = new Set<string>([entry]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    let text: string;
    try {
      text = readFileSync(current, "utf8");
    } catch {
      continue;
    }
    const specs = staticSpecifiers(text);
    files.set(current, specs);
    for (const spec of specs) {
      let next: string | null = null;
      if (spec.startsWith(".")) next = resolveRelative(spec, current);
      else if (spec.startsWith("@openclinxr/")) next = resolveWorkspace(spec);
      else continue; // third-party: never follow (including node:*, bare builtins, playwright)
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      parents.set(next, [...(parents.get(current) ?? [current]), next]);
      queue.push(next);
    }
  }
  return { files, parents };
}

function rel(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
}

describe("the admin bundle reaches no node-only module", () => {
  it("walks main.tsx and finds zero node:* / bare-builtin / compute-slots imports", () => {
    const entry = join(ROOT, "apps/ui-admin/src/main.tsx");
    expect(existsSync(entry)).toBe(true);
    const { files, parents } = walkGraph(entry);
    const offending: Array<{ chain: Chain; spec: string; line: number }> = [];
    for (const [file, specs] of files) {
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (const spec of specs) {
        if (!isOffendingSpecifier(spec)) continue;
        const line = lines.findIndex((l) => l.includes(spec)) + 1;
        offending.push({ chain: parents.get(file) ?? [file], spec, line });
      }
    }
    if (offending.length > 0) {
      const rendered = offending
        .map(({ chain, spec, line }) => {
          const last = chain[chain.length - 1] as string;
          return `${rel(last)}:${line} imports ${spec}\n  chain: ${chain.map((c) => rel(c)).join(" -> ")}`;
        })
        .join("\n");
      expect(`offending node-only imports:\n${rendered}`).toBe("");
    }
    expect(offending).toHaveLength(0);
  });
});
