import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#76) — two shoulder gates in a row passed on bare shoulders, and the product
 * was tuned to fit them.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#76)` block below, and leave the measured table intact.
 *
 * WHAT HAPPENED. #73 measured the MAXIMUM garment Y in a mid-X band and passed at
 * parent 1.345 >= clavicle 1.278. #75 measured BODY SAMPLES with a nearest-garment proximity test
 * and passed. Both renders show bare skin across both deltoids and the upper chest. Then the source,
 * `automate_blender.py:2077`:
 *
 *     # Stronger shoulder flare so deltoid body samples sit under shell (#75 coverage).
 *
 * The garment was widened so the gate's samples would fall under it. Tuned to the test, in a comment.
 *
 * MEASURED BY THE ORCHESTRATOR on both graded assets:
 *
 *                               bodyHeight   shoulderTopY   garmentMaxY   bare
 *   HEAD (8ff963f)                1.660         1.396          1.361      YES
 *   56b6998 (graded "topless")    1.660         1.396          1.361      YES
 *
 * 35 mm of bare shoulder above the rim on BOTH — and `garmentMaxY` is IDENTICAL across them, so
 * #75's flare widened the shell without raising it at all. An independent run of
 * `inspectGarmentLayerCoverage` reports `covered: true` for upper_chest and both deltoids on BOTH
 * blobs, including the one already recorded as a failure. The gate is green on its own negative,
 * because its deltoid band is Y in [1.13, 1.33] (`garment-layer-coverage.ts:264-265`) while the bare
 * skin is at 1.396 — IT SAMPLES BELOW THE REGION IT CLAIMS TO CHECK.
 *
 * THE DEFECT IS THAT THERE IS NO YOKE. `automate_blender.py:2060-2182` builds the torso as an
 * angular ring, the sleeves as SEPARATE TUBES from `_arm_p(±0.18, 0.74)`, and the collar as a smaller
 * ring above `top_y`. Nothing connects the torso rim to the sleeve root over the acromion, which is
 * why raising the neckline twice (0.76 -> 0.81) changed nothing visible — there is no surface there
 * to raise.
 *
 * THE METRIC NEEDS NO THRESHOLD SEARCH, and that is the point: the highest body surface in the
 * shoulder region must not sit above the highest garment surface over it. On the numbers above that
 * fails both graded negatives immediately, with no band to choose and no tolerance to tune. That is
 * what makes it different from the two gates before it.
 *
 * BONE-BASED SAMPLING IS NOT INDEPENDENT. The garment places itself using synthetic `_arm_p` points
 * derived from the same body-height fractions, so "sample at the clavicle bone" is the same numbers
 * wearing a hat — unless the joints come from a frozen bind-pose source the garment code does not
 * write. NOT VERIFIED whether the Anny import bones qualify. If you use bones, say why they are
 * independent.
 *
 * THE THREE CONTRACTS PULL APART, and the split is deliberate.
 *
 * The first two are about THE INSTRUMENT and hold whatever the assets look like: the check must
 * refuse both blobs a human graded as bare, and must not be satisfiable by widening a garment
 * without raising it — which is precisely the move #75 made. The third is about THE PRODUCT and
 * needs the yoke. So the check cannot be made to pass by changing the assets alone, and the assets
 * cannot be made to pass by weakening the check.
 *
 * ALSO DELETE THE TUNING. `shoulder_flare` at `:2077-2078` exists to satisfy a gate rather than to
 * dress a figure. If a real yoke makes it redundant, remove it and say so; if it is load-bearing for
 * something else, say what.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `assessShoulderCoverage({ glbPath })` returning
 * measured maxima and a verdict. Change the call sites and say why if a different shape is better.
 * What must not change: the comparison is body-surface against garment-surface over the shoulder,
 * both read from the asset, with no band or tolerance chosen after looking at the geometry.
 *
 * SCOPE: whether cloth is above the shoulder. Says nothing about drape, fit or whether the clothing
 * is clinically appropriate — that last needs a clinician and is not claimed.
 *
 * ## FIXED (#76)
 *
 * Instrument: `tools/openclinxr/evidence/shoulder-coverage.ts`
 * - `shoulderCoverageVerdict({ shoulderTopY, garmentMaxYOverShoulder })` —
 *   covered iff garmentMaxYOverShoulder >= shoulderTopY. **No tolerance.**
 * - `assessShoulderCoverage({ glbPath })` reads mesh POSITION from body vs
 *   `openclinxr_real_garment*` shells. Shoulder region = body verts in the
 *   upper half of the body AABB with |x-cx| >= 0.32 * half-width (lateral
 *   cut from AABB, not a post-hoc Y band). Garment max is taken over the
 *   same lateral footprint so mid-X collar cannot lie for bare deltoids.
 * - No bones (would share `_arm_p` fractions with the generator).
 *
 * Product: `automate_blender.py` adds a shoulder **yoke** (faces from torso
 * rim → over acromion → sleeve root) with peak at measured body shoulder top
 * + cloth/subsurf lift. Removed `shoulder_flare` at the old :2077–2078 — it
 * only widened the shell so #75 body samples fell under cloth; garmentMaxY
 * was identical (1.361) before/after and shoulders stayed bare.
 * A higher neckline alone is still insufficient (no surface over the deltoid).
 *
 * Measured on regenerated parent/nurse (instrument, post-subsurf):
 *   parent: shoulderTopY 1.3663, garmentMaxYOverShoulder 1.3858, covered
 *   nurse:  shoulderTopY 1.4456, garmentMaxYOverShoulder 1.4541, covered
 * Graded bare blobs (56b6998 + pre-fix HEAD) still refuse.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const load = async () =>
  import("./shoulder-coverage.js") as Promise<Record<string, unknown>>;

