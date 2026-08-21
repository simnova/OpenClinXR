/**
 * #537 — copy openclinxr_room_bake_* image bytes from a bake output GLB into an
 * original room GLB without touching mesh POSITION accessors (textures only).
 *
 * Ceiling may be skipped when the bake clips or drops it out of the clause-(4)
 * band; wall/floor are always merged when present in the bake output.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/merge-room-bake-textures.ts \
 *     --base <original.glb> --bake <baked.glb> --out <out.glb> \
 *     [--skip-textures name1,name2]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing ${flag}`);
}

async function main(): Promise<void> {
  const basePath = arg("--base");
  const bakePath = arg("--bake");
  const outPath = arg("--out");
  const skipArg = arg("--skip-textures", "");
  const skip = new Set(skipArg.split(",").map((s) => s.trim()).filter(Boolean));

  const io = new NodeIO();
  const base = await io.read(basePath);
  const baked = await io.read(bakePath);

  const bakeByName = new Map<string, Uint8Array>();
  for (const t of baked.getRoot().listTextures()) {
    const n = t.getName() ?? "";
    if (!n.startsWith("openclinxr_room_bake_")) continue;
    const img = t.getImage();
    if (img) bakeByName.set(n, img);
  }

  const replaced: string[] = [];
  for (const t of base.getRoot().listTextures()) {
    const n = t.getName() ?? "";
    if (!n.startsWith("openclinxr_room_bake_")) continue;
    if (skip.has(n)) {
      process.stdout.write(`[merge-bake] skip ${n}\n`);
      continue;
    }
    const next = bakeByName.get(n);
    if (!next) {
      process.stdout.write(`[merge-bake] no bake image for ${n}\n`);
      continue;
    }
    t.setImage(next);
    replaced.push(n);
  }

  await io.write(outPath, base);
  process.stdout.write(
    `[merge-bake] wrote ${outPath} replaced=${replaced.length} [${replaced.join(", ")}]\n`,
  );
  void readFileSync(outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
