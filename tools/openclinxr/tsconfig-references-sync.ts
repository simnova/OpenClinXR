#!/usr/bin/env tsx
/**
 * tsconfig-references-sync — derive TypeScript project-reference graph from
 * pnpm `workspace:*` dependencies.
 *
 * Run:   pnpm tsx tools/openclinxr/tsconfig-references-sync.ts
 * Check: pnpm tsx tools/openclinxr/tsconfig-references-sync.ts --check
 *
 * For every workspace package that has a tsconfig.json, this script reads its
 * package.json `dependencies` + `devDependencies`, keeps entries whose value
 * starts with `workspace:`, resolves each to the dependency's directory,
 * computes a relative path, and writes `references: [{ "path": "<rel>" }, ...]`
 * into the tsconfig.json — all sorted deterministically.
 *
 * Cycle handling: before writing, the script builds the full reference graph
 * and runs DFS cycle detection.  Any back-edge is reported explicitly and
 * OMITTED from the output references.  A reported cycle is a finding, not an
 * error (exit code 0 for apply).
 *
 * --check mode: exit code 0 if every tsconfig matches the computed references;
 * exit code 1 if any file is stale (printed to stderr).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(): string {
  let dir = SCRIPT_DIR;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

interface PkgInfo {
  absDir: string; // absolute path to package directory
  name: string; // e.g. "@openclinxr/scenario-runtime"
  hasTsconfig: boolean;
}

/** Walk packages/ and apps/ recursively; return name→info map. */
function collectWorkspacePackages(root: string): Map<string, PkgInfo> {
  const out = new Map<string, PkgInfo>();
  const skip = /node_modules$|^\./;
  const stack = [join(root, "packages"), join(root, "apps")];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skip.test(entry.name)) continue;
      const full = join(dir, entry.name);
      const pkgPath = join(full, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          if (typeof pkg.name === "string" && pkg.name.length > 0) {
            out.set(pkg.name, {
              absDir: full,
              name: pkg.name,
              hasTsconfig: existsSync(join(full, "tsconfig.json")),
            });
          }
        } catch {
          // skip broken package.json
        }
      }
      stack.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// parse workspace deps  (name → relative directory path)
// ---------------------------------------------------------------------------

interface Edge {
  depName: string;
  depDir: string; // absolute
  relPath: string; // relative from consumer → dependency dir
}

function deriveEdges(
  pkgDir: string,
  nameToInfo: Map<string, PkgInfo>,
): Edge[] {
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) return [];

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return [];
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const bucket of [pkg.dependencies ?? {}, pkg.devDependencies ?? {}]) {
    for (const [depName, version] of Object.entries(bucket)) {
      if (typeof version !== "string" || !version.startsWith("workspace:"))
        continue;
      if (seen.has(depName)) continue;
      seen.add(depName);

      const info = nameToInfo.get(depName);
      if (!info || !info.hasTsconfig) continue; // skip if no tsconfig

      edges.push({
        depName,
        depDir: info.absDir,
        relPath: relative(pkgDir, info.absDir),
      });
    }
  }

  // deterministic order
  edges.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return edges;
}

// ---------------------------------------------------------------------------
// cycle detection (DFS with WHITE / GRAY / BLACK)
// ---------------------------------------------------------------------------

