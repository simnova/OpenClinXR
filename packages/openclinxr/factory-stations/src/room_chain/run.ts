/**
 * Ward finish chain, package-internal orchestration (ward-finish-chain slice).
 *
 * Runs room_generate -> room_clinic_finish -> lighting_design in sequence on
 * ONE work GLB for `inpatient_ward_room_v1`, then reports per-stage material
 * state. The three stage runners are imported by RELATIVE PATH from their
 * sibling station folders: this module lives inside `@openclinxr/factory-stations`,
 * so those imports never cross a package boundary. The entrypoint publishes
 * only runRoomChain and ROOM_CHAIN_RECIPES for case runners and promotion.
 *
 * Step 1 (room_generate): fixed-footprint Infinigen GENERATE with the
 * room-dimensions-fix pin (footprint 4.3 x 3.9 x 2.4, door wall +y offset
 * 0.25, hinge +x, style lite), plus the existing albedo+occlusion bake and
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
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { runLightingDesign } from "../lighting_design/run.js";
import { repoRoot } from "../repo-root.js";
import { runRoomClinicFinish } from "../room_clinic_finish/run.js";
import { runRoomGenerate } from "../room_generate/run.js";
import { roomChainRecipeFor } from "./recipes.js";
import {
  collectStageKeyInputs,
  lookupStageCache,
  readCachedResult,
  restoreStageCache,
  scrubLightingKeyInput,
  storeStageCache,
  type CollectStageKeyResult,
  type RoomChainCacheStage,
} from "./cache.js";

export const WARD_CHAIN_OUT_DIR = ".openclinxr/evidence/ward-finish-chain";
// Measured 2026-09-28: a real chain albedo bake took 757 s (log timestamps
// 03:59:13 to 04:11:50), so the old 600 s per-pass budget SIGTERMed a Blender
// that had already finished its real work and the timeout race reported the
// successful bake as a generic "exit 1". The 3600 s (1 hour) default below
// keeps real margin over that measured figure; per the D9 operator directive
// execution duration is refinable and must not fail a good bake.
export const WARD_CHAIN_PASS_TIMEOUT_MS = 3_600_000;

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
  noCache: boolean;
} {
  let seed = roomChainRecipeFor("inpatient_ward_room_v1")?.defaultSeed ?? 205;
  let outDir = WARD_CHAIN_OUT_DIR;
  let passTimeoutMs = WARD_CHAIN_PASS_TIMEOUT_MS;
  let noCache = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--seed") seed = Number(args[i + 1]);
    if (args[i] === "--out-dir") outDir = String(args[i + 1]);
    if (args[i] === "--pass-timeout-ms") passTimeoutMs = Number(args[i + 1]);
    if (args[i] === "--no-cache") noCache = true;
  }
  if (!Number.isFinite(seed)) throw new Error("--seed must be a finite number");
  if (!Number.isFinite(passTimeoutMs) || passTimeoutMs <= 0) {
    throw new Error("--pass-timeout-ms must be a positive number of milliseconds");
  }
  return { seed, outDir, passTimeoutMs, noCache };
}

/** Resolve relative output paths against the same repo-root base every stage uses. */
export function resolveChainOutDir(outDirArg: string, base: string = repoRoot()): string {
  return path.resolve(base, outDirArg);
}

