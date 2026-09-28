/**
 * Ward finish chain, package-internal orchestration (ward-finish-chain slice).
 *
 * Runs room_generate -> room_clinic_finish -> lighting_design in sequence on
 * ONE work GLB for `inpatient_ward_room_v1`, then reports per-stage material
 * state. The three stage runners are imported by RELATIVE PATH from their
 * sibling station folders: this module lives inside `@openclinxr/factory-stations`,
 * so those imports never cross a package boundary and are not part of the
 * package's reviewed public surface (`index.ts` stays untouched).
 *
 * Step 1 (room_generate): fixed-footprint Infinigen GENERATE with the proven
 * stage-2 pin (footprint 8.77 x 7.77 x 2.42, door wall +y offset 0.50,
 * hinge +x, style lite), plus the existing albedo+occlusion bake and
 * trim-locked simplify -- all inside runRoomGenerate.
 * Step 2 (room_clinic_finish): ward_photo preset compose IN PLACE on the
 * work GLB room_generate produced.
 * Step 3 (lighting_design): clinic_day rig computed against the footprint
 * bbox; writes the rig JSON the runtime/bake consume. Does not touch the GLB.
 *
 * After each GLB-touching stage the chain audits the material list
 * (name + baseColorTexture presence + image bytes) so the floor-white
 * diagnosis reads file state, not renders.
 */
import { copyFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { runLightingDesign } from "../lighting_design/run.js";
import { repoRoot } from "../repo-root.js";
import { runRoomClinicFinish } from "../room_clinic_finish/run.js";
import { runRoomGenerate } from "../room_generate/run.js";

export const WARD_CHAIN_ENVIRONMENT_ID = "inpatient_ward_room_v1";
export const WARD_CHAIN_DEFAULT_SEED = 205;
export const WARD_CHAIN_OUT_DIR = ".openclinxr/evidence/ward-finish-chain";
export const WARD_CHAIN_FOOTPRINT = { width: 8.77, depth: 7.77, ceilingHeight: 2.42 };
export const WARD_CHAIN_DOOR = {
  doorWall: "+y",
  wallOffsetM: 0.5,
  hingeSide: "+x",
  style: "lite",
  widthM: 0.95,
  heightM: 2.1,
};
export const WARD_CHAIN_PRESET = "ward_photo";
export const WARD_CHAIN_MOOD = "clinic_day";
// Measured 2026-09-28: a real chain albedo bake took 757 s (log timestamps
// 03:59:13 to 04:11:50), so the old 600 s per-pass budget SIGTERMed a Blender
// that had already finished its real work and the timeout race reported the
// successful bake as a generic "exit 1". The 3600 s (1 hour) default below
// keeps real margin over that measured figure; per the D9 operator directive
// execution duration is refinable and must not fail a good bake.
export const WARD_CHAIN_PASS_TIMEOUT_MS = 3_600_000;
export const WARD_CHAIN_BBOX = {
  minX: -WARD_CHAIN_FOOTPRINT.width / 2,
  maxX: WARD_CHAIN_FOOTPRINT.width / 2,
  minY: -WARD_CHAIN_FOOTPRINT.depth / 2,
  maxY: WARD_CHAIN_FOOTPRINT.depth / 2,
  minZ: 0,
  maxZ: WARD_CHAIN_FOOTPRINT.ceilingHeight,
};

const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

type MaterialAudit = {
  material: string;
  baseColorTexture: boolean;
  baseColorFactor: number[] | null;
  imageBytes: number;
  metallic: number;
  roughness: number;
};

async function auditMaterials(glbPath: string): Promise<{ meshes: string[]; materials: MaterialAudit[]; tris: number }> {
  await MeshoptDecoder.ready;
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  let tris = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  }
  return {
    meshes: root.listMeshes().map((m) => m.getName()),
    materials: root.listMaterials().map((m) => ({
      material: m.getName(),
      baseColorTexture: m.getBaseColorTexture() !== null,
      baseColorFactor: m.getBaseColorFactor() ? [...m.getBaseColorFactor()] : null,
      imageBytes: m.getBaseColorTexture()?.getImage()?.byteLength ?? 0,
      metallic: m.getMetallicFactor(),
      roughness: m.getRoughnessFactor(),
    })),
    tris,
  };
}

