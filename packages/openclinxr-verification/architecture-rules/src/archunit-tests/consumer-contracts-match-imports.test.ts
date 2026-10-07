import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportedSymbols } from "../checks/export-surface-budgets.js";
import {
  declaredEntrypoints,
  measureSurface,
  resolveEntrypointSource,
} from "../checks/public-surface/resolve.js";

/**
 * Consumer-driven contracts: a consumer imports only what its consumes.json
 * lists, and one entrypoint serves one consumer class.
 *
 * WHY. The public surface separates exports by use — runtime apps, packages,
 * tools, and evidence each bind a different slice of a provider. Without a
 * committed contract per consumer, a shrink campaign cannot tell which
 * entrypoint a symbol can move to: every move risks a consumer nobody named.
 * consumes.json (generated once by
 * tools/openclinxr/architecture/write-consumer-contracts.ts from real static
 * imports, then owned by hand) names the slice each consumer binds.
 *
 * TYPE-ONLY IMPORTS COUNT, LISTED WITH KIND. A type-only name still pins the
 * provider interface. Clauses compare by name; kind ("runtime" | "type") is
 * documentation for the split. `import type`, `export type`, and inline
 * `type Foo` all record kind "type"; runtime use dominates when both appear.
 *
 * SCANNERS REUSED, NOT REWRITTEN. Provider publication is
 * declaredEntrypoints + resolveEntrypointSource (checks/public-surface/resolve.ts)
 * with exportedSymbols (checks/export-surface-budgets.ts) reading the source.
 * The named-import pattern mirrors checks/entrypoint-imports-resolve.ts
 * NAMED_IMPORT, extended to `import type`, inline `type` prefixes, subpath
 * specifiers, and re-exports — that check scans only *.test.ts under packages,
 * while this gate scans every source file under each contracted consumer.
 *
 * SCOPE. Clauses (a), (b), (d) run over consumers that own a consumes.json
 * and providers named in it (today: @openclinxr/xr-dialogue only). Imports of
 * providers with no contract row are out of scope. Clause (c) requires every
 * name a contracted provider publishes to be listed in some consumes.json;
 * the global unconsumed count across all providers is reported, not gated.
 */

export type ConsumerClass = "runtime-app" | "package" | "tools" | "evidence";

export type ConsumerDef = { dir: string; class: ConsumerClass };

export const CONSUMERS: ConsumerDef[] = [
  { dir: "apps/ui-xr", class: "runtime-app" },
  { dir: "packages/openclinxr/xr-actor-dialogue", class: "package" },
  { dir: "packages/openclinxr/xr-humanoid-animation", class: "package" },
  { dir: "packages/openclinxr/stations/mouth-executor", class: "package" },
  { dir: "packages/openclinxr/stations/mouth-verifier", class: "package" },
  { dir: "tools/openclinxr/asset-pipeline/makeclothes", class: "tools" },
  { dir: "tools/openclinxr/evidence", class: "evidence" },
  { dir: "tools/openclinxr/mouth-solver", class: "tools" },
];

export const CONTRACTED_PROVIDERS = new Set(["@openclinxr/xr-dialogue"]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".turbo", "public"]);

const IMPORT_FROM =
  /import\s+(type\s+)?(?:[^"'{]*?\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']/gu;
const EXPORT_FROM = /export\s+(type\s+)?(?:\*|\{([^}]*)\})\s+from\s+["']([^"']+)["']/gu;

export type ContractName = { name: string; kind: string };
export type ContractRow = { provider: string; entrypoint: string; names: ContractName[] };
export type AllowlistRow = {
  provider: string;
  entrypoint: string;
  classes: ConsumerClass[];
  reason: string;
};

function findRoot(): string {
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

function sourceFilesUnder(dir: string, out: string[]): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent<string>[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFilesUnder(full, out);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    if (dot >= 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) out.push(full);
  }
}

function splitNames(raw: string, wholeIsType: boolean): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const inlineType = trimmed.startsWith("type ");
    const bare = (inlineType ? trimmed.slice(5) : trimmed).trim();
    const published = bare.includes(" as ") ? (bare.split(" as ")[1]?.trim() ?? "") : bare.split(" as ")[0]?.trim() ?? "";
    if (published === "" || published === "*") continue;
    out.push({ name: published, kind: wholeIsType || inlineType ? "type" : "runtime" });
  }
  return out;
}

