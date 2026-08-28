import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #738 / asset-pipeline-lead.
 *
 * ## THE DEFECT, MEASURED 2026-08-27 at main `c766a658` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * The lips move by morph and the teeth cannot, so at the weight the runtime actually uses the teeth
 * cross the face surface.
 *
 * STRUCTURE, read from the shipped GLB: `mpfb_ob_patient_aisha_body` carries 47 morph targets;
 * `openclinxr_hm08_teeth_…` and `openclinxr_hm08_tongue_…` carry ZERO. All three are skinned to
 * `mpfb_ob_patient_aisha_standard_rig` and the teeth primitive has `JOINTS_0`/`WEIGHTS_0`, so the
 * teeth follow the jaw bone and nothing else. Every viseme shape in this runtime is a morph on the
 * BODY mesh.
 *
 * CLEARANCE, applying the `mouth-open` morph (target index 20) to the visible skin primitive
 * `mpfb_skin_ob_patient_aisha` and re-measuring in the teeth's own band
 * (`1.4746 <= y <= 1.5078`, `|x| <= 0.0335`), against the teeth AABB max z of 0.1422:
 *
 *   weight   skin p50   margin (p50 - teethMax)   verts in band
 *   0        0.1432     +0.0010                   731
 *   0.30     0.1407     **-0.0015**               686
 *   1.00     0.1423     +0.0001                   496
 *
 * 0.30 is not an arbitrary sample. It is `MOUTH_OPEN_CAP`, the graded ceiling #730 landed at
 * `main.ts:8973`, so it is the weight the openness channel writes every frame.
 *
 * THE JAW CHANNEL IS NOT THE PROBLEM AND MUST NOT BE TOUCHED. `viseme-timeline-drive.ts:81` derives
 * `JAW_OPEN_TEETH_CLEAR_RADIANS = asin(0.020725011825561523 / 0.137901)` from bind-pose inputs and
 * `:88-129` gives a full per-phoneme aperture table. That channel already couples the jaw to the
 * shape; it cannot help, because the teeth have no morph to follow.
 *
 * ## POPULATION CAVEAT — read this before trusting the trend
 *
 * The band is fixed in world Y while the morph moves vertices through it, so the vertex count falls
 * from 731 to 686 to 496 as the weight rises. The three rows are therefore not the same population,
 * and the recovery at weight 1.0 is not evidence that a fully open mouth is safe. Only the 0.30 row
 * matters here, because 0.30 is what ships.
 *
 * claimScope: whether the teeth's forward extent stays behind the deformed skin median at the
 *   runtime's own morph weight.
 * notEvidenceFor: how the mouth looks — that is a pixel grade. Whether the child and nurse share the
 *   zero-morph teeth; only the parent was read. Per-vertex clearance; this is an AABB face against a
 *   windowed vertex set.
 */

const GLB = "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
const CAP_SOURCE = "apps/ui-xr/src/viseme-morph-apply.ts";
const BODY = "mpfb_ob_patient_aisha_body";
const SKIN_MAT = "mpfb_skin_ob_patient_aisha";
const TEETH = "openclinxr_hm08_teeth_mpfb_ob_patient_aisha_mesh";
const TONGUE = "openclinxr_hm08_tongue_mpfb_ob_patient_aisha_mesh";

/** The teeth's own band, measured from its AABB at the planting commit. */
const Y_LO = 1.4746;
const Y_HI = 1.5078;
const X_HALF = 0.0335;

/** The runtime's morph weight, read from its source constant so a re-sweep binds automatically. */
function runtimeCap(): number {
  const m = /MOUTH_OPEN_CAP\s*=\s*([0-9.]+)/.exec(readFileSync(CAP_SOURCE, "utf8"));
  if (!m) throw new Error(`MOUTH_OPEN_CAP not found in ${CAP_SOURCE}`);
  return Number(m[1]);
}

const doc = await new NodeIO().read(GLB);
const meshes = doc.getRoot().listMeshes();
const body = meshes.find((m) => m.getName() === BODY)!;
const targetNames = (body.getExtras()?.targetNames as string[] | undefined) ?? [];

/** Max local z of a named mesh, over every primitive. */
function meshMaxZ(name: string): number {
  const mesh = meshes.find((m) => m.getName() === name);
  if (!mesh) throw new Error(`${name} is not in ${GLB}`);
  let max = -Infinity;
  const v = [0, 0, 0];
  for (const pr of mesh.listPrimitives()) {
    const pos = pr.getAttribute("POSITION")!;
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); if (v[2] > max) max = v[2]; }
  }
  return max;
}