function assertBlenderOk(
  stage: string,
  result: Record<string, unknown>,
  opts?: { timeoutMs?: number; outDir?: string },
): void {
  // A timeout kill must report as a timeout, never a bare exit code: the
  // spawn wrapper marks its own timer kills with timedOut: true plus the
  // signal Node reported, while a real crash keeps timedOut: false.
  if (result["timedOut"] === true) {
    const timeoutMs =
      opts?.timeoutMs ??
      (typeof result["timeoutMs"] === "number" ? (result["timeoutMs"] as number) : null);
    const after =
      timeoutMs !== null && timeoutMs !== undefined ? `timed out after ${timeoutMs / 1000} s` : "timed out";
    const signal = typeof result["signal"] === "string" ? ` (signal ${result["signal"] as string})` : "";
    const stderr = typeof result["stderr"] === "string" ? (result["stderr"] as string) : "";
    const logs = opts?.outDir !== undefined ? ` (stage logs in ${opts.outDir})` : "";
    throw new Error(`${stage} ${after}${signal}:${logs}\n${stderr.slice(-2000)}`);
  }
  // Fail the chain on a non-zero exit from ANY Blender pass, not just the
  // rollup. runRoomGenerate reports per-pass exits (S1: blenderExit used to
  // carry only the occlusion code, hiding a crashed albedo pass).
  const codes: Record<string, unknown> = { blenderExit: result["blenderExit"] };
  for (const key of ["albedoExit", "occlusionExit"] as const) {
    if (key in result) codes[key] = result[key];
  }
  for (const [key, code] of Object.entries(codes)) {
    if (code !== 0 && code !== null && code !== undefined) {
      const stderr = typeof result["stderr"] === "string" ? (result["stderr"] as string) : "";
      throw new Error(`${stage} ${key} ${String(code)}:\n${stderr.slice(-2000)}`);
    }
  }
}

/**
 * The trim-locked simplify leaves the work GLB meshopt-compressed, which
 * Blender 5.1.1's glTF addon cannot import (EXT_meshopt_compression
 * unavailable). Decode + strip the extension in place so the compose and
 * rig-report Blender passes can read the file. Geometry and baked maps
 * are untouched; only the compression container is removed.
 */
async function decompressWorkGlb(glbPath: string): Promise<void> {
  await MeshoptDecoder.ready;
  const doc = await io.read(glbPath);
  doc.createExtension(EXTMeshoptCompression).dispose();
  const plain = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await plain.write(glbPath, doc);
}

export function parseWardChainArgs(args: readonly string[]): {
  seed: number;
  outDir: string;
  passTimeoutMs: number;
} {
  let seed = WARD_CHAIN_DEFAULT_SEED;
  let outDir = WARD_CHAIN_OUT_DIR;
  let passTimeoutMs = WARD_CHAIN_PASS_TIMEOUT_MS;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--seed") seed = Number(args[i + 1]);
    if (args[i] === "--out-dir") outDir = String(args[i + 1]);
    if (args[i] === "--pass-timeout-ms") passTimeoutMs = Number(args[i + 1]);
  }
  if (!Number.isFinite(seed)) throw new Error("--seed must be a finite number");
  if (!Number.isFinite(passTimeoutMs) || passTimeoutMs <= 0) {
    throw new Error("--pass-timeout-ms must be a positive number of milliseconds");
  }
  return { seed, outDir, passTimeoutMs };
}

/**
 * Resolve the chain's --out-dir against the repo root, not process.cwd().
 *
 * Third fix in the 44824ba98 -> 9962c6f52 sequence: 44824ba98 absolutized
 * room_generate's workGlb against repoRoot() (Blender spawns run with
 * cwd=repoRoot(), Node I/O resolves against process.cwd()); 9962c6f52
 * absolutized room_chain's outDir but against process.cwd(), which is the
 * PACKAGE directory under `pnpm --filter @openclinxr/factory-stations exec`
 * (the real chain CLI's own invocation shape). The two still disagreed on
 * the BASE: a relative --out-dir landed evidence under
 * packages/openclinxr/factory-stations/.openclinxr/evidence/... while
 * runRoomGenerate resolved the same relative workGlb under the repo root.
 * Resolving here against repoRoot() -- the same base runRoomGenerate uses
 * for options.cwd -- gives one base regardless of the invoker's cwd.
 * Exported so the outDir-resolution logic is unit-testable without running
 * the full GENERATE/bake/finish/lighting sequence.
 */
