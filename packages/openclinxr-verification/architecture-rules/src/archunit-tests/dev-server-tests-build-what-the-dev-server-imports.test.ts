import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = findWorkspaceRoot();

type FixtureFile = {
  boots: string[];
  devServerImportSetMustInclude: string[];
};

type PackageEntry = {
  dir: string;
  manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
};

type FunctionChunk = {
  name: string;
  body: string;
};

const fixture: FixtureFile = JSON.parse(
  readFileSync(
    join(workspaceRoot, "packages/openclinxr-verification/architecture-rules/src/archunit-tests/dev-server-tests-build-what-the-dev-server-imports.fixture.json"),
    "utf8",
  ),
) as FixtureFile;

describe("dev-server tests build what the dev-server imports", () => {
  it("dev-server boot set matches the fixture", () => {
    const derived = deriveBootSet();
    const derivedSorted = [...derived.names].sort();
    const expectedSorted = [...fixture.boots].sort();
    const extra = derivedSorted.filter((pkg) => !expectedSorted.includes(pkg));
    const missing = expectedSorted.filter((pkg) => !derivedSorted.includes(pkg));
    const detail = `extra ${extra.map((pkg) => `${pkg} (${derived.witness.get(pkg) ?? "no-witness"})`).join(", ")} missing ${missing.join(", ")}`;
    expect(derivedSorted, detail).toEqual(expectedSorted);
  });

  it("dev-server import set covers the fixture must-include set", () => {
    const importSet = deriveDevServerImportSet();
    for (const required of fixture.devServerImportSetMustInclude) {
      expect(importSet.has(required), `dev-server import set is missing ${required}`).toBe(true);
    }
  });

  it("dev-server derivation is non-vacuous", () => {
    const derived = deriveBootSet();
    const importSet = deriveDevServerImportSet();
    expect(derived.names.size).toBeGreaterThan(0);
    expect(importSet.size).toBeGreaterThanOrEqual(20);
  });

  for (const pkg of fixture.boots) {
    it(`${pkg} builds the dev-server import set`, () => {
      const importSet = deriveDevServerImportSet();
      const closure = effectiveBuildClosure(pkg);
      const missing = [...importSet.keys()].filter((name) => !closure.has(name));
      expect(missing, `${pkg} test does not build ${missing.join(", ")}`).toEqual([]);
    });
  }
});

function deriveDevServerImportSet(): Map<string, string> {
  const packages = workspacePackageMap();
  const direct = new Map<string, string>();
  const seen = new Set<string>();
  const add = (name: string, witness: string): void => {
    if (!direct.has(name)) {
      direct.set(name, witness);
    }
  };
  for (const seed of ["apps/ui-xr/index.html", "apps/ui-xr/isolated-subject.html", "apps/ui-xr/vite.config.ts"]) {
    scanDevServerFile(seed, seen, add);
  }
  const closed = new Map<string, string>(direct);
  const queue: string[] = [...direct.keys()];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      break;
    }
    const entry = packages.get(current);
    if (entry === undefined) {
      continue;
    }
    for (const dep of Object.keys(entry.manifest.dependencies ?? {})) {
      if (dep.startsWith("@openclinxr/") && !closed.has(dep)) {
        closed.set(dep, `dep of ${current}`);
        queue.push(dep);
      }
    }
  }
  return closed;
}

function scanDevServerFile(file: string, seen: Set<string>, add: (name: string, witness: string) => void): void {
  if (seen.has(file)) {
    return;
  }
  seen.add(file);
  let source: string;
  try {
    source = readFileSync(join(workspaceRoot, file), "utf8");
  } catch {
    return;
  }
  const importPattern = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier === undefined) {
      continue;
    }
    const line = source.slice(0, match.index).split("\n").length;
    if (specifier.startsWith("@openclinxr/")) {
      const parts = specifier.split("/");
      const first = parts[0];
      const second = parts[1];
      if (first !== undefined && second !== undefined) {
        add(`${first}/${second}`, `${file}:${line}`);
      }
    } else if (specifier.startsWith(".")) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved !== null) {
        scanDevServerFile(resolved, seen, add);
      }
    } else if (specifier.startsWith("/src/")) {
      const resolved = resolveDevServerSrcSpecifier(specifier);
      if (resolved !== null) {
        scanDevServerFile(resolved, seen, add);
      }
    }
  }
}

