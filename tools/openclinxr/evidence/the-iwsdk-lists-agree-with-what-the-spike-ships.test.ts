import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #456 — two IWSDK instruments disagree with the tree they are grading.
 *
 * Found by the #455 worker in its out-of-scope slot. Both are mine, not its.
 *
 * ## MEASURED (orchestrator, 2026-08-19) — and WIDER than the card first said
 *
 * The spike declares five `@iwsdk/*` packages:
 *   @iwsdk/core  @iwsdk/xr-input  @iwsdk/scene-composition
 *   @iwsdk/vite-plugin-dev  @iwsdk/vite-plugin-uikitml
 *
 * **Review table** (`iwsdk-npm-currentness-check.ts:129-149`) — declared but NOT reviewed:
 *   @iwsdk/scene-composition        <- the gate reviews 2 of the 3 RUNTIME packages
 *
 * **Posture check** on the real workspace: `EXIT 1`, and it refuses THREE shipping packages,
 * not the one the card first reported:
 *   @iwsdk/scene-composition : not_allowed_in_first_slice
 *   @iwsdk/vite-plugin-dev   : not_allowed_in_first_slice + review_required_package
 *   @iwsdk/vite-plugin-uikitml: not_allowed_in_first_slice + review_required_package
 *
 * Cause: `packages/openclinxr/arena/iwsdk-spike/src/index.ts:1075` holds
 * `allowedFirstSlicePackages: ["@iwsdk/core", "@iwsdk/xr-input"]`. **The workspace outgrew its
 * "first slice" allowlist and nobody moved the allowlist.** `:1961` already shows the extension
 * mechanism — a derived policy that appends a phase-2 package — so this is a list that was meant
 * to grow and did not.
 *
 * ## SCOPE — deliberately narrower than the measurement
 *
 * Only `@iwsdk/scene-composition` is sanctioned in this slice. It is a RUNTIME dependency,
 * installed, typechecking, and part of the 0.5.3 bump that landed in #455.
 *
 * The two vite plugins are **left refused on purpose and are NOT this slice's business.** They
 * are devDependencies carrying a known, still-live `vite ^7.0.0` peer conflict against a catalog
 * on 8.0.16, so `review_required_package` may well be the correct verdict for them. Whether
 * `not_allowed_in_first_slice` is also correct for a package the spike actually ships is a policy
 * question above this slice, recorded and escalated rather than decided here. Clause (5) pins
 * them refused so nobody quietly widens the allowlist to make the gate green.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED   — the review table omits a package the spike declares. Fails on the tree.
 *   (2) RED   — the posture check refuses `scene-composition`. Fails today for TWO reasons:
 *               the artifact does not exist yet, and the refusal is real. Only the second is
 *               the defect; writing the artifact is what makes this clause meaningful at all.
 *   (3) NET   — the spike still declares it. Passes today, must keep passing.
 *   (4) NET   — sidecar-only. Passes today, must keep passing.
 *   (5) NET-BEHIND-THE-GATE — the two vite plugins stay refused. This is a counterweight in
 *               INTENT but it **fails today**, purely because `pre-fix.json` is absent and its
 *               `requirePostureBlockers()` throws. It flips green the moment the artifact is
 *               written and must stay green thereafter. I first declared it "passes today",
 *               which was wrong, and the first run of this file caught me — recorded rather
 *               than quietly corrected, because a wrong REDs-vs-nets line misleads whoever
 *               reads the run output next.
 *   (6) GUARD — the lists are non-empty and really read, so absence is real absence.
 *
 * So a clean tree shows **3 failing / 3 passing**, and the honest reading of those three is
 * "one real product defect (1), one real product defect gated behind a missing artifact (2),
 * and one counterweight that cannot speak until the artifact exists (5)".
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) add a review-table row, never touch posture      -> (2) fails
 *   b) DELETE scene-composition from the spike           -> (3) fails; the spike runs it
 *   c) widen the allowlist to every @iwsdk/*             -> (5) fails; that is a policy change
 *   d) disable or skip the posture check                 -> (2) fails; it must PASS, not vanish
 *   e) add @iwsdk to apps/ui-xr                          -> (4) fails
 *
 * **(b) is the one to watch.** Making a checker green by removing the thing it objects to is the
 * cheapest possible fix and it deletes a working runtime dependency. Clause (3) refuses it.
 *
 * NOT TESTED:
 *   - **Other posture refusals besides this key.** The two vite plugins stay red by design and
 *     nobody has audited what else that checker refuses.
 *   - Whether `not_allowed_in_first_slice` is the right verdict for a shipping devDependency.
 *     Escalated, not decided.
 *   - That the review table's OTHER entries are right. Five reviewed packages are not declared by
 *     the spike at all (`glxf`, `locomotor`, `reference`, two vite plugins) — that is correct,
 *     they are observations of npm latest rather than pins, and it is not this slice's subject.
 *   - Anything in `apps/ui-xr`, in a browser, or on a headset.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const SPIKE = join(REPO_ROOT, "apps/arena/ui-xr-iwsdk-spike/package.json");
const UI_XR = join(REPO_ROOT, "apps/ui-xr/package.json");
const RUNNER = join(HERE, "iwsdk-npm-currentness-check.ts");
const PRE_FIX = join(REPO_ROOT, ".openclinxr/evidence/issue-456/pre-fix.json");

const SANCTIONED = "@iwsdk/scene-composition";
/** Left refused on purpose — see SCOPE. */
const STILL_REFUSED = ["@iwsdk/vite-plugin-dev", "@iwsdk/vite-plugin-uikitml"] as const;

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const allDeps = (p: string): Record<string, string> => {
  const m = JSON.parse(readFileSync(p, "utf8")) as Manifest;
  return { ...m.dependencies, ...m.devDependencies };
};
const spikeIwsdkPackages = (): string[] =>
  Object.keys(allDeps(SPIKE)).filter((k) => k.startsWith("@iwsdk/")).sort();

