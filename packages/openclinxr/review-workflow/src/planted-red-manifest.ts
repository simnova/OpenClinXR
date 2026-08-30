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
 * ## 2026-08-30: the trusted-verifier port landed (card tsk_a5045834c138eceb)
 *
 * Clauses (1), (3), (4), and (5) in
 * `the-release-gate-refuses-a-self-declared-reviewer.test.ts` were flipped from `planted(...)` to
 * `it(...)` — they now pass because the implementation is correct, not because they are expected to
 * fail. No `planted(...)` call remains in that file, so this manifest is intentionally EMPTY: an
 * empty `PLANTED_REDS` with zero discovered clauses is coverage, not a gap. Clause (2) stays the LIVE
 * counterweight it always was, and clause (6) was inverted into a closed-exploit regression guard
 * (still a plain `it`, never a `planted`) — see that file's own comments.
 */
export type PlantedRed = {
  file: string;
  /** The clause title, EXACTLY. Both the identity used for coverage and the vitest selector. */
  select: string;
  /** Regex the probe-mode failure output must match. */
  expected: RegExp;
  stage: "assertion";
};

export const PLANTED_REDS: readonly PlantedRed[] = [];

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
