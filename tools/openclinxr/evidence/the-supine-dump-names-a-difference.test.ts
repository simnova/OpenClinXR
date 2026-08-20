import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #492, third instrument. **MEASURE ONLY. `reject_measured` closes this successfully.**
 *
 * ## WHY THIS IS THE THIRD ATTEMPT AND WHY IT IS NOT A FIX
 *
 * Two of my diagnoses of this regression have been withdrawn:
 *
 *   1. "the constant-offset gown skin tears under the supine transform" — DISPROVEN. The body
 *      itself is unposed; the gown rides whatever the body does.
 *   2. "the supine map binds 3 of 17 bones on the MPFB rig" — **FALSE**. It binds **17/17** through
 *      `resolvePoseBone` (`pose-bone-resolver.ts`), the #306 alias map: `pelvis->root`,
 *      `spine->spine03`, `chest->spine01`, `thighL->upperleg01L`, `handL->wristL`, `neck->neck01`,
 *      limbs to their first segments. I compared LITERAL joint names against the map keys; the
 *      runtime binds through a resolver.
 *
 * Both failures are one shape: **I measured a proxy and read its answer as the system's.** The rule
 * I broke is SS6v — *measure with the instrument the RUNTIME uses, not the one that reads the file.*
 *
 * So this contract does not ask for a fix. It asks for **one honest measurement**, and it encodes
 * the failure mode into clause (3).
 *
 * ## THE REGRESSION, GRADED — IMMUTABLE, and unaffected by why
 *
 *   ed_chest_pain_priority_v1           supine   CRUMPLED TEAL MASS
 *   ward_delirium_med_rec_v1            supine   CRUMPLED TEAL MASS
 *   postop_fever_consult_pressure_v1    supine   CRUMPLED TEAL MASS
 *   stepdown_sepsis_nurse_escalation_v1 supine   CRUMPLED TEAL MASS
 *   psych_suicidal_ideation_safety_v1   standing CORRECT
 *   ed_stroke_alert_handoff_v1          standing UNGRADEABLE (camera outside the room)
 *   adult_abdominal_pain_v1             standing not opened
 *
 * **4 of 4 supine broken. 1 of 3 standing confirmed correct.**
 *
 * ## THE INSTRUMENT ALREADY EXISTS — WIRE IT, DO NOT AUTHOR A FOURTH (D1)
 *
 * `apps/ui-xr/src/isolated-subject-lab.ts` renders ONE subject on the product three.js stack with
 * no room, no HUD, no other actors. `:253` handles `subjectKind: "runtime_posture"`, `:255` takes a
 * **parameterised `spec.bodyGlb`** (URL param at `:169`), and `:263` calls the real
 * `applyAndPlantSupineOnDeck`. Two subjects, one code path, already built.
 *
 *   control    generated-humanoids/ed_chest_pain_adult_cast.glb    (Anny — posed correctly for years)
 *   treatment  generated-humanoids/mpfb-gown-adult-patient.glb     (the recast body)
 *
 * ## WHAT THE DUMP MUST DISTINGUISH (SS10t)
 *
 * Not "produce numbers". The artifact must answer, for the SAME pose call on two bodies:
 *
 *   **which measured quantity differs, and by how much?**
 *
 * World-space, after `applyAndPlantSupineOnDeck` and `updateMatrixWorld(true)` — because **local
 * eulers can look identical while the figure is a wad**. At minimum per subject: world positions of
 * `root`, `upperleg01L/R` (or the Anny equivalents via the same resolver), `spine01`, both wrists
 * and `head`; and the posed mesh AABB.
 *
 * **If nothing differs beyond rig scale, that is `reject_measured`** — and it is a real finding,
 * because it would mean the pose is fine and the defect is downstream (skinning, the gown, the
 * capture). Say so; do not go looking for a fourth cause inside this slice.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                     | (1) both | (2) differs | (3) runtime-called | result
 *   ----------------------------------------------|----------|-------------|--------------------|--------
 *   a) today — no dump                             | **FAIL** |  **FAIL**   |     **FAIL**       | REFUSED
 *   b) read joint names/transforms out of the GLB  |   pass   |    pass     |     **FAIL**       | REFUSED
 *   c) dump one subject and reason about the other |**FAIL**  |  **FAIL**   |       pass         | REFUSED
 *   d) drive the lab on both, dump world state     |   pass   |    pass     |       pass         | ALL PASS
 *
 * **(b) is the one to watch, because it is the mistake I already made twice.** A static read of the
 * GLB produces a plausible table and answers a different question. Clause (3) requires the artifact
 * to record that it obtained its numbers by CALLING the pose function on a loaded graph.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1), (2) and (3) are RED** — no artifact exists.
 * **(4) passes today** and pins this slice to measure-only.
 *
 * NOT TESTED:
 *   - Any cause. Deliberately. Two of mine were wrong and a third guess is not evidence.
 *   - `seated`, the other postures, and the three standing stations.
 *   - Whether a difference, if found, is THE cause rather than a symptom.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DUMP = join(HERE, "supine-pose-two-subject-dump.json");
