import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOM_CHAIN_RECIPES, runRoomChain } from "@openclinxr/factory-stations/room-chain";
import { decodePng } from "../../evidence/decode-png.js";
import { writeRoomEvidencePoses } from "./derive-room-evidence-poses.js";

const RUNTIME_PATHS: Record<string, { glb: string; rig: string; provenanceOut?: string }> = {
  ed_exam_bay_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb", rig: "apps/ui-xr/public/xr-assets/lighting/ed_exam_bay_v1.rig.json" },
  pediatric_urgent_care_bay_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb", rig: "apps/ui-xr/public/xr-assets/lighting/pediatric_urgent_care_bay_v1.rig.json" },
  primary_care_clinic_room_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-primary-care-clinic.glb", rig: "apps/ui-xr/public/xr-assets/lighting/primary_care_clinic_room_v1.rig.json" },
  ed_stroke_bay_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-ed-stroke-bay.glb", rig: "apps/ui-xr/public/xr-assets/lighting/ed_stroke_bay_v1.rig.json" },
  adult_ed_abdominal_bay_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-adult-ed-abdominal-bay.glb", rig: "apps/ui-xr/public/xr-assets/lighting/adult_ed_abdominal_bay_v1.rig.json" },
  telehealth_home_visit_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-telehealth-home-visit.glb", rig: "apps/ui-xr/public/xr-assets/lighting/telehealth_home_visit_v1.rig.json" },
  behavioral_health_private_room_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-behavioral-health-private.glb", rig: "apps/ui-xr/public/xr-assets/lighting/behavioral_health_private_room_v1.rig.json" },
  oncology_consult_room_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-oncology-consult.glb", rig: "apps/ui-xr/public/xr-assets/lighting/oncology_consult_room_v1.rig.json" },
  urgent_care_clinic_room_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-urgent-care-clinic.glb", rig: "apps/ui-xr/public/xr-assets/lighting/urgent_care_clinic_room_v1.rig.json" },
  surgical_ward_room_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-surgical-ward.glb", rig: "apps/ui-xr/public/xr-assets/lighting/surgical_ward_room_v1.rig.json" },
  ob_triage_room_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-ob-triage.glb", rig: "apps/ui-xr/public/xr-assets/lighting/ob_triage_room_v1.rig.json" },
  pediatric_fever_urgent_care_bay_v1: { glb: "apps/ui-xr/public/xr-assets/environment/infinigen-pediatric-fever-urgent-care.glb", rig: "apps/ui-xr/public/xr-assets/lighting/pediatric_fever_urgent_care_bay_v1.rig.json" },
  inpatient_ward_room_v1: {
    glb: "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb",
    rig: "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json",
    provenanceOut: "docs/openclinxr/room-realism/floor-cast",
  },
  stepdown_room_v1: {
    glb: "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb",
    rig: "apps/ui-xr/public/xr-assets/lighting/stepdown_room_v1.rig.json",
  },
};

const digest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

type ParsedGlb = {
  json: Record<string, unknown>;
  views: Buffer[];
  imageViews: Set<number>;
};

