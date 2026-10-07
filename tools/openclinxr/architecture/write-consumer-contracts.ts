import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `pnpm arch:consumer-contracts` (write-consumer-contracts.ts) — generate each
 * consumer's `consumes.json` ONCE from its real imports, then owned by hand.
 *
 * CONSUMER-DRIVEN CONTRACTS. Each consumer of a workspace package (an app dir, a
 * package, or a tools/openclinxr area) owns a committed `consumes.json` at its
 * root: [{ provider, entrypoint, names[] }]. The file is generated once by this
 * script from the tree's actual static imports, then maintained by hand: adding
 * an import without listing it fails the archunit gate, removing one without
 * trimming the file fails the same gate.
 *
 * TYPE-ONLY IMPORTS COUNT — YES, LISTED WITH KIND. A type-only name still pins
 * the provider's interface: renaming or deleting it breaks the consumer's
 * compile. Each name carries kind "runtime" | "type". `import type {…}`,
 * `export type {…}`, and inline `type Foo` prefixes all record kind "type".
 * A value import of a type (no `type` keyword) records "runtime" even when the
 * provider classifies it as type — the gate compares names, the kind is
 * documentation for the split.
 *
 * CONSUMER ROOTS (xr-dialogue scope). The directory that owns the import is
 * the longest matching prefix of the importing file:
 * - apps/ui-xr → runtime-app
 * - packages/openclinxr/xr-actor-dialogue → package
 * - packages/openclinxr/xr-humanoid-animation → package
 * - packages/openclinxr/stations/mouth-executor → package
 * - packages/openclinxr/stations/mouth-verifier → package
 * - tools/openclinxr/asset-pipeline/makeclothes → tools
 * - tools/openclinxr/evidence → evidence
 * - tools/openclinxr/mouth-solver → tools
 *
 * CORRECTED SCOUT NOTE. An earlier scout classified phonemesForText as
 * evidence-only. The tree shows it in packages/openclinxr/xr-humanoid-animation
 * (animation-loop.ts), packages/openclinxr/xr-actor-dialogue (speech.ts), and
 * tools/openclinxr/evidence (speech-sync-capture.ts). Every row below is
 * re-derived from imports; the generator does not special-case any name.
 */

export type ConsumerClass = "runtime-app" | "package" | "tools" | "evidence";

export type ContractName = { name: string; kind: "runtime" | "type" };

export type ConsumerContract = {
  provider: string;
  entrypoint: string;
  names: ContractName[];
};

export const CONSUMERS: { dir: string; class: ConsumerClass }[] = [
  { dir: "apps/ui-xr", class: "runtime-app" },
  { dir: "packages/openclinxr/xr-actor-dialogue", class: "package" },
  { dir: "packages/openclinxr/xr-humanoid-animation", class: "package" },
  { dir: "packages/openclinxr/stations/mouth-executor", class: "package" },
  { dir: "packages/openclinxr/stations/mouth-verifier", class: "package" },
  { dir: "tools/openclinxr/asset-pipeline/makeclothes", class: "tools" },
  { dir: "tools/openclinxr/evidence", class: "evidence" },
  { dir: "tools/openclinxr/mouth-solver", class: "tools" },
];

export const PROVIDER_SCOPE = "@openclinxr/xr-dialogue";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".turbo", "public"]);

const IMPORT_FROM =
  /import\s+(type\s+)?(?:[^"'{]*?\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']/gu;
const EXPORT_FROM = /export\s+(type\s+)?(?:\*|\{([^}]*)\})\s+from\s+["']([^"']+)["']/gu;

function repoRoot(): string {
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
    const name = entry.name;
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      sourceFilesUnder(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (SOURCE_EXTENSIONS.has(ext)) out.push(full);
  }
}

function splitNames(raw: string, wholeIsType: boolean): ContractName[] {
  const out: ContractName[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const isInlineType = trimmed.startsWith("type ");
    const bare = (isInlineType ? trimmed.slice(5) : trimmed).trim();
    const local = bare.split(" as ")[0]?.trim() ?? "";
    const published = bare.includes(" as ") ? (bare.split(" as ")[1]?.trim() ?? "") : local;
    const name = published !== "" ? published : local;
    if (name === "" || name === "*") continue;
    out.push({ name, kind: wholeIsType || isInlineType ? "type" : "runtime" });
  }
  return out;
}

function specifierToContract(specifier: string): { provider: string; entrypoint: string } | undefined {
  if (specifier === PROVIDER_SCOPE) return { provider: PROVIDER_SCOPE, entrypoint: "." };
  if (specifier.startsWith(`${PROVIDER_SCOPE}/`)) {
    return { provider: PROVIDER_SCOPE, entrypoint: `./${specifier.slice(PROVIDER_SCOPE.length + 1)}` };
  }
  return undefined;
}

/** provider/entrypoint → name → kind for one consumer directory. */
export function collectContracts(root: string, consumerDir: string): ConsumerContract[] {
  const files: string[] = [];
  sourceFilesUnder(join(root, consumerDir), files);
  const byKey = new Map<string, Map<string, "runtime" | "type">>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT_FROM)) {
      const target = specifierToContract(match[4] ?? "");
      if (target === undefined) continue;
      const wholeIsType = (match[1] ?? "").trim() !== "";
      const raw = match[2] ?? "";
      if (raw === "" && match[3] !== undefined && match[3] !== "") continue; // default import: no named contract
      const key = `${target.provider}\t${target.entrypoint}`;
      const names = byKey.get(key) ?? new Map<string, "runtime" | "type">();
      for (const entry of splitNames(raw, wholeIsType)) {
        const prev = names.get(entry.name);
        // runtime use dominates: a name imported both ways is a runtime dependency.
        if (prev === undefined || entry.kind === "runtime") names.set(entry.name, entry.kind);
      }
      byKey.set(key, names);
    }
    for (const match of text.matchAll(EXPORT_FROM)) {
      const target = specifierToContract(match[3] ?? "");
      if (target === undefined) continue;
      const wholeIsType = (match[1] ?? "").trim() !== "";
      const raw = match[2] ?? "";
      if (raw === "") continue; // `export *`: no named contract
      const key = `${target.provider}\t${target.entrypoint}`;
      const names = byKey.get(key) ?? new Map<string, "runtime" | "type">();
      for (const entry of splitNames(raw, wholeIsType)) {
        const prev = names.get(entry.name);
        if (prev === undefined || entry.kind === "runtime") names.set(entry.name, entry.kind);
      }
      byKey.set(key, names);
    }
  }
  const out: ConsumerContract[] = [];
  for (const [key, names] of [...byKey.entries()].sort()) {
    const [provider, entrypoint] = key.split("\t") as [string, string];
    out.push({
      provider,
      entrypoint,
      names: [...names.entries()]
        .map(([name, kind]) => ({ name, kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return out;
}

function main(): void {
  const root = repoRoot();
  const only = process.argv[2];
  for (const consumer of CONSUMERS) {
    if (only !== undefined && consumer.dir !== only) continue;
    const contracts = collectContracts(root, consumer.dir);
    const rel = join(consumer.dir, "consumes.json");
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    void existsSync;
    writeFileSync(full, `${JSON.stringify(contracts, null, 2)}\n`);
    const names = contracts.reduce((sum, c) => sum + c.names.length, 0);
    console.log(`${rel}: ${contracts.length} entrypoints, ${names} names [${consumer.class}]`);
    void relative;
  }
}

main();
