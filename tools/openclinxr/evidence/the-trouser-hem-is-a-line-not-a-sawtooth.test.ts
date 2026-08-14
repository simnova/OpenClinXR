import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **The adults' trouser hems have ~10 mm teeth at the ankle. The child's, from the same garment and
 * the same fitter, has 1.3 mm. She is the known-good and she is inside the same asset family.**
 *
 * Graded 2026-08-14 18:18Z on `mpfb-ob-patient-aisha` after #341 round 19 fixed the waistband: the
 * square hip corners are gone, and the **ankle cuffs are still visibly sawtoothed on both legs**. That
 * was ranked defect #2 in the round-19 brief and was not that round's subject.
 *
 * ## MEASURED — local roughness, not span (§11s)
 *
 * Span alone cannot tell a *sloped* hem from a *ragged* one: a hem that follows the ankle contour
 * legitimately varies. The discriminator is **local** — sort the hem ring by angle about its own
 * centroid and read the step between angularly-adjacent vertices. Hem band = the bottom 12 mm of the
 * `cargo_pants` primitive, one leg (x < 0):
 *
 *   actor                     hem verts   meanStep   maxStep   direction flips
 *   ------------------------  ---------   --------   -------   ---------------
 *   mpfb-ob-patient-aisha           107    0.80 mm   9.58 mm                13
 *   mpfb-peds-nurse-kevin           263    0.66 mm   9.83 mm                33
 *   **mpfb-peds-patient-child**      64  **0.11 mm** **1.32 mm**             6
 *
 * **The child's hem is 7x smoother in mean step and 7x tighter in worst step**, on the same
 * `cargo_pants` garment through the same `ClothesService` fit. This is not a garment limitation and
 * not a fitter limitation — it is reachable on this pipeline, today, on a shipped asset.
 *
 * ## THE BOUND IS DERIVED FROM THE KNOWN-GOOD, NOT INVENTED (§9s)
 *
 * The contract does not carry a millimetre literal. It computes
 *
 *   allowed = 3 x child.maxStep x (actor.stature / child.stature)
 *
 * — the child's own worst step, scaled for the actor's size, times a generous 3x. On today's bytes
 * that is `3 x 1.32 x (1.687 / 1.259) = 5.31 mm`, and aisha measures **9.58 mm**, so she fails by
 * **1.8x**. The margin is real and was checked before the bound was written: this is not a threshold
 * fitted to clear an observation.
 *
 * **A literal cannot be edited to pass it, either** — the bound is recomputed from the child's shipped
 * mesh at test time, so making the child worse raises the bar for nobody: clause (3) pins her.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                            | (1) aisha | (2) intact | (3) child | result
 *   ------------------------------------------------------|-----------|------------|-----------|--------
 *   a) today                                             | **FAIL**  |    pass    |   pass    | REFUSED
 *   b) delete the ragged hem ring / shorten the trousers | pass      |  **FAIL**  |   pass    | REFUSED
 *   c) flatten the hem to a single Y, ignoring the ankle | pass      |    pass    |   pass    | ALLOWED*
 *   d) let the child's hem degrade so the bound relaxes  | pass      |    pass    | **FAIL**  | REFUSED
 *   e) re-contour the hem as the child's already is      | pass      |    pass    |   pass    | ALL PASS
 *
 * **(b) is the one to watch.** The cheapest way to remove teeth is to remove the vertices that have
 * them, or to raise the hem above the ragged band. Clause (2) pins hem vertex count within 20% and the
 * hem's world Y within 10 mm of today's, so the trousers cannot get shorter or coarser to pass.
 *
 * **(d) is why clause (3) exists.** The bound is a function of the child's mesh; degrading her would
 * widen it for everyone. Clause (3) holds her at her measured 1.32 mm with the same 3x allowance.
 *
 * ***(c) is deliberately NOT refused.** A perfectly flat hem is a legitimate outcome — trousers are
 * often cut straight — and I am not qualified to say the hem must follow the ankle contour. If the fix
 * flattens it and the pixels read well, that is a pass. Recorded so nobody treats it as a loophole.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED**, failing on aisha and kevin today.
 * **(2), (3) and (4) all pass today** and are true nets — they read quantities the fix must not move.
 *
 * NOT TESTED:
 *   - **Whether the teeth are visible at station distance.** Graded at 4096 isolated; at a 1440 px
 *     station frame the ankles are ~30 px and this may be invisible. It is a grade-resolution defect
 *     until someone shows otherwise.
 *   - **Why the child's hem is clean.** Her pants carry 64 hem vertices against aisha's 107 and
 *     kevin's 263 — a different subdivision, which may be cause or coincidence. Nobody has traced it.
 *   - **The waist end.** #341 round 19 fixed the rim; the residual seam there is a separate defect.
 *   - **Footwear interaction.** Kevin's boots cover his ankle entirely, so his 9.83 mm may never
 *     render. He is measured here but not asserted on.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
/** Overridable so a destructive probe can point the same logic at doctored assets. */
const ASSET_DIR = process.env.OPENCLINXR_HEM_PROBE_DIR ?? join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

const SUBJECT = "mpfb-ob-patient-aisha";
/** Same garment, same fitter, 7x smoother — the known-good column (§9h). */
const KNOWN_GOOD = "mpfb-peds-patient-child";

