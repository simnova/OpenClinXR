#!/usr/bin/env tsx
/**
 * Emit the assert-contract-live done_when line for a planted contract file, with the titles read
 * FROM THE FILE rather than typed by hand.
 *
 * Twice in six slices a dispatch failed on a proof I hand-wrote: once the module path was wrong
 * (#187 — assert-contract-live lives in openclaw/, not evidence/), once the contract title was the
 * pre-rename one (#198 — I renamed the contract when planting the RED and left the done_when stale).
 * Both are §6x-ter's tell: the done_when was typed instead of copied from a known-good source.
 *
 *   pnpm exec tsx tools/openclinxr/openclaw/generate-contract-proof.ts <test-file> [...titleSubstrings]
 *
 * With no substrings, emits every `it(...)` title in the file. With substrings, emits only the
 * matching ones, in file order, and FAILS if a substring matches nothing — so a stale filter is
 * caught here rather than by a dispatch three minutes in.
 */
import { readFileSync } from "node:fs";

const [file, ...filters] = process.argv.slice(2);
if (!file) {
  console.error("usage: generate-contract-proof.ts <test-file> [...titleSubstrings]");
  process.exit(2);
}

const source = readFileSync(file, "utf8");
const titles = [...source.matchAll(/\bit(?:\.fails)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)]
  .map((m) => m[2]!.replace(/\\(["'`])/g, "$1"));

if (titles.length === 0) {
  console.error(`no it(...) titles found in ${file} — is this a contract file?`);
  process.exit(1);
}

let selected = titles;
if (filters.length > 0) {
  const missing = filters.filter((f) => !titles.some((t) => t.includes(f)));
  if (missing.length > 0) {
    console.error(`no contract title contains: ${missing.map((m) => JSON.stringify(m)).join(", ")}`);
    console.error(`available:\n${titles.map((t) => `  - ${t}`).join("\n")}`);
    process.exit(1);
  }
  selected = titles.filter((t) => filters.some((f) => t.includes(f)));
}

const quoted = selected.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(" ");
console.log(`- run:pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts ${file} ${quoted}`);
