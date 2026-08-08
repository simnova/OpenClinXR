import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#226). Three REDs. All flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE REGRESSION, AND IT IS MINE — MEASURED, do not re-derive
 *
 * #219 embedded footwear into both library GLBs. #221 rebaked those same GLBs through
 * `body_param_stage.py` and the footwear WAS SILENTLY ERASED. Main is red right now:
 *
 *     library-figure-finish-parity (2) FAIL
 *       "spouse_anna_hayes_v1: barefoot — no footwear mesh"
 *
 * and the module's own ambient string names the cause without ambiguity:
 *
 *     library_barefoot_because_body_param_export_never_called_embed_role_footwear_shells
 *
 * ROOT CAUSE, verified by grep across the whole tree:
 * `tools/openclinxr/asset-pipeline/makeclothes/embed_library_footwear.py` HAS NO CALLER ANYWHERE.
 * Not in `package.json` (only `asset:makeclothes:fit` and `asset:body-param:fit` exist), not in
 * `body-param-cli.ts`, not in `body_param_stage.py`, not in any stage. Its ONLY invocation is a
 * hand-typed line inside its own docstring:
 *
 *     blender --background --python embed_library_footwear.py -- ...
 *
 * So #219 landed a real capability wired to a step a human has to remember, and the very next
 * upstream rebake erased its output. This is the "proven and unconsumed" pattern again — the fifth
 * instance in this repo — except this time the unconsumed thing had already shipped once.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DIRECTIVE D9 — this is the whole point, not a tidy-up
 *
 * "The ability to take MULTIPLE CASES and run them through it and get a full experience at the end,
 * capable of allowing an examination to perform with no further LLM involvement."
 *
 * A station that yields an unfinished figure unless someone remembers a second script IS NOT A
 * FACTORY STEP. It is a factory step plus a human. The defect is not the missing shoes; it is that
 * the pipeline has an edge that only exists in a docstring.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE KNOWN-GOOD COLUMN IS ALREADY IN THIS TREE — copy it, do not invent a shape
 *
 * The ANNY rail already does this correctly: `automate_blender.py:3847` calls
 * `embed_role_footwear_shells(...)` INSIDE the pipeline. That is why #188's footwear survives every
 * Anny rebake and #219's did not survive one library rebake. Mirror that relationship.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * COMPOSE, DO NOT FOLD — a peer round argued me off my first shape and I accept it
 *
 * I proposed folding the footwear code INTO `body_param_stage.py`. Rejected, and the reason is
 * specific: folding makes footwear share the body export's failure modes (Z-up handling, skins,
 * morph caps) and lets an embed error be swallowed inside a mega-export.
 *
 *   DO:     have `body-param-cli` ORCHESTRATE a fixed pipeline — fit body -> rig -> morph ->
 *           ALWAYS footwear -> catalog stamp. One public command. The footwear step is
 *           UNCONDITIONAL, not a flag, not an option, not skippable when shoes already exist.
 *   KEEP:   `embed_library_footwear.py` as the IMPLEMENTATION of that step.
 *   REMOVE: the manual invocation as a *product* path. There must not be two ways to get a
 *           finished figure, because one of them will be forgotten again.
 *
 * The script already strips prior footwear before embedding (`embed_library_footwear.py:370-373`),
 * so it is safe to run unconditionally on every bake. That is deliberate and you should rely on it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT A "RUN IT TWICE" SLICE CANNOT FAKE
 *
 * "Rebake and the shoes are still there" is WEAK — it passes identically on a no-op that skipped the
 * work and left the old shoes in place. The proof has to distinguish REBUILT from DID-NOTHING.
 *
 * Contract (2) therefore requires the report to record, for each figure, the finish steps that
 * ACTUALLY RAN in that invocation (observed at runtime, not a static list typed into a config) and
 * a content signature of the footwear meshes. A skipped step cannot report itself as having run.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE
 *
 *   DO:     make ONE command produce a finished figure; rebake both library assets through it.
 *   DO NOT: hand-author new shoe geometry. #219 already reuses #188's parametric foot-AABB shell —
 *           that is the deterministic path and inventing a second one is directive D1's anti-pattern
 *           by name.
 *   DO NOT: touch `apps/ui-xr/src` — the runtime is not the defect here, the pipeline edge is.
 *   DO NOT: convert or rebake any shipped Anny humanoid. #188's footwear on those seven must not
 *           move, and contract (3) checks it.
 *   DO NOT: "fix" #215 by writing a catalog file by hand. It must be REGENERATED by the same command.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A SECOND RED IN THE SAME BLAST RADIUS — the narrow #217 fix, and ONLY the narrow one
 *
 * `makeclothes-library-consumed` (#215) also fails on a clean tree:
 *
 *     "no MakeClothes library entries — the fit stage produced nothing a factory script can consume"
 *
 * because its catalog lives under `.openclinxr/evidence/**`, which a clean clone does not have. That
 * is #217's class. Fix it HERE for these artifacts only — the catalog must be regenerated by the
 * pipeline command, not read from evidence that may or may not exist. Do NOT attempt the other 12
 * modules in that class; #217 owns them.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE OF THE REGRESSION IS KNOWN (it is stated above and I verified it by grep). What is NOT
 * known to me: whether the catalog stamp belongs in the CLI or the stage, whether the footwear step
 * needs the armature to already exist (ordering against the rig step), and whether re-embedding
 * after morph export disturbs the morph targets #221 landed. Those are yours to determine. Several
 * of my diagnoses in this repo have been withdrawn — take nothing beyond the grep as fact.
 *
 * If any proof in the brief cannot pass as written, OR passes trivially against the ambient measured
 * range, OR asserts the opposite direction from the defect, SAY SO IN YOUR REPORT AT THE MOMENT YOU
 * FIND IT, before running a corrected version. Three of my proofs last cycle were defective and the
 * worker found them and did not tell me until the end. That is my defect to fix, but I can only fix
 * what I see.
 *
 * ## FIXED (#226)
 *
 * `body-param-cli` now orchestrates a fixed finish pipeline after `body_param_stage`:
 * unconditional `embed_library_footwear.py` on every library GLB, then catalog stamp next to
 * the tracked candidates (not under `.openclinxr/evidence/**`). `export_morph=True` on the
 * footwear re-export so #221 morph targets survive. MakeClothes library catalog is re-stamped
 * beside `makeclothes-hm08-scrub-shirt-library.glb` for clean-clone discovery (#215 narrow fix).
 * Observed finishStepsRun: body_param_stage → embed_library_footwear → catalog_stamp.
 * Planted REDs flip without assertion edits.
 */

type FinishedFigure = {
  bodyClassId: string;
  glbPath: string;
  /** The single public command that produced this figure. A raw blender invocation is not one. */
  producedByCommand: string;
  /** Steps OBSERVED to run in that invocation — not a static list from a config file. */
  finishStepsRun: string[];
  footwearMeshNames: string[];
  footwearTriangleCount: number;
  garmentMeshName: string | null;
  jointCount: number;
  morphTargetCount: number;
};

type Inspect = () => Promise<{
  figures: FinishedFigure[];
  /** Anny humanoids re-read after the library rebake — #188's footwear must not move. */
  annyFootwearIntact: Array<{ assetId: string; footwearTriangleCount: number }>;
  /** Library catalog entries, regenerated by the pipeline — not read from gitignored evidence. */
  catalogEntries: Array<{ garmentId: string; bodyClassId: string; resolvedGlbPath: string }>;
  catalogSource: string;
}>;

const load = () =>
  import("./body-param-produces-finished-figure.js") as Promise<Record<string, unknown>>;

describe("one command produces a FINISHED library figure (#226)", () => {
  it("every library figure is shod, rigged and dressed straight out of the pipeline", async () => {
    const mod = await load();
    const inspect = mod["inspectBodyParamProducesFinishedFigure"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.figures.length, "fewer than two library figures inspected").toBeGreaterThan(1);

    const unfinished: string[] = [];
    for (const f of report.figures) {
      if (f.footwearMeshNames.length === 0 || f.footwearTriangleCount < 60) {
        unfinished.push(
          `${f.bodyClassId}: ${f.footwearTriangleCount} footwear triangles — the rebake erased #219's `
          + `shoes because the embed step has no edge in the pipeline`,
        );
      }
      if (f.garmentMeshName === null) unfinished.push(`${f.bodyClassId}: no garment mesh`);
      if (f.jointCount < 20) unfinished.push(`${f.bodyClassId}: ${f.jointCount} joints — rig lost`);
      if (/blender\s+--background|--python/.test(f.producedByCommand)) {
        unfinished.push(
          `${f.bodyClassId}: producedByCommand "${f.producedByCommand}" is a raw blender invocation — `
          + `a step a human has to remember is not a factory edge (D9)`,
        );
      }
    }
    expect(unfinished, `figures the pipeline did not finish:\n${unfinished.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the footwear step actually RAN, it was not skipped over old shoes (COUNTERWEIGHT)", async () => {
    // "Rebake and the shoes are still there" passes identically on a no-op that skipped the work and
    // left the previous shoes in place. A skipped step cannot report itself as having run, so the
    // report must name the steps OBSERVED in the invocation that produced these bytes.
    const mod = await load();
    const inspect = mod["inspectBodyParamProducesFinishedFigure"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const f of report.figures) {
      const ran = f.finishStepsRun.map((s) => s.toLowerCase());
      if (!ran.some((s) => /footwear|shoe/.test(s))) {
        broken.push(
          `${f.bodyClassId}: finishStepsRun ${JSON.stringify(f.finishStepsRun)} does not include a `
          + `footwear step — shoes present but nothing reports having embedded them`,
        );
      }
      if (f.finishStepsRun.length < 2) {
        broken.push(`${f.bodyClassId}: only ${f.finishStepsRun.length} finish step(s) observed`);
      }
    }
    expect(broken, `the footwear step did not run:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the Anny rail is untouched and the catalog needs no gitignored evidence (COUNTERWEIGHT)", async () => {
    // Two failure modes at once. #188 put footwear on seven Anny humanoids and a library rebake must
    // not disturb them. And #215's catalog currently lives under .openclinxr/evidence/**, so it
    // fails on a clean clone for the wrong reason (#217's class) — it must be REGENERATED by the
    // pipeline, never read from evidence and never hand-written.
    const mod = await load();
    const inspect = mod["inspectBodyParamProducesFinishedFigure"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    expect(
      report.annyFootwearIntact.length,
      "no Anny humanoids re-read — the counterweight cannot see a regression it never measured",
    ).toBeGreaterThan(0);
    for (const a of report.annyFootwearIntact) {
      if (a.footwearTriangleCount < 60) {
        broken.push(`${a.assetId}: ${a.footwearTriangleCount} footwear triangles — #188 regressed`);
      }
    }

    expect(
      report.catalogSource,
      "the catalog must name a pipeline-regenerated source, not a path under .openclinxr/evidence",
    ).not.toMatch(/\.openclinxr[/\\]evidence/);
    if (report.catalogEntries.length === 0) {
      broken.push("catalog is empty — #215 stays red for the wrong reason on a clean clone");
    }
    for (const e of report.catalogEntries) {
      if (!e.resolvedGlbPath || !/\.glb$/i.test(e.resolvedGlbPath)) {
        broken.push(`${e.garmentId}/${e.bodyClassId}: catalog entry resolves no GLB`);
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
