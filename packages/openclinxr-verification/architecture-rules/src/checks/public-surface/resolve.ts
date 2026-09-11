import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Compiler-resolved package public surface (PSR-00 meter).
 *
 * WHY: the regex scanner in checks/export-surface-budgets.ts misses nested arena packages
 * and export syntax the compiler resolves (aliases, export *, export type *, single-quoted
 * specifiers, nested re-export chains). This module drives one TypeScript program over all
 * declared entrypoints and reads the module symbol table, so the baseline counts what a
 * consumer can actually import.
 */

export const SUPPORTED_SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

export type SurfaceSymbol = { name: string; kind: "runtime" | "type" };

export type EntrypointSurface = {
  packageDir: string;
  name: string;
  specifier: string;
  source: string;
  symbols: SurfaceSymbol[];
  wildcardDeclarations: number;
  typeWildcardDeclarations: number;
};

export type PackageSurface = {
  packageDir: string;
  name: string;
  entrypoints: EntrypointSurface[];
  rootSymbols: number;
  occurrences: number;
  uniqueSymbols: number;
  duplicateNames: string[];
  builtResolution: { specifier: string; js: boolean; declarations: boolean }[];
};

export type SurfaceReport = {
  packages: PackageSurface[];
  totals: {
    roots: number;
    entrypoints: number;
    rootSymbols: number;
    occurrences: number;
    uniqueSymbols: number;
    duplicateNames: number;
  };
};

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

export function workspaceRoot(): string {
  return findWorkspaceRoot();
}

export type DeclaredEntrypoint = {
  packageDir: string;
  name: string;
  specifier: string;
  condition: string;
};

function collectConditionTargets(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) collectConditionTargets(nested, into);
  }
}

/** Every workspace package under packages/openclinxr/** with a package.json name. */
export function discoverScopePackages(root: string = findWorkspaceRoot()): { packageDir: string; name: string }[] {
  const out: { packageDir: string; name: string }[] = [];
  const walk = (relativeDir: string): void => {
    const absolute = join(root, relativeDir);
    let entries: Dirent<string>[] | undefined;
    try {
      entries = readdirSync(absolute, { withFileTypes: true }) as Dirent<string>[];
    } catch {
      return;
    }
    for (const entry of entries ?? []) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = `${relativeDir}/${entry.name}`;
      const manifest = join(root, child, "package.json");
      if (existsSync(manifest)) {
        try {
          const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
          if (typeof parsed.name === "string" && parsed.name.startsWith("@openclinxr/")) {
            out.push({ packageDir: child, name: parsed.name });
          }
        } catch {
          // an unreadable manifest is not this meter's business
        }
      }
      walk(child);
    }
  };
  walk("packages/openclinxr");
  return out.sort((a, b) => a.packageDir.localeCompare(b.packageDir));
}

/** Declared root + subpath entrypoints from package.json#exports, "." first. */
export function declaredEntrypoints(
  root: string,
  packageDir: string,
  name: string,
): DeclaredEntrypoint[] {
  const manifestPath = join(root, packageDir, "package.json");
  let parsed: { exports?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { exports?: unknown };
  } catch {
    return [];
  }
  const raw = parsed.exports;
  if (typeof raw === "string") return [{ packageDir, name, specifier: ".", condition: raw }];
  if (raw === null || typeof raw !== "object") return [{ packageDir, name, specifier: ".", condition: "" }];
  const out: DeclaredEntrypoint[] = [];
  for (const [specifier, conditions] of Object.entries(raw as Record<string, unknown>)) {
    const targets: string[] = [];
    collectConditionTargets(conditions, targets);
    out.push({ packageDir, name, specifier, condition: targets[0] ?? "" });
  }
  out.sort((a, b) => (a.specifier === "." ? -1 : b.specifier === "." ? 1 : a.specifier.localeCompare(b.specifier)));
  return out;
}