function resolveDevServerSrcSpecifier(specifier: string): string | null {
  const raw = `apps/ui-xr${specifier}`;
  const candidates: string[] = [raw];
  if (raw.endsWith(".js")) {
    candidates.push(raw.replace(/\.js$/, ".ts"));
  }
  for (const candidate of candidates) {
    if (candidate.includes(".test.") || candidate.includes(".spec.")) {
      continue;
    }
    if (!/\.tsx?$/.test(candidate) && !/\.html$/.test(candidate)) {
      continue;
    }
    try {
      if (existsSync(join(workspaceRoot, candidate)) && statSync(join(workspaceRoot, candidate)).isFile()) {
        return candidate;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function deriveBootSet(): { names: Set<string>; witness: Map<string, string> } {
  const tracked = trackedFiles();
  const spawners: string[] = [];
  for (const file of tracked) {
    if (!file.startsWith("tools/")) {
      continue;
    }
    if (!file.endsWith(".ts") && !file.endsWith(".mts")) {
      continue;
    }
    if (file.includes(".test.")) {
      continue;
    }
    if (file.endsWith("lib/portless-server.ts")) {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(join(workspaceRoot, file), "utf8");
    } catch {
      continue;
    }
    const stripped = stripComments(source);
    if (/spawnPortlessDevServer\(/.test(stripped) || /spawn\([^)]*dev:portless/.test(stripped)) {
      spawners.push(file);
    }
  }
  const spawningNames = new Map<string, Set<string>>();
  for (const spawner of spawners) {
    let source: string;
    try {
      source = readFileSync(join(workspaceRoot, spawner), "utf8");
    } catch {
      continue;
    }
    const chunks = topLevelFunctionChunks(stripComments(source));
    const names = new Set<string>();
    for (const chunk of chunks) {
      if (/spawnPortlessDevServer\(/.test(chunk.body) || /spawn\([^)]*dev:portless/.test(chunk.body)) {
        names.add(chunk.name);
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const chunk of chunks) {
        if (names.has(chunk.name)) {
          continue;
        }
        const called = [...names].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(chunk.body));
        if (called) {
          names.add(chunk.name);
          grew = true;
        }
      }
    }
    spawningNames.set(spawner, names);
  }
  const packages = workspacePackageMap();
  const names = new Set<string>();
  const witness = new Map<string, string>();
  for (const file of tracked) {
    if (!file.endsWith(".test.ts")) {
      continue;
    }
    if (!file.startsWith("packages/") && !file.startsWith("apps/")) {
      continue;
    }
    const reached = transitivelyReachedSpawners(file, new Set(spawners));
    if (reached.length === 0) {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(join(workspaceRoot, file), "utf8");
    } catch {
      continue;
    }
    const stripped = stripComments(source);
    for (const spawner of reached) {
      const spawnerNames = spawningNames.get(spawner) ?? new Set<string>();
      for (const name of spawnerNames) {
        const at = stripped.search(new RegExp(`\\b${name}\\b`));
        if (at >= 0) {
          const pkg = packageNameForFile(file, packages);
          if (pkg !== null && !names.has(pkg)) {
            names.add(pkg);
            witness.set(pkg, `${file}:${stripped.slice(0, at).split("\n").length}`);
          }
        }
      }
    }
  }
  return { names, witness };
}

function transitivelyReachedSpawners(testFile: string, spawners: Set<string>): string[] {
  const seen = new Set<string>([testFile]);
  const queue: string[] = [testFile];
  const found: string[] = [];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      break;
    }
    let source: string;
    try {
      source = readFileSync(join(workspaceRoot, current), "utf8");
    } catch {
      continue;
    }
    const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier === undefined || !specifier.startsWith(".")) {
        continue;
      }
      const resolved = resolveRelativeImport(current, specifier);
      if (resolved === null || seen.has(resolved)) {
        continue;
      }
      if (resolved.includes(".test.")) {
        continue;
      }
      seen.add(resolved);
      if (spawners.has(resolved)) {
        found.push(resolved);
      } else {
        queue.push(resolved);
      }
    }
  }
  return found;
}

function effectiveBuildClosure(pkgName: string): Set<string> {
  const packages = workspacePackageMap();
  const entry = packages.get(pkgName);
  if (entry === undefined) {
    return new Set<string>();
  }
  const turboRaw = readFileSync(join(workspaceRoot, entry.dir, "turbo.json"), "utf8");
  const turbo = JSON.parse(turboRaw) as { tasks?: { test?: { dependsOn?: string[] } } };
  const dependsOn = turbo.tasks?.test?.dependsOn ?? [];
  const seeds = new Set<string>();
  for (const dep of dependsOn) {
    const parsed = /^(.+)#build$/.exec(dep);
    const name = parsed?.[1];
    if (name !== undefined) {
      seeds.add(name);
    }
  }
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = entry.manifest[field] ?? {};
    for (const key of Object.keys(deps)) {
      if (key.startsWith("@openclinxr/")) {
        seeds.add(key);
      }
    }
  }
  const closed = new Set<string>(seeds);
  const queue: string[] = [...seeds];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      break;
    }
    const pkg = packages.get(current);
    if (pkg === undefined) {
      continue;
    }
    for (const key of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (key.startsWith("@openclinxr/") && !closed.has(key)) {
        closed.add(key);
        queue.push(key);
      }
    }
  }
  return closed;
}

