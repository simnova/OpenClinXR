import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * LANE C CAGEMATCH — physics-driven PLACEMENT, the half `#457` did not test.
 *
 * ## WHAT THIS ASKS, AND WHY IT IS NOT `#457` AGAIN
 *
 * `#457` returned `reject_measured` on Rapier's **kinematic character controller** for GROUNDING a
 * standing actor. Its own `NOT EVIDENCE FOR` says so explicitly: *"seated or supine — translation-
 * only, explicitly out of scope"*, and it says nothing about placement.
 *
 * **Physics-driven placement is a different mechanism.** Meta's own WebXR sample ("Chairs Etc.")
 * attaches furniture to DYNAMIC rigid bodies, drives them toward a raycast target with impulses,
 * lets them collide with real room colliders under gravity, and converts to static on confirmation.
 * That is `RigidBodyType::Dynamic` + `applyImpulse` + contact resolution — not a KCC shapecast.
 *
 * ## THE CONTROL COLUMN — hand-authored coordinate triples, and what they have cost
 *
 * Placement today is a literal per item per station:
 *
 *   runtime-bundles.ts:172   EncounterRuntimeEquipmentPlacement = {
 *                              position: { x: number; y: number; z: number };  <- authored
 *                              label: string; interactionCueIds: string[]; }
 *
 * across **14 shipped stations** (`listShippedCastScenarioIds()`), plus `roomProps`. Closed defects
 * that trace to a hand-derived triple rather than to a broken builder:
 *
 *   #247  three actors float above the floor in the ED stroke station
 *   #258  the generated bedside monitor renders ON THE FLOOR, oversized, clipping the frame
 *   #281  the monitor's preserved stand puts it in front of the family member
 *   #173  flat grey slabs intersect both actors' torsos, thighs and skull (oncology)
 *   #175  a fourth placement source rewrites actor positions last, written for visual review
 *   #206  a chair penetrated a desk; the fix moved a SHARED constant 1.5 m for a 1.5 cm graze
 *
 * That is the case for asking the question. It is **not** a prediction that physics wins — `#206`'s
 * real penetration was 15 mm, which is the kind of number an authored triple can absolutely hold.
 *
 * ## THIS CONTRACT PROVES THE BAKE-OFF RAN AND WAS RECORDED. IT DOES NOT PROVE A WINNER.
 *
 * `PROTO_BOARD_LOOP` lane C: *"`done_when` must prove the bake-off ran and was recorded — never that
 * a candidate won."* **A negative result closes the item.** `reject_measured` and
 * `inconclusive_blocked` are both first-class outcomes and neither reds a single clause here.
 *
 * The discriminator between those two, stated because listing a vocabulary is not defining it (SS9m):
 * **`reject_measured` = the bake-off RAN and the treatment lost or cost too much.
 * `inconclusive_blocked` = the bake-off never executed.**
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) artifact | (2) both cols | (3) real API | (4/5) fence | result
 *   -------------------------------------------------|--------------|---------------|--------------|-------------|--------
 *   a) today — no bake-off at all                     |  **FAIL**    |   **FAIL**    |  **FAIL**    |    pass     | REFUSED
 *   b) measure only the treatment, declare a winner   |    pass      |   **FAIL**    |    pass      |    pass     | REFUSED
 *   c) hand-roll a settle loop and call it physics    |    pass      |     pass      |  **FAIL**    |    pass     | REFUSED
 *   d) import rapier into apps/ui-xr to "prove" it    |    pass      |     pass      |    pass      |  **FAIL**   | REFUSED
 *   e) run both columns offline and record the numbers|    pass      |     pass      |    pass      |    pass     | ALL PASS
 *
 * **(b) is the one to watch.** A cagematch that measures only the candidate is an adoption with a
 * chart attached. Clause (2) requires both columns, the same length, over the same subjects.
 *
 * **PROBE CORRECTION, before this landed.** The table above predicts (2) is what stops (b). Probed:
 * with an empty control, (2) is an `it.fails` that stays satisfied and reports as an EXPECTED FAIL,
 * while **(6)** is the clause that actually REDS — `worst([])` is `-Infinity`, not finite. The suite
 * goes red either way and the cheat is refused, but by a different clause than I claimed. Recorded
 * rather than quietly corrected, because mislabelling which clause bites is the #227 defect itself
 * and I have now committed it twice in this file's lifetime.
 *
 * **(c) is the `#457` trap in a new costume.** Its clause (3) existed because a hand-rolled shapecast
 * would look like a controller. Here the equivalent cheat is a gravity loop with a floor clamp — it
 * settles things, it is not Rapier, and it teaches nothing about the engine.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1), (2) and (3) are RED** — no artifact exists on a
 * clean tree. **(4) and (5) pass today** and exist so no clause can be satisfied by promoting into
 * `apps/ui-xr`. **(6) is a VACUITY GUARD** on the acceptance band.
 *
 * NOT TESTED, and none of it is in scope:
 *   - Browser, WebXR, Quest, frame budget, thermals, body counts. Offline Node only.
 *   - ACTOR placement. Equipment and props only — `#457` already ruled on standing actors and its
 *     result must not be re-litigated here.
 *   - Whether the authored triples are *good*. Only whether they penetrate, and by how much.
 *   - Promotion. `apps/ui-xr` stays vanilla three.js whatever this returns.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const REPORT = join(HERE, "physics-placement-cagematch.json");