/** Package names in the review table, read from the source block, not guessed. */
function reviewedPackages(): string[] {
  const src = readFileSync(RUNNER, "utf8");
  const start = src.indexOf("const expectedPackages");
  expect(start, "expectedPackages must exist in the runner").toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("\n];", start));
  return [...new Set([...block.matchAll(/name:\s*"(@iwsdk\/[^"]+)"/gu)].map((m) => m[1] as string))].sort();
}

/**
 * The posture blockers recorded by the pre-fix measurement, which the brief requires to be
 * written BEFORE any product edit. Reading the artifact rather than shelling out keeps this
 * contract fast and deterministic; the `done_when` runs the real checker separately.
 */
type PreFix = { postureBlockers?: string[] };
const preFix: PreFix | null = existsSync(PRE_FIX)
  ? (JSON.parse(readFileSync(PRE_FIX, "utf8")) as PreFix)
  : null;

function requirePostureBlockers(): string[] {
  expect(
    preFix,
    `.openclinxr/evidence/issue-456/pre-fix.json must exist and record postureBlockers — run `
      + `iwsdk-workspace-posture-check on the REAL workspace and capture its blockers BEFORE any edit`,
  ).not.toBeNull();
  const blockers = preFix?.postureBlockers;
  expect(Array.isArray(blockers), "postureBlockers must be an array").toBe(true);
  return blockers as string[];
}

describe("the IWSDK lists agree with what the spike ships", () => {
  it("(1) RED: every @iwsdk package the spike declares appears in the review table", () => {
    const declared = spikeIwsdkPackages();
    const reviewed = reviewedPackages();
    const missing = declared.filter((d) => !reviewed.includes(d));
    expect(
      missing,
      `the currentness gate reviews only what is in expectedPackages; anything the spike ships and `
        + `the table omits moves without the gate noticing`,
    ).toEqual([]);
  });

  it("(2) RED: the posture check does not refuse the sanctioned runtime package", () => {
    // Refuses (a) and (d). The checker must PASS on this key, not be skipped or deleted.
    const blockers = requirePostureBlockers();
    expect(
      blockers.filter((b) => b.startsWith(`${SANCTIONED}:`)),
      `${SANCTIONED} is installed, typechecking and part of the landed 0.5.3 bump — a checker `
        + `calling it not_allowed while the spike ships it is the one position that cannot be right`,
    ).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the spike still declares the sanctioned package", () => {
    // Refuses (b). Making a checker green by deleting what it objects to is the cheapest fix
    // available and it removes a working runtime dependency.
    expect(spikeIwsdkPackages(), `${SANCTIONED} must stay a spike dependency`).toContain(SANCTIONED);
  });

  it("(4) COUNTERWEIGHT: apps/ui-xr carries no @iwsdk dependency — sidecar-only holds", () => {
    // Refuses (e). Behavioural, reading the resolved map rather than matching source text.
    expect(
      Object.keys(allDeps(UI_XR)).filter((k) => k.startsWith("@iwsdk/")),
      `apps/ui-xr stays vanilla three.js`,
    ).toEqual([]);
  });

  it("(5) COUNTERWEIGHT: the two vite plugins stay refused — the allowlist is not widened wholesale", () => {
    // Refuses (c). Sanctioning one runtime package is this slice; re-deciding the first-slice
    // policy for build tooling with a live vite peer conflict is not.
    const blockers = requirePostureBlockers();
    for (const name of STILL_REFUSED) {
      expect(
        blockers.some((b) => b.startsWith(`${name}:`)),
        `${name} must remain refused — its vite ^7.0.0 peer is still live against a catalog on 8.0.16, `
          + `and widening the allowlist wholesale would hide that`,
      ).toBe(true);
    }
  });

  it("(6) VACUITY GUARD: both lists are non-empty and really read", () => {
    expect(spikeIwsdkPackages().length, "the spike declares @iwsdk packages").toBeGreaterThan(2);
    expect(reviewedPackages().length, "the review table is non-empty").toBeGreaterThan(2);
    expect(spikeIwsdkPackages()).toContain(SANCTIONED);
    for (const name of STILL_REFUSED) expect(spikeIwsdkPackages()).toContain(name);
  });
});