/** Live `ps` count of real Blender processes across ALL worktrees on this machine. */
function runningBlenderCount(): number {
  try {
    const out = execFileSync(
      "sh",
      ["-c", 'ps aux | grep "Blender.app/Contents/MacOS/Blender" | grep -v grep | wc -l'],
      { encoding: "utf8", timeout: 15_000 },
    );
    const count = Number(String(out).trim());
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Wait until fewer than 2 real Blender processes are running elsewhere.
 * Covers this module's own `blender --version` key probe; the stage spawns
 * themselves rely on operator scheduling (sibling jobs carry no lock this
 * chain could honor unilaterally). Fail closed rather than contend.
 */
async function waitForBlenderSlot(): Promise<void> {
  for (let i = 0; ; i += 1) {
    if (runningBlenderCount() < 2) return;
    if (i >= 1080) {
      throw new Error("waited 3h for a Blender slot (2 busy); refusing to contend");
    }
    if (i % 6 === 0) process.stdout.write("[ward-chain] waiting for a Blender slot (2 busy)...\n");
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

export type WardChainCacheStatus = Record<RoomChainCacheStage, { hit: boolean; key: string | null }>;

export type RoomChainRunOptions = {
  environmentId: string;
  seed?: number;
  outDir?: string;
  passTimeoutMs?: number;
  noCache?: boolean;
};

export type RoomChainRunResult = {
  environmentId: string;
  seed: number;
  cache: WardChainCacheStatus;
  stageKeys: Record<RoomChainCacheStage, string | null>;
  workGlb: string;
  finalGlb: string;
  rigJson: string;
  reportPath: string;
  glbSha256: string;
  rigSha256: string;
};

export async function runRoomChain(options: RoomChainRunOptions): Promise<RoomChainRunResult> {
  const recipe = roomChainRecipeFor(options.environmentId);
  if (recipe === undefined) throw new Error(`No room-chain recipe for environmentId ${options.environmentId}`);
  const seed = options.seed ?? recipe.defaultSeed;
  if (!Number.isFinite(seed)) throw new Error("room-chain seed must be finite");
  const outDirArg = options.outDir ?? WARD_CHAIN_OUT_DIR;
  const passTimeoutMs = options.passTimeoutMs ?? WARD_CHAIN_PASS_TIMEOUT_MS;
  const noCache = options.noCache ?? false;
  // One base keeps Node audits and Blender stages aligned under package-filtered invocations.
  const outDir = resolveChainOutDir(outDirArg);
  const blender = process.env["BLENDER"] ?? "blender";
  await mkdir(outDir, { recursive: true });
  const workGlb = path.join(outDir, "ward-chain.work.glb");
  const recipeJson = path.join(outDir, "ward-chain.finish-recipe.json");
  const finishReport = path.join(outDir, "ward-chain.finish-report.json");
  const rigJson = path.join(outDir, "ward-chain.lighting-rig.json");
  const lightingReport = path.join(outDir, "ward-chain.lighting-report.json");
  const chainReportPath = path.join(outDir, "ward-chain-report.json");
  const bbox = {
    minX: -recipe.footprintMeters.width / 2,
    maxX: recipe.footprintMeters.width / 2,
    minY: -recipe.footprintMeters.depth / 2,
    maxY: recipe.footprintMeters.depth / 2,
    minZ: 0,
    maxZ: recipe.footprintMeters.ceilingHeight,
  };
  const stageLog = async (stage: string, result: Record<string, unknown>): Promise<void> => {
    const stdout = typeof result["stdout"] === "string" ? (result["stdout"] as string) : "";
    const stderr = typeof result["stderr"] === "string" ? (result["stderr"] as string) : "";
    await writeFile(path.join(outDir, `ward-chain.${stage}.stdout.log`), stdout, "utf8");
    await writeFile(path.join(outDir, `ward-chain.${stage}.stderr.log`), stderr, "utf8");
  };

  // Stage 1: generate + bake + simplify. GENERATE creates workGlb from
  // scratch; a stale work file from an earlier run must not survive.
  // The stage cache wraps each stage: on hit the cached output is copied
  // into place and the Blender spawns are skipped; on miss the stage runs
  // for real and its output is stored. --no-cache forces every stage to run
  // (still writing to cache after) and skips all reads.
  const cacheStatus: WardChainCacheStatus = {
    room_generate: { hit: false, key: null },
    room_clinic_finish: { hit: false, key: null },
    lighting_design: { hit: false, key: null },
  };
  let sharedBlenderVersion: string | undefined;
  if (noCache) process.stdout.write("[ward-chain] --no-cache: every stage runs for real\n");
  const collectKey = (
    stage: RoomChainCacheStage,
    input: Record<string, unknown>,
    workGlbPath?: string,
    upstream?: CollectStageKeyResult,
  ): CollectStageKeyResult => {
    if (upstream !== undefined && !upstream.ok) {
      const refused: CollectStageKeyResult = {
        ok: false,
        warning: `cache skip ${stage}: upstream key unavailable`,
      };
      process.stdout.write(`${refused.warning}\n`);
      return refused;
    }
    const collected = collectStageKeyInputs(stage, {
      input,
      ...(workGlbPath !== undefined ? { workGlbPath } : {}),
      upstreamKey: upstream?.ok ? upstream.key : null,
      blender,
      ...(sharedBlenderVersion !== undefined
        ? { overrides: { blenderVersion: sharedBlenderVersion } }
        : {}),
    });
    if (collected.ok) sharedBlenderVersion = collected.inputs.blenderVersion;
    else process.stdout.write(`${collected.warning}\n`);
    return collected;
  };
  const runCachedStage = async (
    stage: RoomChainCacheStage,
    key: CollectStageKeyResult,
    dest: Record<string, string>,
    run: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> => {
    if (key.ok && !noCache) {
      const entry = lookupStageCache(stage, key.key);
      if (entry !== null) {
        restoreStageCache(entry, dest);
        cacheStatus[stage] = { hit: true, key: key.key };
        process.stdout.write(`cache hit ${stage} ${key.key}\n`);
        return readCachedResult(entry);
      }
      process.stdout.write(`cache miss ${stage} ${key.key}\n`);
    }
    const result = await run();
    if (key.ok) {
      storeStageCache(stage, key.key, key.inputs, result, dest);
      cacheStatus[stage] = { hit: false, key: key.key };
    } else {
      cacheStatus[stage] = { hit: false, key: null };
    }
    return result;
  };

  const genInput = {
    environmentId: recipe.environmentId,
    infinigenPrompt: recipe.infinigenPrompt,
    seed,
    layoutVariant: recipe.layoutVariant,
    footprintMeters: { ...recipe.footprintMeters },
    door: { ...recipe.door, liteRect: [...recipe.door.liteRect] },
  };
  await waitForBlenderSlot();
  process.stdout.write(`[ward-chain] stage 1 room_generate seed=${seed} ...\n`);
  const genKey = collectKey("room_generate", genInput);
  const genResult = await runCachedStage("room_generate", genKey, { "work.glb": workGlb }, () =>
    runRoomGenerate(genInput, {
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
    }),
  );
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
  process.stdout.write(`[ward-chain] stage 2 room_clinic_finish preset=${recipe.finishPreset} ...\n`);
  const finishInput = {
    environmentId: recipe.environmentId,
    preset: recipe.finishPreset,
    seed,
    // Ward door furniture: hinge plates mount on this jamb; the lite
    // fractions place the glass/frame when the leaf carries no cut
    // opening (same rect the generate stage cuts, mirrored + margin
    // mapped). The environment recipe is the single source.
    door: { hingeSide: recipe.door.hingeSide, lite: [...recipe.door.liteRect],
            margin: recipe.door.panelMarginM },
  };
  const finishKey = collectKey("room_clinic_finish", finishInput, workGlb, genKey);
  const finishResult = await runCachedStage(
    "room_clinic_finish",
    finishKey,
    { "work.glb": workGlb, "recipe.json": recipeJson, "report.json": finishReport },
    () =>
      runRoomClinicFinish(finishInput, {
        blender,
        workGlb,
        recipeJsonOut: recipeJson,
        report: finishReport,
        timeoutMs: passTimeoutMs,
      }),
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
    environmentId: recipe.environmentId,
    roomGlbPath: workGlb,
    bboxJson: JSON.stringify(bbox),
    castJson: JSON.stringify([{ actorId: "patient", position: [0, 0.5, 1.0] }]),
    mood: recipe.lightingMood,
    seed,
  };
  process.stdout.write(`[ward-chain] stage 3 lighting_design mood=${recipe.lightingMood} ...\n`);
  const lightResult = await runCachedStage(
    "lighting_design",
    collectKey("lighting_design", scrubLightingKeyInput(lightInput), workGlb, finishKey),
    { "rig.json": rigJson, "report.json": lightingReport },
    () =>
      runLightingDesign(lightInput, {
        blender,
        outRigJson: rigJson,
        report: lightingReport,
        roomGlb: workGlb,
        timeoutMs: passTimeoutMs,
      }),
  );
  await stageLog("lighting", lightResult);
  assertBlenderOk("lighting_design", lightResult, { timeoutMs: passTimeoutMs, outDir });
  const final = await auditMaterials(workGlb);
  const floorRows = final.materials.filter((m) => /floor/i.test(m.material));

  const report = {
    schemaVersion: "openclinxr.ward-finish-chain.v1",
    generatedAt: new Date().toISOString(),
    environmentId: recipe.environmentId,
    seed,
    footprintMeters: recipe.footprintMeters,
    door: recipe.door,
    preset: recipe.finishPreset,
    mood: recipe.lightingMood,
    cache: cacheStatus,
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
  const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
  return {
    environmentId: recipe.environmentId,
    seed,
    cache: cacheStatus,
    stageKeys: Object.fromEntries(Object.entries(cacheStatus).map(([stage, status]) => [stage, status.key])) as Record<RoomChainCacheStage, string | null>,
    workGlb,
    finalGlb: finalCopy,
    rigJson,
    reportPath: chainReportPath,
    glbSha256: digest(finalCopy),
    rigSha256: digest(rigJson),
  };
}

export async function runWardFinishChain(args = process.argv.slice(2)): Promise<RoomChainRunResult> {
  const parsed = parseWardChainArgs(args);
  return runRoomChain({
    environmentId: "inpatient_ward_room_v1",
    seed: parsed.seed,
    outDir: parsed.outDir,
    passTimeoutMs: parsed.passTimeoutMs,
    noCache: parsed.noCache,
  });
}
