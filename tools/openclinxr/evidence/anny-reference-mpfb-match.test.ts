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
 * SCOPE
 *
 *   DO:     drive the MPFB body from an Anny reference so size matches measurably, and export the
 *           face shape keys so the existing viseme applier has targets.
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
  visemeNamesConsumedByRuntime: string[];
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

  it("the MPFB body ships face shape keys the runtime can drive (COUNTERWEIGHT)", async () => {
    // D11 names MPFB for "face shape keys ... and phonemes". Measured on main: the Anny nurse carries
    // 150 morph targets and the library body carries 0, because body_param_stage exports
    // export_morph=False. A viseme applier already exists and has nothing to drive.
    //
    // Count alone is not enough — targets named for nothing the runtime recognises are decoration.
    const mod = await load();
    const inspect = mod["inspectAnnyReferenceMpfbMatch"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const m of report.matched) {
      if (m.morphTargetCount === 0) {
        broken.push(`${m.bodyClassId}: 0 morph targets — the rail chosen for phonemes ships none`);
        continue;
      }
      const consumable = m.morphTargetNames.filter((n) =>
        report.visemeNamesConsumedByRuntime.some((v) => n.toLowerCase().includes(v.toLowerCase())));
      if (consumable.length === 0) {
        broken.push(
          `${m.bodyClassId}: ${m.morphTargetCount} morph targets but none match a viseme the runtime `
          + `consumes (${report.visemeNamesConsumedByRuntime.slice(0, 6).join(", ")}...) — decoration, not phonemes`,
        );
      }
    }
    expect(broken, `face shape keys that cannot be driven:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
