import { it } from "vitest";

/**
 * `planted` is `it.fails` normally and `it` under `OPENCLINXR_PROBE_REDS=1`.
 *
 * A SECOND COPY, and deliberately so. The motion-compiler package carries an identical wrapper, and
 * this repo has spent a week removing duplicate declarations — so the difference is worth stating.
 * What must never be duplicated is a CONTRACT: a type, a value space, a vocabulary, anything two
 * plants can drift apart on. This is a one-line env gate with no shape to drift. Sharing it would
 * mean review-workflow importing from motion-compiler, which is a package dependency that does not
 * otherwise exist and would be a worse trade than two identical lines.
 *
 * ## Why it exists
 *
 * `it.fails` reports THAT a test failed and never WHY, so a suite of green expected-fail counts is
 * compatible with every clause dying on a typo. Twice in the motion package a planted clause failed
 * for a reason nobody intended — one on a mangled fixture path for a full day — and neither was
 * visible until the clause was run in probe mode.
 *
 * This package's four attestation REDs were covered by no standing gate at all when they were
 * planted; that was recorded as a residual at the time and this closes it.
 */
export const planted: typeof it.fails = process.env["OPENCLINXR_PROBE_REDS"] === "1" ? (it as typeof it.fails) : it.fails;
