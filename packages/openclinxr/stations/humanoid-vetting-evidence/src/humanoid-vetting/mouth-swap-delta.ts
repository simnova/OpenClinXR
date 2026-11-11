/**
 * Triangle delta the fitted CC0 teeth/tongue swap (tsk_27e0cec12cab410d) added to a shipped actor:
 * fitted mouth tris in the shipped GLB (meshes named teeth|tongue) minus the hm08 mouth it replaced,
 * read from the sidecar's teethSwapB1.preImageMouthTris. It includes the decimate_teeth.mts post-step
 * (teeth 7120 -> 4628). Counterweights that pin a pre-swap total add this delta, so a total the
 * sidecar cannot explain still reds. An actor with no teethSwapB1 block has delta 0.
 */
import { existsSync, readFileSync } from "node:fs";

export type MouthSwapDelta = { fittedMouthTris: number; preImageMouthTris: number; delta: number };

export function mouthSwapDelta(glbPath: string): MouthSwapDelta {
  const sidecarPath = glbPath.replace(/\.glb$/, ".provenance.json");
  const sidecar = existsSync(sidecarPath)
    ? (JSON.parse(readFileSync(sidecarPath, "utf8")) as { teethSwapB1?: { preImageMouthTris?: Record<string, number> } })
    : {};
  const pre = sidecar.teethSwapB1?.preImageMouthTris;
  if (!pre) return { fittedMouthTris: 0, preImageMouthTris: 0, delta: 0 };
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes?: { name?: string; primitives?: { indices?: number }[] }[];
    accessors?: { count?: number }[];
  };
  let fitted = 0;
  for (const mesh of json.meshes ?? []) {
    if (!/teeth|tongue/i.test(mesh.name ?? "")) continue;
    for (const prim of mesh.primitives ?? []) {
      const count = prim.indices !== undefined ? json.accessors?.[prim.indices]?.count : undefined;
      if (count !== undefined) fitted += count / 3;
    }
  }
  const preImage = Object.values(pre).reduce((sum, value) => sum + value, 0);
  return { fittedMouthTris: fitted, preImageMouthTris: preImage, delta: fitted - preImage };
}
