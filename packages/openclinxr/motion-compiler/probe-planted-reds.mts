/**
 * Every planted RED must fail for the reason it was written for, and the manifest must cover every
 * one of them.
 *
 *     pnpm --filter @openclinxr/motion-compiler probe:reds
 *
 * ## What this catches
 *
 * `it.fails` reports THAT a test failed and never WHY, so a suite of green expected-fail counts is
 * compatible with every clause dying on a typo. Twice in two days one did:
 *
 *   - M1's clauses (1) and (2) failed on a MANGLED FIXTURE PATH from d1ad5063 onward, never on the
 *     absent planner they demand.
 *   - The contact clause claimed to check every sampled frame while its oracle did nearest-KEY lookup.
 *
 * ## Coverage is enforced, not assumed
 *
 * The first version of this runner reported "14/14" while the package held 26 planted clauses. A
 * coverage figure computed over the manifest measures the manifest. Clauses are now DISCOVERED from
 * the TypeScript AST — titles are string literals, so this needs no source regex — and a manifest
 * that is missing an entry, or carries a stale one, fails the run before any probe executes.
 *
 * ## Exit 0 requires, for every discovered clause
 *
 *   1. a manifest entry, and no manifest entry without a clause
 *   2. exactly ONE test selected and exactly one FAILED (a selector matching two tests where one
 *      emits the expected text would otherwise pass)
 *   3. a nonzero vitest exit status, with no spawn error or signal
 *   4. output matching that clause's fingerprint
 *   5. no INSTRUMENT failure — ReferenceError, mangled relative specifier, timeout, parse error —
 *      each of which means the instrument is broken whatever else matched
 *
 * A clause that starts PASSING is a failure here: a satisfied contract is a transition to record
 * deliberately, not to discover later.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { INSTRUMENT_FAILURES, PLANTED_REDS } from "./src/planted-red-manifest.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");

/** Discovered `planted("<title>", ...)` calls, by AST. Never by regex over source. */
function testFilesUnder(dir: string, prefix = ""): string[] {
  // RECURSIVE. A top-level-only scan would silently exclude any clause placed in a subdirectory
  // while the runner kept reporting package-wide coverage — the same shape as the 14-of-26 defect.
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) out.push(...testFilesUnder(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".test.ts")) out.push(`${prefix}${entry.name}`);
  }
  return out;
}

function discoverPlantedClauses(): { file: string; title: string }[] {
  const found: { file: string; title: string }[] = [];
  for (const file of testFilesUnder(SRC)) {
    const source = ts.createSourceFile(file, readFileSync(join(SRC, file), "utf8"), ts.ScriptTarget.ESNext, true);
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "planted") {
        const first = node.arguments[0];
        if (first && ts.isStringLiteralLike(first)) found.push({ file, title: first.text });
        else found.push({ file, title: "<NON-LITERAL TITLE - the manifest cannot address this clause>" });
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return found;
}

/** vitest treats `-t` as a REGEX; clause titles contain parentheses that would become groups. */
function asLiteralRegex(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Outcome = { ok: boolean; label: string; why: string };

function probe(entry: (typeof PLANTED_REDS)[number]): Outcome {
  const label = `${entry.file} :: ${entry.select}`;
  const run = spawnSync(
    "npx",
    ["vitest", "run", "--root", ".", join("src", entry.file), "-t", asLiteralRegex(entry.select), "--reporter=verbose"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, OPENCLINXR_PROBE_REDS: "1" } },
  );
  if (run.error) return { ok: false, label, why: `vitest could not be spawned: ${run.error.message}` };
  if (run.signal) return { ok: false, label, why: `vitest was killed by ${run.signal}` };

  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  if (/Tests\s+\d+ skipped/.test(out) || /No test files found/.test(out)) {
    return { ok: false, label, why: "vitest selected no test - the title in the manifest no longer matches this clause" };
  }

  const failedMatch = /Tests\s+(\d+) failed/.exec(out);
  const failedCount = failedMatch ? Number(failedMatch[1]) : 0;
  const passedMatch = /Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(out);
  const passedCount = passedMatch ? Number(passedMatch[1]) : 0;
  // ANY selected test that PASSED is disqualifying. Requiring exactly one FAILURE is not the same
  // requirement: two clauses sharing an exact title, one passing and one failing, satisfies it while
  // the fingerprint gets attributed to whichever one nobody looked at.
  if (passedCount > 0) {
    return { ok: false, label, why: `${passedCount} selected test(s) PASSED — either this clause is satisfied, or the title selects a clause that is` };
  }
  if (failedCount === 0) {
    return {
      ok: false,
      label,
      why: "the clause PASSED. If the module landed, this is a contract transition: update or remove its manifest entry deliberately.",
    };
  }
  // EXACTLY ONE. A selector matching two failing tests, one of which emits the expected text, would
  // otherwise be accepted - the fingerprint would be evidence about a clause nobody probed.
  if (failedCount !== 1) {
    return { ok: false, label, why: `the selector matched ${failedCount} failing tests; a fingerprint cannot be attributed to one of them` };
  }
  if (run.status === 0) {
    return { ok: false, label, why: "vitest exited 0 while reporting a failure - trust the exit status, not the summary" };
  }

  for (const instrument of INSTRUMENT_FAILURES) {
    if (instrument.pattern.test(out)) return { ok: false, label, why: `INSTRUMENT FAILURE - ${instrument.why}` };
  }

  if (!entry.expected.test(out)) {
    const first = out.split("\n").find((line) => /AssertionError|Error:/.test(line))?.trim() ?? "(no error line found)";
    return { ok: false, label, why: `failed for the WRONG reason.\n      expected ${entry.expected}\n      got      ${first}` };
  }
  return { ok: true, label, why: "" };
}

// -- coverage first: a probe run over an incomplete manifest measures the manifest --------------

const discovered = discoverPlantedClauses();
const key = (file: string, title: string) => `${file} ${title}`;
const manifestKeys = new Set(PLANTED_REDS.map((e) => key(e.file, e.select)));
const discoveredKeys = new Set(discovered.map((d) => key(d.file, d.title)));

const unregistered = discovered.filter((d) => !manifestKeys.has(key(d.file, d.title)));
const stale = PLANTED_REDS.filter((e) => !discoveredKeys.has(key(e.file, e.select)));

if (unregistered.length > 0 || stale.length > 0) {
  for (const d of unregistered) console.log(`FAIL ${d.file} :: ${d.title}\n      planted but NOT in the manifest - this clause is unprobed`);
  for (const e of stale) console.log(`FAIL ${e.file} :: ${e.select}\n      in the manifest but no such planted clause - stale entry, or the title changed`);
  console.log(`\nManifest covers ${PLANTED_REDS.length} of ${discovered.length} planted clauses. Coverage must be exact before any probe runs.`);
  process.exit(1);
}

const results = PLANTED_REDS.map(probe);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.label}${r.ok ? "" : `\n      ${r.why}`}`);

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} planted REDs fail for their own recorded reason (manifest covers all ${discovered.length} discovered clauses).`,
);
process.exit(failed.length === 0 ? 0 : 1);