function specifierToProvider(specifier: string): { provider: string; entrypoint: string } | undefined {
  for (const provider of CONTRACTED_PROVIDERS) {
    if (specifier === provider) return { provider, entrypoint: "." };
    if (specifier.startsWith(`${provider}/`)) {
      return { provider, entrypoint: `./${specifier.slice(provider.length + 1)}` };
    }
  }
  return undefined;
}

export type ImportedName = { name: string; kind: string; file: string };

/** Every contracted-provider named import under one consumer dir. */
export function derivedImports(
  root: string,
  consumerDir: string,
): Map<string, ImportedName[]> {
  const files: string[] = [];
  sourceFilesUnder(join(root, consumerDir), files);
  const out = new Map<string, ImportedName[]>();
  const push = (provider: string, entrypoint: string, entry: ImportedName): void => {
    const key = `${provider}\t${entrypoint}`;
    const list = out.get(key) ?? [];
    list.push(entry);
    out.set(key, list);
  };
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT_FROM)) {
      const target = specifierToProvider(match[4] ?? "");
      if (target === undefined) continue;
      const wholeIsType = (match[1] ?? "").trim() !== "";
      const raw = match[2] ?? "";
      if (raw === "") continue; // default import: no named contract
      for (const entry of splitNames(raw, wholeIsType)) {
        push(target.provider, target.entrypoint, { ...entry, file });
      }
    }
    for (const match of text.matchAll(EXPORT_FROM)) {
      const target = specifierToProvider(match[3] ?? "");
      if (target === undefined) continue;
      const wholeIsType = (match[1] ?? "").trim() !== "";
      const raw = match[2] ?? "";
      if (raw === "") continue; // `export *`: no named contract
      for (const entry of splitNames(raw, wholeIsType)) {
        push(target.provider, target.entrypoint, { ...entry, file });
      }
    }
  }
  return out;
}

export function readContracts(root: string, consumerDir: string): ContractRow[] {
  const full = join(root, consumerDir, "consumes.json");
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, "utf8")) as ContractRow[];
}

export function providerDirFor(root: string, provider: string): string | undefined {
  // Live layout first; fixtures use the same packages/openclinxr/<name> shape.
  const short = provider.split("/")[1] ?? "";
  if (short === "") return undefined;
  const direct = join(root, "packages", "openclinxr", short);
  if (existsSync(join(direct, "package.json"))) return `packages/openclinxr/${short}`;
  return undefined;
}

/** Published names for one provider entrypoint, via the reused resolve + export scanners. */
export function publishedNames(root: string, provider: string, entrypoint: string): Set<string> {
  const packageDir = providerDirFor(root, provider);
  if (packageDir === undefined) return new Set();
  const entries = declaredEntrypoints(root, packageDir, provider);
  const wanted = entries.find((e) => e.specifier === entrypoint);
  if (wanted === undefined) return new Set();
  const source = resolveEntrypointSource(root, wanted);
  if (source === undefined) return new Set();
  return exportedSymbols(source);
}

export function readAllowlist(root: string): AllowlistRow[] {
  const full = join(
    root,
    "packages/openclinxr-verification/architecture-rules/src/archunit-tests/consumer-contracts-allowlist.json",
  );
  if (!existsSync(full)) return [];
  return JSON.parse(readFileSync(full, "utf8")) as AllowlistRow[];
}

