import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#163) — OPERATOR DIRECTION, 2026-08-07, and it changes how this project
 * iterates:
 *
 *   "switch into a mode where you (and grok) use a special harness to test things in an isolated
 *    environment. I feel that you are testing in a full room environment and get lots of noise,
 *    whereas if you followed a software development approach (test only what is under test, and use
 *    harnesses to isolate items from everything else) your iterations can go faster (allowing
 *    delegation) and unlock parallelism and multiple variants tested simultaneously."
 *
 * That is correct and it is the bottleneck. Every visual check today boots the full encounter, loads
 * a station, waits for shell + humanoids, and captures a 1440×900 room in which the subject is a few
 * hundred pixels — confounded by room lighting, HUD chrome, and every other actor.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the existing room-capture path must keep working
 * unchanged. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT ALREADY EXISTS — build on it, do not duplicate it (§6k)
 *
 * `model-vetting-glb-grade-capture.ts` is **half of this already**: it takes `--glb <path>` (repeatable),
 * boots the studio ONCE for N assets, drives the real three.js renderer, and self-checks the render
 * against a NodeIO probe. Its shape is right. Its limit is that a subject must be **a GLB on disk**.
 *
 * `apps/arena/model-vetting-studio` is a separate small app that already reads `URLSearchParams`
 * (`src/main.ts:40`).
 *
 * **64 files call `spawnPortlessDevServer`.** That is the serialization the operator is describing.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS MISSING, AND IT IS THE WHOLE SLICE
 *
 * 1. **Runtime subjects.** A posture, a furniture builder's output, a garment on a body — these exist
 *    only as functions in `apps/ui-xr/src` (`supine-pose.ts`, `seated-pose.ts`, `station-chair.ts`,
 *    `station-stretcher.ts`, `clinical-idle-posture.ts`). Today the ONLY way to see one is to boot an
 *    encounter. They are importable and they do not need a room.
 *
 * 2. **Variant sweeps.** There is no way to render the same subject at N parameter values in one pass.
 *    Choosing a semi-Fowler incline today would mean four full room captures and four grades.
 *
 * 3. **A contact sheet.** N variants must land as ONE labelled image so a grader forms a judgement in
 *    one look instead of N. This is the half that makes delegation work — a worker produces the sheet,
 *    the orchestrator grades it once.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROVING QUESTION — this harness must ANSWER something, not just exist
 *
 * A harness with no first customer is the build-it-and-do-not-connect-it failure this repo has hit
 * six times (§6z). So the slice is not done until it has answered a real open question:
 *
 * **What semi-Fowler incline should the ED chest-pain patient use?** A clinical consult said
 * "~30–45°, medium confidence on 30 versus 45". Produce a contact sheet of the SAME body on the SAME
 * deck at **0°, 15°, 30°, 45°** and leave it for me to grade. That is a question I currently cannot
 * answer without four room captures, and it is exactly the class the operator is pointing at.
 *
 * The incline itself does NOT need to ship as a runtime posture in this slice — the harness may apply
 * it locally. Shipping semi-Fowler is a separate slice and a peer round already said it cannot land
 * before a bed articulates.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NON-NEGOTIABLE: ONE BROWSER, ONE SERVER, N SUBJECTS
 *
 * The point is speed. If the harness boots a dev server per subject or per variant it has failed,
 * however correct its images are. `model-vetting-glb-grade-capture` already demonstrates one boot for
 * N assets — match or beat that. §7b records a suite that paid three cold boots, took 542 s, and left
 * main red.
 *
 * Contract (2) measures this. It is the contract that makes the harness worth building.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **Where the harness page lives.** Extending `apps/arena/model-vetting-studio` reuses a working
 *    renderer and its URL-param entry; a new page is cleaner but duplicates the three.js setup. **I
 *    lean extend** and I am not certain.
 *  - **How a runtime subject is described.** It has to be data a CLI can pass and the page can
 *    instantiate — some declarative form naming a body asset, a furniture builder, a posture, and a
 *    parameter. Say what you chose and what it cannot express.
 *  - **Whether the ui-xr builders are imported directly or duplicated.** Importing couples the harness
 *    to app internals and is the honest choice — a harness that renders its own copy of a builder
 *    tests nothing. If import is impossible across the app boundary, SAY SO AND STOP; that is a real
 *    finding and a different slice.
 *  - **Contact sheet layout** — grid, labels, and whether each variant also gets its own full-size
 *    image. I want both if it is cheap.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands isolated per-subject images with no room and no HUD, and is satisfiable by a slow
 * implementation that boots per subject. (2) forbids that by capping boots. (3) is green today and
 * forbids buying either by breaking the room-capture path that fourteen stations and six contracts
 * depend on.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectIsolatedSubjectHarness()`. What must not
 * change: the harness renders through the SAME three.js path the product uses — a bespoke renderer
 * that draws a subject differently from the app is worse than no harness, because it would grade
 * something the learner never sees.
 *
 * REQUIRED, the observable half: the semi-Fowler contact sheet at 0/15/30/45°, on disk, for me to
 * grade. Plus a per-subject isolated image of at least: the ED stretcher, the clinic chair, and one
 * humanoid in the supine pose.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace with a sentence:
 *     subject_isolated:      yes | room_visible | hud_visible
 *     subject_fills_frame:   yes | too_small | cropped
 *     variants_distinguishable: yes | no
 *     labels_legible:        yes | no
 *
 * OUT-OF-SCOPE WRONGNESS you saw and are not fixing: name the object and what it looks like (§6m).
 * Known and not yours: bare feet, flat doll faces, garment tears.
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: an isolated, variant-capable capture harness and its first real answer. Says NOTHING about
 * whether semi-Fowler ships, the ward bed (#159), patient attire (#160), or lighting (#162).
 */

const load = async () => import("./isolated-subject-harness.js") as Promise<Record<string, unknown>>;

type RenderedSubject = {
  /** Stable id for the subject under test, e.g. "supine_incline_30". */
  subjectId: string;
  /** What kind of thing was isolated — a posture, a furniture builder, a GLB. */
  subjectKind: string;
  imagePath: string;
  /** Fraction of the image's pixels the subject's projected bounds occupy. */
  frameCoverage: number;
  /** True when nothing but the subject and a neutral ground was rendered. */
  roomGeometryPresent: boolean;
  hudPresent: boolean;
  /** Other actors in frame. Must be empty — that is the whole point. */
  extraActorIds: string[];
};

type VariantSweep = {
  sweepId: string;
  /** The parameter varied, e.g. "inclineDegrees". */
  parameter: string;
  values: number[];
  /** One contact sheet showing every variant, labelled. */
  contactSheetPath: string;
  subjects: RenderedSubject[];
};

type HarnessRun = {
  subjects: RenderedSubject[];
  sweeps: VariantSweep[];
  /** Dev servers booted for the WHOLE run. The point of the harness is that this stays tiny. */
  devServerBoots: number;
  /** Browsers launched for the whole run. */
  browserLaunches: number;
  wallClockMs: number;
  /** True when the harness drove the same three.js renderer the product uses. */
  usesProductRenderer: boolean;
};

type Inspect = () => Promise<HarnessRun>;

/** A subject rendered alone should dominate its frame, not sit in a corner of a room. */
const MIN_FRAME_COVERAGE = 0.08;

/** One boot for the whole run. Two is tolerable; per-subject is the failure this exists to prevent. */
const MAX_DEV_SERVER_BOOTS = 2;

describe("a subject can be rendered in isolation, in variants (#163)", () => {
  it("subjects render alone — no room, no HUD, no other actors", async () => {
    // Every visual check today boots the full encounter and captures a room in which the subject is a
    // few hundred pixels, confounded by room lighting, HUD chrome and every other actor.
    const mod = await load();
    const inspect = mod["inspectIsolatedSubjectHarness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.subjects.length, "no subject was rendered in isolation").toBeGreaterThan(2);
    expect(run.usesProductRenderer, "the harness drew the subject with its own renderer").toBe(true);

    const contaminated: string[] = [];
    for (const s of run.subjects) {
      if (s.roomGeometryPresent) contaminated.push(`${s.subjectId}: room geometry in frame`);
      if (s.hudPresent) contaminated.push(`${s.subjectId}: HUD chrome in frame`);
      if (s.extraActorIds.length > 0) {
        contaminated.push(`${s.subjectId}: other actors in frame — ${s.extraActorIds.join(", ")}`);
      }
      if (s.frameCoverage < MIN_FRAME_COVERAGE) {
        contaminated.push(
          `${s.subjectId}: subject covers ${(s.frameCoverage * 100).toFixed(1)}% of the frame`,
        );
      }
    }
    expect(contaminated, `subjects that were not isolated:\n${contaminated.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it("a variant sweep costs one boot and lands as one contact sheet", async () => {
    // Kills the cheap satisfaction of the first contract: isolating subjects correctly while booting a
    // dev server per subject is slower than what it replaces. §7b records a suite that paid three cold
    // boots, took 542s and left main red. Speed IS the requirement here, not a nice-to-have.
    const mod = await load();
    const inspect = mod["inspectIsolatedSubjectHarness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.sweeps.length, "no variant sweep was run").toBeGreaterThan(0);

    for (const sw of run.sweeps) {
      expect(sw.values.length, `${sw.sweepId}: a sweep of fewer than 3 values proves nothing`)
        .toBeGreaterThan(2);
      expect(sw.subjects.length, `${sw.sweepId}: rendered ${sw.subjects.length} of ${sw.values.length} variants`)
        .toBe(sw.values.length);
      expect(sw.contactSheetPath.length, `${sw.sweepId}: no contact sheet was written`).toBeGreaterThan(0);
    }

    expect(
      run.devServerBoots,
      `harness booted ${run.devServerBoots} dev servers for ${run.subjects.length} subjects`,
    ).toBeLessThanOrEqual(MAX_DEV_SERVER_BOOTS);
    expect(run.browserLaunches, "one browser for the run").toBeLessThanOrEqual(MAX_DEV_SERVER_BOOTS);
  }, 1_800_000);

  it("the room-capture path still works (COUNTERWEIGHT)", async () => {
    // The cheapest satisfaction is rebuilding capture from scratch and leaving the existing path
    // broken. Fourteen stations and six contracts read room captures; #133, #150 and #153 all closed
    // on them this week. The harness ADDS an isolated path, it does not replace the integrated one.
    const mod = await load();
    const roomCapture = await import("./ui-xr-environment-room-capture.js") as Record<string, unknown>;
    expect(
      roomCapture["captureStationEnvironmentRooms"],
      "the room-capture entry point disappeared",
    ).toBeTypeOf("function");
    expect(roomCapture["waitForStationShell"], "the shell wait disappeared").toBeTypeOf("function");

    const inspect = mod["inspectIsolatedSubjectHarness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const run = await inspect!();
    // An isolated harness that never renders a runtime subject is just the GLB path renamed.
    const kinds = new Set(run.subjects.map((s) => s.subjectKind));
    expect(
      kinds.size,
      `only ${kinds.size} subject kind(s) rendered: ${[...kinds].join(", ")} — a runtime posture and a furniture builder are both required`,
    ).toBeGreaterThan(1);
  }, 1_800_000);
});

describe("equipment reference packs from parametric renders (#262)", () => {
  it("renders the iv-pole builder as square views and exports the parametric source GLB", async () => {
    // #262 — reference packs must come from PARAMETRIC RENDERS, not a generative
    // image model: deterministic, quota-free, one fewer LLM in the factory (D9).
    // The harness renders the SAME builder stations use (buildDeclaredEquipmentGeometry).
    const { existsSync } = await import("node:fs");
    const mod = await load();
    const renderPack = mod["renderEquipmentReferencePack"] as
      | ((options?: Record<string, unknown>) => Promise<{
          equipmentId: string;
          views: Array<{ view: string; imagePath: string; subjectKind: string }>;
          contactSheetPath: string;
          parametricSourceGlbPath: string | null;
          devServerBoots: number;
          browserLaunches: number;
          usesProductRenderer: boolean;
        }>)
      | undefined;
    expect(renderPack, "renderEquipmentReferencePack disappeared").toBeTypeOf("function");

    const run = await renderPack!({});
    expect(run.equipmentId).toBe("iv_pole_equipment");
    // The issue requires four viewpoints (front, side, two three-quarters); we render five.
    expect(run.views.length).toBeGreaterThanOrEqual(4);
    expect(run.devServerBoots, "the pack must render in ONE dev-server boot").toBeLessThanOrEqual(2);
    expect(run.usesProductRenderer).toBe(true);

    const viewNames = run.views.map((v) => v.view);
    for (const required of ["front", "side", "three_quarter_left", "three_quarter_right"]) {
      expect(viewNames, `missing required view ${required}`).toContain(required);
      const view = run.views.find((v) => v.view === required)!;
      expect(view.subjectKind).toBe("equipment_builder");
      expect(existsSync(view.imagePath), `${required} render missing on disk`).toBe(true);
    }

    expect(existsSync(run.contactSheetPath), "no contact sheet on disk").toBe(true);
    expect(
      run.parametricSourceGlbPath,
      "the parametric source GLB was not exported — needed for the bake geometry comparison",
    ).toBeTruthy();
    expect(existsSync(run.parametricSourceGlbPath!)).toBe(true);
  }, 1_800_000);

  it("subject-only pack mode removes the neutral ground plane (#265)", async () => {
    // #265 re-runs the #262 experiment with ONE input defect corrected. #262's pack
    // renders showed the pole standing on a lit neutral ground plane
    // (`isolated_neutral_ground`, added unconditionally in the lab), and TRELLIS
    // reconstructed that ground as geometry — the withdrawn verdict read the floor
    // slab, not a lost pole. The pack render must therefore be SUBJECT-ONLY: no
    // ground geometry, flat background, same subject/views/bake path.
    //
    // Two modes are asserted from the scene evidence (groundPlanePresent), never
    // from the spec flag:
    //   - subjectOnly:true  -> no ground in ANY view (the #265 fix)
    //   - subjectOnly:false -> ground present (the #262 capability is preserved —
    //                          the counterweight, not a regression)
    const mod = await load();
    const renderPack = mod["renderEquipmentReferencePack"] as
      | ((options?: Record<string, unknown>) => Promise<{
          equipmentId: string;
          views: Array<{
            view: string;
            imagePath: string;
            subjectKind: string;
            groundPlanePresent: boolean;
          }>;
          devServerBoots: number;
          browserLaunches: number;
          usesProductRenderer: boolean;
        }>)
      | undefined;
    expect(renderPack, "renderEquipmentReferencePack disappeared").toBeTypeOf("function");

    // Legacy grounded mode first (writes to the same pack dir), so the final
    // canonical state of .openclinxr/evidence/issue-265/packs is subject-only.
    const grounded = await renderPack!({
      subjectOnly: false,
      outputRoot: ".openclinxr/evidence/issue-265",
    });
    expect(grounded.views.length).toBeGreaterThanOrEqual(4);
    for (const v of grounded.views) {
      expect(
        v.groundPlanePresent,
        `${v.view}: neutral ground missing in legacy grounded mode (#262 capability lost)`,
      ).toBe(true);
    }

    const subjectOnly = await renderPack!({
      subjectOnly: true,
      outputRoot: ".openclinxr/evidence/issue-265",
    });
    expect(subjectOnly.equipmentId).toBe("iv_pole_equipment");
    expect(subjectOnly.views.length).toBeGreaterThanOrEqual(4);
    expect(subjectOnly.usesProductRenderer).toBe(true);
    expect(subjectOnly.devServerBoots, "one dev-server boot per pack render").toBeLessThanOrEqual(2);
    for (const v of subjectOnly.views) {
      expect(v.subjectKind).toBe("equipment_builder");
      expect(
        v.groundPlanePresent,
        `${v.view}: ground plane still present in subject-only render — the #265 input defect is not fixed`,
      ).toBe(false);
    }
  }, 1_800_000);

  it("pack views frame to the subject bounds, not a fixed distance (#270)", async () => {
    // #270: pack renders framed the subject at ~5% of the image — the camera
    // distance was `radius * 2.4` with a 0.4 m floor on radius, so a 12x19 cm
    // wall plate rendered at ~5% coverage and TRELLIS was fed 95% empty
    // background. The fix frames each pack view to the subject's projected
    // bounds (PACK_FRAME_TARGET 0.8 of the square frame's dimension).
    //
    // The assertion floor is NOT invented — it is the measured PRE-FIX coverage
    // of the control (iv_pole_equipment) recorded in
    // .openclinxr/evidence/issue-270/pre-fix.json before any framing change
    // (a threshold chosen to clear an observation would be fitted to it; this
    // one is read from the before-column).
    const mod = await load();
    const renderPack = mod["renderEquipmentReferencePack"] as
      | ((options?: Record<string, unknown>) => Promise<{
          equipmentId: string;
          views: Array<{ view: string; frameCoverage: number }>;
        }>)
      | undefined;
    expect(renderPack, "renderEquipmentReferencePack disappeared").toBeTypeOf("function");

    let preFixText: string;
    try {
      preFixText = readFileSync(".openclinxr/evidence/issue-270/pre-fix.json", "utf8");
    } catch {
      throw new Error(
        "missing .openclinxr/evidence/issue-270/pre-fix.json — the measured before-column is required to derive the assertion floor",
      );
    }
    const preFix = JSON.parse(preFixText) as {
      subjects?: Record<string, { views?: Array<{ frameCoverage?: number }> }>;
    };
    const controlViews = preFix.subjects?.["iv_pole_equipment"]?.views;
    expect(
      controlViews,
      "pre-fix.json must carry the measured control (iv_pole_equipment) views — the floor cannot be derived without them",
    ).toBeTruthy();
    expect(controlViews!.length, "the control must have measured views").toBeGreaterThan(0);
    const floor = Math.max(...controlViews!.map((v) => v.frameCoverage ?? 0));

    const run = await renderPack!({
      equipmentId: "oxygen_wall_port_equipment",
      outputRoot: ".openclinxr/evidence/issue-270",
    });
    const maxCoverage = Math.max(...run.views.map((v) => v.frameCoverage));
    expect(
      maxCoverage,
      `wall port post-fix max view coverage ${(maxCoverage * 100).toFixed(1)}% must exceed the `
        + `measured control floor ${(floor * 100).toFixed(1)}% (iv_pole pre-fix)`,
    ).toBeGreaterThan(floor);
  }, 1_800_000);
});

