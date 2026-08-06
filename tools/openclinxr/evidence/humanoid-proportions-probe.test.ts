import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#56) — nothing in this repo measures whether a humanoid is shaped like a human.
 *
 * Read the renders and the figure is destroyed: torso collapsed into a flat wedge, arms elongated
 * into tubes reaching below the feet, the garment an oversized slab. Four evidence directories from
 * 2026-08-02 — every one of them named as a fix — show it for both parent and nurse.
 *
 * At the same moment: `peds_anxious_parent_rigging_report.json` says `ok: true` with
 * `skinning { maxInfluences: 4, normalized: true }` on a canonical armature, and the runtime's
 * `inspection.json` says `hasVisibleVolume: true`, `hasSeamFoldHints: true`,
 * `deform_with_body`. Both gates green, both describing a figure that does not exist.
 *
 * `tools/openclinxr/evidence/humanoid-vision-score.ts` exists but is an LLM rubric, not a gate, and
 * carries the #46 producer/grader problem. There is no geometric check anywhere.
 *
 * WHAT THIS CONTRACT DOES AND DOES NOT DECIDE. It proves the INSTRUMENT works — that a proportion
 * probe classifies a plainly-human skeleton as sound and a plainly-broken one as unsound. It does
 * NOT assert where the real bug lives. The peer round was explicit that GLB bind pose, runtime
 * skinning and capture are three different suspects and nothing available distinguishes them from
 * the outside, so a contract asserting "the parent GLB is bad" would be guessing.
 *
 * That is why the fixtures below are SYNTHETIC. A test that loads the real asset and asserts it
 * fails would encode an answer nobody has measured; if the GLB turns out sound and the runtime
 * deforms it, that assertion is unsatisfiable and the worker would be pushed to force it.
 *
 * The measurement of the real assets is the SLICE's deliverable, recorded in a report — not an
 * assertion here.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `assessHumanoidProportions({ joints })`
 * returning `{ sound, violations }`. Change the call sites and say why if a different shape is
 * better. What must not change: a correct skeleton passes, arms-below-feet fails, and neither is
 * decided by a file size or a JSON string.
 */

type Joint = { name: string; y: number; x?: number; z?: number };
type Assess = (input: { joints: readonly Joint[] }) => { sound: boolean; violations: string[] };

const load = async () => import("./humanoid-proportions-probe.js") as Promise<Record<string, unknown>>;

/** A plainly human arrangement, Y-up: hands hang near mid-thigh, well above the ankles. */
const SOUND_SKELETON: Joint[] = [
  { name: "head", y: 1.70 },
  { name: "neck", y: 1.55 },
  { name: "chest", y: 1.35 },
  { name: "clavicle.L", y: 1.45, x: -0.15 },
  { name: "upper_arm.L", y: 1.42, x: -0.20 },
  { name: "forearm.L", y: 1.15, x: -0.22 },
  { name: "hand.L", y: 0.90, x: -0.23 },
  { name: "pelvis", y: 1.00 },
  { name: "thigh.L", y: 0.95, x: -0.10 },
  { name: "shin.L", y: 0.50, x: -0.10 },
  { name: "foot.L", y: 0.06, x: -0.10 },
];

/** The failure actually observed: hands below the feet, so the arms read as tubes past the ankles. */
const ARMS_BELOW_FEET: Joint[] = SOUND_SKELETON.map((joint) =>
  joint.name === "hand.L" ? { ...joint, y: -0.15 } : joint,
);

describe("humanoid proportion probe (#56)", () => {
  it("accepts a plainly human skeleton", async () => {
    const mod = await load();
    const assess = mod["assessHumanoidProportions"] as Assess | undefined;
    expect(assess).toBeTypeOf("function");
    // Guards the lazy inverse: a probe that calls everything broken would satisfy the test below.
    expect(assess!({ joints: SOUND_SKELETON }).sound).toBe(true);
  });

  it("rejects a skeleton whose hands hang below its feet", async () => {
    const mod = await load();
    const assess = mod["assessHumanoidProportions"] as Assess | undefined;
    expect(assess).toBeTypeOf("function");
    // This is the deformation in the 2026-08-02 captures, reduced to the one measurable that
    // no byte count, traverse tag or JSON string caught.
    const result = assess!({ joints: ARMS_BELOW_FEET });
    expect(result.sound).toBe(false);
    expect(result.violations.join(" ")).toMatch(/hand|arm|ankle|foot/i);
  });
});
