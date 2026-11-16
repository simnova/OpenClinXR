import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

// Built without a contiguous literal so this guard does not name itself.
const DOC_A = "Docu";
const DOC_B = "ments";
const DOCS = DOC_A + DOC_B;
const SLASH = "/";
const NEEDLE = SLASH + DOCS + SLASH;
const HOME_A = "home" + "dir()";
const HOME_B = "process.env." + "HOME";

const ALLOWLIST = [
  {
    file: "tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts",
    reason: "MFA model cache, not a fixture; separate card",
  },
  {
    file: "tools/openclinxr/evidence/audible-lip-sync-proof/lip-sync-fixture-paths.test.mjs",
    reason: "guard implementation; refuses, never reads",
  },
] as const;

const PINNED = [
  "tools/openclinxr/factory/actor-audio-integration/verify-factory.mjs",
  "tools/openclinxr/evidence/audible-lip-sync-proof/capture.mjs",
];

function listTracked(patterns: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "--", ...patterns], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function relativeImports(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /from\s+["'](\.[^"']+)["']/g,
    /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    /require\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    /import\s+["'](\.[^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (m[1]) found.push(m[1]);
    }
  }
  return found;
}

function resolveImported(testAbs: string, spec: string, tracked: Set<string>): string | null {
  const base = resolve(dirname(testAbs), spec);
  const candidates = [base, base + ".ts", base + ".mjs", base + ".js"];
  for (const c of candidates) {
    if (!/\.(ts|mjs|js)$/.test(c)) continue;
    if (tracked.has(relative(REPO_ROOT, c)) && existsSync(c)) return c;
  }
  return null;
}

function stringLiteralsOfLine(line: string): string[] {
  const out: string[] = [];
  const re = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const raw = m[0] ?? "";
    out.push(raw.slice(1, -1));
  }
  return out;
}

function hasJoinCall(line: string): boolean {
  return /\bjoin\s*\(|\bresolve\s*\(/.test(line);
}

function hasHomeMarker(line: string, a: string, b: string): boolean {
  return line.includes(a) || line.includes(b);
}

function hasDocsArg(literals: string[], docs: string, slash: string): boolean {
  return literals.some((lit) => lit === docs || lit.startsWith(docs + slash));
}

const EVASION_RE = /(['"])Docu\1|(['"])ments\2/;

function hasEvasionConcat(line: string): boolean {
  return EVASION_RE.test(line) && (line.includes("+") || line.includes("${"));
}

function scanFile(abs: string, rel: string): string[] {
  const hits: string[] = [];
  const source = readFileSync(abs, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const literals = stringLiteralsOfLine(line);
    if (literals.some((lit) => lit.includes(NEEDLE))) {
      hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      continue;
    }
    if (
      hasJoinCall(line) &&
      hasHomeMarker(line, HOME_A, HOME_B) &&
      hasDocsArg(literals, DOCS, SLASH)
    ) {
      hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      continue;
    }
    if (hasEvasionConcat(line)) {
      hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
  return hits;
}

describe("no test reads under home docs", () => {
  it("has no fixture read under the home docs tree", () => {
    const tests = listTracked(["tools/**/*.test.ts", "tools/**/*.test.mjs"]);
    const tracked = new Set(listTracked(["*.ts", "*.mjs", "*.js"]));
    const scoped = new Set<string>();
    for (const t of tests) scoped.add(resolve(REPO_ROOT, t));
    for (const t of tests) {
      const abs = resolve(REPO_ROOT, t);
      let source = "";
      try {
        source = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      for (const spec of relativeImports(source)) {
        const resolved = resolveImported(abs, spec, tracked);
        if (resolved) scoped.add(resolved);
      }
    }
    for (const p of PINNED) scoped.add(resolve(REPO_ROOT, p));

    const hits: string[] = [];
    for (const abs of [...scoped].sort()) {
      let rel = relative(REPO_ROOT, abs);
      if (rel === "") rel = abs;
      hits.push(...scanFile(abs, rel));
    }
    hits.sort();

    const allowSet = new Set(ALLOWLIST.map((e) => e.file));
    const allowedHits = hits.filter((h) => [...allowSet].some((f) => h.startsWith(f + ":")));
    const otherHits = hits.filter((h) => ![...allowSet].some((f) => h.startsWith(f + ":")));

    const stale = ALLOWLIST.filter(
      (e) => !allowedHits.some((h) => h.startsWith(e.file + ":")),
    ).map((e) => `remove ${e.file} from the allowlist`);
    expect(stale).toEqual([]);
    expect(otherHits).toEqual([]);
  });
});
