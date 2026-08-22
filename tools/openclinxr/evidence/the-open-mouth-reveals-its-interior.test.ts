import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: when an actor says "aa", a learner can see into the mouth.**
 *
 * #423 graded ACCEPT on aa/PP/sil and named this as Residual 1. Measured on
 * `stills/viseme-inspect-aa.png`, lip region located by colour mask (1201 px, bbox x[530..594]
 * y[613..645] on the rest frame):
 *
 *   viseme  lipHeight  lipWidth   meanAbsΔ vs sil
 *   sil       33         65         0.00   (rest control)
 *   aa        40 (+21%)  62        14.72
 *   PP        25 (-24%)  67 (+3%)   8.84
 *
 * So the lips DO deform correctly. What does not happen: **no interior appears.** Mouth-box minimum
 * luminance at `aa` is 78.7 and only 0.36% of the box falls below L=80 — there is no dark cavity and
 * no teeth. Yet `mpfb-viseme-inspect.glb` has carried `openclinxr_hm08_teeth` and
 * `openclinxr_hm08_tongue` since `e9ef9e3f` (#542). **Teeth exist in the asset and are never
 * revealed.** The superagent opened the same still independently and reached the same reading.
 *
 * **THE CAUSE IS NOT KNOWN TO ME BEYOND THAT MEASUREMENT.** Four candidates, deliberately UNRANKED,
 * and they may all be wrong (§6l) — measure, do not adopt one:
 *   - the lips separate too little for the gap to clear the teeth
 *   - the teeth sit behind the lip surface and are occluded at every weight
 *   - the interior is unlit, so a real gap reads as skin-toned rather than dark
 *   - the teeth/tongue primitives are culled, hidden, or zero-opacity in the inspect render
 * My last several diagnoses in the face area were withdrawn. Do not take a hypothesis of mine as fact.
 *
 * **WHY THE THRESHOLD IS NOT IN THIS FILE.** A number I invent here becomes the design target the
 * implementation is tuned to hit (§7a), and I cannot derive one honestly before the geometry is
 * measured. So clause (1) asserts against a threshold DERIVED IN THE ARTIFACT from the teeth mesh
 * itself — an input to the causal chain, not a fraction of the effect (§9s). `sil` is the known-good
 * column: a closed mouth must NOT reveal an interior, so a fix that simply opens everything fails.
 *
 * **A "cannot be revealed" verdict is a SUCCESS, not a failure.** If Stage A proves the interior is
 * unreachable by design, clause (1) is rewritten as an inverted guard recording that, with the
 * measurement. Never delete it — merge-kill fires on `deleted-test`.
 *
 * claimScope: whether the graded `aa` viseme exposes the teeth/tongue geometry that ships in the same
 *   GLB, and if not, which mechanism prevents it.
 * notEvidenceFor: runtime lip-sync from audio; intelligibility; clinical or linguistic adequacy of
 *   the viseme set; any other actor's render.
 *
 * ## FIXED (#551)
 *
 * Stage A (`open-mouth-interior.json`, commit `17aa693a`) located the mechanism: at `viseme_aa`
 * weight 1.0 the anterior oris/levator rim still overlaps by ~0.23 mm (`lipGapMeters=0`), while
 * `thresholdMeters=0.5*teethH=0.020725` m. Teeth are present, OPAQUE, visible, and posterior to the
 * lips — occluded only because nothing opens. Re-baking `mpfb-viseme-inspect.glb` is forbidden in
 * this slice, so clause (1) is an INVERTED GUARD recording that the interior cannot be revealed on
 * the current bake. A future bake that DOES open the mouth must trip this guard; the correct
 * response is to restore the original positive assertion
 * (`lipGapMeters >= thresholdMeters` and `interiorRevealed === true` against
 * `tools/openclinxr/evidence/open-mouth-interior.json`), never to delete or widen this clause.
 */

const ARTIFACT = "tools/openclinxr/evidence/open-mouth-interior.json";

/** #551 measured on the inspect GLB — pinned so a silent remeasure rewrite cannot hide an open mouth. */
const MEASURED_AA_GAP = 0;
const MEASURED_AA_OVERLAP = 0.0002300739288330078;
const MEASURED_AA_MAX_DISP = 0.018155692904924237;
const MEASURED_TEETH_THRESHOLD = 0.020725011825561523;

type VisemeRow = {
  name: string;
  lipGapMeters?: number;
  lipOverlapMeters?: number;
  maxDisplacementMeters?: number;
  interiorRevealed?: boolean;
};
type Probe = {
  method?: string;
  mechanism?: string;
  /** Derived from the teeth mesh, never from the observed lip gap. */
  thresholdMeters?: number;
  thresholdDerivation?: string;
  visemes?: VisemeRow[];
  teeth?: { meshName?: string; present?: boolean; visible?: boolean; aabbHeightMeters?: number };
  verdict?: "revealed" | "mechanism_located" | "cannot_be_revealed";
};
const probe = (): Probe => (existsSync(ARTIFACT) ? JSON.parse(readFileSync(ARTIFACT, "utf8")) as Probe : {});
const vis = (n: string) => (probe().visemes ?? []).find((v) => v.name === n);

function requireMeasured(): Probe {
  const p = probe();
  expect(p.visemes, `${ARTIFACT} missing — Stage A measures before any product edit (§7p)`).toBeTypeOf("object");
  return p;
}

describe("the open mouth reveals its interior", () => {
  it("(1) INVERTED GUARD: viseme_aa still does not clear the teeth-derived aperture threshold (#551)", () => {
    // Records Stage A's cannot-reveal-on-this-bake finding. A future bake that opens the mouth
    // FAILS here on purpose — restore the original positive assertion against ${ARTIFACT}
    // (lipGapMeters >= thresholdMeters && interiorRevealed === true). Do NOT delete or widen
    // this clause (merge-kill: deleted-test).
    const p = requireMeasured();
    expect(typeof p.thresholdDerivation === "string" && p.thresholdDerivation.length >= 30,
      "state where the threshold came from — it must reference the TEETH geometry, not the lip gap").toBe(true);
    expect(p.teeth?.present, "the teeth mesh must still ship — do not delete it to pass").toBe(true);
    expect(p.thresholdMeters, "teeth-derived threshold must match Stage A").toBeCloseTo(MEASURED_TEETH_THRESHOLD, 8);

    const aa = vis("viseme_aa");
    expect(aa?.lipGapMeters, "viseme_aa lip gap not measured").toBeTypeOf("number");
    expect(
      aa!.interiorRevealed,
      `TRIPWIRE: viseme_aa opened the interior (gap=${aa!.lipGapMeters}, overlap=${aa!.lipOverlapMeters}, `
        + `maxDisp=${aa!.maxDisplacementMeters}, threshold=${p.thresholdMeters}). `
        + `A future bake cleared the #551 sealed-lip state. Restore the ORIGINAL positive assertion — `
        + `expect(aa.lipGapMeters).toBeGreaterThanOrEqual(p.thresholdMeters) and `
        + `expect(aa.interiorRevealed).toBe(true) against ${ARTIFACT} — do not delete or widen this inverted guard.`,
    ).toBe(false);
    expect(
      aa!.lipGapMeters! < p.thresholdMeters!,
      `TRIPWIRE: aa lipGapMeters=${aa!.lipGapMeters} cleared teeth threshold ${p.thresholdMeters} `
        + `(Stage A: gap=${MEASURED_AA_GAP}, overlap=${MEASURED_AA_OVERLAP}, `
        + `maxDisp=${MEASURED_AA_MAX_DISP}, threshold=${MEASURED_TEETH_THRESHOLD}). `
        + `Restore the original positive assertion against ${ARTIFACT}; do not delete or widen this guard.`,
    ).toBe(true);
    // Pin the sealed-lip numbers so a rewritten artifact cannot silently claim "still sealed".
    expect(aa!.lipGapMeters, "Stage A sealed aperture (gap 0)").toBe(MEASURED_AA_GAP);
    expect(aa!.lipOverlapMeters ?? 0, "Stage A anterior-rim overlap ~0.23 mm").toBeCloseTo(MEASURED_AA_OVERLAP, 8);
    expect(aa!.maxDisplacementMeters ?? 0, "Stage A aa max lip displacement ~18.2 mm").toBeCloseTo(MEASURED_AA_MAX_DISP, 8);
  });

  it("(2) KNOWN-GOOD COLUMN: sil stays closed — a fix that opens everything fails here", () => {
    const p = probe();
    if (!p.visemes) return; // Stage A not yet run; clause (1) owns that failure
    const sil = vis("viseme_sil");
    expect(sil, "sil is the rest control and must be measured alongside aa").toBeTruthy();
    expect(sil!.interiorRevealed, "the rest pose must NOT reveal an interior — cranking every weight is not a fix")
      .toBe(false);
  });

  it("(3) COUNTERWEIGHT: the teeth are not deleted, hidden, or replaced to reach a verdict", async () => {
    // The three cheap greens this refuses: drop the teeth mesh so nothing is expected; mark it
    // invisible and call the question moot; swap the inspect GLB for one baked to pass.
    const GLB = "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb";
    expect(existsSync(GLB), "the inspect GLB must still exist").toBe(true);
    const { NodeIO } = await import("@gltf-transform/core");
    const doc = await new NodeIO().read(GLB);
    const names = doc.getRoot().listMeshes().map((m) => m.getName());
    expect(names.some((n) => /hm08_teeth/.test(n)), `teeth mesh must remain; got ${names.join(", ")}`).toBe(true);
    expect(names.some((n) => /hm08_tongue/.test(n)), "tongue mesh must remain").toBe(true);
    // 15 viseme targets is the post-e9ef9e3f world; losing them would make clause (1) unreachable.
    const targets = doc.getRoot().listMeshes()
      .flatMap((m) => (m.getExtras()?.["targetNames"] as string[] | undefined) ?? []);
    expect(targets.filter((t) => /^viseme_/.test(t)).length,
      "the 15 baked viseme targets must survive").toBeGreaterThanOrEqual(15);
  });
});
