import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#221). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * OPERATOR DIRECTIVE D11, verbatim — this slice is the named next step
 *
 *   "Don't rule out MPFB — treat it as a first-class alternative to Anny. Prefer MPFB when you need
 *    standard rig, face shape keys, or MakeHuman wardrobe libraries; keep Anny for case-driven
 *    phenotype binding. Hybrid (Anny mesh + MPFB2 eyes/gaze) is already available. NEXT: implement
 *    ANNY-AS-REFERENCE -> MPFB BODY MATCH so age/size/gender stay aligned while gaining MPFB rigging
 *    and phonemes."
 *
 * The two rails have different JOBS. Anny owns case-driven phenotype; MPFB owns rig, face shape keys
 * and the wardrobe library. The match is what keeps them the same person.
 *
 * This also re-affirms MADR 0044's own operator direction, quoted inside that document (2026-08-07):
 * "create a humanoid with anny then use that as a reference for creating a humanoid with MPFB... so
 * that anny becomes the reference but you can leverage the clothing options from makeclothes."
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED ON MAIN — two gaps, both real, neither guessed
 *
 * 1. NO PHONEMES ON THE MPFB RAIL. Morph targets, counted with glTF-Transform NodeIO:
 *
 *      ed_chest_pain_nurse_adult (Anny)            150 morph targets
 *      body-param-adult_lean_female-library (MPFB)   0 morph targets
 *
 *    `body_param_stage.py` exports with `export_morph=False`. The rail the operator wants for FACE
 *    SHAPE KEYS ships none. A viseme applier already exists (`viseme-morph-apply.test.ts`,
 *    `ui-xr-viseme-drive-capture.ts`) and has nothing to drive on a library figure.
 *
 * 2. THE ANNY REFERENCE HOOK EXISTS AND WAS NEVER USED. `body_param_stage.py:76-78` accepts
 *    `--anny-obj`, described as "Optional Anny reference OBJ for stature/foot align (0044 path)".
 *    The shipped library bodies' provenance records no Anny reference. So the MPFB bodies were
 *    generated from macro sliders alone, with nothing tying age/size/gender to a case's Anny figure.
 *
 * MADR 0044 measured that a stature match is achievable: mean vertex deviation ~2.3 cm after uniform
 * scale plus foot/centre align. That is the reference number, not one I invented.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT "MATCH" MUST MEAN, so this cannot be satisfied by a metadata field
 *
 * A provenance line saying `annyReference: "ed_chest_pain_spouse_adult"` proves nothing. The MPFB body
 * must MEASURABLY resemble its Anny reference in the dimensions the operator named — age, size,
 * gender — read from the exported glTF:
 *
 *   size    stature (body height) and torso girth, both within a tolerance DERIVED FROM 0044's
 *           measured ~2.3 cm mean deviation, not from a figure I supply
 *   gender  a dimension that actually separates the shipped male and female Anny bodies; measure it
 *           on the Anny pair FIRST and use that separation as the scale
 *   age     stated honestly: if no measurable proxy exists on these assets, say so rather than
 *           inventing one. A contract that asserts an unmeasurable thing is worse than one that
 *           admits the gap.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A2 IS DOWNGRADED FROM A FIX TO A MEASUREMENT — a peer round talked me out of the fix
 *
 * My first shape for this was "flip `export_morph=True` and assert the names intersect what the
 * runtime consumes". The peer's objection, which I accept: MPFB's face targets are MakeHuman-family
 * names and the runtime consumes `viseme_*` / `openclinxr_mouth_open` (Anny's list is authored at
 * `automate_blender.py:562`; the runtime reads them at `main.ts:8167`, `:8921-8923`). There is no
 * reason to expect those vocabularies to meet, and a slice that must make them meet in order to go
 * green is a slice that will invent a name map to survive. That would ship FALSE PHONEME READINESS —
 * a station that reports ready and drives nothing.
 *
 * So contract (2) now asks for the ANSWER, not for a particular answer. Verdict is exactly one of:
 *
 *   intersects         at least one exported MPFB target name matches a viseme the runtime consumes
 *   disjoint_measured  they do not meet — and you list >= 20 exported MPFB names as the evidence
 *
 * `disjoint_measured` CLOSES THIS QUESTION SUCCESSFULLY and is the more likely outcome. It is worth
 * more than a forced intersection, because the next slice then knows exactly what a name map costs.
 * Doing nothing supports NEITHER verdict, because 0 exported names satisfies neither branch.
 *
 * BOTH LISTS MUST BE READ, NOT WRITTEN. The viseme vocabulary comes from the runtime source; the
 * target names come from the exported glTF. A hardcoded array in the inspect is the fake here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A3 — MAIN IS RED AND THE PROOF READS A FILE THAT NEED NOT EXIST
 *
 * On a clean tree `parametric-body-deforms` contract (2) fails:
 *
 *     AssertionError: no deformation epsilon — expected 0 to be greater than 0
 *
 * Contract (1) passes, so `bodies.length >= 2`; the self-calibration path at
 * `parametric-body-deforms.ts:529-548` runs and yields ZERO tip motion, so epsilon stays 0. The
 * module also reads `.openclinxr/evidence/issue-216/pre-fix.json` (`:99-123`) and a gitignored stage
 * report (`:551-584`), and takes `max(liveLBS, stageReport)`. #218's worker RECONSTRUCTED that stage
 * report inside its own worktree so the proof would pass, and disclosed it unprompted. It was right
 * to disclose and right to call it "a patch over a structural problem".
 *
 * A proof that reads an artifact which may or may not be present cannot fail for the right reason.
 *
 * REQUIRED: ONE INSTRUMENT. Either
 *   (a) fix the JS LBS so it measures the exported GLB correctly, with epsilon self-calibrated from
 *       THAT SAME LBS — then no evidence file is read at all; or
 *   (b) make the Blender stage the sole instrument and have its report REGENERATED by the slice's own
 *       `run:`, so a clean clone reproduces it.
 *
 * DELETING the override while leaving a broken instrument strands the contract red forever. Deleting
 * it while keeping a `max(...)` under another name is the fake. The peer could not isolate the
 * under-read to one line and neither could I — the module's own comments call it "IBM/world path
 * quirks" (`:551-552`, `:582-583`). Candidates, unranked and possibly all wrong: inverse bind matrix
 * space, joint-name resolution, JOINTS_0/WEIGHTS_0 indexing. THE CAUSE IS NOT KNOWN TO ME BEYOND THE
 * FAILING ASSERTION. Trace it; do not take a hypothesis of mine as fact.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THESE THREE ARE ONE SLICE, over a peer's objection
 *
 * The peer wanted A3 alone, then A1, then A2 — "three independent lands". I overrode it, and the
 * reason is the artifact, not the schedule: A1 REBAKES both library GLBs, and the deformation
 * measurement is taken FROM those GLBs. Landing A3 first means measuring deformation on bodies that
 * A1 is about to replace, then measuring again. They are coupled through the export whether or not
 * they are coupled in the diff.
 *
 * Each cause still carries its own proof that can fail alone — that is the condition for bundling,
 * and it is met. If you find they are genuinely entangled in a way I have not seen, say so and do
 * A3 first; a partial land with a named blocker is a success here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE
 *
 *   DO:     drive the MPFB body from an Anny reference so size matches measurably; MEASURE the morph
 *           name question; make the deformation proof self-sufficient.
 *   DO NOT: replace Anny. D11 keeps Anny for case-driven phenotype binding — this makes MPFB MATCH
 *           it, not supersede it.
 *   DO NOT: build lower-body clothing (#220), retarget motion, or add cast roles.
 *   DO NOT: hand-author morph targets in Python. MPFB provides face shape keys; that is the whole
 *           reason D11 names MPFB for this job. Authoring them by hand is directive D1's anti-pattern.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT KNOWN TO ME: whether MPFB's face shape keys survive glTF export as morph targets with names the
 * existing viseme applier recognises, and whether `export_morph=True` conflicts with the skinning
 * #216 landed. Nine of my premises here have been withdrawn — take no hypothesis of mine as fact.
 * If the shape keys export under names nothing consumes, SAY SO AND STOP with the names you found;
 * that is a successful finding and closes this issue.
 *
 * #215, #216 and #218 contracts stay green. The planted header is IMMUTABLE — append `## FIXED (#221)`.
 */

type MatchedBody = {
  bodyClassId: string;
  glbPath: string;
  annyReferenceAsset: string | null;
  heightMeters: number;
  annyHeightMeters: number;
  torsoGirthMeters: number;
  annyTorsoGirthMeters: number;
  morphTargetCount: number;
  morphTargetNames: string[];
  producedByStage: string;
};

type Inspect = () => Promise<{
  matched: MatchedBody[];
  tolerance: { heightMeters: number; girthMeters: number; source: string };
  /** Read FROM RUNTIME SOURCE, not written here. A hardcoded array is the fake. */
  visemeNamesConsumedByRuntime: string[];
  /** Where the two vocabularies were read from, so the reading can be re-run. */
  visemeVocabularySource: string;
  /** Exactly one of these two. Doing nothing supports neither. */
  morphNameVerdict: "intersects" | "disjoint_measured";
}>;

const load = () =>
  import("./anny-reference-mpfb-match.js") as Promise<Record<string, unknown>>;

describe("an MPFB body matches its Anny reference (#221)", () => {
  it("the MPFB body measurably matches the Anny figure it was built from", async () => {
    const mod = await load();
    const inspect = mod["inspectAnnyReferenceMpfbMatch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.matched.length, "no matched bodies — the Anny reference was not used").toBeGreaterThan(0);
    expect(
      report.tolerance.source,
      "tolerance must name where it came from (MADR 0044 measured ~2.3cm), not be chosen",
    ).toMatch(/0044|measured/i);

    const bad: string[] = [];
    for (const m of report.matched) {
      if (!m.annyReferenceAsset) {
        bad.push(`${m.bodyClassId}: no Anny reference recorded — built from macro sliders alone`);
        continue;
      }
      const dh = Math.abs(m.heightMeters - m.annyHeightMeters);
      const dg = Math.abs(m.torsoGirthMeters - m.annyTorsoGirthMeters);
      if (dh > report.tolerance.heightMeters) {
        bad.push(
          `${m.bodyClassId}: height ${m.heightMeters.toFixed(3)}m vs Anny ${m.annyHeightMeters.toFixed(3)}m `
          + `— off by ${dh.toFixed(3)}m, tolerance ${report.tolerance.heightMeters.toFixed(3)}m`,
        );
      }
      if (dg > report.tolerance.girthMeters) {
        bad.push(
          `${m.bodyClassId}: girth ${m.torsoGirthMeters.toFixed(3)}m vs Anny ${m.annyTorsoGirthMeters.toFixed(3)}m `
          + `— off by ${dg.toFixed(3)}m, tolerance ${report.tolerance.girthMeters.toFixed(3)}m`,
        );
      }
      if (/generated-humanoids\//.test(m.glbPath)) {
        bad.push(`${m.glbPath}: a shipped Anny humanoid was overwritten — this adds library candidates`);
      }
    }
    expect(bad, `MPFB bodies that do not match their Anny reference:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the morph-name question is ANSWERED, either way (MEASUREMENT)", async () => {
    // Downgraded from a fix to a measurement. Either verdict closes it; a forced intersection would
    // be false phoneme readiness. What is forbidden is not answering: 0 exported names and an empty
    // vocabulary support neither branch, so silence cannot pass.
    const mod = await load();
    const inspect = mod["inspectAnnyReferenceMpfbMatch"] as Inspect;
    const report = await inspect();

    expect(
      report.visemeVocabularySource,
      "the viseme vocabulary must name where it was READ from in the runtime, not be an array typed here",
    ).toMatch(/\.(ts|py)\b/);
    expect(
      report.visemeNamesConsumedByRuntime.length,
      "no viseme vocabulary read from the runtime — nothing to compare exported targets against",
    ).toBeGreaterThan(0);
    expect(["intersects", "disjoint_measured"]).toContain(report.morphNameVerdict);

    const broken: string[] = [];
    for (const m of report.matched) {
      const consumable = m.morphTargetNames.filter((n) =>
        report.visemeNamesConsumedByRuntime.some((v) => n.toLowerCase().includes(v.toLowerCase())));

      if (report.morphNameVerdict === "intersects") {
        if (consumable.length === 0) {
          broken.push(
            `${m.bodyClassId}: verdict says "intersects" but 0 of ${m.morphTargetCount} exported `
            + `targets match a viseme the runtime consumes`,
          );
        }
      } else if (m.morphTargetNames.length < 20) {
        broken.push(
          `${m.bodyClassId}: verdict "disjoint_measured" needs the evidence — only `
          + `${m.morphTargetNames.length} exported target names listed, at least 20 required. `
          + `If the export genuinely yields none, that is a different finding: say so and STOP.`,
        );
      }
    }
    expect(broken, `the morph question was not answered:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the deformation proof needs no untracked artifact (COUNTERWEIGHT — A3)", async () => {
    // Main is RED here on a clean tree: `no deformation epsilon — expected 0 to be greater than 0`.
    // The module reads .openclinxr/evidence/issue-216/pre-fix.json and a gitignored stage report, and
    // takes max(liveLBS, stageReport). #218's worker reconstructed that report in its worktree so the
    // proof would pass. ONE INSTRUMENT: epsilon and deformation from the same measurement over the
    // exported GLB, or from a Blender stage this slice's own `run:` regenerates.
    const deforms = (await import("./parametric-body-deforms.js")) as Record<string, unknown>;
    const inspectDeforms = deforms["inspectParametricBodyDeforms"] as (() => Promise<{
      bodies: Array<{ bodyClassId: string; bodyDeformationMeters: number; garmentDeformationMeters: number }>;
      calibration: { deformationEpsilonMeters: number; source: string };
    }>) | undefined;
    expect(inspectDeforms).toBeTypeOf("function");

    const report = await inspectDeforms!();
    expect(
      report.calibration.deformationEpsilonMeters,
      "epsilon is still 0 — the instrument did not measure the export",
    ).toBeGreaterThan(0);
    expect(
      report.calibration.source,
      "epsilon must be sourced from the export or from a regenerated stage run, never from a "
      + "pre-fix artifact that a clean clone will not have",
    ).not.toMatch(/pre.?fix/i);

    const frozen = report.bodies.filter(
      (b) => b.bodyDeformationMeters < report.calibration.deformationEpsilonMeters
        || b.garmentDeformationMeters < report.calibration.deformationEpsilonMeters,
    );
    expect(
      frozen.map((b) => b.bodyClassId),
      "#216's deformation guarantee must survive the rebake this slice performs",
    ).toEqual([]);
  }, 1_800_000);
});