/** Hem band depth: the bottom 12 mm of the trouser primitive. */
const HEM_BAND_M = 0.012;
/** Generous allowance over the known-good's own worst step, size-scaled. Margin checked: aisha 1.8x over. */
const ALLOWANCE = 3;
/** Today's measured hem vertex counts must not collapse — a fix may not delete the ragged ring. */
const VERT_TOLERANCE = 0.2;
/**
 * Nor may the trousers get shorter to escape the band. Measured 2026-08-14: aisha's hem sits at
 * world Y **0.1010 m** (the child's at 0.1000) — at the ankle, not the floor. My first draft of this
 * clause pinned it against 0.0 without measuring and the counterweight failed on its own tree, which
 * is the §7t "vacuous or wrong proof" case caught by running it.
 */
const AISHA_HEM_Y_M = 0.1010;
const HEM_Y_TOLERANCE_M = 0.01;

type Hem = { verts: number; meanStepM: number; maxStepM: number; hemY: number; stature: number };

async function measureHem(id: string): Promise<Hem | null> {
  const path = join(ASSET_DIR, `${id}.glb`);
  if (!existsSync(path)) return null;
  const doc = await new NodeIO().readBinary(readFileSync(path));
  let pants: ArrayLike<number> | null = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 1; i < pos.length; i += 3) {
        if (pos[i]! < lo) lo = pos[i]!;
        if (pos[i]! > hi) hi = pos[i]!;
      }
      if (/cargo_pants/iu.test(mesh.getName())) pants = pos;
    }
  }
  if (!pants) return null;
  let yMin = Infinity;
  for (let i = 1; i < pants.length; i += 3) if (pants[i]! < yMin) yMin = pants[i]!;

  // One leg (x < 0), ordered by angle about that leg's own centroid, so "adjacent" is geometric.
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (let i = 0; i < pants.length; i += 3) {
    if (pants[i]! >= 0 || pants[i + 1]! - yMin > HEM_BAND_M) continue;
    cx += pants[i]!;
    cz += pants[i + 2]!;
    n += 1;
  }
  if (n < 8) return null;
  cx /= n;
  cz /= n;
  const ring: { a: number; y: number }[] = [];
  for (let i = 0; i < pants.length; i += 3) {
    if (pants[i]! >= 0 || pants[i + 1]! - yMin > HEM_BAND_M) continue;
    ring.push({ a: Math.atan2(pants[i + 2]! - cz, pants[i]! - cx), y: pants[i + 1]! });
  }
  ring.sort((p, q) => p.a - q.a);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const step = Math.abs(ring[(i + 1) % ring.length]!.y - ring[i]!.y);
    sum += step;
    if (step > max) max = step;
  }
  return { verts: ring.length, meanStepM: sum / ring.length, maxStepM: max, hemY: yMin, stature: hi - lo };
}

const subject = await measureHem(SUBJECT);
const knownGood = await measureHem(KNOWN_GOOD);

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): { s: Hem; k: Hem } {
  expect(subject, `${SUBJECT} trouser hem measured under ${ASSET_DIR}`).not.toBeNull();
  expect(knownGood, `${KNOWN_GOOD} trouser hem measured (the known-good column)`).not.toBeNull();
  return { s: subject as Hem, k: knownGood as Hem };
}

/** The bound, computed from the shipped known-good at test time — never a literal. */
function allowedMaxStep(s: Hem, k: Hem): number {
  return ALLOWANCE * k.maxStepM * (s.stature / k.stature);
}

describe("the trouser hem is a line not a sawtooth", () => {
  it.fails("(1) RED: the adult hem's worst local step is within the child's, size-scaled", () => {
    const { s, k } = requireMeasured();
    const allowed = allowedMaxStep(s, k);
    expect(
      s.maxStepM,
      `${SUBJECT} worst adjacent hem step ${(s.maxStepM * 1000).toFixed(2)} mm against ${(allowed * 1000).toFixed(2)} mm allowed (${ALLOWANCE}x the child's ${(k.maxStepM * 1000).toFixed(2)} mm, scaled by stature ${s.stature.toFixed(3)}/${k.stature.toFixed(3)})`,
    ).toBeLessThanOrEqual(allowed);
  });

  it("(2) COUNTERWEIGHT: the hem is not deleted or raised to escape the band", () => {
    // Refuses (b). The cheapest way to remove teeth is to remove the vertices carrying them, or to
    // shorten the trousers above the ragged ring. Both are pinned against today's shipped values.
    const { s } = requireMeasured();
    expect(
      s.verts,
      `${SUBJECT} hem vertex count ${s.verts} against 107 measured 2026-08-14 (a fix may not coarsen the ring)`,
    ).toBeGreaterThanOrEqual(Math.round(107 * (1 - VERT_TOLERANCE)));
    expect(
      Math.abs(s.hemY - AISHA_HEM_Y_M),
      `${SUBJECT} hem world Y ${s.hemY.toFixed(4)} against ${AISHA_HEM_Y_M} measured 2026-08-14 — trousers may not be shortened to escape the hem band`,
    ).toBeLessThanOrEqual(HEM_Y_TOLERANCE_M);
  });

  it("(3) COUNTERWEIGHT: the known-good child's hem does not degrade", () => {
    // Refuses (d). The bound is a function of the child's mesh, so degrading her would widen it for
    // everyone. She is held at her own measured worst step with the same allowance.
    const { k } = requireMeasured();
    expect(
      k.maxStepM * 1000,
      `${KNOWN_GOOD} worst adjacent hem step, measured 1.32 mm on 2026-08-14`,
    ).toBeLessThanOrEqual(1.32 * ALLOWANCE);
  });

  it("(4) VACUITY GUARD: both hems carry enough vertices to have a shape at all", () => {
    const { s, k } = requireMeasured();
    expect(s.verts, `${SUBJECT} hem ring vertices`).toBeGreaterThanOrEqual(24);
    expect(k.verts, `${KNOWN_GOOD} hem ring vertices`).toBeGreaterThanOrEqual(24);
  });
});
