import { createLocalComputeServices } from "/Volumes/files/src/openclinxr-wt/cart-round5/packages/openclinxr/service-local-compute/src/index.ts";
import { writeFile } from "node:fs/promises";
const root = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round6";
const services = createLocalComputeServices({ cwd: process.cwd(), env: process.env });
const result = await services.blender.run({
  script: "/usr/bin/time",
  args: ["-l", "/opt/homebrew/bin/blender", "--background", "--python", `${root}/blender-round6.py`, "--",
    "--mode", "render-raw", "--input", `${root}/work/decoded-fullres-voxel-colour.ply`, "--out", `${root}/stage-isolation`,
    "--freeze", "tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json", "--extent", "0.9682512283325195", "--resolution", "1280"],
  label: "round6:profile-stage-render", timeoutMs: 900_000,
});
await writeFile(`${root}/executions/stage-render-profile.json`, `${JSON.stringify(result, null, 2)}\n`);
if (result.code !== 0) throw new Error(result.stderr);