/** (a) consumer imports a name its consumes.json does not list. */
export function checkUnlistedImports(
  root: string,
  consumers: ConsumerDef[] = CONSUMERS,
): string[] {
  const violations: string[] = [];
  for (const consumer of consumers) {
    const contracts = readContracts(root, consumer.dir);
    if (contracts.length === 0) continue;
    const listed = new Map<string, Set<string>>();
    for (const row of contracts) {
      listed.set(
        `${row.provider}\t${row.entrypoint}`,
        new Set(row.names.map((n) => n.name)),
      );
    }
    for (const [key, imports] of derivedImports(root, consumer.dir)) {
      const names = listed.get(key);
      if (names === undefined) {
        const [provider, entrypoint] = key.split("\t") as [string, string];
        violations.push(
          `${consumer.dir} imports ${provider}${entrypoint} with no contract row for it: ${imports[0]?.name ?? ""}`,
        );
        continue;
      }
      for (const imp of imports) {
        if (!names.has(imp.name)) {
          const [provider, entrypoint] = key.split("\t") as [string, string];
          violations.push(
            `${consumer.dir} imports ${imp.name} from ${provider}${entrypoint} but consumes.json does not list it (${imp.file})`,
          );
        }
      }
    }
  }
  return violations.sort();
}

/** (b) consumes.json lists a name the provider entrypoint does not publish. */
export function checkListedNotPublished(
  root: string,
  consumers: ConsumerDef[] = CONSUMERS,
): string[] {
  const violations: string[] = [];
  for (const consumer of consumers) {
    for (const row of readContracts(root, consumer.dir)) {
      if (!CONTRACTED_PROVIDERS.has(row.provider)) continue;
      const published = publishedNames(root, row.provider, row.entrypoint);
      if (published.size === 0) {
        violations.push(
          `${consumer.dir} contracts ${row.provider}${row.entrypoint} which resolves to no entrypoint source`,
        );
        continue;
      }
      for (const name of row.names) {
        if (!published.has(name.name)) {
          violations.push(
            `${consumer.dir} lists ${name.name} in ${row.provider}${row.entrypoint} but the entrypoint does not publish it`,
          );
        }
      }
    }
  }
  return violations.sort();
}

/** (c) provider publishes a name no consumes.json lists. Scoped to contracted providers. */
export function checkUnconsumedPublished(
  root: string,
  consumers: ConsumerDef[] = CONSUMERS,
): string[] {
  const listed = new Map<string, Set<string>>();
  for (const consumer of consumers) {
    for (const row of readContracts(root, consumer.dir)) {
      if (!CONTRACTED_PROVIDERS.has(row.provider)) continue;
      const key = `${row.provider}\t${row.entrypoint}`;
      const set = listed.get(key) ?? new Set<string>();
      for (const name of row.names) set.add(name.name);
      listed.set(key, set);
    }
  }
  const violations: string[] = [];
  for (const provider of CONTRACTED_PROVIDERS) {
    const packageDir = providerDirFor(root, provider);
    if (packageDir === undefined) continue;
    for (const entry of declaredEntrypoints(root, packageDir, provider)) {
      const key = `${provider}\t${entry.specifier}`;
      if (!listed.has(key)) continue; // an entrypoint with no contracts is out of scope
      const source = resolveEntrypointSource(root, entry);
      if (source === undefined) continue;
      const published = exportedSymbols(source);
      const names = listed.get(key) ?? new Set<string>();
      for (const symbol of [...published].sort()) {
        if (!names.has(symbol)) {
          violations.push(`${provider}${entry.specifier} publishes ${symbol} which no consumes.json lists`);
        }
      }
    }
  }
  return violations.sort();
}

