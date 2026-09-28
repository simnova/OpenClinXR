/**
 * TEMPORARY piecemeal driver (deleted before commit). Stage 5-7 of the
 * ward-finish chain: meshopt decompress bridge, room_clinic_finish compose,
 * lighting_design rig. Mirrors runWardFinishChain stages 2-3 exactly, with
 * generous spawn budgets and full result JSON persisted.
 */
import { copyFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { runLightingDesign } from "../lighting_design/run.js";
import {
  WARD_CHAIN_BBOX,
  WARD_CHAIN_ENVIRONMENT_ID,
  WARD_CHAIN_MOOD,
  WARD_CHAIN_PRESET,
} from "./run.js";
import { runRoomClinicFinish } from "../room_clinic_finish/run.js";

const OUT = "/tmp/chain-piecewise/work";
const workGlb = path.join(OUT, "ward-chain.work.glb");
const recipeJson = path.join(OUT, "ward-chain.finish-recipe.json");
const finishReport = path.join(OUT, "ward-chain.finish-report.json");
const rigJson = path.join(OUT, "ward-chain.lighting-rig.json");
const lightingReport = path.join(OUT, "ward-chain.lighting-report.json");

async function decompressWorkGlb(glbPath: string): Promise<void> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(glbPath);
  doc.createExtension(EXTMeshoptCompression).dispose();
  const plain = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await plain.write(glbPath, doc);
}

console.log("[driver] decompress meshopt bridge ...");
await decompressWorkGlb(workGlb);
console.log("[driver] stage finish preset=ward_photo ...");
const finishResult = await runRoomClinicFinish(
  { environmentId: WARD_CHAIN_ENVIRONMENT_ID, preset: WARD_CHAIN_PRESET, seed: 205 },
  { blender: "blender", workGlb, recipeJsonOut: recipeJson, report: finishReport, timeoutMs: 3_600_000 },
);
await writeFile(path.join(OUT, "finish-result.json"), `${JSON.stringify(finishResult, null, 2)}\n`, "utf8");
console.log("[driver] stage lighting mood=clinic_day ...");
const lightResult = await runLightingDesign(
  {
    environmentId: WARD_CHAIN_ENVIRONMENT_ID,
    roomGlbPath: workGlb,
    bboxJson: JSON.stringify(WARD_CHAIN_BBOX),
    castJson: JSON.stringify([{ actorId: "patient", position: [0, 0.5, 1.0] }]),
    mood: WARD_CHAIN_MOOD,
    seed: 205,
  },
  { blender: "blender", outRigJson: rigJson, report: lightingReport, roomGlb: workGlb, timeoutMs: 3_600_000 },
);
await writeFile(path.join(OUT, "lighting-result.json"), `${JSON.stringify(lightResult, null, 2)}\n`, "utf8");
const finalCopy = path.join(OUT, "infinigen-inpatient-ward.chain.glb");
copyFileSync(workGlb, finalCopy);
console.log(`[driver] final copy: ${finalCopy}`);
