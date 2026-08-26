/**
 * #588 — write baseColorFactor entries into a shipped GLB's JSON chunk, verbatim elsewhere.
 *
 * Node-side mirror of the proven Blender-side `patch_glb_base_color_factors`
 * (`materialize_mpfb_humanoid_candidate.py:1000`, used by #506 and #508): the GLB's JSON
 * chunk is re-serialized and the GLB re-assembled; geometry and BIN bytes are copied verbatim.
 * Material names are matched with a trailing `.NNN` variant suffix stripped (the exporter
 * appends `.001` to the second use of a material name).
 *
 * claimScope: baseColorFactor of named materials in a GLB, nothing else changes.
 */

import { readFile, writeFile } from "node:fs/promises";

export type FactorPatch = Record<string, [number, number, number, number]>;

function materialBaseName(name: string): string {
  return name.replace(/\.\d{3}$/u, "");
}

export async function patchGlbBaseColorFactors(path: string, factors: FactorPatch): Promise<string[]> {
  const data = Buffer.from(await readFile(path));
  if (data.subarray(0, 4).toString("latin1") !== "glTF") {
    throw new Error(`patchGlbBaseColorFactors: not a GLB: ${path}`);
  }
  const jsonLen = data.readUInt32LE(12);
  const jsonEnd = 20 + jsonLen;
  const gltf = JSON.parse(data.subarray(20, jsonEnd).toString("utf8")) as {
    materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: unknown } }>;
  };
  const patched: string[] = [];
  for (const mat of gltf.materials ?? []) {
    const base = materialBaseName(mat.name ?? "");
    if (!(base in factors)) continue;
    mat.pbrMetallicRoughness = mat.pbrMetallicRoughness ?? {};
    mat.pbrMetallicRoughness.baseColorFactor = [...factors[base]!];
    patched.push(mat.name ?? base);
  }
  if (patched.length === 0) {
    throw new Error(`patchGlbBaseColorFactors: no material matched ${Object.keys(factors)} in ${path}`);
  }
  let newJson = JSON.stringify(gltf, null, 0);
  newJson += " ".repeat((4 - (newJson.length % 4)) % 4);
  const binChunk = data.subarray(jsonEnd);
  const out = Buffer.alloc(12 + 8 + Buffer.byteLength(newJson) + binChunk.length);
  out.write("glTF", 0, "latin1");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(12 + 8 + Buffer.byteLength(newJson) + binChunk.length, 8);
  out.writeUInt32LE(Buffer.byteLength(newJson), 12);
  out.write("JSON", 16, "latin1");
  out.write(newJson, 20, "utf8");
  binChunk.copy(out, 20 + Buffer.byteLength(newJson));
  await writeFile(path, out);
  return patched;
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("patch-glb-base-color-factors.ts")
    || process.argv[1].endsWith("patch-glb-base-color-factors.js"));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const glbIdx = args.indexOf("--glb");
  const matIdx = args.indexOf("--material");
  if (glbIdx < 0 || matIdx < 0 || args.length < matIdx + 5) {
    console.error("usage: tsx patch-glb-base-color-factors.ts --glb <path> --material <name> <r> <g> <b> [a]");
    process.exitCode = 1;
  } else {
    const glb = args[glbIdx + 1]!;
    const name = args[matIdx + 1]!;
    const r = Number(args[matIdx + 2]!);
    const g = Number(args[matIdx + 3]!);
    const b = Number(args[matIdx + 4]!);
    const a = Number(args[matIdx + 5] ?? 1);
    patchGlbBaseColorFactors(glb, { [name]: [r, g, b, a] })
      .then((patched) => process.stdout.write(`GLB_FACTOR_PATCH ${glb} materials ${patched.join(",")}\n`))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
      });
  }
}
