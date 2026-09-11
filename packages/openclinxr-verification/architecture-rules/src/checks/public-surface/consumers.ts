import { readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Supported-consumer discovery for the public-surface meter (PSR-00).
 *
 * WHY: identifier search alone cannot prove a removal is safe — a dynamic import, require
 * call, re-export chain, or computed access reaches the symbol without naming it in a static
 * import. This scanner finds the KNOWN consumers in every supported form so a zero-result
 * search cannot silently authorize a removal; the compiler plus builds remain the proof.
 */

export const SUPPORTED_CONSUMER_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

export type ConsumerHit = {
  file: string;
  form: "static" | "dynamic" | "require" | "re-export" | "computed";
  specifier: string;
};

const STATIC_IMPORT = /import\s+(?:[^"']*?\sfrom\s+)?["'](@openclinxr\/[^"']+)["']/gu;
const DYNAMIC_IMPORT = /import\s*\(\s*["'](@openclinxr\/[^"']+)["']\s*\)/gu;
const REQUIRE_CALL = /require\s*\(\s*["'](@openclinxr\/[^"']+)["']\s*\)/gu;
const RE_EXPORT = /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'](@openclinxr\/[^"']+)["']/gu;
const COMPUTED_ACCESS = /\[["']([A-Za-z_$][A-Za-z0-9_$]*)["']\]/gu;

const SCAN_ROOTS = [
  "packages/openclinxr",
  "packages/openclinxr-verification",
  "packages/cellix",
  "apps",
  "tools",
  "docs",
] as const;

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".git", "public"]);

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

function sourceFilesUnder(dir: string, out: string[]): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent<string>[];
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFilesUnder(full, out);
      continue;
    }
    if (SUPPORTED_CONSUMER_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) out.push(full);
  }
}

function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

/** Supported consumer hits grouped by workspace package name. */
export function discoverConsumers(root: string = findWorkspaceRoot()): Map<string, ConsumerHit[]> {
  const files: string[] = [];
  for (const scanned of SCAN_ROOTS) sourceFilesUnder(join(root, scanned), files);
  const hits = new Map<string, ConsumerHit[]>();
  const push = (specifier: string, file: string, form: ConsumerHit["form"]): void => {
    const name = packageOf(specifier);
    const list = hits.get(name) ?? [];
    list.push({ file: relative(root, file), form, specifier });
    hits.set(name, list);
  };
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(STATIC_IMPORT)) push(match[1] ?? "", file, "static");
    for (const match of text.matchAll(DYNAMIC_IMPORT)) push(match[1] ?? "", file, "dynamic");
    for (const match of text.matchAll(REQUIRE_CALL)) push(match[1] ?? "", file, "require");
    for (const match of text.matchAll(RE_EXPORT)) push(match[1] ?? "", file, "re-export");
    if ([...text.matchAll(COMPUTED_ACCESS)].length > 0) {
      const mentioned = new Set<string>();
      for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL, RE_EXPORT]) {
        for (const match of text.matchAll(pattern)) mentioned.add(match[1] ?? "");
      }
      for (const specifier of mentioned) {
        if (specifier.startsWith("@openclinxr/")) push(specifier, file, "computed");
      }
    }
  }
  for (const list of hits.values()) list.sort((a, b) => a.file.localeCompare(b.file));
  return hits;
}

/** Consumer forms present per package, for the baseline report. */
export function consumerFormSummary(root: string = findWorkspaceRoot()): Record<string, Record<string, number>> {
  const hits = discoverConsumers(root);
  const out: Record<string, Record<string, number>> = {};
  for (const [name, list] of hits) {
    const forms: Record<string, number> = {};
    for (const hit of list) forms[hit.form] = (forms[hit.form] ?? 0) + 1;
    out[name] = forms;
  }
  return out;
}
