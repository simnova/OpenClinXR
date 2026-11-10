/**
 * cards-r2: runtime head crops of the transplanted card GLB (three.js, MASK 0.2) at front,
 * three_quarter_left, side and back, through renderHeadFocusCrops (#358 focus=head framing).
 * Usage: npx tsx tools/openclinxr/hair-groom-2/cards/head_crops.ts <glb under apps/ui-xr/public> <out dir> <prefix> [--body-frame K]
 * --body-frame K (cards-opt2 P1, opt-in): frame the body head box without the hair, extended K head heights
 * below, so a hair change cannot move the crop. Absent = legacy framing (head box unioned with the hair bounds).
 * --light-rig <rig.json> (sheen round, opt-in): replace the lab default lights with the rig in light_rig.ts
 * (camera-relative key/fill/rim, ambient, hemisphere, env, tone mapping, exposure). Absent = lab default rig.
 */
import { renderHeadFocusCrops, type HeadCropSpec } from "../../evidence/isolated-subject-harness.js";
import { loadLightRig, rigOverrideFor } from "./light_rig.js";

const [glb, outDir, prefix, ...rest] = process.argv.slice(2);
if (!glb || !outDir || !prefix) throw new Error("usage: head_crops.ts <glb> <out dir> <prefix> [--body-frame K] [--light-rig rig.json]");
const bf = rest.indexOf("--body-frame");
const headBodyFrame = bf >= 0 ? { belowHeads: Number(rest[bf + 1]) } : undefined;
if (headBodyFrame && !Number.isFinite(headBodyFrame.belowHeads)) throw new Error("--body-frame needs a number");
const lr = rest.indexOf("--light-rig");
const lightRig = lr >= 0 ? loadLightRig(rest[lr + 1] ?? "") : undefined;
const views = ["front", "three_quarter_left", "side", "back"] as const;
const specs: HeadCropSpec[] = views.map((view) => ({
  rail: "mpfb",
  role: prefix,
  glb,
  outName: `${prefix}-${view}.png`,
  view,
  ...(headBodyFrame ? { headBodyFrame } : {}),
  ...(lightRig ? { rigOverride: rigOverrideFor(lightRig, view) } : {}),
  ...(lightRig?.environmentEquirect ? { equirectEnvironment: lightRig.environmentEquirect } : {}),
}));
const run = await renderHeadFocusCrops({ cwd: process.cwd(), outputRoot: outDir, specs });
console.log(JSON.stringify(run.summary));
