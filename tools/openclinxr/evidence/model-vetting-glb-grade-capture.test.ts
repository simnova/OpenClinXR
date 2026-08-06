import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#59) — there is no grade-worthy path from a GLB on disk to an image.
 *
 * ALL THREE `it.fails` FLIP. Nothing else in this file is planted.
 *
 * MEASURED, and one earlier claim CORRECTED where it was made. `model-vetting-turntable-capture.ts`
 * does drive the real model-vetting-studio three.js renderer through Playwright — the earlier
 * framing "nothing renders a GLB through three.js" was wrong and the peer round refuted it. What is
 * missing is narrower and real:
 *
 *   - it loads by `captureCandidateId` out of a hand-authored `ModelVettingReport` (`:28-29`,
 *     `:42-49`); `--source-report` is the only file input (`:106`). Rendering an arbitrary path
 *     costs report ceremony first. `review-glb-optimization-visual-cagematch.ts:193-204` already
 *     synthesises such a report, so the pattern exists — it is just not reachable as "render this".
 *   - nothing checks that what was drawn is what is on disk.
 *
 * WHY THE SECOND ONE IS THE POINT. An ad-hoc Blender harness built during #58 reported `y=2.000`
 * for `peds_patient_child.glb` where the landed probe measures `height=1.25` — a 60% relative error,
 * from reading pre-modifier `bound_box` on a double-converted axis. It was caught BY HAND, by
 * noticing the disagreement. That is exactly the kind of catch that must stop being human.
 *
 * THE THREE CONTRACTS PULL APART, and none is satisfiable by the other two.
 *
 * The first says a plan can be built from a path alone. Satisfiable by a stub that returns a plan
 * for anything — so the second demands the geometry check REFUSE on the real historical numbers,
 * and the third demands the passes actually differ in pixels. A renderer that plans, agrees with
 * itself, and writes three copies of one buffer fails two of the three.
 *
 * SELF-AGREEMENT IS THE FAILURE MODE TO AVOID. The two measurements must come from different
 * parsers: `humanoid-proportions-probe.ts` reads the file through glTF-Transform NodeIO outside any
 * browser; the capture side measures the loaded scene through three.js `GLTFLoader`. Same metric
 * family, independent code paths. Measuring the same thing twice through one path proves nothing.
 *
 * THE CAUSE OF THE #58 UPPER-BODY ODDITY IS NOT KNOWN TO ME. Whether that render showed real mesh
 * damage or an artifact of the discarded Blender harness is the open question this instrument
 * exists to settle. Do not take either answer from me as fact — I could not tell, which is the
 * whole reason for the slice.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read three pure exports so the contracts stay fast
 * and the browser work lives behind the `run:` rules on the issue. Change the call sites and say why
 * if a different shape is better. What must not change: a path alone is enough, disagreement past a
 * relative tolerance writes NO image, and the passes are not the same pixels.
 *
 * SCOPE: the instrument. It asserts nothing about whether any asset looks right — that verdict is
 * read off the pixels by a human or a model, and is recorded on #59 rather than encoded here.
 *
 * ## FIXED (#59)
 *
 * - `planGlbGradeCapture` builds a plan from a path alone (no ModelVettingReport). Turntable gains
 *   `--glb` which synthesises an ephemeral report; full grade CLI also covers lit+structure+self-check.
 * - `evaluateGeometrySelfCheck` default relative tolerance 0.15 refuses the historical 1.25 vs 2.0
 *   (~60%) and 1.25 vs 1.5 (20%); agrees on 1.25 vs 1.248. Probe = NodeIO; in-page = three.js
 *   sourceMeshAabbMeters (pre-normalize). Refuse writes no images.
 * - `passesDiffer` requires lit vs structure pixel inequality (structure = MeshNormalMaterial wireframe).
 * - Coverage: `pnpm asset:model-vetting:glb-grade -- --all-shipped-humanoids` + validate gallery.json.
 *
 * Measured numbers above are immutable diagnosis — not rewritten.
 */

const load = async () =>
  import("./model-vetting-glb-grade-capture.js") as Promise<Record<string, unknown>>;

type CapturePlan = { sourceGlbPath: string; views: string[] };
type PlanFn = (input: { glbPath: string; views: readonly string[] }) => CapturePlan;

type Measured = { height: number; horizontalExtent: number };
type SelfCheck = (input: {
  probe: Measured;
  inPage: Measured;
  tolerance?: number;
}) => { agrees: boolean; writeImages: boolean; relativeError: number };

type PassesDiffer = (a: Uint8Array, b: Uint8Array) => boolean;

/**
 * A real shipped asset that appears in NO model-vetting report. If a plan can be built for this,
 * the report ceremony is genuinely gone rather than defaulted around.
 */
const UNREPORTED_GLB =
  "apps/ui-xr/public/cagematch/anny-garment-hint-v1/current/peds_patient_child_garment_hint_v1.glb";

describe("a GLB on disk can be rendered and the render can be trusted (#59)", () => {
  it("renders a GLB given only its path, with no hand-authored source report", async () => {
    const mod = await load();
    const plan = mod["planGlbGradeCapture"] as PlanFn | undefined;
    expect(plan).toBeTypeOf("function");

    const result = plan!({ glbPath: UNREPORTED_GLB, views: ["front", "three_quarter"] });

    // The plan must be ABOUT the file it was handed — a stub returning a fixed default candidate
    // would otherwise satisfy this.
    expect(result.sourceGlbPath).toContain("peds_patient_child_garment_hint_v1.glb");
    expect(result.views).toEqual(["front", "three_quarter"]);
  });

  it("refuses and writes no image when in-page geometry disagrees with the NodeIO probe", async () => {
    const mod = await load();
    const check = mod["evaluateGeometrySelfCheck"] as SelfCheck | undefined;
    expect(check).toBeTypeOf("function");

    // The real historical numbers: probe said 1.25, the discarded harness said 2.000.
    const disagreement = check!({
      probe: { height: 1.25, horizontalExtent: 0.805 },
      inPage: { height: 2.0, horizontalExtent: 1.902 },
    });
    expect(disagreement.agrees).toBe(false);
    expect(disagreement.writeImages).toBe(false);
    expect(disagreement.relativeError).toBeGreaterThan(0.15);

    // And it must still pass on agreement, or "refuse always" satisfies the line above.
    const agreement = check!({
      probe: { height: 1.25, horizontalExtent: 0.805 },
      inPage: { height: 1.248, horizontalExtent: 0.807 },
    });
    expect(agreement.agrees).toBe(true);
    expect(agreement.writeImages).toBe(true);

    // Kills the tuned tolerance: the default must be tight enough to catch the failure that
    // motivated this. A default loose enough to admit 60% error is not a check.
    const defaulted = check!({
      probe: { height: 1.25, horizontalExtent: 0.805 },
      inPage: { height: 1.5, horizontalExtent: 0.97 },
    });
    expect(defaulted.writeImages).toBe(false);
  });

  it("a lit pass and a structure pass of the same view are not the same pixels", async () => {
    const mod = await load();
    const differ = mod["passesDiffer"] as PassesDiffer | undefined;
    expect(differ).toBeTypeOf("function");

    const lit = new Uint8Array([12, 40, 90, 255, 12, 40, 90, 255]);
    const identical = new Uint8Array(lit);
    const structure = new Uint8Array([250, 250, 250, 255, 4, 4, 4, 255]);

    // Three renders of one buffer under three filenames is the cheap way to satisfy a
    // three-files-exist rule. This is what refuses it.
    expect(differ!(lit, identical)).toBe(false);
    expect(differ!(lit, structure)).toBe(true);
  });
});
