import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveHumanoidVariantOrCastPath } from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";
import { ADULT_POOL_GLBS } from "../../../packages/openclinxr/asset-registry/src/cast-asset-constants.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";

/**
 * OBSERVABLE: no actor the factory can author is cast onto the Anny rail.
 *
 * MEASURED 2026-08-25, do not re-derive. Operator P0 (#652): "kill all the anny rail models".
 *
 * The card's own contract, no-shipped-humanoid-is-anny-and-every-face-has-units.test.ts:105,:117,
 * does `resolver.includes(`${name}.glb`)` — a string search over the resolver's SOURCE TEXT. Deleting
 * literals turns it green while proving nothing. This contract CALLS the resolver instead.
 *
 * WHAT THE 42-ACTOR WALK SAYS, and why it is not the whole story. Calling
 * resolveHumanoidVariantOrCastPath once per bank actor with the real roster as `siblings`:
 *
 *   POPULATION scenarios=14 actors=42   ANNY RESOLUTIONS: 0 of 42   FALLBACK: 3
 *
 * So no learner meets an Anny asset TODAY. That measurement is correct and it does NOT license the
 * conclusion that the rail is inert — which is a conclusion the orchestrator drew and withdrew.
 *
 * THE LIVE PATH, reproduced twice (orchestrator + peer round). Twelve synthetic nurse-class actors in
 * one scenario, real siblings roster:
 *
 *   nurse_synthetic_1_v1  -> mpfb-clinical-nurse-adult
 *   nurse_synthetic_2_v1  -> ed_chest_pain_adult_cast      <== ANNY
 *   nurse_synthetic_3_v1  -> peds_anxious_parent           <== ANNY
 *   ... 7 of 12 resolve Anny assets.
 *
 * The shipped bank never reaches it because its actors resolve by actorId first, and its maximum
 * same-class count is 2. That is luck, not design: ONE authored actor turns "no learner meets Anny"
 * false. The mechanism is cast-asset-constants.ts:106 ADULT_POOL_GLBS — 5 MPFB members and SIX Anny
 * members — drained by actor-casting.ts:238 pickAdultGlb against a shared `used` set.
 *
 * THE MISNAMED LAST RESORT. actor-casting.ts:298-299 reads:
 *     // Exhausted pool — prefer gown body as last resort for clinical safety of default.
 *     return ED_ADULT_CAST_GLB;
 * ED_ADULT_CAST_GLB is "ed_chest_pain_adult_cast.glb" (cast-asset-constants.ts:24) — an ANNY asset.
 * The gown body is mpfb-gown-adult-patient.glb, which is MPFB and already leads the resolver for 7 of
 * 42 actors. The comment's stated intent and the constant disagree.
 *
 * DESTRUCTIVE PROBE, run before planting: n=6 same-class actors cast 4 of 6 onto Anny; n=14 (pool
 * length + 3) casts 9 of 14, and the LAST resolves `peds_anxious_parent` — an Anny asset, but NOT the
 * ED_ADULT_CAST_GLB named at actor-casting.ts:299. So clause (2) fails on a still-unexhausted pool
 * handing out Anny members, not necessarily on the :299 tail. The assertion holds either way; the
 * precise hop is NOT DETERMINED and the fixer should trace it rather than take this note as fact.
 *
 * FAILED TREATMENT, refused by clause (3): deleting the eight Anny GLBs while leaving the pool
 * membership intact. That leaves pickAdultGlb handing out paths to files that no longer exist, which
 * is worse than the defect. Clause (3) requires every resolved path to name a file on disk.
 *
 * FAILED TREATMENT, refused by clause (4): dropping actors onto the caller's fallbackPath instead of
 * casting them. The fallback set must EQUAL the three non-embodied actors and not grow.
 *
 * KNOWN-GOOD COLUMN: the 42-actor bank walk. It resolves 0 Anny and 0 missing files TODAY, and clause
 * (2) pins it, so a fix cannot regress the shipped bank while satisfying clause (1).
 *
 * NO SCALAR THRESHOLD APPEARS IN THIS CONTRACT. Every assertion is set membership or existence over an
 * enumerated population.
 *
 * claimScope: which asset the cast resolver returns for bank actors and for synthetic same-class
 *   rosters, and whether that file exists.
 * notEvidenceFor: whether any MPFB body is anatomically right, correctly clothed, within the triangle
 *   budget, or reads as the person the case describes; the comparatorOverridePath and generated-bundle
 *   paths, which this contract does not exercise.
 */

/** The eight raw Anny GLB stems shipped at 59,932,516 bytes, measured on main 2026-08-25. */
const ANNY_STEMS = [
  "adult_male_street_casual",
  "ed_chest_pain_adult_cast",
  "ed_chest_pain_nurse_adult",
  "ed_chest_pain_spouse_adult",
  "peds_anxious_parent",
  "peds_fever_patient_child",
  "peds_nurse_kevin",
  "peds_patient_child",
] as const;

/**
 * The three actors resolvePoolCastPathWithSiblings drops ON PURPOSE: role "system", and actorIds
 * matching /_phone_/ and /_tablet_/. None of them should have a body in the room. This is a SET, not a
 * count — "3 or fewer" would also green assigning a body to a phone.
 */