type ShoulderFacts = {
  shoulderTopY: number;
  garmentMaxYOverShoulder: number;
  covered: boolean;
};
type Assess = (input: { glbPath: string }) => Promise<ShoulderFacts>;

const PARENT = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
const NURSE = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

/** The asset the orchestrator graded "topless under an open cardigan, bare shoulders". */
function gradedBareBlob(): string {
  const dir = mkdtempSync(join(tmpdir(), "openclinxr-76-"));
  const out = join(dir, "parent-56b6998.glb");
  const buf = execFileSync("git", ["show", "56b6998:apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb"], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
  writeFileSync(out, buf);
  return out;
}

describe("the shoulder check refuses what a human graded as bare (#76)", () => {
  it("the shoulder check refuses both assets previously graded as bare-shouldered", async () => {
    // Calibration against a RECORDED VERDICT rather than against today's asset. These two blobs are
    // fixed and external; a check tuned until the current asset passes cannot also pass this.
    // Graded bare = 56b6998 blob + HEAD-at-plant parent (git show of pre-fix tree via 8ff963f).
    const mod = await load();
    const assess = mod["assessShoulderCoverage"] as Assess | undefined;
    expect(assess).toBeTypeOf("function");

    // PARENT path is the live file (now fixed). Use the fixed graded blob + the pre-#76
    // commit blob so regeneration cannot greenwash this instrument contract.
    const preFixParent = (() => {
      const dir = mkdtempSync(join(tmpdir(), "openclinxr-76-pre-"));
      const out = join(dir, "parent-8ff963f.glb");
      const buf = execFileSync(
        "git",
        ["show", "8ff963f:apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb"],
        { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      );
      writeFileSync(out, buf);
      return out;
    })();

    for (const glbPath of [gradedBareBlob(), preFixParent]) {
      const facts = await assess!({ glbPath });
      expect(facts.shoulderTopY, `${glbPath} reported no shoulder surface`).toBeGreaterThan(0);
      expect(
        facts.covered,
        `${glbPath}: shoulderTopY ${facts.shoulderTopY} vs garment ${facts.garmentMaxYOverShoulder} — graded bare, check says covered`,
      ).toBe(false);
    }
  }, 300_000);

  it("widening a garment without raising it does not count as covering the shoulder", async () => {
    // Kills the exact move #75 made: shoulder_flare widened the shell laterally, garmentMaxY did not
    // change, and the previous gate went green. A verdict driven by width rather than height fails.
    const mod = await load();
    const assess = mod["assessShoulderCoverage"] as Assess | undefined;
    const verdict = mod["shoulderCoverageVerdict"] as
      | ((facts: { shoulderTopY: number; garmentMaxYOverShoulder: number }) => boolean)
      | undefined;
    expect(assess).toBeTypeOf("function");
    expect(verdict, "expose the verdict separately so it can be probed without an asset").toBeTypeOf("function");

    // The real measured numbers, unchanged by widening.
    expect(verdict!({ shoulderTopY: 1.396, garmentMaxYOverShoulder: 1.361 })).toBe(false);
    // And a garment that genuinely reaches over the shoulder must pass, or "always false" satisfies
    // the contract above.
    expect(verdict!({ shoulderTopY: 1.396, garmentMaxYOverShoulder: 1.402 })).toBe(true);
  });

  it("the regenerated parent and nurse pass the shoulder check", async () => {
    // The product half. Needs a yoke — faces connecting the torso rim to the sleeve root over the
    // acromion — not a higher neckline, which has already been tried twice.
    const mod = await load();
    const assess = mod["assessShoulderCoverage"] as Assess | undefined;
    expect(assess).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const facts = await assess!({ glbPath });
      expect(
        facts.covered,
        `${glbPath}: shoulderTopY ${facts.shoulderTopY} still above garment ${facts.garmentMaxYOverShoulder}`,
      ).toBe(true);
    }
  }, 300_000);
});
