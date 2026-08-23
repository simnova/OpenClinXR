import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: no shipped clinician wears a party shoe that needs a bespoke patch script.**
 *
 * ## MEASURED ON HEAD f697dc28, 2026-08-23 — do not re-derive, do not rewrite these numbers
 *
 * `SHOE_BY_REFERENCE` (`materialize_mpfb_humanoid_candidate.py:29-41`) sends `toigo_flats` — a
 * LEOPARD-PRINT PARTY FLAT, `diffuseTexture Shoe.png` per `flats.mhmat:12` — to the default branch,
 * to `ed_chest_pain_nurse_adult` (nurse + physician + RT + MA) and to `ob_patient_aisha`
 * (OB patient + peds parent). Read off the shipped GLBs with NodeIO:
 *
 *     GLB                                total    flats mesh   share
 *     mpfb-clinical-nurse-adult.glb     132,450      57,600     43.5%
 *     mpfb-clinical-physician-adult.glb 135,082      57,600     42.6%
 *     mpfb-gown-adult-patient.glb       134,375      57,600     42.9%
 *     mpfb-ob-patient-aisha.glb         131,238      57,600     43.9%
 *     mpfb-peds-parent-aisha.glb        131,328      57,600     43.9%
 *
 * **THIS IS NOT A TRIANGLE-BUDGET CLAIM.** #475 is open on that number and the standing directive
 * is that no output is gated on triangle count. The triangles are printed as identity, not as a
 * bound, and nothing below asserts on them.
 *
 * ## THE COST IS REPEATED SLICE BURN, AND IT IS COUNTABLE
 *
 *     #502 CLOSED  "Ten nurses and a physician wear red-and-leopard party flats"
 *     #553 CLOSED  "toigo_flats is textured on one cast actor and near-black on three"
 *     #538 OPEN    "carries its 7.7MB texture on two actors and drops it on three"
 *     #554 OPEN    "the leopard Shoe.png is unbound but still shipped, 7,769,810 orphaned bytes"
 *
 * plus `tools/openclinxr/evidence/strip-clinician-footwear-pattern.py`, 68 lines whose entire
 * reason to exist is undoing this one asset per actor after every bake. Four manual exceptions are
 * not a pipeline step (the D9 defect class #404 names).
 *
 * ## THE STAND-IN IS ALREADY ON DISK AND ALREADY BAKES
 *
 *     toigo_mj_cloth_shoes.mhclo   "# license CC0"  "# author MRT"   (read 2026-08-23)
 *     mj_shoes.obj                 556 v / 502 f  ->  1,004 tris baked
 *     max basemesh interpolation ref 13,331 < 13,380  (#318 helper-strip bound)
 *     already shipping on mpfb-family-partner-adult.glb and mpfb-peds-patient-child.glb
 *
 * `flats.obj` is 28,808 v / 28,800 f in the CACHED SOURCE, so the 57x is author-side before
 * anything in this repo runs. That also answers #475's open mechanism question.
 *
 * ## WHAT MUST NOT CHANGE
 *
 * Nobody goes barefoot. Clause (4) refuses the cheap green: deleting the flats mesh satisfies
 * (1) and (2) and makes five clinicians shoeless. The swap must REPLACE, never remove.
 *
 * claimScope: whether any shipped cast GLB still carries the `toigo_flats` footwear mesh, and
 * whether the per-actor strip patch still has a subject.
 * notEvidenceFor: any triangle-budget or Quest claim; that either shoe is clinically correct
 * (that is a pixel grade nobody has taken); the licence status of anything but the two `.mhclo`
 * headers quoted above; that the swapped bake was run.
 *
 * ## FIXED (#598)
 *
 * `SHOE_BY_REFERENCE` `None` + `ed_chest_pain_nurse_adult` now map to `toigo_mj_cloth_shoes`
 * (was `toigo_flats`). Five cast GLBs rebaked; each footwear mesh is
 * `…footwear_toigo_mj_cloth_shoes…` at 1,004 tris. `strip-clinician-footwear-pattern.py` and the
 * in-script `if shoe_kind == "toigo_flats"` branch left on disk (dead — no reference maps there).
 * Inspect GLBs (`mpfb-gown-inspect` / `mpfb-viseme-inspect`) not rebaked this slice.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const HUMANOIDS = path.join(REPO, "apps/ui-xr/public/generated-humanoids");

/** Cast GLBs whose `SHOE_BY_REFERENCE` branch resolves to `toigo_flats` today. Measured, not guessed. */
const FLATS_WEARERS = [
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-clinical-physician-adult.glb",
  "mpfb-gown-adult-patient.glb",
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-parent-aisha.glb",
] as const;

/** Cast GLBs already on a plain library shoe: the known-good column, and they must stay unchanged. */
const ALREADY_PLAIN = [
  "mpfb-family-partner-adult.glb",
  "mpfb-peds-patient-child.glb",
  "mpfb-peds-nurse-kevin.glb",
  "mpfb-street-adult-male.glb",
] as const;

const FOOTWEAR_RE = /footwear|shoe|boot|slipper|sandal|sneaker/iu;

interface FootwearRow {
  readonly glb: string;
  readonly meshNames: readonly string[];
  readonly triangles: number;
}

async function footwearOf(glb: string): Promise<FootwearRow> {
  const abs = path.join(HUMANOIDS, glb);
  // A missing asset must FAIL, never silently skip. A gate that inspects nothing passes about
  // nothing (the #64 class).
  expect(existsSync(abs), `${glb} must exist to be measured`).toBe(true);
  const doc = await new NodeIO().read(abs);
  const meshes = doc
    .getRoot()
    .listMeshes()
    .filter((m) => FOOTWEAR_RE.test(m.getName()));
  let triangles = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles += idx ? idx.getCount() / 3 : (prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
  }
  return { glb, meshNames: meshes.map((m) => m.getName()), triangles };
}

describe("no clinician wears a shoe that needs a patch script", () => {
  it("(1) RED: no shipped cast GLB carries the toigo_flats footwear mesh", async () => {
    // Five clinicians and patients ship in leopard party flats today. The fix is one table edit in
    // SHOE_BY_REFERENCE plus a rebake, NOT another per-actor texture strip.
    const rows = await Promise.all(FLATS_WEARERS.map(footwearOf));
    const offenders = rows.filter((r) => r.meshNames.some((n) => /toigo_flats/iu.test(n)));
    expect(
      offenders.map((r) => r.glb),
      "these cast GLBs still wear the party flat that #502/#538/#553/#554 have each patched around",
    ).toEqual([]);
  });

  it("(2) RED: the per-actor strip patch has no subject left in any shipped GLB", async () => {
    // strip-clinician-footwear-pattern.py exists solely to undo this asset's leopard texture after
    // every bake. When no shipped GLB carries the material it names, the patch is dead and the
    // pipeline step it stood in for is gone.
    const patch = path.join(HERE, "strip-clinician-footwear-pattern.py");
    expect(existsSync(patch), "the patch script is the artifact whose subject must disappear").toBe(
      true,
    );
    const named = /mat_makeclothes_library_footwear_([A-Za-z0-9_]+)/u.exec(
      readFileSync(patch, "utf8"),
    );
    expect(named?.[1], "the patch must still name the material it strips").toBeDefined();

    const rows = await Promise.all([...FLATS_WEARERS, ...ALREADY_PLAIN].map(footwearOf));
    const stillPatched = rows.filter((r) =>
      r.meshNames.some((n) => n.includes(named?.[1] ?? " ")),
    );
    expect(
      stillPatched.map((r) => r.glb),
      `no shipped GLB may still carry ${named?.[1]}, the mesh the strip patch targets`,
    ).toEqual([]);
  });

  it("(3) KNOWN-GOOD COLUMN: the four actors already on plain library shoes are untouched", async () => {
    // Pins what must NOT change. Measured 2026-08-23: mj_cloth_shoes 1,004 tris on the partner and
    // the child; culturalibre_male_boots 30,768 on kevin and the street male. If clause (1) were
    // satisfied by breaking the footwear channel wholesale, this column goes red first.
    const rows = await Promise.all(ALREADY_PLAIN.map(footwearOf));
    for (const row of rows) {
      expect(row.meshNames.length, `${row.glb} must still carry exactly one footwear mesh`).toBe(1);
      expect(
        row.meshNames[0],
        `${row.glb} must keep its existing plain library shoe (mj_cloth_shoes or male_boots)`,
      ).toMatch(/toigo_mj_cloth_shoes|culturalibre_male_boots/u);
    }
  });

  it("(4) COUNTERWEIGHT: every former flats wearer still has footwear geometry", async () => {
    // Refuses the cheap green. Deleting the flats mesh satisfies (1) and (2) and leaves five
    // clinicians barefoot, the #6p class where removing a mechanism removes the job it was doing.
    // A REPLACEMENT keeps a footwear mesh; a REMOVAL does not.
    const rows = await Promise.all(FLATS_WEARERS.map(footwearOf));
    for (const row of rows) {
      expect(row.meshNames.length, `${row.glb} must not be left barefoot by the swap`).toBe(1);
      expect(
        row.triangles,
        `${row.glb} footwear must be real geometry, not an empty mesh`,
      ).toBeGreaterThan(0);
    }
  });
});
