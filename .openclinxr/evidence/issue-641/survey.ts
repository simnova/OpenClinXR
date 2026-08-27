/**
 * #641 pre-fix survey: per-room per-material non-black % + texture bytes + UV
 * coverage, read with the same instrument as the planted contract
 * (lib/png-region-luminance.ts). Temporary tool for the pre-fix artifact.
 */
import { NodeIO } from "@gltf-transform/core";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { regionLuminance } from "../../../tools/openclinxr/evidence/lib/png-region-luminance.js";

const REPO = resolve(import.meta.dirname, "../../..");
const BANK = resolve(REPO, "apps/ui-xr/public/xr-assets/environment");

const io = new NodeIO();

function roomAssets(dir: string, out: string[] = []): string[] {
  if (!fsExists(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) roomAssets(p, out);
    else if (/^infinigen-.*\.glb$/u.test(entry.name)) out.push(p);
  }
  return out;
}
function fsExists(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Fraction of the [0,1]^2 UV square covered by a primitive's TEXCOORD_0 bounds. */
function uvCoverage(prim: any): number {
  const attr = prim.getAttribute("TEXCOORD_0");
  if (!attr) return 0;
  const arr = attr.getArray();
  if (!arr) return 0;
  const es = attr.getElementSize();
  const norm = attr.getNormalized();
  const scale = norm && attr.getComponentType() !== 5126 ? (attr.getComponentType() === 5121 ? 255 : 65535) : 1;
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i + 1 < arr.length; i += es) {
    const u = (arr[i] as number) / scale;
    const v = (arr[i + 1] as number) / scale;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  if (!isFinite(minU)) return 0;
  const w = Math.max(0, maxU - minU);
  const h = Math.max(0, maxV - minV);
  return Math.min(1, w * h);
}

type Row = {
  room: string;
  material: string;
  pct: number;
  bytes: number;
  texWidth: number;
  texHeight: number;
  uvCoverage: number;
  shaderClass: string;
};

async function main() {
  const rows: Row[] = [];
  for (const path of roomAssets(BANK)) {
    const room = path.split("/").pop() ?? path;
    const doc = await io.read(path);
    for (const material of doc.getRoot().listMaterials()) {
      const name = material.getName();
      const texture = material.getBaseColorTexture();
      const image = texture?.getImage();
      if (!image) continue;
      if (!/openclinxr_room_bake_/u.test(texture.getName() ?? "")) continue;
      const lum = regionLuminance(image, {}, { step: 8 });
      if (!lum) continue;
      // UV coverage across every primitive that uses this material.
      let coverage = 0;
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          if (prim.getMaterial() === material) coverage = Math.max(coverage, uvCoverage(prim));
        }
      }
      const shaderClass = /tile|dirt|bone|rug|floor/i.test(name)
        ? "floor"
        : /plaster/i.test(name)
          ? "wall"
          : "other";
      rows.push({
        room,
        material: name,
        pct: lum.nonBlackPct,
        bytes: image.byteLength,
        texWidth: lum.width,
        texHeight: lum.height,
        uvCoverage: coverage,
        shaderClass,
      });
    }
  }
  process.stdout.write(JSON.stringify({ measuredAgainstCommit: gitSha(), rows }, null, 2) + "\n");
}

function gitSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
