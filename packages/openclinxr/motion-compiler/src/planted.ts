import { it } from "vitest";

/**
 * `planted` is `it.fails` normally and `it` under `OPENCLINXR_PROBE_REDS=1`.
 *
 * ## Why this exists
 *
 * A planted RED must fail for the reason it was written for. Twice in two days one did not:
 *
 *   - M1's clauses (1) and (2) failed on a MANGLED FIXTURE PATH from d1ad5063 onward, never on the
 *     absent planner they exist to demand. `../../` in a path variable under `@vite-ignore` is
 *     resolved natively and mangles to `/scenario-fixtures/src/...`. That helper ran on the first
 *     line of both clauses.
 *   - The contact clause claimed to check every sampled frame while its oracle did nearest-KEY
 *     lookup, so it never evaluated the interpolation it was written to bound.
 *
 * Both were invisible because `it.fails` reports only that a test failed, never why. A suite of
 * green "expected fail" counts is compatible with every clause dying on a typo.
 *
 * ## Why a wrapper rather than rewriting the files
 *
 * The audit that found these ran `sed` over the source to flip `it.fails` to `it`, then copied the
 * originals back. That works and it is fragile: it mutates tracked files, it cannot run in CI, and a
 * failure between the flip and the restore leaves the tree wrong. An env-gated wrapper needs no
 * source mutation and runs anywhere.
 *
 * ## The contract this creates
 *
 * A clause registered in `planted-red-manifest.ts` must, in probe mode, fail with a message matching
 * its recorded fingerprint. A clause that starts failing for a DIFFERENT reason is a broken
 * instrument. A clause that starts PASSING is a contract transition and must be recorded
 * deliberately, not discovered later.
 */
export const planted: typeof it.fails = process.env["OPENCLINXR_PROBE_REDS"] === "1" ? (it as typeof it.fails) : it.fails;
