import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { UprightJoint } from "./humanoid-upright-guard.js";

/**
 * PLANTED CONTRACTS (#67) — six of the seven shipped humanoids are rotated 90 degrees off-axis.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#67)` block below, and leave the measured table intact.
 *
 * MEASURED from the glTF JSON via glTF-Transform NodeIO — not from a render, not from Blender:
 *
 *   generated-humanoids/peds_patient_child.glb                        R=(0, 0, 0, 1)          never re-baked
 *   generated-humanoids/peds_anxious_parent.glb                       R=(0.707, 0, 0, 0.707)  #58
 *   generated-humanoids/peds_nurse_kevin.glb                          R=(0.707, 0, 0, 0.707)  #58
 *   anny-real-garment/current/peds_patient_child_real_garment.glb     R=(0.707, 0, 0, 0.707)  #64
 *   anny-real-garment/current/ed_chest_pain_patient_real_garment.glb  R=(0.707, 0, 0, 0.707)  #64
 *   anny-school-age/current/peds_patient_child_mpfb2_eye.glb          R=(0.707, 0, 0, 0.707)  #64
 *   anny-garment-hint-v1/current/peds_patient_child_garment_hint_v1.glb R=(0.707, 0, 0, 0.707) #64
 *
 * `(0.707, 0, 0, 0.707)` is +90 degrees about X. Rendered through the real three.js path, the six
 * hang head-down while the one with an identity root stands upright. I read the images.
 *
 * THE CAUSE, traced and verified: `align_y_height_bind_for_gltf_yup_export`
 * (`automate_blender.py:2531-2575`) applies an OBJECT-level correction, `rotation_euler.x += 90` at
 * `:2563`, which the exporter bakes into the armature root and therefore into every child — the mesh
 * is parented to the armature at `:387-388` with an identity parent inverse. #58 did not make mesh,
 * joints and inverse bind matrices consistent; it inverted WHICH OF THEM IS WRONG. Before: joints
 * along -Z, mesh looking upright through the IBMs. After: joints standing, mesh lying down.
 *
 * WHAT IS NOT KNOWN TO ME, and it is the mechanism risk: how Blender's glTF exporter treats inverse
 * bind matrices when the rotation is applied to rest DATA rather than left on the object node. Run a
 * control/treatment on ONE asset and look at the render before regenerating six. Do not take a
 * hypothesis of mine as fact.
 *
 * WHY EVERY EXISTING GATE SAID THIS WAS FINE, which is why the third contract exists:
 *
 *   - `humanoid-proportions-probe` compares wrist/hand world Y against ankle/foot world Y. After a
 *     +90 X rotation, world Y is the old -Z, so the check silently became a front-to-back
 *     comparison that comes out positive. It reports SOUND on a figure lying on its face.
 *   - #59's geometry self-check agreed on all seven at ~0 relative error, CORRECTLY: both sides
 *     measure a world mesh AABB, and an inverted figure is exactly as tall as an upright one. It
 *     answers "is the renderer drawing the file", which is the question it was built for.
 *     AGREEMENT BETWEEN TWO INSTRUMENTS MEASURING THE SAME THING IS NOT CORRECTNESS.
 *   - A "mesh taller than wide" check would also pass. Inversion preserves height.
 *
 * THE THREE CONTRACTS PULL APART, and each kills a different cheap fix.
 *
 * The first is defeated by leaving the rotation where it is and asserting something else. The second
 * is defeated by clearing the root rotation while the skinning still lies the figure down — it reads
 * ordering along the model's OWN up axis, so it survives any root transform and does not care what
 * the world axes are. The third is defeated by fixing the generator and shipping no consumer: this
 * project's most repeated failure is a mechanism that lands with nothing calling it, and a generator
 * fix with no runtime guard is exactly that shape.
 *
 * AND THE OLD DEFECT MUST NOT COME BACK. Deleting the +90 restores the pre-#58 joint failure, so
 * `cagematch-bind-pose-regression.test.ts` and the proportions suite are in this issue's done_when
 * alongside these. Both have to hold at once. That is the whole point.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `armatureRootRotation(glbPath)`,
 * `assessUprightOrdering({ joints })` and a guard exported from the ui-xr humanoid load path. Change
 * the call sites and say why if a different shape is better. What must not change: the shipped
 * assets have identity roots, ordering is measured along the model's own axis, and the runtime
 * refuses a humanoid it should not display.
 *
 * SCOPE: the figure stands up. Says nothing about face quality, garment realism or skin — those are
 * judgeable only once this is true, and are not claimed here.
 *
 * ## FIXED (#67)
 *
 * Mechanism (traced, control/treatment on peds_anxious_parent before regenerating six):
 * - #58 left `arm_obj.rotation_euler.x += 90°` on the armature object; exporter baked
 *   root R=(0.707,0,0,0.707); mesh parented with identity MPI inherited it → head-down.
 * - Baking +90 into rest DATA still left mesh POSITION on Z after export_yup (joints on Y).
 * - Working path: keep Y-height rest, identity object rotation, `export_yup=False`
 *   (`method: identity_object_export_yup_false_y_height_self_standing`) — same self-standing
 *   convention as `apply_bvh_to_anny_full`. Mesh POSITION, joints, and root then all agree.
 * - mpfb2 lane: Blender re-import converts Y-up→Z-up; re-export must use export_yup=True
 *   so the conversion maps back (export_yup=False on that path re-broke joints onto Z).
 *
 * Regenerated: peds_anxious_parent, peds_nurse_kevin (tracked generated-humanoids/) + four
 * cagematch current/ mirrors (gitignored). peds_patient_child control left as identity upright.
 * Stack: identity root + upright ordering + proportions/bind-pose suites + ui-xr load refuse.
 *
 * Pixel verdict (orchestrator/worker): post-fix front_lit.png of peds_anxious_parent stands
 * upright on the ground plane beside peds_patient_child — anatomically plausible standing
 * human (not a clinical-realism claim).
 */

