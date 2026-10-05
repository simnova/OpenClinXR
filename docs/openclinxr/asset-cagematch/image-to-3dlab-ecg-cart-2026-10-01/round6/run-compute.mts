import { createLocalComputeServices } from "/Volumes/files/src/openclinxr-wt/cart-round5/packages/openclinxr/service-local-compute/src/index.ts";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round6";
const checkpoint = "/Volumes/files/src/openclinxr-wt/cart-round5/.openclinxr/round5b-replay-20261001/decoded-mesh.pt";
const python = `${process.env.HOME}/.openclinxr-tools/trellis2-apple/venv/bin/python3`;
const services = createLocalComputeServices({ cwd: process.cwd(), env: process.env });
await mkdir(path.join(root, "executions"), { recursive: true });
const records = [];
async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function gpu(label, script, argv, timeoutMs = 3_600_000) {
  const started = new Date();
  const result = await services.gpuJob.run({
    command: "/usr/bin/time",
    args: ["-l", python, script, ...argv],
    cwd: process.cwd(), env: process.env, label, timeoutMs,
  });
  records.push({ label, started: started.toISOString(), ended: new Date().toISOString(), ...result });
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
}

async function blender(label, argv, timeoutMs = 3_600_000) {
  const started = new Date();
  const result = await services.blender.run({
    script: "/usr/bin/time",
    args: ["-l", "/opt/homebrew/bin/blender", "--background", "--python", `${root}/blender-round6.py`, "--", ...argv],
    label, timeoutMs,
  });
  records.push({ label, started: started.toISOString(), ended: new Date().toISOString(), ...result });
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
}

if (!(await exists(`${root}/work/stage-prep.json`))) await gpu("round6:prepare-stage", `${root}/prepare-stage.py`, [
  "--checkpoint", checkpoint,
  "--out", `${root}/work`,
  "--round5-helper", "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5/process-treatment.py",
]);
if (!(await exists(`${root}/stage-isolation/render-report.json`))) await blender("round6:raw-stage-render", [
  "--mode", "render-raw",
  "--input", `${root}/work/decoded-fullres-voxel-colour.ply`,
  "--out", `${root}/stage-isolation`,
  "--freeze", "tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json",
  "--extent", "0.9682512283325195",
  "--resolution", "1280",
]);
if (!(await exists(`${root}/a1/report.json`))) await gpu("round6:a1-post", `${root}/postprocess-a1.py`, [
  "--input", `${root}/a0/ecg-cart.glb`,
  "--checkpoint", checkpoint,
  "--trellis-root", `${process.env.HOME}/.openclinxr-tools/trellis2-apple/src`,
  "--out", `${root}/a1/ecg-cart.glb`,
  "--report", `${root}/a1/report.json`,
]);
await writeFile(path.join(root, "executions", "compute.json"), `${JSON.stringify(records, null, 2)}\n`);
