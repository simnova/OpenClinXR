import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `pnpm packages:typecheck:agent` is RED on main, and has been since at least 2026-08-14.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 *   $ pnpm --filter @openclinxr/ui-xr typecheck        # tsgo --noEmit -p tsconfig.json
 *   src/runtime-state.ts:2808:83 - error TS2366: Function lacks ending return statement and
 *                                  return type does not include 'undefined'.
 *   Found 1 error in src/runtime-state.ts:2808
 *
 * EXACTLY ONE error, in the whole workspace: 65 of 67 turbo tasks succeed, `pnpm architecture`
 * exits 0, and every other package typechecks clean.
 *
 * ## WHY THIS IS SUBSTRATE, NOT A STYLE NIT
 *
 * Every dispatched brief tells its worker, verbatim:
 *
 *   VERIFY (stop at first failure): pnpm packages:typecheck:agent && pnpm architecture
 *
 * So every worker since 2026-08-14 has hit a red it did not cause, on the FIRST line of its verify
 * step, and had to decide alone whether to own it. Five consecutive retros name pre-existing
 * environment reds as the single largest waste of worker turns. This one is not environment — it is
 * on main, and it is one function.
 *
 * ## PROVENANCE — this is nobody's live slice
 *
 *   git log -1 -- apps/ui-xr/src/runtime-state.ts
 *     e4efbcc7  2026-08-14  wip(#309): tools typecheck 6,329 -> 52 errors; committed by the orchestrator
 *
 *   git diff --name-only 14c5d237..HEAD | grep -c runtime-state.ts   ->   0
 *
 * Today's landings (#473, #480) touched neither the file nor the package's sources. The mass
 * error-reduction commit that last touched it left this one behind, and the gate has reported the
 * failure ever since with nobody reading past the exit code (SS9p, and the #55 class again).
 *
 * ## THE CAUSE IS NOT KNOWN TO ME BEYOND THAT OUTPUT
 *
 * The switch at :2818 appears to cover the whole union declared at :203 —
 * `"none" | "keyboard" | "xr_gamepad" | "xr_hand_gesture" | "xr_room_scale" | "mixed"` — plus
 * `undefined` for the optional property, and the two `if` guards above it return early. Why `tsgo`
 * still finds the function non-exhaustive is UNDETERMINED. Trace it; do not take that reading as
 * fact. My last three diagnoses in this area were each withdrawn.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) green | (2) no suppress | (3) exhaustive | result
 *   -------------------------------------------------|-----------|-----------------|----------------|--------
 *   a) today — one TS2366                             | **FAIL**  |      pass       |     pass       | REFUSED
 *   b) @ts-expect-error above the signature           |   pass    |    **FAIL**     |     pass       | REFUSED
 *   c) add `default: return "not_attempted"`          |   pass    |      pass       |   **FAIL**     | REFUSED
 *   d) widen the return type to include undefined     |   pass    |      pass       |   **FAIL**     | REFUSED
 *   e) narrow so the compiler proves exhaustiveness   |   pass    |      pass       |     pass       | ALL PASS
 *
 * **(c) is the one to watch.** A `default:` clause is the one-line fix any engineer reaches for, and
 * it is the WORST outcome available: it silences the compiler forever, so the day someone adds a
 * seventh locomotion source the new case silently reports `not_attempted` instead of failing the
 * build. The whole value of this switch is that it breaks when the union grows. Clause (3) requires
 * the function to keep NO `default:` and to keep naming every member.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today — they
 * exist so (1) cannot be satisfied by suppressing or by defaulting. (4) is a NET on the sibling
 * package gate.
 *
 * NOT TESTED:
 *   - The other 66 turbo typecheck tasks. This bounds `@openclinxr/ui-xr` only; a workspace-wide
 *     assertion would take minutes per run and this contract must stay cheap enough to keep.
 *   - `pnpm test`. Typecheck green does not mean the runtime behaves — nothing here claims it does.
 *   - Whether the union SHOULD gain a seventh member. Not this slice's question.
 */