/** Median z of the visible skin inside the teeth band, with `mouth-open` applied at `weight`. */
function skinMedianZ(weight: number): { p50: number; n: number } {
  const prim = body.listPrimitives().find((pr) => pr.getMaterial()?.getName() === SKIN_MAT)!;
  const pos = prim.getAttribute("POSITION")!;
  const i = targetNames.indexOf("mouth-open");
  const delta = i >= 0 ? prim.listTargets()[i]?.getAttribute("POSITION") : undefined;
  const zs: number[] = [];
  const v = [0, 0, 0];
  const d = [0, 0, 0];
  for (let k = 0; k < pos.getCount(); k++) {
    pos.getElement(k, v);
    if (delta) delta.getElement(k, d); else { d[0] = 0; d[1] = 0; d[2] = 0; }
    const y = v[1] + weight * d[1];
    if (y < Y_LO || y > Y_HI) continue;
    if (Math.abs(v[0] + weight * d[0]) > X_HALF) continue;
    zs.push(v[2] + weight * d[2]);
  }
  zs.sort((a, b) => a - b);
  return { p50: zs[Math.floor(zs.length / 2)]!, n: zs.length };
}

describe("the teeth stay behind the face when the mouth opens (#738)", () => {
  /**
   * RED. Measured -0.0015 m at the shipped weight. The bound is the skin's own median in the same
   * band at the same weight, so no threshold of mine appears — the comparison is the asset against
   * itself.
   */
  it.fails("(1) at the runtime's morph weight the teeth stay behind the skin median", () => {
    const w = runtimeCap();
    const { p50, n } = skinMedianZ(w);
    expect(n, "the band must still contain skin vertices at this weight").toBeGreaterThan(0);
    expect(
      meshMaxZ(TEETH),
      `skin median ${p50.toFixed(4)} at weight ${w} over ${n} verts; the teeth carry no morph `
        + "targets, so a lip morph that draws the surface back exposes them",
    ).toBeLessThanOrEqual(p50);
  });

  /**
   * KNOWN-GOOD, and it is what makes clause (1) non-vacuous. At rest the same measurement already
   * passes, by 1.0 mm. If this ever fails, clause (1) is reporting a broken instrument rather than
   * the morph.
   */
  it("(2) KNOWN-GOOD: at rest the teeth are already behind the skin median", () => {
    const { p50, n } = skinMedianZ(0);
    expect(n, "731 verts at the planting commit").toBeGreaterThan(0);
    expect(meshMaxZ(TEETH), `rest margin was +0.0010 m when planted`).toBeLessThanOrEqual(p50);
  });

  /**
   * COUNTERWEIGHT. Sliding the teeth backwards clears clause (1) and empties the mouth. The floor is
   * an in-asset landmark rather than a number of mine: the teeth must stay in front of the tongue,
   * which sits at max z 0.1347 and is the only other structure in there.
   */
  it("(3) COUNTERWEIGHT: the teeth do not retreat behind the tongue", () => {
    expect(
      meshMaxZ(TEETH),
      "pushing the teeth back far enough to clear any lip morph would put them behind the tongue "
        + "and leave the open mouth empty",
    ).toBeGreaterThan(meshMaxZ(TONGUE));
  });

  /**
   * COUNTERWEIGHT. Deleting or unbinding the teeth is the other way to make a protrusion stop being
   * visible. The counts are the shipped ones at the planting commit.
   */
  it("(4) COUNTERWEIGHT: the teeth still ship, skinned, at their triangle count", () => {
    const mesh = meshes.find((m) => m.getName() === TEETH)!;
    let tris = 0;
    let skinned = true;
    for (const pr of mesh.listPrimitives()) {
      const idx = pr.getIndices();
      tris += idx ? idx.getCount() / 3 : 0;
      if (!pr.getAttribute("JOINTS_0") || !pr.getAttribute("WEIGHTS_0")) skinned = false;
    }
    expect(Math.round(tris), "192 tris at the planting commit").toBeGreaterThanOrEqual(192);
    expect(skinned, "JOINTS_0 and WEIGHTS_0 — the teeth must keep following the jaw bone").toBe(true);
  });
});

// NOT TESTED: how the mouth looks at any weight — that is the orchestrator's pixel grade. Whether
// the child and the nurse carry the same zero-morph teeth; only the parent was read. Whether the
// three weights compared in the header describe one population — they do not, because the band is
// fixed in world Y while the morph moves vertices through it, and only the shipped weight is
// asserted on here.