function parseGlb(file: string): ParsedGlb {
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new Error(`${file} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
  const binHeader = 20 + jsonLength;
  const binStart = binHeader + 8;
  const bufferViews = (json["bufferViews"] ?? []) as Array<{ byteOffset?: number; byteLength: number }>;
  const images = (json["images"] ?? []) as Array<{ bufferView?: number }>;
  return {
    json,
    views: bufferViews.map((view) => bytes.subarray(
      binStart + (view.byteOffset ?? 0),
      binStart + (view.byteOffset ?? 0) + view.byteLength,
    )),
    imageViews: new Set(images.flatMap((image) => image.bufferView === undefined ? [] : [image.bufferView])),
  };
}

function decodedRgbaEquivalent(left: Buffer, right: Buffer): boolean {
  const a = decodePng(left);
  const b = decodePng(right);
  if (a === null || b === null || a.w !== b.w || a.h !== b.h) return false;
  let oneLsbChannelDifferences = 0;
  for (const channel of ["r", "g", "b", "a"] as const) {
    for (let index = 0; index < a[channel].length; index += 1) {
      const delta = Math.abs((a[channel][index] ?? 0) - (b[channel][index] ?? 0));
      if (delta > 1) return false;
      if (delta === 1 && ++oneLsbChannelDifferences > 1) return false;
    }
  }
  return true;
}

/** True only when GLBs differ by PNG encoding/container offsets or one 1-LSB texture channel. */
export function roomGlbContentEqual(leftFile: string, rightFile: string): boolean {
  const left = parseGlb(leftFile);
  const right = parseGlb(rightFile);
  if (left.views.length !== right.views.length || left.imageViews.size !== right.imageViews.size) return false;
  const normalize = (parsed: ParsedGlb): string => {
    const json = structuredClone(parsed.json) as {
      bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
      buffers?: Array<{ byteLength?: number }>;
    };
    for (const [index, view] of (json.bufferViews ?? []).entries()) {
      delete view.byteOffset;
      if (parsed.imageViews.has(index)) delete view.byteLength;
    }
    for (const buffer of json.buffers ?? []) delete buffer.byteLength;
    return JSON.stringify(json);
  };
  if (normalize(left) !== normalize(right)) return false;
  return left.views.every((view, index) => {
    const other = right.views[index];
    if (other === undefined) return false;
    if (view.equals(other)) return true;
    return left.imageViews.has(index) && right.imageViews.has(index) && decodedRgbaEquivalent(view, other);
  });
}

export function parseRoomPromoteArgs(args: readonly string[]): { environmentId: string; seed?: number; outDir: string; noCache: boolean } {
  let environmentId = "";
  let seed: number | undefined;
  let outDir = ".openclinxr/evidence/ward-finish-chain";
  let noCache = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--environment") environmentId = String(args[++i] ?? "");
    else if (args[i] === "--seed") seed = Number(args[++i]);
    else if (args[i] === "--out-dir") outDir = String(args[++i] ?? "");
    else if (args[i] === "--no-cache") noCache = true;
  }
  if (!environmentId) throw new Error("--environment is required");
  if (seed !== undefined && !Number.isFinite(seed)) throw new Error("--seed must be finite");
  if (!outDir) throw new Error("--out-dir requires a directory");
  return seed === undefined ? { environmentId, outDir, noCache } : { environmentId, seed, outDir, noCache };
}

export async function promoteRoom(args = process.argv.slice(2)): Promise<void> {
  const { environmentId, seed: requestedSeed, outDir, noCache } = parseRoomPromoteArgs(args);
  const recipe = ROOM_CHAIN_RECIPES[environmentId as keyof typeof ROOM_CHAIN_RECIPES];
  const runtime = RUNTIME_PATHS[environmentId];
  if (recipe === undefined || runtime === undefined) throw new Error(`No promotable room-chain recipe for ${environmentId}`);
  const seed = requestedSeed ?? recipe.defaultSeed;
  const before = Object.fromEntries([runtime.glb, runtime.rig].map((file) => [file, existsSync(file) ? digest(file) : null]));
  const chain = await runRoomChain({
    environmentId,
    seed,
    outDir,
    noCache,
  });
  const preservedShippedGlbContent = existsSync(runtime.glb)
    && digest(chain.finalGlb) !== digest(runtime.glb)
    && roomGlbContentEqual(chain.finalGlb, runtime.glb);
  if (!preservedShippedGlbContent) copyFileSync(chain.finalGlb, runtime.glb);
  copyFileSync(chain.rigJson, runtime.rig);
  const evidencePosesPath = path.join(outDir, "room-evidence-poses.json");
  const evidencePoses = await writeRoomEvidencePoses(
    preservedShippedGlbContent ? runtime.glb : chain.finalGlb,
    recipe,
    evidencePosesPath,
  );
  if (runtime.provenanceOut !== undefined && !preservedShippedGlbContent) {
    execFileSync(process.execPath, [
      path.join("node_modules", "tsx", "dist", "cli.mjs"),
      "tools/openclinxr/evidence/room-ward-finish-chain/ship-ward-provenance.ts",
    ], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, SHIP_WARD_OUT: process.env["SHIP_WARD_OUT"] ?? runtime.provenanceOut, SHIP_WARD_SEED: String(seed), SHIP_WARD_CHAIN_OUT: path.dirname(chain.finalGlb) },
    });
  }
  const after = Object.fromEntries([runtime.glb, runtime.rig].map((file) => [file, digest(file)]));
  const changed = Object.keys(after).filter((file) => before[file] !== after[file]);
  process.stdout.write(`${JSON.stringify({
    environmentId,
    seed,
    cache: chain.cache,
    before,
    after,
    changed,
    preservedShippedGlbContent,
    evidencePoses: {
      path: evidencePosesPath,
      sha256: digest(evidencePosesPath),
      sourceGlbSha256: evidencePoses.sourceGlbSha256,
      count: evidencePoses.poses.length,
      clearanceM: evidencePoses.clearanceM,
    },
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await promoteRoom();
}
