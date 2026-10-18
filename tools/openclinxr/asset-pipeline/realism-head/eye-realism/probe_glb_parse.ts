/** Node-side GLB parse check (no browser): does three's GLTFLoader accept these GLBs? */
import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Material, Object3D } from "three";
// NOTE: no MeshoptDecoder: both GLBs declare extensionsUsed=null, so the
// loader needs no compressed-geometry decoder. The `self` polyfill stays:
// three's loader graph references the browser global at module scope.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const FILES = [
  "/Volumes/files/openclinxr-assets/store/lid-conform-any/body2-lidconform.glb",
  "/Volumes/files/openclinxr-assets/store/face-station-cases/body2/run3/body2-lidconform.glb",
];

function meshName(m: Object3D): string | null {
  const named = m as Object3D & { isMesh?: boolean; material?: Material | Material[] };
  if (!named.isMesh) return null;
  const mats = Array.isArray(named.material)
    ? named.material.map((x) => (x as { name?: string }).name)
    : [(named.material as { name?: string } | undefined)?.name];
  return `${named.name} | ${mats.join(",")}`;
}

async function main(): Promise<void> {
  const loader = new GLTFLoader();
  for (const f of FILES) {
    const bytes = readFileSync(f);
    console.log(`FILE ${f} bytes=${bytes.length}`);
    try {
      const gltf = await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        "",
      );
      let meshes = 0;
      const names: string[] = [];
      gltf.scene.traverse((o: Object3D) => {
        const n = meshName(o);
        if (n !== null) {
          meshes += 1;
          names.push(n);
        }
      });
      console.log(`PARSE_OK ${f} meshes=${meshes}`);
      if (process.env["EYEREAL_LIST_NAMES"] === "1") {
        for (const n of names) console.log(`MESH ${n}`);
      }
    } catch (err) {
      console.log(`PARSE_FAIL ${f}: ${(err as Error).message}`);
    }
  }
}

await main();
