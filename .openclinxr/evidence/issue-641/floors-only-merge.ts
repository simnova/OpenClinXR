/**
 * #641 floors-only merge: restore every NON-floor texture (walls/ceiling/AO/text)
 * from the git-committed original GLB, keeping only the re-baked FLOOR
 * base-colour textures and the repaired floor UVs.
 *
 * Matching is by MATERIAL SLOT (original material of the same name -> same slot),
 * not by texture name: a room carries two DISTINCT same-named textures (the two
 * plaster materials each own their own AO/bake map), and a name-keyed merge
 * collapses them into byte-identical copies — measured: 12 identical AO pairs.
 *
 * Why restore at all: the full re-bake also re-bakes walls/ceilings, and ceilings
 * clip to 255 under the distributed rig — that breaks #537's "ceiling is not
 * blown" clause. The card is floor-scoped; walls/ceilings/AO ship byte-identical
 * to before.
 *
 * Usage: pnpm exec tsx <this> <room.glb>
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";

const FLOOR = /tile|dirt|bone|rug|floor/i;

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: floors-only-merge.ts <room.glb>");
  const io = new NodeIO();
  const original = await io.readBinary(
    execFileSync("git", ["show", `HEAD:${path}`], { maxBuffer: 64 * 1024 * 1024 }),
  );
  const fixed = await io.read(path);

  const origByMaterial = new Map<string, { base?: Uint8Array; occ?: Uint8Array }>();
  for (const m of original.getRoot().listMaterials()) {
    const slot: { base?: Uint8Array; occ?: Uint8Array } = {};
    const base = m.getBaseColorTexture();
    const occ = m.getOcclusionTexture();
    if (base) slot.base = base.getImage() ?? undefined;
    if (occ) slot.occ = occ.getImage() ?? undefined;
    origByMaterial.set(m.getName(), slot);
  }

  let restored = 0;
  let kept = 0;
  for (const m of fixed.getRoot().listMaterials()) {
    const orig = origByMaterial.get(m.getName());
    if (!orig) {
      console.warn(`[merge] no original material named ${m.getName()} in git HEAD — keeping re-baked`);
      continue;
    }
    // AO / normal / emissive slots are never floor bakes — always restore.
    const occ = m.getOcclusionTexture();
    if (occ && orig.occ) {
      occ.setImage(orig.occ);
      restored += 1;
    }
    // Base colour: keep ONLY floor-class shaders re-baked; restore everything else.
    const base = m.getBaseColorTexture();
    if (base) {
      if (FLOOR.test(m.getName())) {
        kept += 1;
      } else if (orig.base) {
        base.setImage(orig.base);
        restored += 1;
      }
    }
  }
  const bytes = await io.writeBinary(fixed);
  await writeFile(path, bytes);
  console.log(`[merge] ${path}: restored ${restored} non-floor slot texture(s), kept ${kept} floor bake(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
