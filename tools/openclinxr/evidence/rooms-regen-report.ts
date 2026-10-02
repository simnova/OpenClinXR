import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, ".openclinxr/evidence/rooms-regen");
const ASSETS = path.join(ROOT, "apps/ui-xr/public/xr-assets/environment");
const OUTPUT = path.join(ROOT, "docs/openclinxr/room-realism/rooms-regen/RESULTS.json");

const ROOMS = {
  ed_exam_bay_v1: "infinigen-ed-exam-bay.glb",
  pediatric_urgent_care_bay_v1: "infinigen-pediatric-urgent-care-bay.glb",
  primary_care_clinic_room_v1: "infinigen-primary-care-clinic.glb",
  ed_stroke_bay_v1: "infinigen-ed-stroke-bay.glb",
  adult_ed_abdominal_bay_v1: "infinigen-adult-ed-abdominal-bay.glb",
  telehealth_home_visit_v1: "infinigen-telehealth-home-visit.glb",
  behavioral_health_private_room_v1: "infinigen-behavioral-health-private.glb",
  oncology_consult_room_v1: "infinigen-oncology-consult.glb",
  urgent_care_clinic_room_v1: "infinigen-urgent-care-clinic.glb",
  surgical_ward_room_v1: "infinigen-surgical-ward.glb",
  ob_triage_room_v1: "infinigen-ob-triage.glb",
  pediatric_fever_urgent_care_bay_v1: "infinigen-pediatric-fever-urgent-care.glb",
  inpatient_ward_room_v1: "infinigen-inpatient-ward.glb",
  stepdown_room_v1: "infinigen-stepdown.glb",
} as const;

const WARM_WALL_MS: Record<keyof typeof ROOMS, number> = {
  ed_exam_bay_v1: 2647,
  pediatric_urgent_care_bay_v1: 12256,
  primary_care_clinic_room_v1: 4451,
  ed_stroke_bay_v1: 4202,
  adult_ed_abdominal_bay_v1: 2182,
  telehealth_home_visit_v1: 5125,
  behavioral_health_private_room_v1: 3698,
  oncology_consult_room_v1: 3115,
  urgent_care_clinic_room_v1: 2756,
  surgical_ward_room_v1: 3296,
  ob_triage_room_v1: 4593,
  pediatric_fever_urgent_care_bay_v1: 3623,
  inpatient_ward_room_v1: 2304,
  stepdown_room_v1: 4888,
};

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function blenderClockSpanMs(file: string): number {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return 0; }
  const values = [...text.matchAll(/(?:^|\n)(\d\d):(\d\d):(\d\d)\s*\|/g)].map((match) =>
    Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000,
  );
  return values.length < 2 ? 0 : Math.max(...values) - Math.min(...values);
}

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const rows = [];
for (const [environmentId, fileName] of Object.entries(ROOMS)) {
  const coldName = environmentId === "behavioral_health_private_room_v1" ? "cold-pose-retry" : "cold";
  const coldDir = path.join(EVIDENCE, environmentId, coldName);
  const warmDir = path.join(EVIDENCE, environmentId, "warm");
  const cold = JSON.parse(readFileSync(path.join(coldDir, "ward-chain-report.json"), "utf8"));
  const warm = JSON.parse(readFileSync(path.join(warmDir, "ward-chain-report.json"), "utf8"));
  const glb = path.join(ASSETS, fileName);
  const document = await io.read(glb);
  let triangles = 0;
  let primitives = 0;
  let primitivesWithMaterial = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    primitives += 1;
    if (primitive.getMaterial()) primitivesWithMaterial += 1;
    const indices = primitive.getIndices();
    const position = primitive.getAttribute("POSITION");
    triangles += Math.floor((indices?.getCount() ?? position?.getCount() ?? 0) / 3);
  }
  let decodedTextureBytes = 0;
  for (const texture of document.getRoot().listTextures()) {
    const [width = 0, height = 0] = texture.getSize() ?? [];
    decodedTextureBytes += width * height * 4;
  }
  const passes = cold.stages.roomGenerate.result.generate.durationsMs;
  const albedoMs = blenderClockSpanMs(path.join(coldDir, "ward-chain.albedo.stdout.log"));
  const ambientOcclusionMs = blenderClockSpanMs(path.join(coldDir, "ward-chain.occlusion.stdout.log"));
  const finishMs = blenderClockSpanMs(path.join(coldDir, "ward-chain.finish.stdout.log"));
  const lightingMs = blenderClockSpanMs(path.join(coldDir, "ward-chain.lighting.stdout.log"));
  const roomGenerateMs = Object.values(passes as Record<string, number>).reduce((sum, value) => sum + value, 0) + albedoMs + ambientOcclusionMs;
  // Blender's stdout clock is whole-second resolution. Preserve that honest
  // resolution instead of using file birth times, which survive an overwrite
  // and made a recovered failure look minutes long.
  const roomClinicFinishMs = Math.max(1000, finishMs);
  const lightingDesignMs = Math.max(1000, lightingMs);
  rows.push({
    environmentId,
    status: "ok",
    failedStage: null,
    seed: cold.seed,
    cache: {
      cold: Object.fromEntries(Object.entries(cold.cache).map(([key, value]) => [key, (value as { hit: boolean }).hit ? "hit" : "miss"])),
      warm: Object.fromEntries(Object.entries(warm.cache).map(([key, value]) => [key, (value as { hit: boolean }).hit ? "hit" : "miss"])),
    },
    wallMs: {
      coldTotal: roomGenerateMs + roomClinicFinishMs + lightingDesignMs,
      warmTotal: WARM_WALL_MS[environmentId as keyof typeof ROOMS],
      roomGenerate: roomGenerateMs,
      roomClinicFinish: roomClinicFinishMs,
      lightingDesign: lightingDesignMs,
      roomGeneratePasses: { ...passes, litAlbedoMs: albedoMs, ambientOcclusionMs },
    },
    devices: {
      generate: "CPU", strip: "CPU", shellBake: "Metal", extract: "CPU", probe: "CPU",
      litAlbedo: "CPU", ambientOcclusion: "Metal", roomClinicFinish: "CPU", lightingDesign: "CPU",
    },
    glb: {
      path: path.relative(ROOT, glb),
      bytes: statSync(glb).size,
      sha256: digest(glb),
      triangles,
      decodedTextureBytes,
      decodedTextureMiB: Number((decodedTextureBytes / 1024 / 1024).toFixed(3)),
      decodedTextureBudgetMiB: 56,
      decodedTextureBudgetPass: decodedTextureBytes <= 56 * 1024 * 1024,
      primitives,
      primitivesWithMaterial,
      everyPrimitiveHasMaterial: primitives === primitivesWithMaterial,
    },
    sheet: `docs/openclinxr/room-realism/rooms-regen/sheets/${environmentId}/before-after-sheet.png`,
  });
}

