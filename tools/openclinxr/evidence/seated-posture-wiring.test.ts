import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#81) — the telehealth patient stands in a living room with a marker cube for a chair.
 *
 * ALL FOUR `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#81)` block below, and leave the measured facts intact.
 *
 * MEASURED, so you do not re-derive it:
 *
 *   - Mesh2Motion's library holds 162 clips (87 base + 75 addon) at
 *     /tmp/ocxr77_tools/mesh2motion-app/static/animations/. Mostly game/action, but it contains
 *     Sitting_Enter / Sitting_Idle / Sitting_Talking / Sitting_Exit, Idle Listening, Head Nod.
 *   - LICENCE: LICENSE-CC0.MD covers "All 3d models, blend files, rigs, ANIMATIONS" — the motion data
 *     is CC0. EXCLUDE static/animations/CarnegieMellonAnimations/ entirely: its own readme points at
 *     rancidmilk.itch.io, so it is neither CMU nor covered by that grant.
 *   - THERE IS NO CHAIR. `patient_chair` is a fixture SLOT (environment-descriptors.ts:314) and
 *     station-environment.ts:104-119 builds a 0.18 x 0.06 x 0.18 MARKER CUBE per slot, commented
 *     "tiny visible cubes so captures differ by layout". `parent_chair_equipment` is named at
 *     main.ts:1173-1174 but no such GLB exists under apps/ui-xr/public/xr-assets/medical-equipment/
 *     — only ecg-cart and iv-pole are there.
 *   - THERE IS NO POSTURE FIELD. EncounterRuntimeActorPlacement is slotKind, position, scale,
 *     verticalOffsetMeters, labelPrefix (runtime-bundles.ts:138-144).
 *   - BUT HALF THE PLUMBING EXISTS: actor-floor-composition.ts:12-16,:54-68 already skips the
 *     feet-on-floor check for non-standing postures. It was written expecting a concept nobody added.
 *
 * THIS IS SPIKE-GATED AND THAT IS THE HONEST SHAPE. The 66->23 bone map is mechanical for the
 * load-bearing chain (pelvis, spine collapse, neck, head, clavicle, upper_arm, forearm, hand,
 * thigh/shin/foot; drop fingers and leaves). What is NOT mechanical: rest-pose and axis alignment
 * against an Anny/canonical bind, and ROOT TRANSLATION — Sitting_Idle carries 198 channels INCLUDING
 * translation on pelvis/root, while our procedural clips are rotation-only
 * (automate_blender.py:703-718). SEATED HEIGHT LIVES IN THAT TRANSLATION and will double-apply
 * against verticalOffsetMeters unless you reconcile them. That is the most likely way this goes wrong.
 *
 * IF A RETARGETED Sitting_Idle FAILS VISUAL GRADE TWICE, STOP AND SAY SO. "The library has sitting
 * clips; 66->23 does not clear our armature without more work" closes #81 successfully — it is what
 * the cagematch was opened to determine. Do not grind.
 *
 * WHY THESE CONTRACTS ASSERT DATA FLOW AND NOTHING ABOUT APPEARANCE. Five gates were written in this
 * repo for "does the garment cover the shoulder" and all five passed on a figure graded bare, because
 * each was a scalar proxy for an area property. "Is the patient sitting on the chair" is the same
 * trap: a pelvis-near-seat-height test is satisfied by a figure floating in a sitting pose. So the
 * machine checks that the posture reaches the runtime, that a chair exists with a seat height, that
 * the right clip is bound, and that no excluded-licence clip shipped. WHETHER IT LOOKS LIKE SITTING
 * IS READ OFF THE RENDER by a human and recorded on #81.
 *
 * THE FOUR CONTRACTS PULL APART. A posture field that nothing reads satisfies none of the others; a
 * chair with no posture is furniture nobody uses; a bound clip with no chair is a figure sitting on
 * air; and the licence guard is orthogonal to all three and must hold regardless.
 *
 * IF SATISFYING ANY OF THIS MAKES THE PRODUCT VISIBLY WORSE, WRITE THE SENTENCE — "IN-SCOPE VISUAL
 * VERDICT: this looks like ___, which is / is not what the contract was trying to produce" — and then
 * satisfy the contract anyway. A previous worker saw its own output was wrong, graded it passing
 * because the metric held, and only said so when asked afterwards.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectSeatedPostureWiring()`. Change the call
 * sites and say why if a different shape is better. What must not change: posture is declared data
 * that reaches the runtime, the chair is real geometry with a seat height, clip binding follows
 * posture, and no CarnegieMellonAnimations clip ships.
 *
 * SCOPE: the wiring. Says nothing about whether the sit looks right, and nothing about clinical
 * plausibility of the posture — that needs a clinician.
 */

const load = async () =>
  import("./seated-posture-wiring.js") as Promise<Record<string, unknown>>;

type Wiring = {
  placements: { actorId: string; posture: string }[];
  chairFixture: { exists: boolean; seatHeightMeters: number; isMarkerCube: boolean } | null;
  clipBindings: { actorId: string; posture: string; clipName: string }[];
  shippedClipSources: string[];
};
type Inspect = () => Promise<Wiring>;

describe("a declared posture reaches the runtime and there is something to sit on (#81)", () => {
  it.fails("a placement declares a posture and the runtime receives it", async () => {
    const mod = await load();
    const inspect = mod["inspectSeatedPostureWiring"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const w = await inspect!();
    expect(w.placements.length, "no placements reported").toBeGreaterThan(0);
    // At least one actor must be seated, and the values must be a real vocabulary rather than free text.
    const postures = new Set(w.placements.map((p) => p.posture));
    for (const p of postures) expect(["standing", "seated", "supine"]).toContain(p);
    expect([...postures], "no actor is seated anywhere").toContain("seated");
  }, 180_000);

  it.fails("the patient_chair fixture builds real geometry with a stated seat height, not a marker cube", async () => {
    // Kills "declare seated and leave the marker cube": a figure in a sitting pose over a 6 cm cube is
    // a figure sitting on nothing, which is worse than a standing one.
    const mod = await load();
    const inspect = mod["inspectSeatedPostureWiring"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const w = await inspect!();
    expect(w.chairFixture, "no chair fixture reported").not.toBeNull();
    expect(w.chairFixture!.exists).toBe(true);
    expect(w.chairFixture!.isMarkerCube, "still the 0.18x0.06x0.18 placeholder").toBe(false);
    expect(w.chairFixture!.seatHeightMeters, "a seat with no height is not a seat").toBeGreaterThan(0.2);
    expect(w.chairFixture!.seatHeightMeters).toBeLessThan(0.8);
  }, 180_000);

  it.fails("a seated actor is bound to a seated clip and a standing actor is not", async () => {
    // Kills a posture field nothing consumes. Two-sided so "bind the sitting clip to everyone" fails.
    const mod = await load();
    const inspect = mod["inspectSeatedPostureWiring"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const w = await inspect!();
    const seated = w.clipBindings.filter((b) => b.posture === "seated");
    const standing = w.clipBindings.filter((b) => b.posture === "standing");
    expect(seated.length, "no seated binding").toBeGreaterThan(0);
    expect(standing.length, "no standing binding to contrast against").toBeGreaterThan(0);
    for (const b of seated) expect(b.clipName.toLowerCase()).toMatch(/sit/);
    for (const b of standing) expect(b.clipName.toLowerCase()).not.toMatch(/sit/);
  }, 180_000);

  it.fails("no clip sourced from the CarnegieMellonAnimations folder is shipped", async () => {
    // Licence guard, orthogonal to the other three. That folder's readme points at rancidmilk.itch.io
    // and is NOT covered by Mesh2Motion's CC0 grant, which does cover the GLB animation libraries.
    const mod = await load();
    const inspect = mod["inspectSeatedPostureWiring"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const w = await inspect!();
    expect(w.shippedClipSources.length, "no clip provenance reported at all").toBeGreaterThan(0);
    for (const src of w.shippedClipSources) {
      expect(src.toLowerCase(), `clip provenance points at an excluded source: ${src}`)
        .not.toMatch(/carnegiemellon|rancidmilk/);
    }
  }, 180_000);
});