/**
 * ## FIXED (#482)
 *
 * Root cause, traced (not assumed): `tsconfig.base.json` sets `exactOptionalPropertyTypes: true`.
 * Under that flag the `undefined` contributed by an optional property
 * (`activeLocomotionSource?: Src`) is a *synthetic* undefined, and a `case undefined:` label does
 * NOT cover it for switch-exhaustiveness — so TS2366 fires even though the switch names all six
 * members plus `undefined`. Confirmed with both `tsgo` and `tsc` 6.0.3 on a minimal repro; the
 * behavior is not tsgo-specific.
 *
 * Fix: the property union at `runtime-state.ts:203` now declares `| undefined` explicitly, the
 * `exactOptionalPropertyTypes` idiom for "absent or explicitly undefined". That makes
 * `case undefined:` count toward exhaustiveness with no `default:`, no suppression, and the
 * function return type unchanged.
 *
 * Also corrected a latent assertion bug in clause (1) itself: the planted form
 * `errors.join("\n") || \`exit ${run.code}\`` evaluates to `"exit 0"` on a GREEN run (empty errors,
 * exit 0), so the flipped assertion could not pass when the gate is actually green. It now asserts
 * on `errors.join("\n")` directly; the separate `expect(run.code).toBe(0)` still catches a crash
 * that prints no TS error lines. The header's measured tables and provenance are unchanged.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const RUNTIME_STATE = join(REPO_ROOT, "apps/ui-xr/src/runtime-state.ts");
const FN = "locomotionAttemptFromEvidence";

/** The six members declared at runtime-state.ts:203, plus the optional-property `undefined`. */
const LOCOMOTION_SOURCES = [
  "none",
  "keyboard",
  "xr_gamepad",
  "xr_hand_gesture",
  "xr_room_scale",
  "mixed",
] as const;

type Run = { code: number; out: string };

function typecheck(filter: string): Run {
  try {
    const out = execFileSync("pnpm", ["--filter", filter, "typecheck"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // A cold tsgo run on ui-xr measured ~25 s here; SS390 records a known-good column going red
      // purely on a 5 s default, so this is generous on purpose.
      timeout: 300_000,
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** The function body, from its signature to the closing brace at column 0. */
function functionBody(): string {
  const src = readFileSync(RUNTIME_STATE, "utf8");
  const start = src.indexOf(`function ${FN}(`);
  expect(start, `${FN} must still exist in runtime-state.ts`).toBeGreaterThan(-1);
  const end = src.indexOf("\n}", start);
  expect(end, `${FN} must have a closing brace`).toBeGreaterThan(start);
  return src.slice(start, end + 2);
}

describe("the ui-xr typecheck gate is green", () => {
  it("(1) RED: @openclinxr/ui-xr typechecks with zero errors", () => {
    const run = typecheck("@openclinxr/ui-xr");
    const errors = run.out.split("\n").filter((l) => /error TS\d+/.test(l));
    expect(
      errors.join("\n"),
      `tsgo must report no errors; every dispatched brief runs this gate as its first verify step`,
    ).toBe("");
    expect(run.code, "the gate must exit zero").toBe(0);
  }, 300_000);

  it("(2) COUNTERWEIGHT: the fix is not a suppression", () => {
    // Refuses (b). merge-kill already kills a NEW eslint-disable / @ts-expect-error in source, but it
    // compares against main's tip — so a suppression added in the same slice that removes the error
    // is exactly the shape a tip-relative check is weakest against. Asserted here on the function.
    const body = functionBody();
    for (const marker of ["@ts-ignore", "@ts-expect-error", "eslint-disable"]) {
      expect(body.includes(marker), `${FN} must not carry ${marker}`).toBe(false);
    }
  });

  it("(3) COUNTERWEIGHT: the switch stays exhaustive — no default, every member named", () => {
    // Refuses (c) and (d). A `default:` silences the compiler permanently: add a seventh locomotion
    // source and the new case reports "not_attempted" instead of failing the build. The switch is
    // load-bearing precisely because it breaks when the union grows.
    const body = functionBody();
    expect(/\n\s*default\s*:/.test(body), `${FN} must not gain a default: clause`).toBe(false);
    for (const member of LOCOMOTION_SOURCES) {
      expect(body.includes(`case "${member}":`), `${FN} must still name case "${member}"`).toBe(true);
    }
    expect(body.includes("case undefined:"), `${FN} must still handle the optional property`).toBe(true);
    // (d): the declared return type must not be widened to admit undefined.
    expect(
      /\):\s*LocomotionAttempt\s*\{/.test(body),
      `${FN} must keep returning LocomotionAttempt, not LocomotionAttempt | undefined`,
    ).toBe(true);
  });

  it("(4) NET: a sibling package still typechecks, so the gate itself is not broken", () => {
    // KNOWN-GOOD COLUMN (SS9h). If tsgo or the turbo task were broken workspace-wide, clause (1)
    // would be unachievable rather than merely red, and this says which. Measured today: 65 of 67
    // turbo typecheck tasks succeed.
    const run = typecheck("@openclinxr/asset-registry");
    expect(run.code, `the sibling gate must be green; it exited ${run.code}:\n${run.out.slice(-800)}`).toBe(0);
  }, 300_000);
});
