/**
 * #504 — the bake treats a layered garment identically to an unlayered one, so the physician's
 * scrub shirt punches through the lab coat over it.
 *
 * MEASURED 2026-08-21 (orchestrator). IMMUTABLE — flip the assertions and append a
 * `## FIXED (#504)` block below; do not rewrite these hashes.
 *
 *   asset                            mesh              verts   POSITION sha256[0:16]
 *   mpfb-clinical-nurse-adult        scrub_shirt       18768   4f15119183150c6a   <- NO coat over it
 *   mpfb-clinical-physician-adult    scrub_shirt       18768   4f15119183150c6a   <- coat OVER it
 *   mpfb-clinical-physician-adult    lab_coat           5264   1a67ed31132fbefd
 *
 * The two shirts are BYTE-IDENTICAL. One is worn under a coat and one is not, and the bake
 * produced the same geometry for both. That is the defect, stated exactly and with no threshold.
 *
 * WHY z_depth CANNOT FIX THIS — verified through the landed readMhcloLayering (#498):
 *   male_crude_labcoatop  zDepth=50  deleteVerts=428
 *   Scrub_Shirt           zDepth=50  deleteVerts=0
 * Same layer, so consuming z_depth faithfully yields NO offset between them. And delete_verts
 * removes BASEMESH vertices — it hides body under a garment (#485/#295), not shirt under coat.
 * Whatever lands here must therefore introduce a separation the shipped data does not express,
 * and must SAY SO rather than pretending to consume a directive.
 *
 * NO COVERAGE GATE. §6t records five gates defeated on the neighbouring "does the garment cover"
 * predicate, and the #485 signed-distance probe is VOID on open shells — its known-good column
 * returned 99.93% poke / 426.5 mm for a shirt over a body that grades perfectly clean. Do not
 * build a sixth. This contract binds the MECHANISM; whether the teal blotches are gone is the
 * orchestrator's pixel grade, exactly as #503 split it.
 *
 * claimScope: whether the bake produces different geometry for a garment worn UNDER another.
 * notEvidenceFor: that the render looks right, that poke-through is gone, or clinical realism.
 */
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const DIR = "apps/ui-xr/public/generated-humanoids/";
const NURSE = "mpfb-clinical-nurse-adult.glb";
const PHYS = "mpfb-clinical-physician-adult.glb";
const BASELINE_COAT_SHA = "1a67ed31132fbefd";
const MIN_NET_SEPARATION_M = 0.001;

type Geo = { verts: number; sha: string; mean: [number, number, number] };

async function geo(file: string, match: RegExp): Promise<Geo | null> {
  const d = await new NodeIO().read(DIR + file);
  for (const m of d.getRoot().listMeshes()) {
    if (!match.test(m.getName())) continue;
    const pos = m.listPrimitives()[0]?.getAttribute("POSITION");
    if (!pos) continue;
    const a = pos.getArray() as Float32Array;
    const sha = createHash("sha256").update(Buffer.from(new Float32Array(a).buffer)).digest("hex").slice(0, 16);
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < a.length; i += 3) { sx += a[i]!; sy += a[i + 1]!; sz += a[i + 2]!; }
    const n = a.length / 3;
    return { verts: pos.getCount(), sha, mean: [sx / n, sy / n, sz / n] };
  }
  return null;
}

const netShift = (a: Geo, b: Geo): number =>
  Math.hypot(a.mean[0] - b.mean[0], a.mean[1] - b.mean[1], a.mean[2] - b.mean[2]);

describe("#504 a garment worn under another is separated from it", () => {
  it("the control pair is real — both assets ship and carry the same shirt today", async () => {
    const n = await geo(NURSE, /scrub_shirt/);
    const p = await geo(PHYS, /scrub_shirt/);
    expect(n, "nurse scrub_shirt").toBeTruthy();
    expect(p, "physician scrub_shirt").toBeTruthy();
    expect(n!.verts).toBe(18768);
    expect(p!.verts).toBe(18768);
  });

  it.fails(
    "(1) the layered pair differs from the unlayered control — shirt pushed in OR coat pushed out, coherently",
    async () => {
      const nurseShirt = (await geo(NURSE, /scrub_shirt/))!;
      const physShirt = (await geo(PHYS, /scrub_shirt/))!;
      const physCoat = (await geo(PHYS, /lab_coat/))!;

      // EITHER approach is legitimate, so either satisfies this: move the inner garment in, or
      // the outer one out. Net centroid shift, not per-vertex magnitude — a jitter that changes
      // the hash has net ~0 and cannot pass (§11s: bound the shape, not the quantity).
      const shirtMoved = physShirt.sha !== nurseShirt.sha
        && netShift(physShirt, nurseShirt) >= MIN_NET_SEPARATION_M;
      const coatMoved = physCoat.sha !== BASELINE_COAT_SHA;

      expect(shirtMoved || coatMoved,
        "neither the under-shirt nor the over-coat moved: the bake still treats layered and unlayered identically").toBe(true);
    },
  );

  it(
    "(2) COUNTERWEIGHT: the UNLAYERED control is untouched — the nurse wears the same shirt with nothing over it",
    async () => {
      const n = (await geo(NURSE, /scrub_shirt/))!;
      expect(n.sha, "nurse scrub_shirt must stay 4f15119183150c6a — no coat, nothing to separate from")
        .toBe("4f15119183150c6a");
    },
  );

  it(
    "(3) COUNTERWEIGHT: nothing is deleted, hidden or swapped — both garments keep their vertex counts",
    async () => {
      const shirt = await geo(PHYS, /scrub_shirt/);
      const coat = await geo(PHYS, /lab_coat/);
      expect(shirt?.verts, "scrub_shirt must not be removed or decimated away").toBe(18768);
      expect(coat?.verts, "lab_coat must not be removed or swapped for a closed garment").toBe(5264);
    },
  );
});
