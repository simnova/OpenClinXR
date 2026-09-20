import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * clothing_consume must call the garment-provenance-stamp station after a
 * successful bake so extras are not discarded. Tests call plan(), not run(),
 * so this is a source assertion (same shape as materializer-runs-teeth-rest-clearance).
 *
 * claimScope: runClothingConsume source invokes the stamp on outGlb.
 * notEvidenceFor: blender fit quality; gown-class swap.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const RUN = join(SRC, "run.ts");

describe("the clothing_consume station stamps garment provenance", () => {
  it("(1) runClothingConsume calls garment-provenance-stamp.ts on outGlb after blender exit 0", () => {
    const src = readFileSync(RUN, "utf8");
    expect(src).toContain("garment-provenance-stamp.ts");
    expect(src).toContain("stampGarmentProvenance(options.outGlb");
    expect(src).toMatch(/if \(result\.code === 0\)/);
  });
});