const NON_EMBODIED_ACTOR_IDS = new Set([
  "telehealth_system_v1",
  "neurology_consultant_phone_v1",
  "remote_interpreter_tablet_v1",
]);

/**
 * Resolved paths live under TWO public roots — /generated-humanoids for most bodies and
 * /xr-assets/humanoids/candidates for the peds parent's motion-bind GLB (#557). An earlier draft of
 * clause (3) hardcoded the first root and reported the parent as missing; the file exists and the
 * resolver returns the correct full path. Check the path the resolver ACTUALLY returns.
 */
const PUBLIC_ROOT = "apps/ui-xr/public";
const FALLBACK = "/generated-humanoids/__FALLBACK_SENTINEL__.glb";

const stemOf = (p: string): string => (p.split("/").pop() ?? p).replace(/\.glb$/u, "");
const isAnny = (p: string): boolean => ANNY_STEMS.includes(stemOf(p) as (typeof ANNY_STEMS)[number]);

type Roster = ReadonlyArray<{ actorId: string; role: string }>;
const resolveAll = (scenarioId: string, roster: Roster): { actorId: string; path: string }[] =>
  roster.map((a) => ({
    actorId: a.actorId,
    path: resolveHumanoidVariantOrCastPath({
      scenarioId, actorId: a.actorId, role: a.role, fallbackPath: FALLBACK, siblings: roster,
    }),
  }));

const bankRosters = (): { scenarioId: string; roster: Roster }[] =>
  (scenarioBank as unknown as { scenarioId: string; actors?: { actorId: string; role: string }[] }[])
    .map((s) => ({
      scenarioId: s.scenarioId,
      roster: (s.actors ?? []).map((a) => ({ actorId: a.actorId, role: a.role })),
    }));

describe("no actor can be cast onto the anny rail", () => {
  it.fails("(1) a same-class roster deep enough to drain the pool casts NO Anny asset", () => {
    // Six same-class actors in one scenario. The shipped bank's maximum is 2, so this is the
    // authored-actor case the bank has not reached yet — not a hypothetical.
    const roster: Roster = Array.from({ length: 6 }, (_, i) => ({
      actorId: `nurse_synthetic_${i + 1}_v1`, role: "nurse",
    }));
    const resolved = resolveAll("stepdown_sepsis_nurse_escalation_v1", roster);
    const anny = resolved.filter((r) => isAnny(r.path));
    expect(
      anny.map((r) => `${r.actorId} -> ${stemOf(r.path)}`),
      "a sixth nurse must not be cast onto the Anny rail; ADULT_POOL_GLBS carries six Anny members "
        + "and pickAdultGlb drains it against a shared used-set",
    ).toEqual([]);
  });

  it.fails("(2) the exhausted-pool last resort is not an Anny asset", () => {
    // actor-casting.ts:298 says "prefer gown body ... for clinical safety of default" and returns
    // ED_ADULT_CAST_GLB = ed_chest_pain_adult_cast.glb, which is Anny. The gown body is MPFB.
    const roster: Roster = Array.from({ length: ADULT_POOL_GLBS.length + 3 }, (_, i) => ({
      actorId: `overflow_actor_${i + 1}_v1`, role: "nurse",
    }));
    const last = resolveAll("stepdown_sepsis_nurse_escalation_v1", roster).at(-1);
    expect(
      last === undefined ? "NO RESOLUTION" : stemOf(last.path),
      "past the end of the pool the resolver must not fall back to an Anny body",
    ).not.toBeOneOf([...ANNY_STEMS]);
  });

  it("(3) KNOWN-GOOD: every bank actor still resolves, to a file that EXISTS, and none is Anny", () => {
    // Pins today's behaviour. Refuses the cheap fix of deleting the eight GLBs while leaving pool
    // membership intact, which would hand out paths to files that are gone.
    const missing: string[] = [];
    const anny: string[] = [];
    let population = 0;
    for (const { scenarioId, roster } of bankRosters()) {
      for (const r of resolveAll(scenarioId, roster)) {
        population += 1;
        if (r.path === FALLBACK) continue;
        if (isAnny(r.path)) anny.push(`${r.actorId} -> ${stemOf(r.path)}`);
        if (!existsSync(`${PUBLIC_ROOT}${r.path.startsWith("/") ? r.path : `/${r.path}`}`)) {
          missing.push(`${r.actorId} -> ${r.path}`);
        }
      }
    }
    expect(population, "the bank must not shrink out from under this contract").toBeGreaterThan(35);
    expect(anny, "no shipped bank actor may resolve an Anny asset").toEqual([]);
    expect(missing, "a resolved path must name a file that exists — presence of a name is not bytes")
      .toEqual([]);
  });

  it("(4) NET: the fallback set EQUALS the three non-embodied actors and does not grow", () => {
    // Refuses a fix that satisfies (1) by dropping actors onto the caller's fallback instead of
    // casting them. A count would green assigning a body to a phone; a set will not.
    const fellThrough = new Set<string>();
    for (const { scenarioId, roster } of bankRosters()) {
      for (const r of resolveAll(scenarioId, roster)) {
        if (r.path === FALLBACK) fellThrough.add(r.actorId);
      }
    }
    expect(
      [...fellThrough].sort(),
      "only the telehealth system, the phone consultant and the tablet interpreter may go unbodied",
    ).toEqual([...NON_EMBODIED_ACTOR_IDS].sort());
  });
});