/** (d) one entrypoint serves consumers of different classes without an allowlist reason. */
export function checkMixedClassEntrypoints(
  root: string,
  consumers: ConsumerDef[] = CONSUMERS,
  allowlist: AllowlistRow[] = readAllowlist(root),
): string[] {
  const servedBy = new Map<string, Set<ConsumerClass>>();
  for (const consumer of consumers) {
    for (const [key] of derivedImports(root, consumer.dir)) {
      const set = servedBy.get(key) ?? new Set<ConsumerClass>();
      set.add(consumer.class);
      servedBy.set(key, set);
    }
  }
  const excused = new Map<string, AllowlistRow>();
  for (const row of allowlist) excused.set(`${row.provider}\t${row.entrypoint}`, row);
  const violations: string[] = [];
  for (const [key, classes] of [...servedBy.entries()].sort()) {
    if (classes.size < 2) continue;
    const row = excused.get(key);
    const [provider, entrypoint] = key.split("\t") as [string, string];
    if (row === undefined || row.reason.trim() === "") {
      violations.push(
        `${provider}${entrypoint} serves ${[...classes].sort().join(", ")} with no allowlist reason`,
      );
      continue;
    }
    const covered = new Set(row.classes);
    for (const cls of classes) {
      if (!covered.has(cls)) {
        violations.push(
          `${provider}${entrypoint} serves ${cls} outside its allowlist classes ${[...covered].sort().join(", ")}`,
        );
      }
    }
  }
  return violations.sort();
}

/** Reported, not gated: published symbols tree-wide that no consumes.json lists. */
export function globalUnconsumedCount(root: string): number {
  const report = measureSurface(root);
  const listed = new Set<string>();
  for (const consumer of CONSUMERS) {
    for (const row of readContracts(root, consumer.dir)) {
      for (const name of row.names) listed.add(`${row.provider}\t${row.entrypoint}\t${name.name}`);
    }
  }
  let count = 0;
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        if (!listed.has(`${pkg.name}\t${entry.specifier}\t${symbol.name}`)) count += 1;
      }
    }
  }
  return count;
}

