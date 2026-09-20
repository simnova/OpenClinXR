import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The bake knows --mhclo at export time. fit_stage must write sourceMhclo extras
 * onto the garment object and enable glTF extras export so the path is not discarded.
 *
 * claimScope: fit_stage.py source.
 * notEvidenceFor: blender bake pixels; gown-class swap of the peds upper shell.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const FIT = join(SRC, "fit_stage.py");

describe("the fit stage stamps mhclo extras before export", () => {
  it("(1) garment custom props are set from args.mhclo and glTF extras are exported", () => {
    const src = readFileSync(FIT, "utf8");
    expect(src).toContain('garment["sourceMhclo"]');
    expect(src).toContain("_mhclo_licence_token");
    expect(src).toContain("_garment_class_from_name");
    expect(src).toContain("export_extras=True");
    expect(src).toContain("tshirt");
    expect(src).not.toMatch(/garment\["garmentClass"\]\s*=\s*"gown"/);
  });
});