const loadProbe = async () =>
  import("./humanoid-upright-guard.js") as Promise<Record<string, unknown>>;

type Quat = readonly [number, number, number, number];
type RootRotation = (glbPath: string) => Promise<Quat | null>;

type Joint = UprightJoint;
type Ordering = (input: { joints: readonly UprightJoint[] }) => { upright: boolean; violations: string[] };

const SHIPPED = [
  "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
  "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
  "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
  "apps/ui-xr/public/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb",
  "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb",
  "apps/ui-xr/public/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb",
  "apps/ui-xr/public/cagematch/anny-garment-hint-v1/current/peds_patient_child_garment_hint_v1.glb",
];

describe("shipped humanoids stand up (#67)", () => {
  it("every shipped humanoid has an identity armature root rotation", async () => {
    const mod = await loadProbe();
    const rootRotation = mod["armatureRootRotation"] as RootRotation | undefined;
    expect(rootRotation).toBeTypeOf("function");

    const offenders: string[] = [];
    for (const glbPath of SHIPPED) {
      if (!existsSync(glbPath)) {
        // A missing asset must not pass by omission — this guard inspects gitignored cagematch
        // mirrors, and on a clean clone a `continue` would make it green having checked nothing.
        offenders.push(`${glbPath}: absent, cannot verify`);
        continue;
      }
      const q = await rootRotation!(glbPath);
      if (q === null) {
        offenders.push(`${glbPath}: no armature root found`);
        continue;
      }
      const isIdentity = Math.abs(q[0]) < 1e-4 && Math.abs(q[1]) < 1e-4 && Math.abs(q[2]) < 1e-4 && Math.abs(Math.abs(q[3]) - 1) < 1e-4;
      if (!isIdentity) offenders.push(`${glbPath}: (${q.map((v) => v.toFixed(3)).join(", ")})`);
    }
    expect(offenders).toEqual([]);
  }, 180_000);

  it("head sits above hips above feet along the model's own up axis, whatever the root transform", async () => {
    const mod = await loadProbe();
    const ordering = mod["assessUprightOrdering"] as Ordering | undefined;
    expect(ordering).toBeTypeOf("function");

    // Synthetic first, so the check is proven non-vacuous before it is pointed at real files: an
    // inverted figure must be REFUSED even though it is exactly as tall as an upright one, which is
    // what defeats both the world-Y probe and a mesh-AABB height check.
    const upright: Joint[] = [
      { name: "head", worldX: 0, worldY: 1.6, worldZ: 0 },
      { name: "hips", worldX: 0, worldY: 0.9, worldZ: 0 },
      { name: "foot.L", worldX: -0.1, worldY: 0.05, worldZ: 0 },
      { name: "foot.R", worldX: 0.1, worldY: 0.05, worldZ: 0 },
    ];
    expect(ordering!({ joints: upright }).upright).toBe(true);
    const inverted = upright.map((j) => ({ ...j, worldY: 1.65 - (j.worldY ?? 0) }));
    expect(ordering!({ joints: inverted }).upright).toBe(false);

    // Then the real assets. All seven, no skipping.
    const { extractJointsFromGlb } = await import("./humanoid-proportions-probe.js");
    const failures: string[] = [];
    for (const glbPath of SHIPPED) {
      if (!existsSync(glbPath)) {
        failures.push(`${glbPath}: absent, cannot verify`);
        continue;
      }
      const { joints } = await extractJointsFromGlb(glbPath);
      const result = ordering!({ joints });
      if (!result.upright) failures.push(`${glbPath}: ${result.violations.join("; ")}`);
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it("the ui-xr humanoid load path refuses a humanoid whose root rotation is not identity", async () => {
    // Kills the generator-fix-with-no-consumer shape. A bad bake must not be able to reach a learner
    // just because someone re-ran the pipeline without looking.
    const mod = (await import("../../../apps/ui-xr/src/humanoid-load-guard.js")) as Record<string, unknown>;
    const guard = mod["assertHumanoidRootUpright"] as undefined | ((scene: unknown) => void);
    expect(guard).toBeTypeOf("function");

    const rotated = { children: [{ name: "openclinxr_canonical_humanoid_armature", quaternion: { x: 0.707, y: 0, z: 0, w: 0.707 } }] };
    expect(() => guard!(rotated)).toThrow();

    const identity = { children: [{ name: "openclinxr_canonical_humanoid_armature", quaternion: { x: 0, y: 0, z: 0, w: 1 } }] };
    expect(() => guard!(identity)).not.toThrow();
  });
});