export function resolveChainOutDir(outDirArg: string, base: string = repoRoot()): string {
  return path.resolve(base, outDirArg);
}

export async function runWardFinishChain(args = process.argv.slice(2)): Promise<void> {
  const { seed, outDir: outDirArg, passTimeoutMs } = parseWardChainArgs(args);
  // Measured 2026-09-27 (a recurrence of the same class of bug fixed in
  // room_generate/run.ts): auditMaterials below is pure Node I/O -- it
  // resolves a relative workGlb against process.cwd(), which is the PACKAGE
  // directory under `pnpm --filter @openclinxr/factory-stations exec` (the
  // real CLI invocation shape), not repoRoot(). runRoomGenerate now
  // absolutizes its own copy of workGlb internally, so stage 1 completes,
  // but this module's OWN workGlb (used for auditMaterials both before and
  // after each stage) was still the raw relative string from --out-dir and
  // ENOENTs the same way. Absolutize outDir once, up front, against
  // repoRoot() -- the same base runRoomGenerate resolves its workGlb
  // against -- so every path derived from it (workGlb, recipeJson,
  // reports, logs) agrees on one base regardless of the caller's cwd.
  const outDir = resolveChainOutDir(outDirArg);
  const blender = process.env["BLENDER"] ?? "blender";
  await mkdir(outDir, { recursive: true });
  const workGlb = path.join(outDir, "ward-chain.work.glb");
  const recipeJson = path.join(outDir, "ward-chain.finish-recipe.json");
  const finishReport = path.join(outDir, "ward-chain.finish-report.json");
  const rigJson = path.join(outDir, "ward-chain.lighting-rig.json");
  const lightingReport = path.join(outDir, "ward-chain.lighting-report.json");
  const chainReportPath = path.join(outDir, "ward-chain-report.json");
  const stageLog = async (stage: string, result: Record<string, unknown>): Promise<void> => {
    const stdout = typeof result["stdout"] === "string" ? (result["stdout"] as string) : "";
    const stderr = typeof result["stderr"] === "string" ? (result["stderr"] as string) : "";
    await writeFile(path.join(outDir, `ward-chain.${stage}.stdout.log`), stdout, "utf8");
    await writeFile(path.join(outDir, `ward-chain.${stage}.stderr.log`), stderr, "utf8");
  };

  // Stage 1: generate + bake + simplify. GENERATE creates workGlb from
  // scratch; a stale work file from an earlier run must not survive.
  const genInput = {
    environmentId: WARD_CHAIN_ENVIRONMENT_ID,
    infinigenPrompt: "inpatient ward room",
    seed,
    layoutVariant: "default",
    footprintMeters: { ...WARD_CHAIN_FOOTPRINT },
    door: { ...WARD_CHAIN_DOOR },
  };
  process.stdout.write(`[ward-chain] stage 1 room_generate seed=${seed} ...\n`);
  const genResult = await runRoomGenerate(genInput, {
    blender,
    workGlb,
    bakeAlbedo: true,
    timeoutMs: passTimeoutMs,
    generateTimeoutMs: 3_600_000,
  }).catch(async (err: unknown) => {
    await writeFile(
      path.join(outDir, "ward-chain.generate.error.txt"),
      err instanceof Error ? (err.stack ?? err.message) : String(err),
      "utf8",
    );
    throw err;
  });
  await stageLog("generate", genResult);
  // S1: albedo stdout/stderr get their OWN log files. runRoomGenerate used
  // to overwrite stdout/stderr with the occlusion pass's output, so the
  // albedo crash left no trace in the evidence dir.
  for (const pass of ["albedo", "occlusion"] as const) {
    for (const stream of ["stdout", "stderr"] as const) {
      const field = `${pass}${stream === "stdout" ? "Stdout" : "Stderr"}`;
      const content = typeof genResult[field] === "string" ? (genResult[field] as string) : "";
      await writeFile(path.join(outDir, `ward-chain.${pass}.${stream}.log`), content, "utf8");
    }
  }
  assertBlenderOk("room_generate", genResult, { timeoutMs: passTimeoutMs, outDir });
  const afterGenerate = await auditMaterials(workGlb);
  process.stdout.write(
    `[ward-chain] stage 1 done: tris=${afterGenerate.tris} ` +
      `materials=[${afterGenerate.materials.map((m) => `${m.material}${m.baseColorTexture ? "(tex)" : "(flat)"}`).join(", ")}]\n`,
  );

  // Stage 2: finish compose in place (via the decompressed bridge).
  process.stdout.write(`[ward-chain] decompress meshopt bridge ...\n`);
  await decompressWorkGlb(workGlb);
  process.stdout.write(`[ward-chain] stage 2 room_clinic_finish preset=${WARD_CHAIN_PRESET} ...\n`);
  const finishResult = await runRoomClinicFinish(
    { environmentId: WARD_CHAIN_ENVIRONMENT_ID, preset: WARD_CHAIN_PRESET, seed },
    { blender, workGlb, recipeJsonOut: recipeJson, report: finishReport, timeoutMs: passTimeoutMs },
  );
  await stageLog("finish", finishResult);
  assertBlenderOk("room_clinic_finish", finishResult, { timeoutMs: passTimeoutMs, outDir });
  const afterFinish = await auditMaterials(workGlb);
  process.stdout.write(
    `[ward-chain] stage 2 done: tris=${afterFinish.tris} ` +
      `materials=[${afterFinish.materials.map((m) => `${m.material}${m.baseColorTexture ? `(tex:${m.imageBytes}B)` : "(flat)"}`).join(", ")}]\n`,
  );

  // Stage 3: lighting rig (JSON only; the GLB is untouched).
  const lightInput = {
    environmentId: WARD_CHAIN_ENVIRONMENT_ID,
    roomGlbPath: workGlb,
    bboxJson: JSON.stringify(WARD_CHAIN_BBOX),
    castJson: JSON.stringify([{ actorId: "patient", position: [0, 0.5, 1.0] }]),
    mood: WARD_CHAIN_MOOD,
    seed,
  };
  process.stdout.write(`[ward-chain] stage 3 lighting_design mood=${WARD_CHAIN_MOOD} ...\n`);
  const lightResult = await runLightingDesign(lightInput, {
    blender,
    outRigJson: rigJson,
    report: lightingReport,
    roomGlb: workGlb,
    timeoutMs: passTimeoutMs,
  });
  await stageLog("lighting", lightResult);
  assertBlenderOk("lighting_design", lightResult, { timeoutMs: passTimeoutMs, outDir });
  const final = await auditMaterials(workGlb);
  const floorRows = final.materials.filter((m) => /floor/i.test(m.material));

  const report = {
    schemaVersion: "openclinxr.ward-finish-chain.v1",
    generatedAt: new Date().toISOString(),
    environmentId: WARD_CHAIN_ENVIRONMENT_ID,
    seed,
    footprintMeters: WARD_CHAIN_FOOTPRINT,
    door: WARD_CHAIN_DOOR,
    preset: WARD_CHAIN_PRESET,
    mood: WARD_CHAIN_MOOD,
    workGlb,
    stages: {
      roomGenerate: { result: genResult, materialAudit: afterGenerate },
      roomClinicFinish: { result: finishResult, recipeJson, materialAudit: afterFinish },
      lightingDesign: { result: lightResult, rigJson, materialAudit: final },
    },
    floorMaterialVerdict: floorRows,
  };
  await writeFile(chainReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`[ward-chain] report: ${chainReportPath}\n`);
  process.stdout.write(
    `[ward-chain] floor materials in final GLB: ${floorRows.length === 0 ? "NONE" : floorRows.map((m) => `${m.material} tex=${m.baseColorTexture} bytes=${m.imageBytes} factor=${JSON.stringify(m.baseColorFactor)}`).join("; ")}\n`,
  );

  // Convenience copy: the exact file Task 2 wires as the shipped environment.
  const finalCopy = path.join(outDir, "infinigen-inpatient-ward.chain.glb");
  copyFileSync(workGlb, finalCopy);
  process.stdout.write(`[ward-chain] final copy: ${finalCopy} (exists=${existsSync(finalCopy)})\n`);
}
