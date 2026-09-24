import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A missing artifact must hard-fail or be a vitest skip. An `if` that sees a
 * missing file and `return`s passes the test without checking it.
 * The exit state is an empty list.
 */

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const EVIDENCE_ROOT = join(REPO_ROOT, "tools/openclinxr/evidence");
const MISSING_CALL = "exists" + "Sync";

type IfHead = {
  cond: string;
  rest: string;
};

function codeOf(line: string): string {
  let out = "";
  let inStr: "'" | "\"" | "`" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    out += c;
  }
  return out;
}

function ifHead(line: string): IfHead | null {
  const code = codeOf(line);
  const m = /^(\s*)(?:else\s+)?if\s*\(/.exec(code);
  if (!m) return null;
  let i = m[0].length;
  let depth = 1;
  while (i < code.length && depth > 0) {
    const c = code[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return {
    cond: code.slice(m[0].length, i - 1),
    rest: code.slice(i).trim(),
  };
}

function hidesMissingFile(cond: string): boolean {
  return new RegExp(`!\\s*(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?${MISSING_CALL}\\s*\\(`).test(cond);
}

function blockEnd(lines: string[], start: number): number {
  let depth = 0;
  let started = false;
  for (let j = start; j < lines.length; j++) {
    const code = codeOf(lines[j] ?? "");
    for (const c of code) {
      if (c === "{") {
        depth += 1;
        started = true;
      } else if (c === "}") depth -= 1;
    }
    if (started && depth <= 0) return j;
  }
  return lines.length - 1;
}

function silentMissingReturns(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = ifHead(lines[i] ?? "");
    if (!head || !hidesMissingFile(head.cond)) continue;
    if (/^return\b/.test(head.rest)) {
      hits.push(i + 1);
      continue;
    }
    if (!head.rest.startsWith("{")) continue;
    if (/\breturn\b/.test(head.rest)) {
      hits.push(i + 1);
      continue;
    }
    const end = blockEnd(lines, i);
    for (let j = i + 1; j <= end; j++) {
      if (/^\s*return\b/.test(codeOf(lines[j] ?? ""))) {
        hits.push(i + 1);
        break;
      }
    }
  }
  return hits;
}

function evidenceTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      out.push(...evidenceTestFiles(path));
    } else if (ent.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("evidence tests declare their skip", () => {
  it("has no silent missing-artifact return", () => {
    const hits: string[] = [];
    for (const file of evidenceTestFiles(EVIDENCE_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const line of silentMissingReturns(source)) {
        const text = (source.split("\n")[line - 1] ?? "").trim();
        hits.push(`${relative(REPO_ROOT, file)}:${line}: ${text}`);
      }
    }
    hits.sort();
    expect(hits).toEqual([]);
  });
});
