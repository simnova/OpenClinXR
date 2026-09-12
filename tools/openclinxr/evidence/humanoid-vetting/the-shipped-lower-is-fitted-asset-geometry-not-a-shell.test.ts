/**
 * Family-partner lower (diagnosis): the shipped mesh named
 * `mat_makeclothes_library_cargo_pants` is a body-derived cover shell, not the
 * cargo asset's own topology.
 *
 * Diagnosis (measured 2026-09-12, live GLB bytes — no Blender opened):
 *
 * | actor | lower tris | source .obj faces | faces x 2 | match |
 * |---|---:|---:|---:|---|
 * | mpfb-street-adult-male (known-good) | 5708 | 2854 (elvs_jeans_straight_leg) | 5708 | yes — fitted |
 * | mpfb-clinical-nurse-adult (known-good) | 2704 | 1352 (Scrub_Pants) | 2704 | yes — fitted |
 * | mpfb-family-partner-adult | 2789 | 196 (cortu_cargo_pants) | 392 | no — shell |
 * | mpfb-ob-patient-aisha (bite) | 1075 | 196 (cortu_cargo_pants) | 392 | no — shell |
 *
 * A FITTED lower ships the source asset's own topology (tris == faces * 2,
 * exact). A SHELL does not: `build_cover_shell` takes the body's faces in a
 * height band and displaces them 15 mm (`CLOTH_STANDOFF_M`), then assigns the
 * library garment's material name.
 *
 * Chosen covering replacement: pants02 `elvs_jeans_bootcut`
 * (`mens_elv_jeans1f.obj`, 2854 faces, `# license CC_by`, max mhclo ref 13351).
 * Unconsumed sibling of the street actor's straight-leg jeans. Punkduck classic
 * jeans covered on the street body but read as balloon/jodhpur thighs.
 *
 * This clause FAILS on a shell (family-partner pre-fix 2789 != 5708) and PASSES
 * on a fit (tris == 2854 * 2). The same arithmetic pointed at aisha (1075 vs
 * 392) is the bite: a cover-shell actor must not satisfy faces*2.
 *
 * NOT TESTED: whether the bootcut covers without clipping; the other four
 * cover-shell actors; the gown rail; nurse/street lowers (must not change).
 *
 * ## FIXED (#0)
 *
 * Family-partner rematerialized with ClothesService.fit_clothes_to_human on
 * elvs_jeans_bootcut against the live MPFB hm08 basemesh (macros live). Report:
 * family-partner-library-lower-2026-09-12.md.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const HUMANOIDS = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
/**
 * The garment source assets live in `.openclinxr-local/provider-cache`, which is UNTRACKED —
 * neither committed nor ignored. An untracked directory does not exist in a linked worktree, so
 * resolving it from this file's own checkout made the discriminator pass in the main checkout and
 * FAIL in every worktree. It failed an unrelated card's land on 2026-09-12 for exactly that reason.
 *
 * `resolveCoordinationRoot` returns the MAIN worktree via `git rev-parse --git-common-dir`, which
 * every worktree computes identically, so the cache resolves to the one copy that exists.
 * Tracked paths (the shipped GLBs above) stay on the local root: they are present everywhere.
 */
function mainWorktreeRoot(): string {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // <main-worktree>/.git -> <main-worktree>
    return dirname(commonDir);
  } catch {
    return REPO_ROOT;
  }
}
const CACHE_ROOT = mainWorktreeRoot();
const GARMENT_SOURCES = join(CACHE_ROOT, ".openclinxr-local/provider-cache/garments/sources");
const BOOTCUT_OBJ = join(GARMENT_SOURCES, "makehuman-pants02/clothes/elvs_jeans_bootcut/mens_elv_jeans1f.obj");
const CARGO_OBJ = join(GARMENT_SOURCES, "makehuman-pants01/cortu_cargo_pants/cargo_pants.obj");
const STREET_OBJ = join(GARMENT_SOURCES, "makehuman-pants02/clothes/elvs_jeans_straight_leg/mens_elv_jeans2slf.obj");
const SCRUB_OBJ = join(GARMENT_SOURCES, "makehuman-community-scrub-pants/Scrub_Pants.obj");
const FAMILY = join(HUMANOIDS, "mpfb-family-partner-adult.glb");
const AISHA = join(HUMANOIDS, "mpfb-ob-patient-aisha.glb");
const STREET = join(HUMANOIDS, "mpfb-street-adult-male.glb");
const NURSE = join(HUMANOIDS, "mpfb-clinical-nurse-adult.glb");
const LOWER_RE = /pants|jean|trouser|cargo/i;
const FAMILY_LOWER_RE = /bootcut_jeans_pants|straight_leg_jeans_pants|cargo_pants/i;

function objFaceCount(path: string): number {
  const text = readFileSync(path, "utf8");
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("f ")) n += 1;
  }
  return n;
}

async function lowerTriangleCount(glbPath: string, match: RegExp): Promise<number> {
  const doc = await new NodeIO().read(glbPath);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!match.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) tris += idx.getCount() / 3;
    }
  }
  return Math.round(tris);
}

describe("the shipped lower is fitted asset geometry, not a shell", () => {
  it("source .obj files are present so the discriminator can run", () => {
    expect(existsSync(BOOTCUT_OBJ), BOOTCUT_OBJ).toBe(true);
    expect(existsSync(CARGO_OBJ), CARGO_OBJ).toBe(true);
    expect(existsSync(FAMILY), FAMILY).toBe(true);
    expect(existsSync(AISHA), AISHA).toBe(true);
  });

  it("COUNTERWEIGHT: nurse scrub pants stay 1352 faces x 2 = 2704 tris", async () => {
    if (!existsSync(SCRUB_OBJ) || !existsSync(NURSE)) return;
    const faces = objFaceCount(SCRUB_OBJ);
    const tris = await lowerTriangleCount(NURSE, /scrub_pants/i);
    expect(faces, "Scrub_Pants.obj face count").toBe(1352);
    expect(tris, "nurse lower must remain the fitted scrub asset").toBe(faces * 2);
  });

  it("COUNTERWEIGHT: street straight-leg jeans stay 2854 faces x 2 = 5708 tris", async () => {
    if (!existsSync(STREET_OBJ) || !existsSync(STREET)) return;
    const faces = objFaceCount(STREET_OBJ);
    const tris = await lowerTriangleCount(STREET, /straight_leg_jeans_pants/i);
    expect(faces, "elvs_jeans_straight_leg face count").toBe(2854);
    expect(tris, "street lower must remain the fitted straight-leg asset").toBe(faces * 2);
  });

  it("family-partner lower tris equal the chosen bootcut .obj faces x 2", async () => {
    const faces = objFaceCount(BOOTCUT_OBJ);
    const tris = await lowerTriangleCount(FAMILY, FAMILY_LOWER_RE);
    expect(faces, "elvs_jeans_bootcut mens_elv_jeans1f.obj face count").toBe(2854);
    expect(tris, "family-partner lower is a shell if tris !== faces*2").toBe(faces * 2);
  });

  it("the same arithmetic FAILS on a cover-shell actor (aisha cargo)", async () => {
    const faces = objFaceCount(CARGO_OBJ);
    const tris = await lowerTriangleCount(AISHA, LOWER_RE);
    expect(faces, "cortu cargo_pants.obj face count").toBe(196);
    expect(tris, "aisha lower must exist").toBeGreaterThan(0);
    expect(tris, "bite: aisha 1075-tri shell is not cargo faces*2").not.toBe(faces * 2);
  });
});
