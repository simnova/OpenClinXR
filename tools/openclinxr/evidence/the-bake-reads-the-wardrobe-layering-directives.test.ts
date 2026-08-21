/**
 * #498 — the wardrobe assets ship two layering directives and the bake reads NEITHER.
 *
 * MEASURED 2026-08-20 (orchestrator, before any product edit). IMMUTABLE — flip the
 * assertion and append a `## FIXED (#498)` block below; do not rewrite these numbers.
 *
 *   16 cached garment .mhclo, 13 unique basenames
 *   16/16 carry `z_depth`.  15 are 50; culturalibre_male_boots is 70.
 *    6/16 carry a populated `delete_verts`:
 *         male_crude_labcoatop  1548 B / 263 tokens
 *         crudelabcoatopen      1699 B / 270 tokens
 *      Scrub_Shirt, crudegown, cargo_pants carry the key EMPTY.
 *
 *   git grep z_depth      -- tools packages apps  -> 1 hit, an unrelated Anny UV script
 *   git grep delete_verts -- tools packages apps  -> 1 hit, hair-licence-classify.ts (licences only)
 *   fit-cli.ts:189 readMhcloLicense reads the first 1600 bytes for a LICENCE only.
 *   fit_stage.py has no layering code; every `layer` hit is Blender's `view_layer`.
 *
 * WHY IT MATTERS, and the two halves must not be conflated:
 *   z_depth      is MakeHuman's layer-ORDER key. labcoat and Scrub_Shirt both declare 50,
 *                the same layer, so nothing orders or offsets one outside the other. This is
 *                the directive that bears on the physician's coat being punched through.
 *   delete_verts removes BASEMESH vertices under a garment. It fixes the BODY-through-garment
 *                class (#485 cargo-pants patches, #295 mittens) and does NOT by itself fix a
 *                shirt showing through a coat.
 *
 * CAUSE NOT DETERMINED beyond "unread". z_depth parity is a candidate, not a finding. The
 * #485 signed-distance instrument is VOID here: its known-good column returned 99.93% poke /
 * 426.5 mm for scrub_shirt over body, because it orients by fix_normals + signed volume and
 * only holds on a closed tube. A shirt is an open shell. Do not reuse it; do not build a
 * seventh coverage gate (§6t) — wire the directives the assets already carry (D1).
 *
 * claimScope: whether the pipeline can READ z_depth and delete_verts out of a cached .mhclo.
 * notEvidenceFor: that any garment renders correctly, that poke-through is fixed, or that
 *                 layering is APPLIED in the bake. Reading is the first step, not the outcome.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CACHE = ".openclinxr-local/provider-cache/garments";

function cachedMhclo(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".mhclo")) out.push(p);
    }
  };
  walk(CACHE);
  return out.sort();
}

/** Ground truth straight off disk — deliberately NOT the reader under test. */
function rawZDepth(p: string): number | null {
  const m = readFileSync(p, "utf8").match(/^z_depth\s+(\d+)/im);
  return m ? Number(m[1]) : null;
}

const FILES = cachedMhclo();

describe("#498 the bake can read the wardrobe layering directives", () => {
  it("the cache is populated, so the contract below is not vacuous", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10);
    // Both controls must be present or clause (1) proves nothing.
    expect(FILES.some((f) => f.endsWith("culturalibre_male_boots.mhclo"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("male_crude_labcoatop.mhclo"))).toBe(true);
  });

  it.fails(
    "(1) a reader returns z_depth and delete_verts, and DISCRIMINATES — boots 70, labcoat populated, Scrub_Shirt empty",
    async () => {
      const mod = (await import(
        "../asset-pipeline/makeclothes/fit-cli.ts"
      )) as { readMhcloLayering?: (p: string) => { zDepth: number | null; deleteVerts: number[] } };
      expect(typeof mod.readMhcloLayering).toBe("function");
      const read = mod.readMhcloLayering!;

      const pick = (n: string) => FILES.find((f) => f.endsWith(n))!;

      // KNOWN-GOOD COLUMN: the only non-50 in the whole cache. A stub that returns a
      // constant 50 — the cheapest way to green the other rows — dies here.
      expect(read(pick("culturalibre_male_boots.mhclo")).zDepth).toBe(70);

      // A populated delete_verts and an EMPTY one, so a stub returning a fixed
      // non-empty array cannot pass either.
      expect(read(pick("male_crude_labcoatop.mhclo")).zDepth).toBe(50);
      expect(read(pick("male_crude_labcoatop.mhclo")).deleteVerts.length).toBeGreaterThan(0);
      expect(read(pick("Scrub_Shirt.mhclo")).deleteVerts.length).toBe(0);
    },
  );

  it.fails(
    "(2) COUNTERWEIGHT: every cached file, enumerated dynamically, matches ground truth read off disk — a hardcoded table cannot satisfy this",
    async () => {
      const mod = (await import(
        "../asset-pipeline/makeclothes/fit-cli.ts"
      )) as { readMhcloLayering?: (p: string) => { zDepth: number | null; deleteVerts: number[] } };
      const read = mod.readMhcloLayering!;
      for (const f of FILES) {
        expect(read(f).zDepth, `z_depth mismatch for ${f}`).toBe(rawZDepth(f));
      }
    },
  );

  it.fails(
    "(3) the reader reports a SPREAD, not a constant — at least two distinct z_depth values across the cache",
    async () => {
      const mod = (await import(
        "../asset-pipeline/makeclothes/fit-cli.ts"
      )) as { readMhcloLayering?: (p: string) => { zDepth: number | null; deleteVerts: number[] } };
      const read = mod.readMhcloLayering!;
      const distinct = new Set(FILES.map((f) => read(f).zDepth));
      expect(distinct.size).toBeGreaterThanOrEqual(2);
    },
  );
});