const SUPINE_POSE_SRC = join(REPO_ROOT, "apps/ui-xr/src/supine-pose.ts");
const CASTING_SRC = join(REPO_ROOT, "packages/openclinxr/asset-registry/src/actor-casting.ts");

const CONTROL = "ed_chest_pain_adult_cast.glb";
const TREATMENT = "mpfb-gown-adult-patient.glb";

type Subject = {
  bodyGlb: string;
  /** How the numbers were obtained. Clause (3) reads this. */
  obtainedBy: string;
  worldJoints: Record<string, { x: number; y: number; z: number }>;
  posedMeshAabb: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};
type Dump = {
  schemaVersion: string;
  verdict: "difference_named" | "reject_measured" | "other";
  verdictNote?: string;
  differingQuantities: { name: string; control: number; treatment: number; deltaMeters: number }[];
  subjects: Subject[];
};

function requireDump(): Dump {
  expect(existsSync(DUMP), `${DUMP} must exist — this slice is the measurement, not a fix`).toBe(true);
  return JSON.parse(readFileSync(DUMP, "utf8")) as Dump;
}

describe("the supine dump names a difference, or says there is none", () => {
  it.fails("(1) RED: both subjects were dumped through the same pose call", () => {
    const d = requireDump();
    const glbs = d.subjects.map((s) => s.bodyGlb.split("/").pop());
    expect(glbs, `control and treatment must BOTH be measured; reasoning about one is not a column`)
      .toEqual(expect.arrayContaining([CONTROL, TREATMENT]));
    for (const s of d.subjects) {
      expect(Object.keys(s.worldJoints).length, `${s.bodyGlb} must carry world joint positions`)
        .toBeGreaterThanOrEqual(5);
      expect(s.posedMeshAabb?.max, `${s.bodyGlb} must carry a posed mesh AABB`).toBeDefined();
    }
  });

  it.fails("(2) RED: the artifact names which quantity differs, or states that none does", () => {
    const d = requireDump();
    expect(["difference_named", "reject_measured", "other"]).toContain(d.verdict);
    if (d.verdict === "difference_named") {
      expect(d.differingQuantities.length, "name at least one differing quantity with both values")
        .toBeGreaterThan(0);
    }
    if (d.verdict === "other") {
      expect(d.verdictNote?.length ?? 0, "'other' requires a note").toBeGreaterThan(20);
    }
    // reject_measured needs no differing quantity — that IS the finding.
  });

  it.fails("(3) RED: the numbers came from CALLING the runtime pose, not from reading the GLB", () => {
    // Refuses (b) — the mistake I made twice on this very defect. A static glTF read produces a
    // plausible table and answers a different question (SS6v).
    const d = requireDump();
    for (const s of d.subjects) {
      expect(
        /applyAndPlantSupineOnDeck|applySupinePose|isolated-subject-lab/.test(s.obtainedBy ?? ""),
        `${s.bodyGlb}: obtainedBy must name the runtime pose path that produced these numbers; `
          + `got ${JSON.stringify(s.obtainedBy)}`,
      ).toBe(true);
      expect(
        /NodeIO|gltf-transform|read the glb/i.test(s.obtainedBy ?? ""),
        `${s.bodyGlb}: a static glTF read is not the runtime binding path`,
      ).toBe(false);
    }
  });

  it("(4) NET: this slice changes no product behaviour", () => {
    // Pins measure-only. Two withdrawn diagnoses is not the moment to edit the pose.
    const supine = readFileSync(SUPINE_POSE_SRC, "utf8");
    expect(supine.includes("SUPINE_BONE_EULERS"), "the euler map must be untouched").toBe(true);
    // CORRECTED ON THE PLANT RUN, and it is the same error family as the two withdrawn diagnoses:
    // I checked for the literal filename and `actor-casting.ts` references the CONSTANT
    // `MPFB_GOWN_ADULT_PATIENT_GLB` (0 literal occurrences, 8 constant occurrences). A text check
    // for a symbol's value is another proxy. Recorded rather than silently fixed.
    expect(
      readFileSync(CASTING_SRC, "utf8").includes("MPFB_GOWN_ADULT_PATIENT_GLB"),
      "the recast must stand — no revert inside a measurement slice",
    ).toBe(true);
  });
});
