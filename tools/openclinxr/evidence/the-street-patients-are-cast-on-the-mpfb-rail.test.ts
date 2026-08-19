import { existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { resolveHumanoidVariantOrCastPath } from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main 5294a8a5 — do not re-derive these rows
 *
 * #441 baked `mpfb-street-adult-male.glb` and landed it: 137 joints, library t-shirt and
 * cargo trousers with the hem 0.217H below its own knee joint, male shoe and hair rows.
 * The orchestrator graded it at native 1280x1280 — a recognisable adult male in a t-shirt
 * and trousers, not an evening dress.
 *
 * **Nothing casts it.** Enumerated live through `resolveScenarioActorCast` over
 * `listShippedCastScenarioIds()` — 39 actor slots, of which four are `street_casual`
 * patients and all four still resolve to the 23-joint Anny body:
 *
 *   telehealth_diabetes_health_literacy_v1     patient_luis_martinez_v1
 *   clinic_abdominal_pain_interpreter_v1       patient_lucia_morales_v1
 *   oncology_bad_news_family_v1                patient_david_miller_v1
 *   primary_care_dyslipidemia_joint_pain_v1    patient_mario_guzman_v1
 *
 *   all four -> /generated-humanoids/adult_male_street_casual.glb   (23 joints, NO trousers)
 *
 * This is the repo's characteristic defect in its purest form: a proven component wired to
 * nothing. #441 changed no learner-visible pixel because the resolver was out of its scope.
 *
 * ## THE RESOLVER IS DUAL AND BOTH COPIES MUST MOVE TOGETHER
 *
 * `actor-casting.ts:266-268` states the rule in the source:
 *
 *   > "Mirrors the runtime copy in humanoid-runtime-asset-url.ts (both must change
 *   >  together — the patient-attire dual-resolver agreement asserts this)."
 *
 * `apps/ui-xr/src/humanoid-runtime-asset-url.ts` carries its own pool order — the constant
 * at :48 and the pool pushes at :205, :219, :226, :236, :239 — and its header (:8-14)
 * explains WHY it is a mirror rather than an import: the asset-registry `dist/` is
 * gitignored, so importing a new named export from it fails the whole `main.ts` graph
 * after a src-only merge and times out `waitForStationShell` for EVERY scenario. That is
 * the #85 regression. A one-sided edit here reproduces it.
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h) — the agreement already holds, everywhere
 *
 * Probed live: **39 of 39 slots agree** between the two resolvers today, 0 disagree.
 * That is the baseline clause (3) protects. It is a strong known-good — not one example
 * but the entire population — and it is exactly what a one-sided edit destroys.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — nothing casts the MPFB body           |FAIL |FAIL |pass |pass | REFUSED
 *   b) edit actor-casting.ts only                    |pass |FAIL |**FAIL**|pass| REFUSED
 *   c) edit humanoid-runtime-asset-url.ts only       |FAIL |pass |**FAIL**|pass| REFUSED
 *   d) point the whole adult pool at the MPFB body   |pass |pass |pass |**FAIL**| REFUSED
 *   e) both copies, street_casual patients only      |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the one to watch** and it is the shape the first spec of this slice had. It
 * greens the registry, leaves the running app on the Anny path, and reintroduces #85.
 *
 * **(d) is the greedy version.** Pointing every adult slot at one new body would green
 * (1)-(3) and collapse the cast: the gown patients, the nurses and the family actors would
 * all become the same man. Clause (4) pins every non-street slot to the exact path it
 * resolves to today.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — the substitution MATCHED
 *
 * Planted row (b): pointed `ADULT_MALE_STREET_CASUAL_GLB` in `cast-asset-constants.ts` at
 * the MPFB file — the registry side ONLY — re-ran, reverted with `git checkout --`.
 *
 *   before: 2 failed | 3 passed   (1) and (2) red, (3) green at 39/39
 *   after:  2 failed | 3 passed   (1) GREEN, (2) still red, (3) RED with 4 disagreements
 *
 * The one-sided edit is a real path to greening clause (1), and clause (3) caught it on
 * the first attempt naming all four slots. Prediction and outcome agree on every cell of
 * row (b). The counterweight is what stands between this slice and the #85 regression.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1) and (2) are REDS — the four slots resolve to the Anny body in both resolvers today.
 *   (3) PASSES TODAY at 39/39 and is a pure net against (b) and (c).
 *   (4) PASSES TODAY — it pins the 35 non-street slots. Pure net against (d).
 *   (5) PASSES TODAY — it reads the population and the target asset, not the mapping.
 *
 * NOT TESTED:
 *   - **Appearance in a station.** This asserts which path resolves. Whether the figure
 *     reads correctly standing in a clinic room is a pixel grade the orchestrator owes
 *     after this lands, and no clause here is evidence for it.
 *   - **Fit quality.** The waistband ledge, torn trouser cuffs at the boot line, boot-toe
 *     poke-through and the grey-green throat patch graded on #441 are all still present.
 *     They ship to four stations the moment this lands. That is a known, accepted trade:
 *     bare legs and a pediatric top are worse than a fit defect.
 *   - **Age as geometry (#151).** The body is Kevin's macro to five decimals; a 58-year-old
 *     patient wears a 29-year-old's body. Unchanged by this slice and deliberately so.
 *   - **Within-scenario distinctness** for the four stations, none of which has a second
 *     adult male patient. Not re-derived here.
 *   - Quest budget. 12.4 MB and 66,676 triangles, unmeasured on hardware.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const MPFB_STREET_GLB = "mpfb-street-adult-male.glb";
const MPFB_STREET_RUNTIME_PATH = `/generated-humanoids/${MPFB_STREET_GLB}`;
const ANNY_STREET_RUNTIME_PATH = "/generated-humanoids/adult_male_street_casual.glb";

/** The four `street_casual` patient slots, measured on 5294a8a5. */
const STREET_SLOTS: readonly (readonly [string, string])[] = [
  ["telehealth_diabetes_health_literacy_v1", "patient_luis_martinez_v1"],
  ["clinic_abdominal_pain_interpreter_v1", "patient_lucia_morales_v1"],
  ["oncology_bad_news_family_v1", "patient_david_miller_v1"],
  ["primary_care_dyslipidemia_joint_pain_v1", "patient_mario_guzman_v1"],
];

type Slot = { sid: string; actorId: string; role: string; runtimeAssetPath: string };

function everySlot(): Slot[] {
  const out: Slot[] = [];
  for (const sid of listShippedCastScenarioIds()) {
    for (const a of resolveScenarioActorCast(sid) as unknown as Slot[]) {
      out.push({ ...a, sid });
    }
  }
  return out;
}

/** The runtime mirror's answer for one slot, with the roster it would see in the app. */
function uiPathFor(slot: Slot, all: Slot[]): string {
  return resolveHumanoidVariantOrCastPath({
    scenarioId: slot.sid,
    actorId: slot.actorId,
    role: slot.role,
    fallbackPath: slot.runtimeAssetPath,
    siblings: all.filter((s) => s.sid === slot.sid).map((s) => ({ actorId: s.actorId, role: s.role })),
  });
}

const slots = everySlot();
const isStreet = (s: Slot): boolean =>
  STREET_SLOTS.some(([sid, actorId]) => s.sid === sid && s.actorId === actorId);

/** SS7t: an empty enumeration must FAIL, never pass vacuously. */
function requireSlots(): Slot[] {
  expect(slots.length, "the cast enumeration is empty — this contract is measuring nothing").toBeGreaterThan(30);
  return slots;
}

describe("the street_casual patients are cast on the MPFB rail", () => {
  it("(1) RED: the registry resolver casts all four street patients to the MPFB body", () => {
    const wrong = requireSlots()
      .filter(isStreet)
      .filter((s) => s.runtimeAssetPath !== MPFB_STREET_RUNTIME_PATH)
      .map((s) => `${s.sid}/${s.actorId} -> ${s.runtimeAssetPath}`);
    expect(
      wrong,
      `these slots still resolve to the 23-joint Anny body (${ANNY_STREET_RUNTIME_PATH}), which carries no lower garment at all`,
    ).toEqual([]);
  });

  it("(2) RED: the ui-xr runtime mirror casts the same four to the same body", () => {
    // The mirror is what the running app calls. Greening (1) alone leaves the learner on Anny.
    const all = requireSlots();
    const wrong = all
      .filter(isStreet)
      .map((s) => ({ s, ui: uiPathFor(s, all) }))
      .filter(({ ui }) => ui !== MPFB_STREET_RUNTIME_PATH)
      .map(({ s, ui }) => `${s.sid}/${s.actorId} -> ${ui}`);
    expect(wrong, `the running app still loads the Anny body for these slots`).toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the two resolvers agree on every slot, not just the four", () => {
    // Refuses (b) and (c). Measured 39/39 agreement today; a one-sided edit is the #85 class,
    // which times out waitForStationShell for EVERY scenario, not just the one that moved.
    const all = requireSlots();
    const disagreements = all
      .map((s) => ({ s, ui: uiPathFor(s, all) }))
      .filter(({ s, ui }) => ui !== s.runtimeAssetPath)
      .map(({ s, ui }) => `${s.sid}/${s.actorId}: registry=${s.runtimeAssetPath} ui=${ui}`);
    expect(disagreements, `dual-resolver disagreement — actor-casting.ts:266-268 requires both copies to move together`).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: no non-street slot changes what it resolves to", () => {
    // Refuses (d). Pointing the whole adult pool at one body would green (1)-(3) and make the
    // gown patients, the nurses and the family actors all the same man.
    const moved = requireSlots()
      .filter((s) => !isStreet(s))
      .filter((s) => s.runtimeAssetPath === MPFB_STREET_RUNTIME_PATH)
      .map((s) => `${s.sid}/${s.actorId} (${s.role})`);
    expect(moved, `a non-street slot was pointed at the street patient's body`).toEqual([]);
  });

  it("(5) VACUITY GUARD: exactly four street slots exist and the target asset is real", async () => {
    // Reads the population and the asset, not the mapping, so it passes today and keeps passing.
    const street = requireSlots().filter(isStreet);
    expect(street.length, "the four street_casual patient slots must all still exist").toBe(4);
    const glb = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids", MPFB_STREET_GLB);
    expect(existsSync(glb), `${MPFB_STREET_GLB} must exist — casting at a missing file is worse than Anny`).toBe(true);
    const doc = await new NodeIO().read(glb);
    expect(
      doc.getRoot().listSkins()[0]?.listJoints().length ?? 0,
      "the target must be on the MPFB rail (137 joints), not a 23-joint Anny body under a new name",
    ).toBeGreaterThanOrEqual(100);
  });
});
