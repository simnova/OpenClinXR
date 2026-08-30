/**
 * Every planted RED in this package, with the reason it is CURRENTLY red.
 *
 * `pnpm --filter @openclinxr/review-workflow probe:reds` discovers every `planted(...)` clause from
 * the TypeScript AST, refuses any mismatch against this list, then runs each clause alone in probe
 * mode and requires it to fail with a message matching its pattern.
 *
 * ## Maintaining this
 *
 * As the verifier port lands, a clause's failure reason MOVES — from "the gate trusts the row" to a
 * real assertion, then to passing. That is a contract transition and it belongs here as an explicit
 * edit. A clause that passes while still listed is reported as a failure, which is the point: nobody
 * discovers a satisfied contract by accident.
 *
 * ## The clause that is NOT here, deliberately
 *
 * Clause (2) is a LIVE counterweight, not a RED: it asserts a verified approval is accepted, which
 * stops clause (1) being satisfied by refusing everything forever. It is green today FOR THE WRONG
 * REASON — HEAD ignores the verifier field and accepts the fabricated rows outright. Written as
 * `it.fails` it passed immediately, which is how the mislabelling was caught. Clause (6) is the live
 * premise sentinel and is expected to turn red when the fix lands.
 */
export type PlantedRed = {
  file: string;
  /** The clause title, EXACTLY. Both the identity used for coverage and the vitest selector. */
  select: string;
  /** Regex the probe-mode failure output must match. */
  expected: RegExp;
  stage: "assertion";
};

export const PLANTED_REDS: readonly PlantedRed[] = [
  {
    file: "the-release-gate-refuses-a-self-declared-reviewer.test.ts",
    select: "(1) RED: a self-declared approval with NO verifier still blocks",
    expected: /a fabricated approval satisfied a required reviewer role/,
    stage: "assertion",
  },
  {
    file: "the-release-gate-refuses-a-self-declared-reviewer.test.ts",
    select: "(3) RED: roles come from the VERIFIER, never from the evidence row",
    expected: /the claimed role was accepted while the verifier reported a principal who does not hold it/,
    stage: "assertion",
  },
  {
    file: "the-release-gate-refuses-a-self-declared-reviewer.test.ts",
    select: "(4) RED: an approval is BOUND to its scenario and version — it cannot be replayed",
    expected: /the verifier was never called with the approval to check/,
    stage: "assertion",
  },
  {
    file: "the-release-gate-refuses-a-self-declared-reviewer.test.ts",
    select: "(5) RED: a reject-all verifier BLOCKS — proving the port is consulted, not decorative",
    expected: /every attestation was refused and the gate still passed/,
    stage: "assertion",
  },
];

/**
 * Failure shapes that mean the INSTRUMENT is broken, whatever else matched. A clause dying on any of
 * these is not red for its own reason even if its message happens to contain the expected substring.
 */
export const INSTRUMENT_FAILURES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /ReferenceError/, why: "a symbol the clause references does not exist" },
  { pattern: /Cannot find module '\/(?!Volumes)/, why: "a mangled relative specifier" },
  { pattern: /Test timed out/, why: "the clause hung rather than asserting" },
  { pattern: /SyntaxError/, why: "the file does not parse" },
];
