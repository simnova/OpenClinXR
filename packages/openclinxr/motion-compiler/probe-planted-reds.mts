/**
 * Runs every clause in `PLANTED_REDS` ALONE, in probe mode, and requires it to fail for its own
 * recorded reason.
 *
 * `pnpm --filter @openclinxr/motion-compiler probe:reds`
 *
 * Exit 0 only when every registered clause: ran (exactly one selected), failed, matched its
 * fingerprint, and did not die of an instrument failure. Run it before a card becomes Planted,
 * immediately before dispatch, and in CI while cards remain Planted and unresolved.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { INSTRUMENT_FAILURES, PLANTED_REDS } from "./src/planted-red-manifest.js";

const ROOT = dirname(fileURLToPath(import.meta.url));

type Outcome = { ok: boolean; label: string; why: string };

/**
 * vitest treats `-t` as a REGEX. Clause titles start "(1) RED: ..." and those parentheses become a
 * capture group, so the literal title matches nothing and every test is SKIPPED — which the first
 * version of this runner reported as "failed for the wrong reason" on 13 of 14 clauses. A gate whose
 * own selector is broken reports the tree as broken, which is the failure this gate exists to catch,
 * arriving from inside the gate.
 */
function asLiteralRegex(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function probe(entry: (typeof PLANTED_REDS)[number]): Outcome {
  const label = `${entry.file} :: ${entry.select}`;
  const run = spawnSync(
    "npx",
    ["vitest", "run", "--root", ".", join("src", entry.file), "-t", asLiteralRegex(entry.select), "--reporter=verbose"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, OPENCLINXR_PROBE_REDS: "1" } },
  );
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  // A skipped run means the selector matched nothing. Reporting that as a wrong-reason failure would
  // blame the tree for a manifest typo.
  if (/Tests\s+\d+ skipped/.test(out) || /No test files found/.test(out)) {
    return { ok: false, label, why: "vitest selected no test — the title in the manifest no longer matches this clause" };
  }

  const passed = /Tests\s+1 passed/.test(out) && !/failed/.test(out);
  if (passed) {
    return {
      ok: false,
      label,
      why: "the clause PASSED. If the module landed, this is a contract transition: update or remove its manifest entry deliberately.",
    };
  }

  for (const instrument of INSTRUMENT_FAILURES) {
    if (instrument.pattern.test(out)) {
      return { ok: false, label, why: `INSTRUMENT FAILURE — ${instrument.why}` };
    }
  }

  if (!entry.expected.test(out)) {
    const first = out.split("\n").find((line) => /AssertionError|Error:/.test(line))?.trim() ?? "(no error line found)";
    return { ok: false, label, why: `failed for the WRONG reason.\n      expected ${entry.expected}\n      got      ${first}` };
  }

  return { ok: true, label, why: "" };
}

const results = PLANTED_REDS.map(probe);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.label}${r.ok ? "" : `\n      ${r.why}`}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} planted REDs fail for their own recorded reason.`);
process.exit(failed.length === 0 ? 0 : 1);
