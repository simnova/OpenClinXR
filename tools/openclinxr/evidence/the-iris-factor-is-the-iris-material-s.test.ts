import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the eye-colour contract reads the IRIS material's factor, not an eyelash's.
 *
 * `eye-colour-is-case-driven.test.ts:200-217` matches `/eye/i` against `${mesh}/${material}` and
 * NEVER BREAKS, so a later match overwrites `factor`. "eyebrow" and "eyelash" both contain "eye".
 *
 * MEASURED on `mpfb-peds-nurse-kevin.glb`, in document order:
 *
 *   makeclothes_library_eyes_low_poly_...   tex=yes  factor=None -> glTF default (1,1,1,1)   <- IRIS
 *   openclinxr_fitted_eyebrow_...           tex=no   factor=(0.05, 0.03, 0.02)
 *   openclinxr_hm08_eyelash_...             tex=no   factor=(0.02, 0.02, 0.02)               <- wins
 *
 * The clause then pairs a real 597 KB iris texture with a hair-dark eyelash factor and reports the eye
 * as flat. It has been RED on main while four slices landed around it — the #182 class, where a false
 * red is attributed to whatever lands next.
 *
 * Verified independently before planting: the iris material carries `baseColorFactor: None` on
 * mpfb-peds-patient-child, mpfb-peds-parent-aisha, mpfb-peds-nurse-kevin and mpfb-ob-patient-aisha.
 * There is no product defect. Also note `getBaseColorFactor()` returns `[1,1,1,1]` rather than null
 * when unset, so the `if (c)` guard never skips and the overwrite is unconditional.
 *
 * WHY THE FIXTURE EXISTS, and it is the whole point of clause (2). All 11 shipped assets list
 * IRIS -> brow -> lash, so `break`-on-first-match would pass on every one of them today. A contract
 * without a reordered case cannot refuse that fix, and shipping it would be decoration. The fixture
 * lists the eyelash FIRST; `break` returns its 0.02 factor there and fails, while a texture-based
 * discriminator returns the iris. Document order is not a guarantee — "the eye material carrying a
 * texture" is.
 *
 * claimScope: which material's baseColorFactor the eye-colour row builder attributes to the iris.
 * notEvidenceFor: whether any iris looks correct, the case-driven colour logic (that is #519/#520),
 *   or the shipped assets, which measure clean.
 */

const EVIDENCE = join(process.cwd(), "tools/openclinxr/evidence");
const SHIPPED = join(process.cwd(), "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const REORDERED = join(EVIDENCE, "fixtures/eye-material-order/eyelash-before-iris.gltf");
const NEUTRAL = 0.02; // any deviation this large is a hair colour, not an unset factor

type Row = { irisSha: string | null; irisKb: number; factor: [number, number, number] };

async function readRow(path: string): Promise<Row> {
  const mod = await import("./eye-colour-is-case-driven.js") as Record<string, unknown>;
  const fn = mod["readEyeRow"];
  if (typeof fn !== "function") {
    throw new Error(
      "eye-colour-is-case-driven.ts does not export readEyeRow(path). The row builder is inline in "
      + "the test file, so which material it attributes the factor to cannot be measured directly.",
    );
  }
  return (fn as (p: string) => Promise<Row> | Row)(path) as Promise<Row>;
}

describe("the iris factor is the iris material's", () => {
  it("(0) HARNESS COLUMN: the reordered fixture really does list the eyelash first", async () => {
    // Passes today, and guards the fixture itself. If a later edit reorders it, clause (2) silently
    // stops refusing anything - which is exactly the decoration this contract exists to avoid.
    const { NodeIO } = await import("@gltf-transform/core");
    const doc = await new NodeIO().read(REORDERED);
    const order = doc.getRoot().listMeshes().flatMap((m) =>
      m.listPrimitives().map((p) => (p.getMaterial()!.getBaseColorTexture() ? "IRIS" : "lash")));
    expect(order, "fixture must list the untextured eyelash before the textured iris").toEqual(["lash", "IRIS"]);
  });

  it("(1) GUARD (flipped from RED #569): a shipped asset's iris factor is neutral, not the eyelash's hair colour", async () => {
    const row = await readRow(SHIPPED);
    const worst = Math.max(...row.factor.map((v) => Math.abs(v - 1)));
    expect(
      worst,
      "the iris material carries no factor override; (0.02,0.02,0.02) is the eyelash's hair colour",
    ).toBeLessThan(NEUTRAL);
  });

  it("(2) GUARD + COUNTERWEIGHT (flipped from RED #569): order does not decide — the eyelash-first fixture still yields the iris", async () => {
    // Refuses `break`-on-first-match, which passes on all 11 shipped assets and fails here.
    const row = await readRow(REORDERED);
    const worst = Math.max(...row.factor.map((v) => Math.abs(v - 1)));
    expect(worst, "taking the FIRST /eye/ match returns the eyelash's 0.02 here").toBeLessThan(NEUTRAL);
  });

  it("(3) COUNTERWEIGHT GUARD (flipped from RED #569): the iris texture is still identified, on both", async () => {
    // Refuses a fix that narrows the match so hard it stops finding the iris at all. The shipped
    // asset's iris is the 597 KB brown_eye; the fixture's is a 1x1 stub, so only presence is asserted.
    const shipped = await readRow(SHIPPED);
    expect(shipped.irisSha, "the shipped iris texture must still be read").toBeTruthy();
    expect(shipped.irisKb, "the shipped iris is the ~597 KB brown_eye").toBeGreaterThan(500);
    const fixture = await readRow(REORDERED);
    expect(fixture.irisSha, "the fixture's iris texture must still be read").toBeTruthy();
  });
});