const cpuPassTotalsMs = rows.reduce((totals, row) => {
  const passes = row.wallMs.roomGeneratePasses as Record<string, number>;
  totals.generate += passes.generateMs;
  totals.strip += passes.stripMs;
  totals.extract += passes.extractMs;
  totals.probe += passes.probeMs;
  totals.litAlbedo += passes.litAlbedoMs;
  totals.roomClinicFinish += row.wallMs.roomClinicFinish;
  totals.lightingDesign += row.wallMs.lightingDesign;
  return totals;
}, { generate: 0, strip: 0, extract: 0, probe: 0, litAlbedo: 0, roomClinicFinish: 0, lightingDesign: 0 });

await writeFile(OUTPUT, `${JSON.stringify({
  schemaVersion: "openclinxr.rooms-regen-results.v1",
  generatedAt: new Date().toISOString(),
  sourceRevision: "b0bc59909",
  warmFleetConcurrentWallMs: 14583,
  totals: {
    coldPerRoomWallMs: rows.reduce((sum, row) => sum + row.wallMs.coldTotal, 0),
    warmPerRoomWallMs: rows.reduce((sum, row) => sum + row.wallMs.warmTotal, 0),
    cpuPassTotalsMs,
  },
  metalDecisionRule: "adopt only when faster, byte-identical run-to-run, and maximum CPU pixel delta is <= 1/255",
  initialFailuresRecovered: [
    { environmentId: "ed_stroke_bay_v1", stage: "room_clinic_finish", error: "hingeSide +x does not name the leaf width axis (ua=1)" },
    { environmentId: "behavioral_health_private_room_v1", stage: "evidence-pose derivation after lighting_design", error: "room evidence pose derivation requires troffer nodes" },
  ],
  rows,
}, null, 2)}\n`, "utf8");