function workspacePackageMap(): Map<string, PackageEntry> {
  const packages = new Map<string, PackageEntry>();
  for (const file of trackedFiles()) {
    if (!file.endsWith("package.json")) {
      continue;
    }
    if (file.includes("/node_modules/") || file.includes("/dist/")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(workspaceRoot, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const name = (parsed as { name?: unknown }).name;
    if (typeof name !== "string") {
      continue;
    }
    const manifest = parsed as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    packages.set(name, { dir: dirname(file), manifest });
  }
  return packages;
}

function packageNameForFile(file: string, packages: Map<string, PackageEntry>): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const [name, entry] of packages) {
    const prefix = `${entry.dir}/`;
    if (file.startsWith(prefix) && entry.dir.length > bestLength) {
      best = name;
      bestLength = entry.dir.length;
    }
  }
  return best;
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = normalize(join(dirname(fromFile), specifier)).split("\\").join("/");
  const candidates: string[] = [base];
  if (base.endsWith(".js")) {
    candidates.push(base.replace(/\.js$/, ".ts"));
    candidates.push(base.replace(/\.js$/, ".mts"));
  }
  candidates.push(`${base}.ts`);
  candidates.push(`${base}.mts`);
  candidates.push(`${base}/index.ts`);
  for (const candidate of candidates) {
    if (candidate.includes(".test.") || candidate.includes(".spec.")) {
      continue;
    }
    if (!/\.m?tsx?$/.test(candidate)) {
      continue;
    }
    try {
      if (existsSync(join(workspaceRoot, candidate)) && statSync(join(workspaceRoot, candidate)).isFile()) {
        return candidate;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function topLevelFunctionChunks(source: string): FunctionChunk[] {
  const pattern = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/gm;
  const matches = [...source.matchAll(pattern)];
  const chunks: FunctionChunk[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match === undefined) {
      continue;
    }
    const first = match[1];
    const second = match[2];
    const name = first ?? second ?? "";
    if (name.length === 0) {
      continue;
    }
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? source.length;
    chunks.push({ name, body: source.slice(start, next) });
  }
  return chunks;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: workspaceRoot, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

function findWorkspaceRoot(): string {
  let candidate = process.cwd();

  while (true) {
    if (existsSync(join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error("Could not find workspace root containing pnpm-workspace.yaml");
    }
    candidate = parent;
  }
}