function candidateSources(root: string, packageDir: string, condition: string): string[] {
  const out: string[] = [];
  if (condition.startsWith("./src/")) {
    const bare = condition.replace(/^\.\//u, "").replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, "");
    for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
      const candidate = join(root, packageDir, `${bare}${extension}`);
      if (!out.includes(candidate)) out.push(candidate);
    }
    return out;
  }
  const direct = condition.replace(/^\.\//u, "").replace(/\.d\.ts$/u, ".ts").replace(/\.js$/u, ".ts");
  const base = direct === "" ? "src/index" : `src/${direct.replace(/^dist\//u, "")}`;
  const bare = base.replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, "");
  for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
    const candidate = join(root, packageDir, `${bare}${extension}`);
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/** Source file backing a declared entrypoint, resolved from the dist condition. */
export function resolveEntrypointSource(
  root: string,
  entry: DeclaredEntrypoint,
): string | undefined {
  for (const candidate of candidateSources(root, entry.packageDir, entry.condition)) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function countWildcards(source: string): { wildcards: number; typeWildcards: number } {
  if (!existsSync(source)) return { wildcards: 0, typeWildcards: 0 };
  const text = readFileSync(source, "utf8");
  return {
    wildcards: (text.match(/^export \* from ["']/gmu) ?? []).length,
    typeWildcards: (text.match(/^export type \* from ["']/gmu) ?? []).length,
  };
}

const VALUE_FLAGS =
  ts.SymbolFlags.ValueModule |
  ts.SymbolFlags.Variable |
  ts.SymbolFlags.Function |
  ts.SymbolFlags.Class |
  ts.SymbolFlags.Enum |
  ts.SymbolFlags.ConstEnum;

function classify(checker: ts.TypeChecker, symbol: ts.Symbol): "runtime" | "type" {
  let target = symbol;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      target = checker.getAliasedSymbol(symbol);
    } catch {
      return "runtime";
    }
  }
  return (target.flags & VALUE_FLAGS) !== 0 ? "runtime" : "type";
}

export function manifestHash(root: string, packageDir: string): string {
  const files = ["package.json", "src/index.ts"];
  const hash = createHash("sha256");
  for (const file of files) {
    const full = join(root, packageDir, file);
    hash.update(file);
    hash.update(existsSync(full) ? readFileSync(full) : "");
  }
  return hash.digest("hex");
}

function programFor(sources: string[]): ts.Program {
  return ts.createProgram(sources, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    skipLibCheck: true,
    types: [],
  });
}

/** Compiler-resolved surface for every declared entrypoint in scope. */
export function measureSurface(root: string = findWorkspaceRoot()): SurfaceReport {
  const scope = discoverScopePackages(root);
  const byPackage = new Map<string, { name: string; entries: DeclaredEntrypoint[] }>();
  for (const pkg of scope) {
    byPackage.set(pkg.packageDir, { name: pkg.name, entries: declaredEntrypoints(root, pkg.packageDir, pkg.name) });
  }
  const withSources = [...byPackage.values()].flatMap((pkg) =>
    pkg.entries.map((entry) => ({ entry, source: resolveEntrypointSource(root, entry) })),
  );
  const sources = withSources.map((item) => item.source).filter((source): source is string => source !== undefined);
  const program = programFor(sources.length > 0 ? sources : [join(root, "package.json")]);
  const checker = program.getTypeChecker();
  const packages: PackageSurface[] = [];
  let rootSymbols = 0;
  let occurrences = 0;
  const perPackageUnique = new Map<string, Set<string>>();
  for (const [packageDir, pkg] of byPackage) {
    const entrypoints: EntrypointSurface[] = [];
    for (const entry of pkg.entries) {
      const source = resolveEntrypointSource(root, entry);
      const counts = source === undefined ? { wildcards: 0, typeWildcards: 0 } : countWildcards(source);
      let symbols: SurfaceSymbol[] = [];
      if (source !== undefined) {
        const sourceFile = program.getSourceFile(source);
        const moduleSymbol =
          sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile);
        const exported =
          sourceFile === undefined || moduleSymbol === undefined
            ? []
            : checker.getExportsOfModule(moduleSymbol);
        symbols = exported.map((symbol: ts.Symbol) => ({
          name: symbol.name,
          kind: classify(checker, symbol),
        }));
        symbols.sort((a, b) => a.name.localeCompare(b.name));
      }
      const rel = source === undefined ? "" : relative(root, source);
      entrypoints.push({
        packageDir,
        name: pkg.name,
        specifier: entry.specifier,
        source: rel,
        symbols,
        wildcardDeclarations: counts.wildcards,
        typeWildcardDeclarations: counts.typeWildcards,
      });
      if (entry.specifier === ".") rootSymbols += symbols.length;
      occurrences += symbols.length;
      const unique = perPackageUnique.get(packageDir) ?? new Set<string>();
      for (const symbol of symbols) unique.add(symbol.name);
      perPackageUnique.set(packageDir, unique);
    }
    const unique = perPackageUnique.get(packageDir) ?? new Set<string>();
    const seen = new Map<string, number>();
    for (const entry of entrypoints) {
      for (const symbol of entry.symbols) seen.set(symbol.name, (seen.get(symbol.name) ?? 0) + 1);
    }
    const duplicateNames = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
      .sort();
    packages.push({
      packageDir,
      name: pkg.name,
      entrypoints,
      rootSymbols: entrypoints.find((entry) => entry.specifier === ".")?.symbols.length ?? 0,
      occurrences: entrypoints.reduce((sum, entry) => sum + entry.symbols.length, 0),
      uniqueSymbols: unique.size,
      duplicateNames,
      builtResolution: pkg.entries.map((entry) => checkBuiltOutput(root, packageDir, entry)),
    });
  }
  packages.sort((a, b) => a.packageDir.localeCompare(b.packageDir));
  let uniqueSymbols = 0;
  let duplicateNames = 0;
  for (const pkg of packages) {
    uniqueSymbols += pkg.uniqueSymbols;
    duplicateNames += pkg.duplicateNames.length;
  }
  return {
    packages,
    totals: {
      roots: packages.length,
      entrypoints: packages.reduce((sum, pkg) => sum + pkg.entrypoints.length, 0),
      rootSymbols,
      occurrences,
      uniqueSymbols,
      duplicateNames,
    },
  };
}

function checkBuiltOutput(
  root: string,
  packageDir: string,
  entry: DeclaredEntrypoint,
): { specifier: string; js: boolean; declarations: boolean } {
  const targets: string[] = [];
  collectConditionTargets(entry.condition === "" ? {} : entry.condition, targets);
  let js = true;
  let declarations = true;
  if (targets.length === 0) {
    const fallback = join(root, packageDir, entry.specifier === "." ? "src/index.ts" : "");
    const missing = entry.specifier !== "." || !existsSync(fallback);
    js = !missing;
    declarations = !missing;
  }
  for (const target of targets) {
    const full = join(root, packageDir, target.replace(/^\.\//u, ""));
    if (target.endsWith(".d.ts")) {
      if (!existsSync(full)) declarations = false;
    } else if (target.endsWith(".js") || target.endsWith(".mjs") || target.endsWith(".cjs")) {
      if (!existsSync(full)) js = false;
    }
  }
  return { specifier: entry.specifier, js, declarations };
}
