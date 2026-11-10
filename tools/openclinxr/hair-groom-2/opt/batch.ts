// batch.ts <batch.json> <outDir>: one dev-server boot for many head crops (copy of the lane's EV/sheen/tools/batch.ts with
// import paths for this directory). batch.json: [{ glb, view, outName, rig?: LightRig, hideHair? }]
import { readFileSync } from "node:fs";
import { renderHeadFocusCrops, type HeadCropSpec } from "../../evidence/isolated-subject-harness.js";
import { rigOverrideFor, type LightRig } from "../cards/light_rig.js";
const [file, outDir] = process.argv.slice(2);
const items = JSON.parse(readFileSync(file!, "utf8")) as Array<{ glb: string; view: string; outName: string; rig?: LightRig; hideHair?: boolean }>;
const specs: HeadCropSpec[] = items.map((it) => ({
  rail: "mpfb", role: "sheen", glb: it.glb, outName: it.outName, view: it.view as HeadCropSpec["view"],
  headBodyFrame: { belowHeads: 1.5 },
  ...(it.rig ? { rigOverride: rigOverrideFor(it.rig, it.view) } : {}),
  ...(it.hideHair ? { hideHair: true } : {}),
  ...(it.rig?.environmentEquirect ? { equirectEnvironment: it.rig.environmentEquirect } : {}),
}));
const run = await renderHeadFocusCrops({ cwd: process.cwd(), outputRoot: outDir!, specs });
console.log(JSON.stringify(run.summary));
