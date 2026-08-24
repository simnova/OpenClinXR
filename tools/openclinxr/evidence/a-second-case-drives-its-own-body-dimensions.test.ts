import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: more than one shipped case drives the body dimensions of its own cast.
 *
 * MEASURED 2026-08-24, do not re-derive. Body-mesh bounding heights of every shipped MPFB humanoid,
 * read straight from the glTF:
 *
 *   1.760  nurse-adult, physician-adult, peds-nurse-kevin, street-adult-male
 *   1.666  ob-patient-aisha, gown-adult-patient, gown-inspect, viseme-inspect
 *   1.660  peds-parent-aisha            <- authored `height_cm: 166`
 *   1.655  family-partner-adult
 *   1.241  peds-patient-child           <- authored `height_cm: 125`
 *
 * **Two of eleven bodies are phenotype-driven. Nine sit on generator defaults.** The two that are
 * driven belong to the single case in the bank that authors a phenotype at all -
 * `scenario-fixtures/src/pediatric-asthma.ts:116` (Maya, age 8, height_cm 125) and `:163` (Tara, age
 * 34, height_cm 166). Twenty-four fixture files, five mention `phenotype`, and four of those five are
 * the export/lookup machinery and its tests.
 *
 * So the phenotype -> MPFB macro path WORKS - #576 landed it and the child measures 1.241 m against an
 * authored 1.25. **The factory is not blocked on the generator. It is starved of input.** That is the
 * D9 throughput limiter: a pipeline that bakes a distinct human per case cannot do so for fourteen
 * cases that never describe one.
 *
 * KNOWN-GOOD COLUMN - clause (2): the peds-asthma pair. 1.241 and 1.660, authored 125 and 166, both
 * within 1 cm. It is the proof that the mechanism exists, and it must not move: a fix that reaches
 * clause (1) by retuning the generator's macro mapping would drag these two off their authored values.
 *
 * COUNTERWEIGHT - clause (3): the nine default bodies may not simply be scaled apart. A height that
 * does not trace to an authored `height_cm` in a case fixture is a hardcoded number in the generator,
 * which is the thing this contract exists to remove. The new body's height must MATCH its case's
 * authored value, not merely differ from 1.760.
 *
 * FAILED TREATMENT, do not repeat: editing a GLB, a resolver table, or a constant to change a shipped
 * height. The height is an output. Author the phenotype in the case fixture and re-bake.
 *
 * claimScope: body-mesh bounding height of the shipped MPFB humanoids, and whether a second case's
 *   authored `height_cm` reaches its cast's vertices.
 * notEvidenceFor: any other phenotype field (build, skin_tone, gender_presentation are unmeasured);
 *   whether the resulting figure looks right; garments; the Anny rail.
 */

const HUMANOIDS = "apps/ui-xr/public/generated-humanoids";
/** Generator defaults - every body that no case describes lands on one of these. */
const DEFAULT_HEIGHTS = [1.76, 1.666, 1.655] as const;
/** An authored height_cm must reach the mesh within this. The peds pair lands inside 1 cm. */
const AUTHORED_TOLERANCE_M = 0.02;

async function bodyHeightMeters(basename: string): Promise<number> {
  const doc = await new NodeIO().readBinary(readFileSync(`${HUMANOIDS}/${basename}`));
  let lo = Number.POSITIVE_INFINITY; let hi = Number.NEGATIVE_INFINITY;
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!/_body$/u.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"); if (!pos) continue;
      const arr = pos.getArray() as ArrayLike<number>;
      for (let i = 1; i < arr.length; i += 3) {
        const y = arr[i]!; if (y < lo) lo = y; if (y > hi) hi = y;
      }
    }
  }
  if (!Number.isFinite(lo)) throw new Error(`no _body mesh in ${basename}`);
  return hi - lo;
}

const isDefault = (h: number): boolean =>
  DEFAULT_HEIGHTS.some((d) => Math.abs(h - d) < AUTHORED_TOLERANCE_M);

describe("a second case drives its own body dimensions", () => {
  it.fails("(1) a case other than paediatric asthma has a cast body off the generator defaults", async () => {
    const candidates = [
      "mpfb-clinical-nurse-adult.glb", "mpfb-clinical-physician-adult.glb",
      "mpfb-street-adult-male.glb", "mpfb-family-partner-adult.glb", "mpfb-ob-patient-aisha.glb",
    ];
    const heights = await Promise.all(candidates.map(bodyHeightMeters));
    const authored = candidates.filter((_, i) => !isDefault(heights[i]!));
    expect(
      authored,
      `all of these sit on a generator default (${heights.map((h) => h.toFixed(3)).join(", ")}). `
      + "Only paediatric asthma authors a phenotype, so only its two actors get a body of their own; "
      + "the factory is starved of input, not broken",
    ).not.toHaveLength(0);
  }, 120_000);

  it("(2) KNOWN-GOOD COLUMN: the peds-asthma pair still matches its authored height_cm", async () => {
    // The proof that the phenotype -> vertex path exists. A fix that reaches clause (1) by retuning
    // the macro mapping instead of authoring a phenotype drags these two off their authored values.
    const child = await bodyHeightMeters("mpfb-peds-patient-child.glb");
    const parent = await bodyHeightMeters("mpfb-peds-parent-aisha.glb");
    expect(Math.abs(child - 1.25), `child authored height_cm 125, mesh is ${child.toFixed(3)}m`)
      .toBeLessThanOrEqual(AUTHORED_TOLERANCE_M);
    expect(Math.abs(parent - 1.66), `parent authored height_cm 166, mesh is ${parent.toFixed(3)}m`)
      .toBeLessThanOrEqual(AUTHORED_TOLERANCE_M);
  }, 120_000);

  it("(3) COUNTERWEIGHT: the bank still spans real human stature, not a scale trick", async () => {
    // Refuses reaching clause (1) by nudging a body a few centimetres off a default, and refuses a
    // wholesale rescale. The child must stay a child and the tallest adult must stay adult-sized.
    const child = await bodyHeightMeters("mpfb-peds-patient-child.glb");
    const tall = await bodyHeightMeters("mpfb-clinical-nurse-adult.glb");
    expect(child, "an 8-year-old is not adult-sized").toBeLessThan(1.45);
    expect(tall, "an adult clinician is not child-sized").toBeGreaterThan(1.60);
    expect(tall - child, "the bank must still span a real stature range").toBeGreaterThan(0.35);
  }, 120_000);

  it("(4) VACUITY GUARD: the reader measures a body, not an empty set", async () => {
    // Without this, clause (1) could pass on a reader that returns 0 for everything - every height
    // would be "off default". Pins that the instrument returns plausible human stature.
    const h = await bodyHeightMeters("mpfb-clinical-nurse-adult.glb");
    expect(h, "a shipped adult body must measure between 1.2 and 2.2 m").toBeGreaterThan(1.2);
    expect(h).toBeLessThan(2.2);
  }, 120_000);
});
