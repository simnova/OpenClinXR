/**
 * Failure shapes that mean the INSTRUMENT is broken, whatever else matched. A clause dying on any of
 * these is not red for its own reason even if its message happens to contain the expected substring.
 *
 * Internal module (not an entrypoint): probe-planted-reds.mts consumes it by relative path.
 * Previously published via ./planted-red-manifest; unpublished 2026-10-08 (no contracted consumer
 * binds it) while keeping the symbol for the in-package probe.
 */
export const INSTRUMENT_FAILURES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /ReferenceError/, why: "a symbol the clause references does not exist" },
  { pattern: /Cannot find module '\/(?!Volumes)/, why: "a mangled relative specifier - the M1 defect of 2026-08-29" },
  { pattern: /Test timed out/, why: "the clause hung rather than asserting" },
  { pattern: /SyntaxError/, why: "the file does not parse" },
];
