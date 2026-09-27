/**
 * Ward finish chain CLI (ward-finish-chain part 3): runs room_generate ->
 * room_clinic_finish -> lighting_design in sequence on ONE work GLB for
 * `inpatient_ward_room_v1`, then reports per-stage material state.
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
 * After each GLB-touching stage the CLI audits the material list
 * (name + baseColorTexture presence + image bytes) so the floor-white
 * diagnosis reads file state, not renders.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/environment/ward-finish-chain-cli.ts \
 *     [--seed 205] [--out-dir .openclinxr/evidence/ward-finish-chain]
 */
import { copyFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import {
  runRoomGenerate,
  runRoomClinicFinish,
  runLightingDesign,
} from "@openclinxr/factory-stations";

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

function assertBlenderOk(stage: string, result: Record<string, unknown>): void {
  const code = result["blenderExit"];
  if (code !== 0 && code !== null) {
    const stderr = typeof result["stderr"] === "string" ? (result["stderr"] as string) : "";
    throw new Error(`${stage} blender exit ${String(code)}:\n${stderr.slice(-2000)}`);
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

function parseArgs(args: readonly string[]): { seed: number; outDir: string } {
  let seed = WARD_CHAIN_DEFAULT_SEED;
  let outDir = WARD_CHAIN_OUT_DIR;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--seed") seed = Number(args[i + 1]);
    if (args[i] === "--out-dir") outDir = String(args[i + 1]);
  }
  if (!Number.isFinite(seed)) throw new Error("--seed must be a finite number");
  return { seed, outDir };
}

export async function runWardFinishChain(args = process.argv.slice(2)): Promise<void> {
  const { seed, outDir } = parseArgs(args);
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
    timeoutMs: 600_000,
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
  assertBlenderOk("room_generate", genResult);
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
    { blender, workGlb, recipeJsonOut: recipeJson, report: finishReport, timeoutMs: 600_000 },
  );
  await stageLog("finish", finishResult);
  assertBlenderOk("room_clinic_finish", finishResult);
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
    timeoutMs: 600_000,
  });
  await stageLog("lighting", lightResult);
  assertBlenderOk("lighting_design", lightResult);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWardFinishChain();
}