function withFixture(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "consumer-contracts-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const manifest = (name: string, extraExports?: Record<string, unknown>): string =>
  JSON.stringify({
    name,
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" }, ...(extraExports ?? {}) },
  });

const consumersFile = (dir: string, rows: ContractRow[]): [string, string] => [
  `${dir}/consumes.json`,
  JSON.stringify(rows, null, 2),
];

describe("consumer contracts match imports", () => {
  it("(1) PLANT (a): an import its consumes.json does not list fails", () => {
    withFixture(
      {
        "packages/openclinxr/fixture-provider/package.json": manifest("@openclinxr/fixture-provider"),
        "packages/openclinxr/fixture-provider/src/index.ts": "export const listed = 1;\nexport const sneaky = 2;\n",
        [consumersFile("apps/fixture-app", [
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [] },
        ])[0]]: consumersFile("apps/fixture-app", [])[1],
      },
      (root) => {
        // Plant in the contracted provider's shape: rewrite the fixture to
        // use the real provider name so specifierToProvider sees it.
        writeFileSync(
          join(root, "packages/openclinxr/fixture-provider/package.json"),
          manifest("@openclinxr/xr-dialogue"),
        );
        mkdirSync(join(root, "packages/openclinxr/xr-dialogue/src"), { recursive: true });
        writeFileSync(join(root, "packages/openclinxr/xr-dialogue/src/index.ts"), "export const listed = 1;\nexport const sneaky = 2;\n");
        writeFileSync(
          join(root, "apps/fixture-app/consumes.json"),
          JSON.stringify([{ provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "listed", kind: "runtime" }] }]),
        );
        mkdirSync(join(root, "apps/fixture-app/src"), { recursive: true });
        writeFileSync(
          join(root, "apps/fixture-app/src/main.ts"),
          'import { listed, sneaky } from "@openclinxr/xr-dialogue";\nconsole.log(listed, sneaky);\n',
        );
        const violations = checkUnlistedImports(root, [{ dir: "apps/fixture-app", class: "runtime-app" }]);
        expect(violations.join("\n")).toContain("sneaky");
        expect(violations.join("\n")).not.toContain("listed but consumes");
      },
    );
  });

  it("(2) PLANT (b): a consumes.json name the provider does not publish fails", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const real = 1;\n",
        "apps/fixture-app/src/main.ts": 'import { real } from "@openclinxr/xr-dialogue";\nconsole.log(real);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          {
            provider: "@openclinxr/xr-dialogue",
            entrypoint: ".",
            names: [
              { name: "real", kind: "runtime" },
              { name: "ghost", kind: "runtime" },
            ],
          },
        ]),
      },
      (root) => {
        const violations = checkListedNotPublished(root, [{ dir: "apps/fixture-app", class: "runtime-app" }]);
        expect(violations.join("\n")).toContain("ghost");
      },
    );
  });

  it("(3) PLANT (c): a published name no consumes.json lists fails", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const covered = 1;\nexport const orphan = 2;\n",
        "apps/fixture-app/src/main.ts": 'import { covered } from "@openclinxr/xr-dialogue";\nconsole.log(covered);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "covered", kind: "runtime" }] },
        ]),
      },
      (root) => {
        const violations = checkUnconsumedPublished(root, [{ dir: "apps/fixture-app", class: "runtime-app" }]);
        expect(violations.join("\n")).toContain("orphan");
        expect(violations.join("\n")).not.toContain("covered which");
      },
    );
  });

  it("(4) PLANT (d): one entrypoint serving two classes fails without an allowlist reason", () => {
    withFixture(
      {
        "packages/openclinxr/xr-dialogue/package.json": manifest("@openclinxr/xr-dialogue"),
        "packages/openclinxr/xr-dialogue/src/index.ts": "export const shared = 1;\n",
        "apps/fixture-app/src/main.ts": 'import { shared } from "@openclinxr/xr-dialogue";\nconsole.log(shared);\n',
        "apps/fixture-app/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "shared", kind: "runtime" }] },
        ]),
        "tools/openclinxr/fixture-tool/run.ts": 'import { shared } from "@openclinxr/xr-dialogue";\nconsole.log(shared);\n',
        "tools/openclinxr/fixture-tool/consumes.json": JSON.stringify([
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", names: [{ name: "shared", kind: "runtime" }] },
        ]),
      },
      (root) => {
        const consumers: ConsumerDef[] = [
          { dir: "apps/fixture-app", class: "runtime-app" },
          { dir: "tools/openclinxr/fixture-tool", class: "tools" },
        ];
        expect(checkMixedClassEntrypoints(root, consumers, []).join("\n")).toContain("serves runtime-app, tools");
        const excused = checkMixedClassEntrypoints(root, consumers, [
          { provider: "@openclinxr/xr-dialogue", entrypoint: ".", classes: ["runtime-app", "tools"], reason: "fixture reason" },
        ]);
        expect(excused).toEqual([]);
      },
    );
  });

  it("(5) live tree: clauses (a), (b), (c) pass and (d) passes with today's allowlist", () => {
    const root = findRoot();
    expect(checkUnlistedImports(root).join("\n")).toBe("");
    expect(checkListedNotPublished(root).join("\n")).toBe("");
    expect(checkUnconsumedPublished(root).join("\n")).toBe("");
    const allowlist = readAllowlist(root);
    expect(allowlist.map((r) => `${r.provider}${r.entrypoint}`).sort()).toEqual([
      "@openclinxr/xr-dialogue.",
      "@openclinxr/xr-dialogue./actor-audio-runtime",
      "@openclinxr/xr-dialogue./viseme-morph",
      "@openclinxr/xr-dialogue./viseme-runtime",
      "@openclinxr/xr-dialogue./viseme-timeline",
    ]);
    for (const row of allowlist) expect(row.reason.trim() !== "").toBe(true);
    expect(checkMixedClassEntrypoints(root, CONSUMERS, allowlist)).toEqual([]);
    // Without the allowlist the mixed-class gate fires: the excuse is load-bearing.
    expect(checkMixedClassEntrypoints(root, CONSUMERS, []).length).toBeGreaterThan(0);
  });

  it("(6) live tree reports the global unconsumed count", () => {
    const count = globalUnconsumedCount(findRoot());
    expect(count).toBeGreaterThan(1000);
  });
});
