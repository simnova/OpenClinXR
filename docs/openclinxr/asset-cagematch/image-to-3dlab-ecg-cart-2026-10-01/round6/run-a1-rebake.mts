import { createLocalComputeServices } from "/Volumes/files/src/openclinxr-wt/cart-round5/packages/openclinxr/service-local-compute/src/index.ts";
import { writeFile } from "node:fs/promises";

const root = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round6";
const checkpoint = "/Volumes/files/src/openclinxr-wt/cart-round5/.openclinxr/round5b-replay-20261001/decoded-mesh.pt";
const python = `${process.env.HOME}/.openclinxr-tools/trellis2-apple/venv/bin/python3`;
const services = createLocalComputeServices({ cwd: process.cwd(), env: process.env });
const started = new Date();
const result = await services.gpuJob.run({
  command: "/usr/bin/time",
  args: ["-l", python, `${root}/postprocess-a1.py`,
    "--input", `${root}/a0/ecg-cart.glb`,
    "--checkpoint", checkpoint,
    "--trellis-root", `${process.env.HOME}/.openclinxr-tools/trellis2-apple/src`,
    "--out", `${root}/a1/ecg-cart.glb`,
    "--report", `${root}/a1/report.json`],
  cwd: process.cwd(), env: process.env, label: "round6:a1-exact-control-rebake", timeoutMs: 3_600_000,
});
await writeFile(`${root}/executions/a1-rebake.json`, `${JSON.stringify({ started: started.toISOString(), ended: new Date().toISOString(), ...result }, null, 2)}\n`);
if (result.code !== 0) throw new Error(result.stderr);
