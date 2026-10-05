import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5b";
const jobs = [
  ["r5b-budget", `${root}/budget/ecg-cart.glb`],
  ["r5b-raw", `${root}/raw/ecg-cart.glb`],
] as const;

const services = createLocalComputeServices({ cwd: process.cwd(), env: process.env });
const records = [];
for (const [id, glb] of jobs) {
  for (const transparent of [false, true]) {
    const kind = transparent ? "silhouettes" : "renders";
    const outDir = path.join(root, kind, id);
    await mkdir(outDir, { recursive: true });
    const started = new Date();
    const result = await services.blender.run({
      script: "/usr/bin/time",
      args: [
        "-l", "/opt/homebrew/bin/blender", "--background",
        "--python",
        "tools/openclinxr/factory/equipment-lane/render-glb-multiview-pack.py",
        "--",
        "--glb", glb,
        "--out-dir", outDir,
        "--resolution", "1280",
        ...(transparent ? ["--transparent", "true"] : []),
        "--freeze-in", "tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json",
        "--normalize-extent", "0.9682512283325195",
        "--only-view", "three_quarter_right.png",
      ],
      label: `ecg-cart-round5b:${id}:${kind}`,
      timeoutMs: 900_000,
    });
    const ended = new Date();
    records.push({ id, kind, glb, outDir, start: started.toISOString(), end: ended.toISOString(), ...result });
    if (result.code !== 0) throw new Error(`${id}/${kind} failed: ${result.stderr}`);
  }
}
await writeFile(path.join(root, "executions/render-round5b.json"), `${JSON.stringify(records, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, jobs: records.length }));
