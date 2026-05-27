import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const defaultInputPath = "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb";
const defaultOutputPath = defaultInputPath;
const defaultBackupPath = ".openclinxr/asset-production/realism-backups/neutral-generated-human-pre-primitive-proxy-strip-2026-05-23.glb";

const primitiveProxyPrefixes = [
  "local_fixture_",
  "openclinxr_proportioned_",
  "openclinxr_visual_detail_",
  "openclinxr_camera_facing_",
];

type CliOptions = {
  inputPath: string;
  outputPath: string;
  backupPath: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(path.dirname(options.backupPath), { recursive: true });
  if (path.resolve(options.inputPath) === path.resolve(options.outputPath)) {
    await copyFile(options.inputPath, options.backupPath);
  }

  const document = await new NodeIO().read(options.inputPath);
  const removedNodeNames: string[] = [];
  for (const node of [...document.getRoot().listNodes()]) {
    const name = node.getName();
    if (primitiveProxyPrefixes.some((prefix) => name.startsWith(prefix))) {
      removedNodeNames.push(name);
      node.dispose();
    }
  }
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await new NodeIO().write(options.outputPath, document);
  process.stdout.write(JSON.stringify({
    schemaVersion: "openclinxr.strip-humanoid-primitive-proxies.v1",
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    backupPath: options.backupPath,
    removedNodeCount: removedNodeNames.length,
    removedNodeNames,
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  }, null, 2));
  process.stdout.write("\n");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: defaultInputPath,
    outputPath: defaultOutputPath,
    backupPath: defaultBackupPath,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    index += 1;
    if (arg === "--input") options.inputPath = next;
    else if (arg === "--output") options.outputPath = next;
    else if (arg === "--backup") options.backupPath = next;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
