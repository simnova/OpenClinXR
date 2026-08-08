#!/usr/bin/env tsx
/**
 * Ambient-fail gate — refuse a dispatch whose planted contract is already green on main.
 *
 * From orchestration review #2 (2026-08-08), which named one root cause behind three of my errors:
 *
 *   PREDICATE–SUBJECT MISMATCH: the assertion is well-formed; the thing it is EVALUATED OVER is not
 *   the defect.
 *
 *     population  — #196's RED filtered all 14 environments (where difference is guaranteed)
 *                   instead of the width sweep of one, and went GREEN while the defect was present.
 *     lifecycle   — integrate's rebuild measured `base...head` AFTER the merge, when it is empty.
 *     policy      — #198 "≥12 must stay fallback" and #202 "none may be fallback" asserted opposite
 *                   values of the same ledger field, with no supersession line.
 *
 * The review was explicit that another rules section would not bind, because the rules already
 * narrated both. "You already half-have 'commit the RED'. What failed is RED UNDER THE FILTER THAT
 * SHIPS, not RED under a hand-tuned population."
 *
 * So this runs the contract exactly as the worker will, against main as it stands, and refuses if it
 * passes. A planted contract that is green before anyone starts cannot fail for the right reason.
 *
 *   pnpm exec tsx tools/openclinxr/openclaw/ambient-fail-gate.ts <test-file> [...titleSubstrings]
 *
 * Exit 0  — the contract FAILS on ambient main. Safe to dispatch.
 * Exit 1  — the contract PASSES on ambient main. Vacuous plant; refuse.
 * Exit 2  — usage or execution error.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export type AmbientVerdict = {
  testFile: string;
  passedOnAmbient: boolean;
  detail: string;
};

export function runAmbientCheck(testFile: string, cwd: string): AmbientVerdict {
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", testFile], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    return {
      testFile,
      passedOnAmbient: true,
      detail: "every contract in the file passes on main — nothing here can fail for the right reason",
    };
  } catch (error) {
    const stdout = error instanceof Error && "stdout" in error
      ? String((error as { stdout?: Buffer }).stdout ?? "")
      : "";
    const failed = /(\d+) failed/u.exec(stdout);
    return {
      testFile,
      passedOnAmbient: false,
      detail: failed ? `${failed[1]} contract(s) fail on ambient main` : "contract fails on ambient main",
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [testFile] = process.argv.slice(2);
  if (!testFile) {
    console.error("usage: ambient-fail-gate.ts <test-file> [...titleSubstrings]");
    process.exit(2);
  }
  if (!existsSync(testFile)) {
    console.error(`ambient-fail-gate: ${testFile} does not exist — plant the contract first`);
    process.exit(2);
  }
  const verdict = runAmbientCheck(testFile, process.cwd());
  if (verdict.passedOnAmbient) {
    console.error(
      `ambient-fail-gate: REFUSE — ${verdict.detail}.\n`
      + `  A planted contract must fail on main BEFORE dispatch, under the same filter the worker\n`
      + `  will flip. Green-on-ambient means the assertion is not evaluated over the defect —\n`
      + `  the predicate-subject mismatch class (#196 population, integrate lifecycle, #198/#202 policy).`,
    );
    process.exit(1);
  }
  console.log(`ambient-fail-gate: OK — ${verdict.detail}. Safe to dispatch.`);
}
