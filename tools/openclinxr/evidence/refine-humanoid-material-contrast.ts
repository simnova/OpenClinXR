import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const defaultInputPath = "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb";
const defaultOutputPath = defaultInputPath;
const defaultBackupPath = ".openclinxr/asset-production/realism-backups/neutral-generated-human-pre-material-contrast-v2-2026-05-23.glb";
const defaultReportPath = "docs/openclinxr/refine-humanoid-material-contrast-v2-2026-05-23.json";

type CliOptions = {
  inputPath: string;
  outputPath: string;
  backupPath: string;
  reportPath: string;
};

const materialTargets = new Map<string, {
  baseColorFactor: [number, number, number, number];
  roughnessFactor: number;
  metallicFactor: number;
}>([
  ["anny_surface_hair_dark", { baseColorFactor: [0.055, 0.038, 0.028, 1], roughnessFactor: 0.86, metallicFactor: 0 }],
  ["anny_surface_scrub_teal", { baseColorFactor: [0.02, 0.34, 0.38, 1], roughnessFactor: 0.76, metallicFactor: 0.02 }],
  ["anny_mesh_skin_warm_review", { baseColorFactor: [0.78, 0.66, 0.57, 1], roughnessFactor: 0.92, metallicFactor: 0 }],
  ["anny_mesh_lip_region_review", { baseColorFactor: [0.58, 0.36, 0.33, 1], roughnessFactor: 0.9, metallicFactor: 0 }],
  ["anny_mesh_nose_mouth_shadow_review", { baseColorFactor: [0.50, 0.39, 0.35, 1], roughnessFactor: 0.95, metallicFactor: 0 }],
]);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(path.dirname(options.backupPath), { recursive: true });
  await cp(options.inputPath, options.backupPath);
  const io = new NodeIO();
  const document = await io.read(options.inputPath);
  const updated: string[] = [];
  for (const material of document.getRoot().listMaterials()) {
    const target = materialTargets.get(material.getName());
    if (!target) continue;
    material
      .setBaseColorFactor(target.baseColorFactor)
      .setRoughnessFactor(target.roughnessFactor)
      .setMetallicFactor(target.metallicFactor);
    updated.push(material.getName());
  }
  await io.write(options.outputPath, document);
  const report = {
    schemaVersion: "openclinxr.refine-humanoid-material-contrast.v1",
    generatedAt: new Date().toISOString(),
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    backupPath: options.backupPath,
    updatedMaterials: updated,
    claimBoundaries: {
      notEvidenceFor: ["production_skin_shader_quality", "photorealism", "quest_readiness", "clinical_validity"],
    },
  };
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${options.reportPath}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: defaultInputPath,
    outputPath: defaultOutputPath,
    backupPath: defaultBackupPath,
    reportPath: defaultReportPath,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.inputPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
    else if (arg === "--backup") options.backupPath = requireNext(args, ++index, arg);
    else if (arg === "--report") options.reportPath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

await main();
