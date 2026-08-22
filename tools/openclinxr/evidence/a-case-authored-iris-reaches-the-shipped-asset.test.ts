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

  it.fails("(2) RED: the parent's iris differs from the child's, because the cast says green", () => {
    expect(
      irisOf(PARENT)!.sha,
      "the wired eye_iris_colour maps parent/family to green; the shipped GLB carries the brown bytes",
    ).not.toBe(irisOf(CHILD)!.sha);
  });

  it.fails("(3) RED: the nurse's iris differs from the child's, because the cast says blue", () => {
    expect(
      irisOf(NURSE)!.sha,
      "the wired eye_iris_colour maps nurse to blue; the shipped GLB carries the brown bytes",
    ).not.toBe(irisOf(CHILD)!.sha);
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
