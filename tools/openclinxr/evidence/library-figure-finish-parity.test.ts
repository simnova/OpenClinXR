import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#219). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT — graded in the #218 capture, and the rail is visibly behind
 *
 * ED Chest Pain now stages `body-param-adult_lean_female-library.glb` as the spouse through ordinary
 * cast resolution. Standing beside two Anny actors, the library figure is:
 *
 *   - BAREFOOT           — #188 put footwear on the seven Anny humanoids only
 *   - ARMS OUTSTRETCHED  — the Anny nurse and patient stand in the clinical idle; the library figure
 *                          holds a T-pose-like stance
 *
 * A rail that produces visibly unfinished people will not be adopted for more roles, and an unadopted
 * rail is the same "proven and unconsumed" disease one level up.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED BEFORE PLANTING — this rules out the obvious cause, so do not spend turns on it
 *
 * `clinical-idle-posture.ts:48-53` keys UNDOTTED names: `upper_armL`, `forearmL`, `handL`, and its own
 * comment says "Canonical undotted runtime names (pre-fix: scene graph reports upper_armL not
 * upper_arm.L)".
 *
 * The library body's joints, read from the exported glTF with NodeIO, are DOTTED:
 *
 *   pelvis, spine, chest, neck, head, eye.L, eye.R, clavicle.L, upper_arm.L, forearm.L, hand.L,
 *   index_finger_base.L, clavicle.R, upper_arm.R, forearm.R, hand.R, index_finger_base.R,
 *   thigh.L, shin.L, foot.L, thigh.R, shin.R, foot.R      (23)
 *
 * §6v: three.js STRIPS DOTS on load (`PropertyBinding.sanitizeNodeName` — `.` is a path separator in
 * animation binding). So `upper_arm.L` in the file becomes `upper_armL` in the scene graph, and the
 * idle map's keys MATCH. **A name mismatch is NOT the cause.**
 *
 * THE CAUSE IS NOT KNOWN TO ME BEYOND THAT. Nine of my premises in this repo have been withdrawn, so
 * take no hypothesis of mine as fact. Candidates, unordered and possibly all wrong: idle is not applied
 * to library-resolved actors because a branch keys on asset path or cast kind; idle is applied and then
 * overwritten by a later pass; the library figure loads after idle runs. MEASURE THE LIVE GRAPH FIRST —
 * dump the spouse's `upper_armL` local rotation and compare it against the Anny nurse's in the same
 * scene. That one dump separates "never applied" from "applied then clobbered".
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE — a peer round split this from a bigger thing I was about to bundle
 *
 * I proposed footwear + idle + LOWER-BODY CLOTHING as one "parity" slice. Rejected, and the reason is
 * exact: lower-body geometry has NEVER existed in any rail — every garment in the bank is
 * `upper_layers` and lower clothing is painted texture (#188's correction). That is a new
 * `clothing_generate` station, not polish, and bundling it would smuggle a greenfield pipeline in
 * under the word "parity". It is filed separately.
 *
 *   DO:     idle posture + footwear on the library figure. Two known mechanisms.
 *   DO NOT: build trousers, a lower-body mesh channel, or touch the #73 lower-paint path.
 *   DO NOT: hand-author a new shoe shell in Python. #188's footwear path is deterministic and on
 *           foot bones; reuse it, or use a MakeClothes asset. Inventing a second AABB shoe is
 *           directive D1's anti-pattern.
 *   DO NOT: add cast roles, touch Mesh2Motion, or add morph targets.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT A "LOOKS BETTER NOW" SLICE CANNOT FAKE
 *
 * Contract (1) compares the library figure against a REAL ANNY ACTOR IN THE SAME SCENE, not against a
 * number I chose. The Anny nurse is the known-good column (§9h): whatever idle produces on her is the
 * target. Arm-hang is measured as the horizontal offset of the wrist from the torso axis — a T-pose has
 * a large offset, a clinical idle a small one — and the library figure must land within a tolerance
 * derived FROM THE ANNY ACTORS in that same capture, never from a figure I supply.
 *
 * That reference is independent of the treatment: fixing the library figure cannot move the Anny
 * baseline. (#151's `eps = spread * 0.35` passed by construction because its reference was a fraction
 * of its own result; do not repeat that shape.)
 *
 * ## FIXED (#219)
 *
 * Pre-fix measured (ED chest pain, same capture):
 *   nurse Anny:   lateral 0.244 m, upper_armL = (−0.22, 0.06, −1.12), footwearTris=160, idleBones=8
 *   library spouse: lateral 0.810 m, upper_armL = (−0.22, 0.06, −1.12), footwearTris=0, idleBones=8
 * So idle WAS applied (same local eulers as nurse) — not a name mismatch, not never-applied.
 * World hang differed because hm08 library upper_arm local Z has the opposite sense from Anny.
 *
 * Fixes:
 *   1. Tag body-param library loads `openClinXrHumanoidRail = "library"` (main.ts load path).
 *   2. clinical-idle-posture.ts LIBRARY_CLINICAL_IDLE_ARM_HANG flips upper_arm Z
 *      (L z=+1.12, R z=−1.12). Live probe: lateral 0.337 → post-fix 0.341 vs Anny median 0.340.
 *   3. Footwear: tools/.../embed_library_footwear.py reuses #188 parametric foot-AABB shell
 *      topology (Z-up post-import) → openclinxr_footwear_* meshes, 160 tris, foot.L/R weights.
 *      Baked into both body-param-*-library.glb assets.
 *
 * Post-fix: library lateral 0.341 m within Anny-derived tol 0.12 m; footwearTris=160 both rails.
 * IN-SCOPE VISUAL (finish-parity-grade.png): library_arms_at_side=yes; library_shod=yes (brown
 * casual shells); anny_actors_normal=yes; materials_distinct=yes.
 */

type FigureFinish = {
  scenarioId: string;
  actorId: string;
  rail: "library" | "anny";
  /** Horizontal wrist offset from the torso axis, metres. T-pose is large; clinical idle is small. */
  wristLateralOffsetMeters: number;
  footwearMeshNames: string[];
  footwearTriangleCount: number;
};

type Inspect = () => Promise<{
  figures: FigureFinish[];
  annyBaseline: { medianWristLateralOffsetMeters: number; toleranceMeters: number; source: string };
}>;

const load = () =>
  import("./library-figure-finish-parity.js") as Promise<Record<string, unknown>>;

describe("a library figure is finished to Anny parity (#219)", () => {
  it("the library figure stands like the Anny actors beside it", async () => {
    const mod = await load();
    const inspect = mod["inspectLibraryFigureFinishParity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const library = report.figures.filter((f) => f.rail === "library");
    const anny = report.figures.filter((f) => f.rail === "anny");
    expect(library.length, "no library figure inspected").toBeGreaterThan(0);
    expect(
      anny.length,
      "no Anny actor inspected — the known-good column must come from the same capture",
    ).toBeGreaterThan(0);
    expect(
      report.annyBaseline.source,
      "the baseline must name that it came from the Anny actors in this scene, not a chosen number",
    ).toMatch(/anny/i);

    const target = report.annyBaseline.medianWristLateralOffsetMeters;
    const tol = report.annyBaseline.toleranceMeters;
    expect(tol, "no tolerance derived from the Anny actors").toBeGreaterThan(0);

    const bad: string[] = [];
    for (const f of library) {
      const delta = Math.abs(f.wristLateralOffsetMeters - target);
      if (delta > tol) {
        bad.push(
          `${f.actorId}: wrist ${f.wristLateralOffsetMeters.toFixed(3)}m from the torso axis vs the `
          + `Anny median ${target.toFixed(3)}m (tolerance ${tol.toFixed(3)}m) — it is not standing `
          + `like the actors beside it`,
        );
      }
    }
    expect(bad, `library figures that do not stand like an Anny actor:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the library figure is shod, and the Anny cast is untouched (COUNTERWEIGHT)", async () => {
    // #188 put footwear on the seven Anny humanoids. The library rail never got it, so a staged
    // library figure is barefoot next to shod colleagues. Reuse #188's deterministic foot-bone path —
    // a second hand-authored AABB shoe would be D1's anti-pattern.
    const mod = await load();
    const inspect = mod["inspectLibraryFigureFinishParity"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const f of report.figures.filter((x) => x.rail === "library")) {
      if (f.footwearMeshNames.length === 0) broken.push(`${f.actorId}: barefoot — no footwear mesh`);
      if (f.footwearTriangleCount < 60) {
        broken.push(`${f.actorId}: ${f.footwearTriangleCount} footwear triangles is a shard, not a shoe`);
      }
    }
    for (const f of report.figures.filter((x) => x.rail === "anny")) {
      if (f.footwearMeshNames.length === 0) {
        broken.push(`${f.actorId}: an Anny actor lost its footwear — #188 must not regress`);
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
