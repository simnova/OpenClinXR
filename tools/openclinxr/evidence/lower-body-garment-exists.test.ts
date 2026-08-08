import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#220). Three REDs. All flip — OR the slice closes on a licence STOP, which is
 * a successful outcome and is built into the vocabulary below. Read that part before anything else.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED ON MAIN — trust these, do not re-derive
 *
 * I read ALL 19 shipped humanoid GLBs with glTF-Transform NodeIO and matched every mesh name against
 * /trouser|pant|leg|lower|skirt|short/. There are ZERO lower-body garment meshes, on either rail:
 *
 *   generated-humanoids/ (7)   every garment is upper: `openclinxr_real_garment_peds_upper_v1_mesh`,
 *                              `openclinxr_declared_upper_layers__hospital_gown_mesh`,
 *                              `..._scrub_top+scrub_po`
 *   candidates/ (12)           `makeclothes_library_scrub_shirt_*`, `Scrub_Shirt`, `Polo_t-shirt`,
 *                              `crude_male_shirt`, `t_shirt_basic_tucked`
 *
 * Legs are painted texture. Lower-body clothing has never existed in this factory.
 *
 * AND THERE IS NO ASSET FOR IT LOCALLY. `find ~ -name "*.mhclo"` returns 12 files and every one is
 * `Scrub_Shirt.mhclo` — the same asset, copied across old worktree evidence dirs. The fit stage
 * sources garments from the network (`fit-cli.ts:36`, `:63-64`) and reads the licence token from the
 * asset's own header (`:178-187`), not from the download page.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS SLICE MAY LEGITIMATELY STOP WITHOUT SHIPPING A GARMENT
 *
 * A peer round refused to name a trousers asset as verified, and it was right to: neither of us has
 * read a candidate's licence header. So this is a FIND-OR-STOP.
 *
 *   verdict `garment_fitted`            a licence-clean lower garment was found, fitted and shipped
 *   verdict `blocked_no_licensed_asset` none found with a CC0 or CC-BY token in its OWN header
 *
 * `blocked_no_licensed_asset` CLOSES THIS ISSUE SUCCESSFULLY. Record every candidate you examined
 * with its id, source URL and the licence token you read. That list is the deliverable in that case
 * and it is worth more than a garment shipped on an unclear licence.
 *
 * DO NOT invent or hardcode an asset id you have not downloaded and read. Naming a fake
 * `scrub_pants_hm08` would be the single worst thing in this slice.
 * DO NOT hand-author parametric trousers in Python if the search fails. That is directive D1's
 * anti-pattern by name — "LLMs toiling in non-deterministic ways building things in the factory".
 * Copyleft (GPL/AGPL) is REFUSED regardless of convenience.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TWO GARMENTS IS NOT "THE SAME CALL TWICE" — a peer named what breaks first
 *
 * `fit_stage.py` fits ONE garment and exports `[mh, garment]`. Adding a second introduces, in the
 * peer's order of likelihood: waist interpenetration between shirt and trousers; a second
 * `fit_clothes_to_human` call and a second mesh parented to the basemesh; auto-weighting BOTH meshes
 * after BOTH fits; a second material slot; export ordering across body + upper + lower + footwear;
 * and a catalog key that is `(garmentId, bodyClass)` today and now needs to express an OUTFIT.
 *
 * None of that is a reason not to do it. It is a list of places to look when something is wrong.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PAINT MUST GO WHERE THE MESH ARRIVES — this is #73 in reverse and it is contract (2)
 *
 * #73 established that painted lower clothing is DELIBERATE, not a defect. So shipping a trouser
 * mesh ON TOP of the existing lower paint gives a muddy double — and #73 itself was the case where
 * removing paint without a replacement left a figure bare.
 *
 * So the two must move together: where a real lower garment mesh exists, the lower-band paint is
 * suppressed. Contract (2) asserts both halves, because either alone is a regression.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONE COMMAND, OR IT WILL BE LOST — the #219 failure class, three weeks old
 *
 * #219 embedded footwear via a script with no caller. #221's rebake erased it silently and main went
 * red. #226 fixed that by making `body-param-cli` orchestrate a FIXED pipeline where the footwear
 * step is unconditional.
 *
 * The lower garment joins that pipeline or it will be erased by the next rebake exactly as the
 * footwear was. Contract (3) requires it to survive a rebake and requires the finish steps that ran
 * to be OBSERVED, not declared — a skipped step cannot report itself as having run.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE
 *
 *   DO:     find a licence-clean lower garment, fit it per body class through the EXISTING
 *           ClothesService station, wire it into the #226 finish pipeline, suppress the lower paint
 *           where the mesh lands, rebake both library bodies.
 *   DO NOT: touch `apps/ui-xr/src`, the Anny rail's seven shipped humanoids, or
 *           `tools/openclinxr/evidence/infinigen-*` — a second worker holds the Infinigen trim
 *           measure this cycle.
 *   DO NOT: add a new station. This exercises the station #215 landed with a second garment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT KNOWN TO ME: whether any community lower garment is fitted to hm08 topology at all (the peer
 * could not verify one); whether ClothesService handles two garments in one scene or needs two
 * passes; whether the waist overlaps enough to poke through; and whether suppressing lower paint is
 * a per-region flag or requires a texture change. THE CAUSE OF NOTHING IS KNOWN HERE — this is
 * greenfield, not a bug. Measure, and report what you find even when it is "this cannot be done".
 *
 * CAPTURE INSTRUMENT (D3): this is a THING claim — is this figure's lower body clothed? — so the
 * grade is an ISOLATED harness render of the figure alone, NOT a station room capture.
 *
 * If any proof CANNOT PASS as written, OR passes trivially against the ambient range, OR is a
 * regression net rather than load-bearing, SAY SO AT THE MOMENT YOU FIND IT.
 */

