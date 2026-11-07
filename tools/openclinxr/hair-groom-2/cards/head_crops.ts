/**
 * cards-r2: runtime head crops of the transplanted card GLB (three.js, MASK 0.2) at front,
 * three_quarter_left, side and back, through renderHeadFocusCrops (#358 focus=head framing).
 * Usage: npx tsx tools/openclinxr/hair-groom-2/cards/head_crops.ts <glb under apps/ui-xr/public> <out dir> <prefix>
 */
import { renderHeadFocusCrops, type HeadCropSpec } from "../../evidence/isolated-subject-harness.js";

const [glb, outDir, prefix] = process.argv.slice(2);
const views = ["front", "three_quarter_left", "side", "back"] as const;
const specs: HeadCropSpec[] = views.map((view) => ({
  rail: "mpfb",
  role: prefix,
  glb,
  outName: `${prefix}-${view}.png`,
  view: view as HeadCropSpec["view"],
}));
const run = await renderHeadFocusCrops({ cwd: process.cwd(), outputRoot: outDir, specs });
console.log(JSON.stringify(run.summary));
