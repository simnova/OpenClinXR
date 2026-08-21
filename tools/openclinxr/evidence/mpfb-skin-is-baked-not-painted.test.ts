import { createHash } from "node:crypto";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { listUniqueLiveCastMpfbAssetPaths } from "./live-scenario-actor-cast.js";

/**
 * **Every MPFB actor's skin is a hand-authored flat colour, and the shipped procedural shader has
 * never reached a GLB.** #343 measured why, by actually invoking the service rather than reasoning
 * about it — headless Blender 5.1.1, MPFB 2.0.15:
 *
 *   MaterialService.create_v2_skin_material -> export_scene.gltf -> NodeIO read-back
 *     => baseColorTexture: NONE,  baseColorFactor: [1,1,1,1]
 *
 * The `enhanced_skin` node tree does not survive glTF export, and the Blender 5.1 exporter has **no
 * material-bake capability**. The shipped shader reaches a GLB only via an explicit **Cycles bake**
 * wired into a Principled `baseColor`. So this is not "call the service nobody called" (D1's usual
 * shape) — it is "call the service AND add a bake stage".
 *
 * MY PIXEL GRADE, 05:38 and 06:51, which is what makes this worth a slice rather than a nicety:
 *   - all three actors read as pale and uniform, no subsurface variation anywhere on the body;
 *   - the CHILD is the outlier — near-white, visibly paler than the two adults, with ~a dozen small
 *     dark speckles across forehead and cheeks that read as texture noise rather than freckles;
 *   - with a red-brown iris it gives the child an unsettling cast the adults do not have.
 *
 * KNOWN-GOOD COLUMN, and it is on these same bodies: the **iris** textures DO survive export. #356
 * wired per-actor CC0 iris images and I graded three distinct colours in pixels (aisha green, kevin
 * blue, child brown) at 05:38. So "a texture cannot survive this exporter" is already false on this
 * asset — the eyes prove the path works. That is why clause (3) pins them: a skin bake must not break
 * the one textured material that already ships.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) skin textured | (2) per-actor distinct | (3) iris intact | result
 *   -------------------------------------------------|-------------------|------------------------|-----------------|--------
 *   a) today — flat baseColorFactor, no texture       |    **FAIL**       |          n/a           |      pass       | REFUSED
 *   b) bake ONE skin texture, reuse on all three      |      pass         |       **FAIL**         |      pass       | REFUSED
 *   c) hand-author a flat 1x1 / solid PNG per actor   |      pass         |       **FAIL**         |      pass       | REFUSED
 *   d) Cycles-bake the shipped node tree per actor    |      pass         |         pass           |      pass       | ALL PASS
 *
 * (b) is the one to watch. "Give the skin a texture" is satisfied by baking once and reusing, which
 * leaves three actors sharing one skin — the exact defect #343 is named for, wearing a texture. (c) is
 * the D1 violation: a solid PNG per actor is hand-authoring with extra steps, and it dies on the same
 * clause because a solid colour hashes identically wherever the authored tone is the same, and where
 * it does not, the byte size floor catches a 1x1.
 *
 * ## PREMISE WITHDRAWN 2026-08-13 06:58 — planted as a RED, measured false before dispatch.
 *
 * I wrote clause (1) as an `it.fails` RED on #343's headline. Running it FAILED as an `it.fails`,
 * i.e. its body passed, and the measurement says why:
 *
 *   mpfb_skin_peds_nurse_kevin     659,041 B  sha 7d7baa4ea728
 *   mpfb_skin_peds_patient_child   621,147 B  sha b97f146966f6
 *
 * **The skin is already baked, per-actor, and the textures are distinct.** #343 measured the SERVICE
 * path in a fresh scene (create_human -> MaterialService -> export = NONE) and generalised it to the
 * shipped assets; the pipeline evidently bakes skin by another route (the `.skin-baked.png` sidecars).
 * Both measurements are correct about different things.
 *
 * So the defect is NOT absence, it is QUALITY: a 620 KB per-actor texture that still reads as a flat
 * pale paint chip, with the child near-white. That is the factory's characteristic defect —
 * **the component is wired and produces output that does not work** — and it is a sharper target than
 * 'never called'. Clause (1) is now a plain `it` regression net, not a RED.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): there is no RED here any more. (2) is unreachable
 * until (1) passes and is the anti-sharing counterweight. (3) passes today and is a regression net on
 * #356's landed work.
 *
 * NOT TESTED:
 *   - **Whether a baked skin LOOKS better.** This asserts provenance and distinctness, never
 *     appearance. #343's own measurement establishes feasibility, not quality; only a pixel grade can
 *     say whether the child stops being the pale outlier, and that grade is mine to do after it lands.
 *   - **That the texture came from `enhanced_skin` specifically.** Distinct non-trivial textures could
 *     in principle come from another procedural source. Naming the node tree in the bake stage is the
 *     implementer's job to record in provenance; this contract cannot see it.
 *   - **Nothing about clinical skin-tone appropriateness**, which is not an implementer decision
 *     (§8d/§8y) and is not a contract question.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** A solid or 1x1 bake is not a procedural skin. Iris textures on these bodies are ~4-40 KB. */
