/**
 * Teeth-only lip-couple seat: FF/PP @ gain 1, open vowels @ 0.8.
 *
 * Narrow deterministic follow-up to seat-teeth-on-lip-rim.ts (which pins
 * restDropMm 4.215 / downGain 1.25 and is left untouched). Applies the
 * physically-proven v-H transform to the committed parent asset:
 *
 * - fitted_teeth POSITION base: +3.12mm Y (head-up), +0.16mm Z (forward), rigid.
 * - teeth morph POSITION deltas by targetNames: FF/PP x1.0 (committed
 *   pressed-lips contact preserved), aa/E/I/O/U x0.8 (morph-driven travel
 *   9.31 -> 8.34 into the 7.0-8.6 gate; jaw-weight lever disproven, untouched).
 *
 * Why FF=1/open=0.8 is principled: the committed FF press already solves
 * bilabial closure (0.2mm render contact; FF/PP deltas are that solution -
 * scaling them broke closed-frame dyMax: t-Y2M08 max frames were FF-closed).
 * Jaw travel is morph-driven (jscale 0.7 moves travel 0.04mm), so the gain
 * belongs only on the open vowels. No gate, evaluator, track, capture,
 * weight, joint, or body change. Upper deltas are 0 in the source asset, so
 * the upper arch stays static by construction (verified 0.0 on every viseme).
 *
 * Safety: input bytes are read ONCE, hash-verified, and parsed from memory
 * (no path re-read TOCTOU); pre-existing or input-aliasing outputs are
 * refused before any work; the CLI runs only as the entry point, takes
 * exactly two positional args, and rejects every flag (there are no knobs).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

export const INPUT_SHA = "5cab66767a6bec8cb22d4d021ccccc416955f8f617fdc243d38d56e17f185dde";
export const INPUT_SHA_STAMPED_PARENT = "53d6129afc2465645090073c6e8f8fc6c5e7eb027f9550d0bdbc3ed021bee1d2";
export const INPUT_SHAS: readonly string[] = [INPUT_SHA, INPUT_SHA_STAMPED_PARENT];
export const DY_MM = 3.12;
export const DZ_MM = 0.16;
export const OPEN_GAIN = 0.8;
export const CLOSED_GAIN = 1.0;
export const OPEN_VISEMES = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U"] as const;
export const CLOSED_VISEMES = ["viseme_FF", "viseme_PP"] as const;

function fail(msg: string): never {
  throw new Error(`seat-teeth-ff1-open08: ${msg}`);
}

/** Pure in-document transform: rigid base shift + per-viseme morph gains. No I/O. */
export function applyTeethFf1Open08(doc: Document): Record<string, number> {
  const teeth = doc.getRoot().listMeshes().find((m) => /fitted_teeth/i.test(m.getName() ?? ""));
  if (!teeth) fail("no fitted_teeth mesh");
  const prim = teeth.listPrimitives()[0]!;
  const names = ((teeth.getExtras() as { targetNames?: string[] } | null)?.targetNames) ?? [];
  const want: Set<string> = new Set<string>([...OPEN_VISEMES, ...CLOSED_VISEMES]);
  if (names.length !== 7 || !names.every((n) => want.has(n))) {
    fail(`unexpected teeth targetNames [${names.join(",")}]`);
  }
  const pos = prim.getAttribute("POSITION")!;
  const parr: Float32Array<ArrayBuffer> = Float32Array.from(pos.getArray() as ArrayLike<number>);
  const dy = DY_MM / 1000;
  const dz = DZ_MM / 1000;
  for (let v = 0; v < parr.length / 3; v++) {
    parr[v * 3 + 1] = (parr[v * 3 + 1] as number) + dy;
    parr[v * 3 + 2] = (parr[v * 3 + 2] as number) + dz;
  }
  pos.setArray(parr);
  const perTarget: Record<string, number> = {};
  names.forEach((nm, i) => {
    const gain = (OPEN_VISEMES as readonly string[]).includes(nm) ? OPEN_GAIN : CLOSED_GAIN;
    perTarget[nm] = gain;
    if (gain === 1) return;
    const t = prim.listTargets()[i]?.getAttribute("POSITION");
    if (!t) fail(`missing POSITION target for ${nm}`);
    const a: Float32Array<ArrayBuffer> = Float32Array.from(t.getArray() as ArrayLike<number>);
    for (let k = 0; k < a.length; k++) a[k] = (a[k] as number) * gain;
    t.setArray(a);
  });
  return perTarget;
}

export async function seatTeethFf1Open08(inputPath: string, outputPath: string): Promise<Record<string, unknown>> {
  const inReal: string = realpathSync(inputPath);
  const outAbs: string = resolve(outputPath);
  let outParentReal: string;
  try {
    outParentReal = realpathSync(dirname(outAbs));
  } catch {
    fail(`output parent does not exist: ${dirname(outAbs)}`);
  }
  let outReal: string | null = null;
  try {
    outReal = realpathSync(outAbs);
  } catch {
    outReal = null;
  }
  if (outReal !== null && outReal === inReal) fail(`output aliases input, refusing: ${outputPath}`);
  if (join(outParentReal, basename(outAbs)) === inReal) fail(`output aliases input, refusing: ${outputPath}`);
  if (outReal !== null || existsSync(outAbs)) fail(`output exists, refusing to clobber: ${outputPath}`);
  const bytes = readFileSync(inReal);
  const inSha = createHash("sha256").update(bytes).digest("hex");
  if (!INPUT_SHAS.includes(inSha)) fail(`input sha ${inSha} != pinned ${INPUT_SHA} or ${INPUT_SHA_STAMPED_PARENT}`);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(bytes);
  const perTarget = applyTeethFf1Open08(doc);
  const outBytes = await io.writeBinary(doc);
  try {
    writeFileSync(outAbs, Buffer.from(outBytes), { flag: "wx" });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "EEXIST") fail(`output exists, refusing to clobber: ${outputPath}`);
    throw e;
  }
  const outSha = createHash("sha256").update(outBytes).digest("hex");
  return { inSha, outSha, dyMm: DY_MM, dzMm: DZ_MM, perTarget };
}

const isEntryPoint =
  typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  const args = process.argv.slice(2);
  const badFlag = args.find((a) => a.startsWith("--"));
  const run = async (): Promise<void> => {
    if (badFlag !== undefined) fail(`unsupported flag ${badFlag} (this producer takes exactly two paths, no flags)`);
    if (args.length !== 2) fail(`usage: seat-teeth-ff1-open08.ts <input.glb> <output.glb> (got ${args.length} args)`);
    const receipt = await seatTeethFf1Open08(args[0] as string, args[1] as string);
    console.log(JSON.stringify(receipt));
  };
  run().then(undefined, (e: unknown) => {
    console.error(String((e as Error).message ?? e));
    process.exitCode = 1;
  });
}
