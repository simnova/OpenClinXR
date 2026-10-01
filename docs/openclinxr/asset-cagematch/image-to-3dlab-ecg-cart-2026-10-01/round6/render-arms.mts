import { createLocalComputeServices } from "/Volumes/files/src/openclinxr-wt/cart-round5/packages/openclinxr/service-local-compute/src/index.ts";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round6";
const services = createLocalComputeServices({ cwd: process.cwd(), env: process.env });
const records = [];
for (const arm of ["a0", "a1"]) {
  for (const transparent of [false, true]) {
    const kind = transparent ? "silhouettes" : "renders";
    const outDir = `${root}/${kind}/${arm}`;
    await mkdir(outDir, { recursive: true });
    const started = new Date();
    const result = await services.blender.run({
      script: "/usr/bin/time",
      args: [
        "-l", "/opt/homebrew/bin/blender", "--background",
        "--python", "tools/openclinxr/factory/equipment-lane/render-glb-multiview-pack.py", "--",
        "--glb", `${root}/${arm}/ecg-cart.glb`,
        "--out-dir", outDir,
        "--resolution", "1280",
        ...(transparent ? ["--transparent", "true"] : []),
        "--freeze-in", "tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json",
        "--normalize-extent", "0.9682512283325195",
        "--only-view", "three_quarter_right.png",
      ],
      label: `round6:${arm}:${kind}`,
      timeoutMs: 900_000,
    });
    records.push({ arm, kind, started: started.toISOString(), ended: new Date().toISOString(), ...result });
    if (result.code !== 0) throw new Error(`${arm}/${kind}: ${result.stderr}`);
  }
}
await mkdir(path.join(root, "executions"), { recursive: true });
await writeFile(path.join(root, "executions", "renders.json"), `${JSON.stringify(records, null, 2)}\n`);
