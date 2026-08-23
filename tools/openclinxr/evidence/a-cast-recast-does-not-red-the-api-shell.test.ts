import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MPFB_GOWN_ADULT_PATIENT_GLB } from "../../../packages/openclinxr/asset-registry/src/cast-asset-constants.js";

/**
 * **OBSERVABLE: recasting an actor updates one constant, and no unrelated suite goes red.**
 *
 * ## MEASURED ON HEAD f6aab708, 2026-08-23 — do not re-derive
 *
 *     pnpm --filter @openclinxr/api test
 *       Tests  1 failed | 132 passed (133)
 *       FAIL src/app.test.ts > serves a learner-safe runtime asset bundle through an opaque bundle route
 *         Expected: "/generated-humanoids/ed_chest_pain_adult_cast.glb"
 *         Received: "/generated-humanoids/mpfb-gown-adult-patient.glb"
 *
 * The PRODUCT is correct. `5e3c88b2` (2026-08-20, "#491 L6: recast the seven Anny patients onto the
 * gowned MPFB body") deliberately moved the ED patient onto the gowned MPFB asset. The API test
 * still names the pre-recast basename, so `apps/api` has been RED on main for three days.
 *
 * ## THIS IS THE SECOND TIME, AND THE TEST SAYS SO ITSELF
 *
 * `apps/api/src/app.test.ts:115-120` carries its own account of the FIRST occurrence:
 *
 *     "#85 recast the adult ED roles off pediatric assets onto a promoted adult humanoid; the
 *      casting table is SSOT and the blob path follows it. This expectation still named the
 *      pre-#85 neutral humanoid and was RED on main from that merge until found — the top-level
 *      gate reported green from a stale turbo cache (#92)."
 *
 * Same defect, same file, same mechanism, one recast later. The lesson was written down and the
 * BRITTLENESS was left in place: the assertion repeats a basename that the casting table owns.
 *
 * ## THE SSOT ALREADY EXISTS AND IS UNCONSUMED BY THE TEST
 *
 * `cast-asset-constants.ts:97` exports `MPFB_GOWN_ADULT_PATIENT_GLB`. Two suites repeat the literal
 * instead of importing it — `apps/api/src/app.test.ts:121` and
 * `packages/openclinxr/asset-registry/src/asset-registry.test.ts:430`. D1: wire the proven constant,
 * do not re-type the string.
 *
 * ## WHAT THIS CONTRACT DOES NOT CLAIM
 *
 * It does NOT claim the gowned MPFB body is the right asset for an ED chest-pain patient, or that it
 * looks like a gown. The crudegown history is exactly why that is out of scope here: S0/S1/S2 landed
 * three green contracts on a garment the pixel grade showed as a floor-length evening dress. This
 * contract is about an assertion drifting from its SSOT, nothing more.
 *
 * claimScope: whether the API shell's actor-asset expectation tracks the casting SSOT.
 * notEvidenceFor: whether the cast choice is clinically right; garment appearance; any other suite.
 *
 * ## FIXED (#592)
 *
 * Both suites now import the casting constants through their package boundary instead of repeating
 * the literal:
 * - `apps/api/src/app.test.ts` imports `MPFB_GOWN_ADULT_PATIENT_GLB`, `PEDS_CHILD_GLB`,
 *   `PEDS_PARENT_GLB` from `@openclinxr/asset-registry` (which re-exports
 *   `cast-asset-constants.js`); the stale pre-#491 expectation and both peds fixture literals
 *   interpolate the constants.
 * - `packages/openclinxr/asset-registry/src/asset-registry.test.ts` adds
 *   `MPFB_GOWN_ADULT_PATIENT_GLB` to its existing `./index.js` import; line 430 interpolates it.
 * Clauses (1) and (2) flipped from `it.fails` to passing `it` clauses. No resolver, casting-table,
 * or constant value changed.
 */

const API_TEST = "apps/api/src/app.test.ts";
const REGISTRY_TEST = "packages/openclinxr/asset-registry/src/asset-registry.test.ts";
/** Any repeated `/generated-humanoids/<name>.glb` literal — the pattern that drifts. */
const HARDCODED_GLB = /["'`]\/generated-humanoids\/[A-Za-z0-9_.-]+\.glb["'`]/gu;

describe("a cast recast does not red the api shell", () => {
  it("(1) the api shell suite is green", async () => {
    // Today: 1 failed | 132 passed, on a stale basename. Fails here as a compile-free proxy so the
    // defect is visible without shelling out to another package's runner.
    const src = readFileSync(API_TEST, "utf8");
    const stale = src.includes("ed_chest_pain_adult_cast.glb");
    expect(stale, `${API_TEST} still names the pre-#491 basename; the cast moved on 2026-08-20`)
      .toBe(false);
  });

  it("(2) no suite repeats a generated-humanoids basename the casting table owns", () => {
    // Refuses the cheap fix on (1): swapping one literal for the CURRENT one leaves the same
    // brittleness and guarantees a third occurrence at the next recast.
    const offenders: string[] = [];
    for (const file of [API_TEST, REGISTRY_TEST]) {
      const hits = readFileSync(file, "utf8").match(HARDCODED_GLB) ?? [];
      if (hits.length > 0) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, "import the constant from cast-asset-constants.ts instead of repeating it")
      .toEqual([]);
  });

  it("(3) KNOWN-GOOD COLUMN: the SSOT constant exists and is the value the product resolves to", () => {
    // Pins the PREMISE. If the constant did not exist, clause (2) could be satisfied by deleting
    // the assertions rather than by wiring the SSOT, and this contract would be vacuous.
    expect(MPFB_GOWN_ADULT_PATIENT_GLB, "cast-asset-constants must export the gowned adult patient")
      .toBe("mpfb-gown-adult-patient.glb");
  });

  it("(4) COUNTERWEIGHT: the learner-safe assertions are still present in the api shell test", () => {
    // Refuses "delete the failing expectation". The route's identity guarantees are the reason that
    // test exists; a fix that removes assertions to reach green removes the guard with them.
    const src = readFileSync(API_TEST, "utf8");
    for (const field of ["tenantId", "userId", "examRunId", "encounterId"]) {
      expect(src.includes(`body.${field}`), `${API_TEST} must still assert ${field} is absent`).toBe(true);
    }
    expect(src.includes("productionCloudCall"), "the productionCloudCall guard must survive").toBe(true);
  });
});
