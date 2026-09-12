/**
 * Gate: an evidence file must not join `.openclinxr-local/provider-cache` to a root
 * derived from `import.meta.url` / `import.meta.dirname` (the current worktree).
 *
 * The cache is untracked. A linked worktree does not have a copy, so that join
 * passes in main and fails everywhere else.
 *
 * Allowed: `join(CACHE_ROOT, …)` / `join(mainWorktreeRoot(…), …)` where CACHE_ROOT
 * comes from `git rev-parse --git-common-dir`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const EVIDENCE_ROOT = basename(THIS_DIR) === "provider-cache" ? dirname(THIS_DIR) : THIS_DIR;

const CACHE_MARKER = ".openclinxr-local/provider-cache";

/** Identifiers that mean "this file's checkout", not the main worktree. */
const WORKTREE_LOCAL_ROOT = /^(?:REPO_ROOT|REPO|HERE|cwd|repoRoot)$/;

function uncomment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, acc);
    else if (/\.(?:test\.)?tsx?$/.test(entry.name) || entry.name.endsWith(".mts")) acc.push(full);
  }
  return acc;
}

type Hit = { file: string; detail: string };

function worktreeLocalCacheJoins(abs: string): Hit[] {
  if (abs === THIS_FILE) return [];
  const src = uncomment(readFileSync(abs, "utf8"));
  if (!src.includes(CACHE_MARKER)) return [];
  const rel = relative(EVIDENCE_ROOT, abs);
  const hits: Hit[] = [];

  const joinRe = /\b(?:path\.)?join\(\s*([^,]+?)\s*,\s*(['"`])([^'"`]*?\.openclinxr-local\/provider-cache)/g;
  for (const m of src.matchAll(joinRe)) {
    const first = m[1]!.replace(/\s+/g, " ").trim();
    if (first.includes("mainWorktreeRoot") || first === "CACHE_ROOT" || first === "MAIN_ROOT") continue;
    const ident = first.split(/[.(]/)[0] ?? first;
    if (WORKTREE_LOCAL_ROOT.test(ident) || first === ident) {
      if (WORKTREE_LOCAL_ROOT.test(ident)) {
        hits.push({ file: rel, detail: `join(${first}, …${CACHE_MARKER})` });
      }
    }
  }

  const templateRe = /\$\{(REPO_ROOT|REPO|HERE|cwd|repoRoot)\}\/\.openclinxr-local\/provider-cache/g;
  for (const m of src.matchAll(templateRe)) {
    hits.push({ file: rel, detail: `template \${${m[1]}}/${CACHE_MARKER}` });
  }

  return hits;
}

describe("no evidence test resolves the provider-cache from its own worktree", () => {
  it("refuses a provider-cache path joined to an import.meta.url-derived root", () => {
    const files = walkTs(EVIDENCE_ROOT).filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
    expect(files.length, "evidence tree must contain TypeScript files to scan").toBeGreaterThan(10);

    const hits: Hit[] = [];
    for (const f of files) hits.push(...worktreeLocalCacheJoins(f));

    expect(
      hits,
      hits.map((h) => `${h.file}: ${h.detail}`).join("\n") || "no hits",
    ).toEqual([]);
  });
});