type LowerGarmentCandidate = {
  garmentId: string;
  sourceUrl: string;
  /** Read from the .mhclo header itself, never from a web page. */
  licenseToken: string;
  accepted: boolean;
  rejectionReason: string | null;
};

type DressedFigure = {
  bodyClassId: string;
  glbPath: string;
  upperGarmentMeshName: string | null;
  lowerGarmentMeshName: string | null;
  lowerGarmentTriangleCount: number;
  /** Painted lower-body region triangles still present. Must be 0 where a lower mesh exists. */
  lowerPaintTriangleCount: number;
  footwearTriangleCount: number;
  jointCount: number;
  skinnedMeshCount: number;
  /** Finish steps OBSERVED to run in the invocation that produced these bytes. */
  finishStepsRun: string[];
};

type Inspect = () => Promise<{
  verdict: "garment_fitted" | "blocked_no_licensed_asset";
  candidatesExamined: LowerGarmentCandidate[];
  figures: DressedFigure[];
}>;

const load = () =>
  import("./lower-body-garment-exists.js") as Promise<Record<string, unknown>>;

describe("a figure's lower body is clothed by the factory (#220)", () => {
  it("a licence-clean lower garment was found and fitted, or the search is documented", async () => {
    const mod = await load();
    const inspect = mod["inspectLowerBodyGarment"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(["garment_fitted", "blocked_no_licensed_asset"]).toContain(report.verdict);
    expect(
      report.candidatesExamined.length,
      "no candidates examined — either verdict requires evidence that a search happened",
    ).toBeGreaterThan(0);

    for (const c of report.candidatesExamined) {
      expect(c.licenseToken, `${c.garmentId}: no licence token read from the .mhclo header`).toBeTruthy();
      expect(
        c.sourceUrl,
        `${c.garmentId}: no source URL — an asset with no provenance cannot ship`,
      ).toBeTruthy();
      if (c.accepted) {
        expect(
          c.licenseToken,
          `${c.garmentId}: accepted on licence "${c.licenseToken}" — only CC0 or CC-BY are permitted`,
        ).toMatch(/cc0|cc-by|cc by|public domain/i);
      }
    }

    // A documented dead end closes this issue. Everything below applies only to a shipped garment.
    if (report.verdict === "blocked_no_licensed_asset") {
      expect(
        report.candidatesExamined.every((c) => !c.accepted),
        "verdict says blocked but a candidate is marked accepted",
      ).toBe(true);
      return;
    }

    const bad: string[] = [];
    for (const f of report.figures) {
      if (!f.lowerGarmentMeshName) bad.push(`${f.bodyClassId}: no lower garment mesh in the export`);
      if (f.lowerGarmentTriangleCount < 100) {
        bad.push(`${f.bodyClassId}: ${f.lowerGarmentTriangleCount} lower-garment triangles is a shard`);
      }
    }
    expect(bad, `figures whose lower body is not clothed:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the paint leaves where the mesh arrives, and nothing else regresses (COUNTERWEIGHT)", async () => {
    // #73 established that painted lower clothing is DELIBERATE. A trouser mesh laid over surviving
    // paint is a muddy double; paint removed with no mesh is the bare-legs regression #73 itself
    // caused. Both halves move together or neither is correct.
    //
    // The rest guards the #219 failure class: a rebake that quietly drops what a previous slice
    // embedded. Upper garment, footwear, rig and skinning must all survive the new fit.
    const mod = await load();
    const inspect = mod["inspectLowerBodyGarment"] as Inspect;
    const report = await inspect();
    if (report.verdict === "blocked_no_licensed_asset") return;

    const broken: string[] = [];
    for (const f of report.figures) {
      if (f.lowerGarmentMeshName && f.lowerPaintTriangleCount > 0) {
        broken.push(
          `${f.bodyClassId}: ${f.lowerPaintTriangleCount} painted lower-body triangles under a real `
          + `garment mesh — paint and mesh both present is a muddy double (#73 in reverse)`,
        );
      }
      if (!f.upperGarmentMeshName) broken.push(`${f.bodyClassId}: upper garment lost to the new fit`);
      if (f.footwearTriangleCount < 60) {
        broken.push(`${f.bodyClassId}: footwear lost (${f.footwearTriangleCount} tris) — the #219 class`);
      }
      if (f.jointCount < 20) broken.push(`${f.bodyClassId}: ${f.jointCount} joints — rig lost`);
      if (f.skinnedMeshCount < 3) {
        broken.push(
          `${f.bodyClassId}: ${f.skinnedMeshCount} skinned meshes — body, upper and lower must all `
          + `bind, or a leg moves inside a frozen trouser`,
        );
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("one command produces it, and the step is observed to have run (COUNTERWEIGHT)", async () => {
    // #219 embedded footwear via a script with no caller; #221's rebake erased it and main went red.
    // #226 fixed that with a fixed pipeline whose steps are unconditional. The lower garment joins
    // that pipeline or the next rebake erases it the same way. A skipped step cannot report itself
    // as having run, so `finishStepsRun` must be OBSERVED rather than declared in a config.
    const mod = await load();
    const inspect = mod["inspectLowerBodyGarment"] as Inspect;
    const report = await inspect();
    if (report.verdict === "blocked_no_licensed_asset") return;

    const broken: string[] = [];
    for (const f of report.figures) {
      const ran = f.finishStepsRun.map((s) => s.toLowerCase());
      if (!ran.some((s) => /lower|trouser|pant|outfit/.test(s))) {
        broken.push(
          `${f.bodyClassId}: finishStepsRun ${JSON.stringify(f.finishStepsRun)} names no lower-garment `
          + `step — the mesh is present but nothing reports having fitted it`,
        );
      }
      if (!ran.some((s) => /footwear|shoe/.test(s))) {
        broken.push(`${f.bodyClassId}: the footwear step stopped running — #226 regressed`);
      }
    }
    expect(broken, `the pipeline did not own the lower garment:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