const MIN_SKIN_TEXTURE_BYTES = 2048;

const io = new NodeIO();
const isSkinMaterial = (n: string): boolean => /skin|body|human/i.test(n) && !/iris|eye|cornea|sclera/i.test(n);
const isIrisMaterial = (n: string): boolean => /iris|eye/i.test(n);

type Row = {
  file: string;
  skinMaterials: string[];
  skinTextureSha: string | null;
  skinTextureBytes: number;
  irisTextureCount: number;
};

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const mats = doc.getRoot().listMaterials();
  if (mats.length === 0) return null;
  const skin = mats.filter((m) => isSkinMaterial(m.getName()));
  let sha: string | null = null;
  let bytes = 0;
  for (const m of skin) {
    const tex = m.getBaseColorTexture();
    const img = tex?.getImage();
    if (img && img.byteLength > bytes) {
      bytes = img.byteLength;
      sha = createHash("sha256").update(img).digest("hex").slice(0, 16);
    }
  }
  const iris = mats.filter((m) => isIrisMaterial(m.getName()) && m.getBaseColorTexture()?.getImage());
  return {
    file: rel.split("/").pop()!,
    skinMaterials: skin.map((m) => m.getName()),
    skinTextureSha: sha,
    skinTextureBytes: bytes,
    irisTextureCount: iris.length,
  };
}

/** Live cast MPFB paths — never a directory scan of harness subjects (#528). */
const files = listUniqueLiveCastMpfbAssetPaths();

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). This is a plain `it` sibling on purpose:
 * an `it.fails` clause cannot guard its own vacuity, because it is satisfied when its body throws for
 * ANY reason — including this guard throwing. That trap cost me a wrong-reason green on the #361 plant.
 */
function requireRows(): void {
  expect(rows.length, `MPFB bodies measured (live cast ${files.length})`).toBeGreaterThanOrEqual(3);
}

describe("MPFB skin is baked from the shipped shader, not painted", () => {
  it("(1) NET: every MPFB actor's skin material carries a baked baseColor texture", () => {
    requireRows();
    const painted = rows
      .filter((r) => r.skinTextureSha === null || r.skinTextureBytes < MIN_SKIN_TEXTURE_BYTES)
      .map((r) => `${r.file}: skin=[${r.skinMaterials.join(",")}] texture=${r.skinTextureSha ?? "NONE"} bytes=${r.skinTextureBytes}`);
    expect(painted, "actors whose skin is a flat colour rather than a baked texture").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: no two actors share one skin texture", () => {
    // Refuses baking once and reusing — three actors sharing one skin IS the defect, texture or not.
    // Also refuses a hand-authored solid PNG, which hashes identically wherever the tone matches.
    requireRows();
    const withTex = rows.filter((r) => r.skinTextureSha !== null);
    const shas = withTex.map((r) => r.skinTextureSha!);
    const dupes = shas.filter((s, i) => shas.indexOf(s) !== i);
    expect(
      dupes,
      `skin textures reused across actors (${new Set(shas).size} distinct across ${withTex.length} textured)`,
    ).toEqual([]);
  });

  it("(3) NET known-good: #356's per-actor iris textures still survive export", () => {
    requireRows();
    const broken = rows.filter((r) => r.irisTextureCount === 0).map((r) => `${r.file}: no iris texture`);
    expect(broken, "iris textures lost — #356 regressed by the skin bake").toEqual([]);
  });
});