const FENCE = join(REPO_ROOT, "apps/ui-xr/src/static-assets.test.ts");
const UI_XR = join(REPO_ROOT, "apps/ui-xr/package.json");

/** Closed vocabulary WITH an escape value (SS7c) — the escape is where the real findings hide. */
const VERDICTS = ["adopt", "reject_measured", "inconclusive_blocked", "other"] as const;

/** The real Rapier dynamic-body placement surface. A gravity loop with a floor clamp is not this. */
const REQUIRED_API = ["RigidBodyDesc", "dynamic", "applyImpulse"] as const;

type Column = { subjectId: string; penetrationMeters: number; restingOnId: string | null }[];
type Report = {
  schemaVersion: string;
  verdict: (typeof VERDICTS)[number];
  verdictNote?: string;
  control: Column;
  treatment: Column;
  treatmentApi: string[];
  engineVersion: string;
  hazards: string[];
  rationale: string;
};

function requireReport(): Report {
  expect(existsSync(REPORT), `${REPORT} must exist — the bake-off must RUN, not be reasoned about`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

const worst = (c: Column): number => c.reduce((m, r) => Math.max(m, r.penetrationMeters), -Infinity);

describe("the physics-placement cagematch ran and was recorded", () => {
  it.fails("(1) RED: the artifact exists and names a verdict from the closed vocabulary", () => {
    const r = requireReport();
    expect(VERDICTS as readonly string[], `verdict was ${JSON.stringify(r.verdict)}`).toContain(r.verdict);
    // SS7c: `other` must never be silent — it is where an outcome neither of us imagined lands.
    if (r.verdict === "other") {
      expect(r.verdictNote?.length ?? 0, "verdict 'other' requires verdictNote explaining it").toBeGreaterThan(20);
    }
    expect(r.engineVersion, "record the engine version the bake-off actually ran").toMatch(/\d+\.\d+/);
  });

  it.fails("(2) RED: BOTH columns are populated, the same size, over the same subjects", () => {
    // Refuses (b). A cagematch that measures only the candidate is an adoption with a chart on it.
    const r = requireReport();
    expect(r.control.length, "the authored-placement control must be measured, not assumed").toBeGreaterThan(0);
    expect(r.treatment.length, "control and treatment must cover the same subjects").toBe(r.control.length);
    expect(
      r.treatment.map((x) => x.subjectId).sort(),
      "same subjects in both columns, or the comparison is between different things",
    ).toEqual(r.control.map((x) => x.subjectId).sort());
  });

  it.fails("(3) RED: the treatment used Rapier's real dynamic-body API", () => {
    // Refuses (c) — the SS457 trap in a new costume. A gravity loop with a floor clamp settles
    // objects and teaches nothing about the engine. Impulse-driven dynamic bodies are the subject.
    const r = requireReport();
    for (const api of REQUIRED_API) {
      expect(r.treatmentApi, `treatmentApi must name ${api}; a hand-rolled settle is not the subject`).toContain(api);
    }
  });

  it("(4) COUNTERWEIGHT: the ui-xr pre-production fence is untouched", () => {
    // Refuses (d). This is a cagematch, not a promotion — same clause SS457 carried, same reason.
    expect(
      readFileSync(FENCE, "utf8"),
      `apps/ui-xr/src/static-assets.test.ts must still forbid a rapier dependency in ui-xr`,
    ).toContain("@dimforge/rapier");
  });

  it("(5) COUNTERWEIGHT: apps/ui-xr declares no rapier dependency", () => {
    const m = JSON.parse(readFileSync(UI_XR, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(
      Object.keys({ ...m.dependencies, ...m.devDependencies }).filter((k) => k.includes("rapier")),
      `placement is a bake-time question; nothing here needs a runtime import`,
    ).toEqual([]);
  });

  it("(6) VACUITY GUARD: the comparison band comes from the CONTROL's own numbers", () => {
    // Refuses a band the worker picked. If the artifact is absent this clause is silent by design —
    // it guards the comparison, and (1)-(3) already fail loudly when there is nothing to compare.
    if (!existsSync(REPORT)) return;
    const r = requireReport();
    expect(Number.isFinite(worst(r.control)), "the control's worst penetration must be a real number").toBe(true);
    expect(
      r.rationale?.length ?? 0,
      "the verdict must be argued against the control's measured numbers, not asserted",
    ).toBeGreaterThan(40);
    expect(new Set(VERDICTS).size, "the vocabulary can express a loss").toBeGreaterThan(1);
  });
});
