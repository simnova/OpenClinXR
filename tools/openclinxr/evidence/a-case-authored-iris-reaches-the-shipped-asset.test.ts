import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: an actor whose case authors an iris colour ships with that iris.
 *
 * The mechanism is WIRED. `materialize_mpfb_humanoid_candidate.py:3145` imports
 * `eye_iris_colour(actor_role, phenotype)` and consumes the returned colour's own `.mhmat` through
 * the generic `make_material_from_mhmat` path. The licence ledger records the cast it implements
 * (#356): child/patient -> brown, parent/family -> GREEN, nurse -> BLUE. Nine CC0 iris materials are
 * staged and licence-cleared (`third-party-asset-licence-ledger.md`, verified in the asset headers,
 * no attribution obligation).
 *
 * ## PREMISE WITHDRAWN 2026-08-22 — the RED clauses asserted the opposite of the case data.
 *
 * I wrote clauses (2) and (3) from the licence ledger's #356 row ("parent/family -> green,
 * nurse -> blue"). That row records what #356 IMPLEMENTED IN 2026-08-13; it is not a live spec.
 * #518 (ac1a215e) made the manifest `eye_color` the override and demoted the role cast to a
 * fallback, #519 documented "parent and nurse keep case-driven brown_eye", and #520 (a2e92481)
 * re-keyed an iris clause "to case-driven eye_color, not cast uniformity" - the exact error I then
 * made. Verified in the source: pediatric-asthma.ts:169 authors eye_color "brown" for the parent
 * and :216 authors "brown" for the nurse.
 *
 * So all-brown IS the wired selector's correct output for these two, and no correct implementation
 * could have satisfied the REDs. They are rewritten below as INVERTED GUARDS asserting the true
 * behaviour, not deleted - a superseded contract becomes a guard.
 *
 * MEASURED on the shipped GLBs' embedded image buffers, 2026-08-22:
 *
 *   ALL 11 shipped mpfb-*.glb embed one byte-identical iris:
 *     name "brown_eye", 610,817 bytes, sha256 4659691c7295...
 *
 * The parent ships brown where the cast says green; the nurse ships brown where it says blue. This is
 * the "wired but produces nothing usable" shape D9 names as the factory's characteristic defect - the
 * component is consumed, and the artifact does not carry its output.
 *
 * WHAT THIS DOES NOT CLAIM. The nine colours differ in the pack (luminance sd 33.7-40.0 recorded in
 * the ledger), so a green iris is buildable. Whether the shipped GLBs simply predate a rebake, or the
 * bake runs and the colour never reaches the export, is NOT DETERMINED - both produce these bytes and
 * I have not run a bake. The implementer traces it; do not take either as given.
 *
 * claimScope: which iris texture bytes each shipped MPFB GLB embeds, against the cast the wired
 *   mechanism declares.
 * notEvidenceFor: how any iris looks at any framing, skin, face geometry, or the seven-patient body
 *   sharing measured on #527 - that is a separate and larger defect.
 */

const HUMANOIDS = "apps/ui-xr/public/generated-humanoids";

/** Parse a GLB's JSON + BIN chunks and return each embedded image's name and sha256. */
function embeddedImages(glb: string): { name: string; bytes: number; sha: string }[] {
  const b = readFileSync(join(HUMANOIDS, glb));
  let off = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Buffer | null = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4e4f534a) json = JSON.parse(b.subarray(off, off + len).toString()) as Record<string, unknown>;
    else if (type === 0x004e4942) bin = b.subarray(off, off + len);
    off += len;
  }
  if (!json || !bin) return [];
  const views = (json["bufferViews"] ?? []) as { byteOffset?: number; byteLength: number }[];
  const images = (json["images"] ?? []) as { name?: string; bufferView?: number }[];
  const out: { name: string; bytes: number; sha: string }[] = [];
  for (const im of images) {
    if (im.bufferView === undefined) continue;
    const v = views[im.bufferView]!;
    const data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    out.push({ name: im.name ?? "?", bytes: data.length, sha: createHash("sha256").update(data).digest("hex").slice(0, 12) });
  }
  return out;
}

const irisOf = (glb: string) => embeddedImages(glb).find((i) => /eye/i.test(i.name));

/** Cast per the wired mechanism, as recorded in the licence ledger for #356. */
const PARENT = "mpfb-peds-parent-aisha.glb";   // cast says green
const NURSE = "mpfb-peds-nurse-kevin.glb";     // cast says blue
const CHILD = "mpfb-peds-patient-child.glb";   // cast says brown — the known-good

describe("a case-authored iris reaches the shipped asset", () => {
  it("(0) HARNESS COLUMN: every shipped MPFB asset embeds exactly one iris texture", () => {
    // Passes today. Proves the failures below mean "the colours are identical", not "the parser is
    // broken" or "the assets moved".
    for (const glb of [PARENT, NURSE, CHILD]) {
      const iris = irisOf(glb);
      expect(iris, `${glb} embeds an iris texture`).toBeDefined();
      expect(iris!.bytes, `${glb} iris is a real image`).toBeGreaterThan(100_000);
    }
  });

  it("(1) KNOWN-GOOD COLUMN: the child patient ships the brown iris its case declares", () => {
    // brown is byte-identical to the CC0 upstream (ledger #340, sha256 4659691c7295, 610,817 B).
    // A fix that makes every actor unique must NOT disturb the one the cast already gets right.
    const iris = irisOf(CHILD)!;
    expect(iris.sha, "child/patient -> brown, and brown is the verified upstream asset").toBe("4659691c7295");
  });

  it("(2) GUARD (was a RED, premise withdrawn): the parent ships brown because tara's case authors brown", () => {
    // pediatric-asthma.ts:169 - eye_color "brown" on adult_standard_parent. #518 makes that the
    // override. A regression to #356's role cast would turn this green and fail here.
    expect(
      irisOf(PARENT)!.sha,
      "the parent's case authors brown; matching the child's brown is correct, not a collapse",
    ).toBe(irisOf(CHILD)!.sha);
  });

  it("(3) GUARD (was a RED, premise withdrawn): the nurse ships brown because kevin's case authors brown", () => {
    // pediatric-asthma.ts:216 - eye_color "brown" on adult_male_nurse.
    expect(
      irisOf(NURSE)!.sha,
      "the nurse's case authors brown; a flip to blue would be the role cast overriding the case",
    ).toBe(irisOf(CHILD)!.sha);
  });

  it("(4) COUNTERWEIGHT: the iris stays a real staged texture, not a recolour", () => {
    // Refuses the cheap fix - tinting or generating bytes to make the hashes differ. Every shipped
    // iris must remain a full-size 1024^2 RGBA texture in the range the CC0 pack actually contains
    // (610,817-701,486 bytes, per the ledger). A synthesised swatch or a baseColorFactor tint fails
    // here, and the ledger's own reason stands: the iris is chromatic, so tinting comes out muddy.
    for (const glb of [PARENT, NURSE, CHILD]) {
      const iris = irisOf(glb)!;
      expect(iris.bytes, `${glb} iris size sits in the staged pack's measured range`)
        .toBeGreaterThanOrEqual(610_817);
      expect(iris.bytes, `${glb} iris size sits in the staged pack's measured range`)
        .toBeLessThanOrEqual(701_486);
    }
  });
});