function detectCycles(
  graph: Map<string, string[]>, // package name → dep package names
): string[][] {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];

  function dfs(u: string, path: string[]) {
    color.set(u, GRAY);
    path.push(u);
    const neighbors = graph.get(u) ?? [];
    for (const v of neighbors) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        // back edge -> cycle
        const idx = path.indexOf(v);
        cycles.push([...path.slice(idx), v]);
      } else if (c === WHITE) {
        dfs(v, path);
      }
    }
    path.pop();
    color.set(u, BLACK);
  }

  for (const u of graph.keys()) {
    if ((color.get(u) ?? WHITE) === WHITE) dfs(u, []);
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// tsconfig read / write
// ---------------------------------------------------------------------------

interface TsconfigRef {
  path: string;
}

function generateReferencesArray(edges: Edge[]): TsconfigRef[] {
  return edges.map((e) => ({ path: e.relPath }));
}

/** Parse a tsconfig.json. */
function readTsconfig(absPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve the effective `compilerOptions` for a tsconfig by following its
 * `extends` chain.  Returns the merged options (child overrides parent).
 * Guards against circular extends.
 */
function resolveEffectiveCompilerOptions(
  tsconfigPath: string,
  visited = new Set<string>(),
): Record<string, unknown> {
  const canonical = tsconfigPath; // follow symlinks for visited check
  if (visited.has(canonical)) return {};
  visited.add(canonical);

  const tsconfig = readTsconfig(tsconfigPath);
  if (!tsconfig) return {};

  let parent: Record<string, unknown> = {};
  if (typeof tsconfig["extends"] === "string") {
    const extendsPath = join(dirname(tsconfigPath), tsconfig["extends"] as string);
    parent = resolveEffectiveCompilerOptions(extendsPath, visited);
  }

  const own = (tsconfig["compilerOptions"] as Record<string, unknown>) ?? {};
  return { ...parent, ...own };
}

/** Check whether a tsconfig (via its extends chain) has `noEmit: true`. */
function hasNoEmit(tsconfigPath: string): boolean {
  const co = resolveEffectiveCompilerOptions(tsconfigPath);
  return co["noEmit"] === true;
}

/** Serialise a JSON value with 2-space indent, preserving key order. */
function prettyJson(val: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);

  if (val === null) return "null";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return JSON.stringify(val);

  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.map((v) => `${padInner}${prettyJson(v, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad}]`;
  }

  // object
  const keys = Object.keys(val as Record<string, unknown>);
  if (keys.length === 0) return "{}";
  const items = keys.map(
    (k) =>
      `${padInner}${JSON.stringify(k)}: ${prettyJson((val as Record<string, unknown>)[k], indent + 1)}`,
  );
  return `{\n${items.join(",\n")}\n${pad}}`;
}

/** Serialise tsconfig with `references` positioned after `compilerOptions`. */
function serialiseTsconfig(json: Record<string, unknown>): string {
  const keys = Object.keys(json);
  const orderedKeys: string[] = [];

  let inserted = false;
  for (const k of keys) {
    orderedKeys.push(k);
    if (
      k === "compilerOptions" ||
      (k === "extends" && !keys.includes("compilerOptions"))
    ) {
      if (!keys.includes("references")) {
        orderedKeys.push("references");
        inserted = true;
      }
    }
  }
  if (!inserted && !keys.includes("references")) {
    orderedKeys.push("references");
  }

  const reordered: Record<string, unknown> = {};
  for (const k of orderedKeys) {
    reordered[k] = json[k];
  }

  return prettyJson(reordered, 0) + "\n";
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");

  const root = findWorkspaceRoot();
  const nameToInfo = collectWorkspacePackages(root);

  // Step 1: derive all edges (consumer name → edges to dependencies)
  const consumerEdges = new Map<string, Edge[]>(); // consumer name → edges
  for (const info of nameToInfo.values()) {
    if (!info.hasTsconfig) continue;
    const edges = deriveEdges(info.absDir, nameToInfo);
    if (edges.length > 0) consumerEdges.set(info.name, edges);
  }

  // Step 2: build graph for cycle detection
  const graph = new Map<string, string[]>();
  for (const [consumer, edges] of consumerEdges) {
    graph.set(consumer, edges.map((e) => e.depName));
  }
  // Also add nodes with no outgoing edges so DFS visits them
  for (const name of nameToInfo.keys()) {
    if (!graph.has(name)) graph.set(name, []);
  }

  const cycles = detectCycles(graph);

  // Step 3: build "safe" edge set — omit edges that participate in any cycle
  const cycleEdgeSet = new Set<string>(); // "consumer→dep"
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length - 1; i += 1) {
      cycleEdgeSet.add(`${cycle[i]}→${cycle[i + 1]}`);
    }
  }

  // Step 4: filter edges — exclude cycles AND dep packages with noEmit=true
  const noEmitSkipped = new Set<string>(); // "depName" — packages skipped due to noEmit
  const finalRefs = new Map<string, TsconfigRef[]>(); // consumer absDir → refs
  let totalEdges = 0;
  let cycleOmitted = 0;
  let noEmitOmitted = 0;

  for (const [consumer, edges] of consumerEdges) {
    const info = nameToInfo.get(consumer)!;
    const safeEdges = edges.filter((e) => {
      const key = `${consumer}→${e.depName}`;
      if (cycleEdgeSet.has(key)) {
        cycleOmitted += 1;
        return false;
      }
      const depTsconfig = join(e.depDir, "tsconfig.json");
      if (hasNoEmit(depTsconfig)) {
        noEmitSkipped.add(e.depName);
        noEmitOmitted += 1;
        return false;
      }
      return true;
    });
    if (safeEdges.length > 0) {
      finalRefs.set(info.absDir, generateReferencesArray(safeEdges));
      totalEdges += safeEdges.length;
    }
  }

  // Step 5: report cycles + noEmit skips
  if (cycles.length > 0) {
    console.error("CYCLES DETECTED (these edges are OMITTED from references):");
    for (const cycle of cycles) {
      console.error(`  ${cycle.join(" → ")}`);
    }
    if (cycleOmitted > 0) {
      console.error(`  (${cycleOmitted} edge(s) omitted total)\n`);
    }
  } else {
    console.error("CYCLES: none");
  }

  if (noEmitSkipped.size > 0) {
    const sorted = [...noEmitSkipped].sort();
    console.error(
      `\nnoEmit SKIPS (${noEmitOmitted} edge(s) to ${sorted.length} package(s) — noEmit=true is TS6310-incompatible with project references):`,
    );
    for (const n of sorted) console.error(`  ${n}`);
  } else {
    console.error("noEmit skips: none");
  }

  // Step 6: apply or check
  let filesUpdated = 0;
  let filesStale = 0;
  const staleFiles: string[] = [];

  for (const [absDir, refs] of finalRefs) {
    const tsconfigPath = join(absDir, "tsconfig.json");
    const existing = readTsconfig(tsconfigPath);
    if (!existing) continue;

    const existingRefs = existing["references"] as TsconfigRef[] | undefined;
    const expectedRefs = refs;

    // Compare: build expected serialized form and compare to raw file
    const expectedJson = serialiseTsconfig({ ...existing, references: expectedRefs });
    const rawExisting = readFileSync(tsconfigPath, "utf8");

    const eq = expectedJson === rawExisting;

    if (checkOnly) {
      if (!eq) {
        staleFiles.push(tsconfigPath);
        filesStale += 1;
      }
    } else {
      if (!eq) {
        writeFileSync(tsconfigPath, expectedJson, "utf8");
        filesUpdated += 1;
      }
    }
  }

  if (checkOnly) {
    if (staleFiles.length > 0) {
      console.error(
        `\nSTALE tsconfig files (${staleFiles.length}) — references out of date:`,
      );
      for (const f of staleFiles) console.error(`  ${relative(root, f)}`);
      process.exit(1);
    }
    console.error("All tsconfig references up to date.");
  }

  // Summary
  console.error(
    `\nDone: ${filesUpdated} tsconfig(s) updated, ${totalEdges} total reference edges, ${cycleOmitted} cycle edges omitted, ${noEmitOmitted} noEmit edges omitted.`,
  );
}

main();
