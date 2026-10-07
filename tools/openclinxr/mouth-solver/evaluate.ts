/**
 * CLI: headless mouth-geometry evaluation for one GLB + cue track.
 *
 * Run: pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts
 *   --glb <path> --track <metrics.json> --out <json>
 * Probe: pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts --probe [--glb <path>]
 *   Static morph response per viseme at its runtime jaw angle (ms, no drive).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluate, probePremise, readEvaluatorTrack } from "@openclinxr/station-mouth-verifier";

const DEFAULT_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";

function flag(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${name} <value>`);
  }
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--probe")) {
    const probeGlb = flag("--glb", DEFAULT_GLB);
    const { rows, visemes, wallMs } = await probePremise(probeGlb);
    console.log("viseme jawDeg lipOuterZ rimZ teethLowerZ teethUpperZ rimJawShare teethJawShare (mm, 0..1)");
    for (const row of rows) {
      console.log(
        `${row.viseme} ${row.jawDegrees} ${row.lipOuterZMm} ${row.rimZMm} ` +
          `${row.teethLowerZMm} ${row.teethUpperZMm} ${row.rimJawShare} ${row.teethJawShare}`,
      );
    }
    console.log(`visemes present: ${visemes.join(",")}`);
    console.log(`wall clock: ${wallMs} ms`);
    return;
  }
  const glbPath = flag("--glb");
  const trackPath = flag("--track");
  const outPath = flag("--out");
  const track = readEvaluatorTrack(trackPath);
  const { output } = await evaluate(glbPath, track);
  output.trackPath = trackPath;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  const summary = output.summary;
  const range = summary.forwardGapHeadLocalMaxMm - summary.forwardGapHeadLocalMinMm;
  console.log(`frames: ${summary.frames}`);
  console.log(
    `forward gap head-local mm: min ${summary.forwardGapHeadLocalMinMm} max ${summary.forwardGapHeadLocalMaxMm} ` +
      `mean ${summary.forwardGapHeadLocalMeanMm} std ${summary.forwardGapHeadLocalStdMm} range ${Math.round(range * 1e6) / 1e6}`,
  );
  console.log(
    `"now" frames (${summary.nowVisemes.join("+")} ${summary.nowFrames[0]}-${summary.nowFrames[summary.nowFrames.length - 1]}): ` +
      `mean forward gap ${summary.nowForwardGapMeanMm} mm`,
  );
  for (const point of summary.nowGapSeries) {
    console.log(
      `  f=${point.frame} t=${point.timeS}s ${point.viseme ?? "none"} gap=${point.forwardGapHeadLocalMm} mm`,
    );
  }
  console.log(`penetration frames: ${summary.penetrationFrames}`);
  console.log(
    `rim gap head-local mm (${summary.rimVertCount} rim verts): min ${summary.rimGapHeadLocalMinMm} ` +
      `max ${summary.rimGapHeadLocalMaxMm} mean ${summary.rimGapHeadLocalMeanMm} now-min ${summary.rimGapNowMinMm}`,
  );
  console.log(
    `ground truth dy: median ${summary.groundTruthDyMedianCropPx} px, max ${summary.groundTruthDyMaxCropPx} px ` +
      `(gate median <= 2, max <= 5)`,
  );
  console.log(
    `ground truth dx (recorded): median ${summary.groundTruthDxMedianCropPx} px, max ${summary.groundTruthDxMaxCropPx} px ` +
      `over ${summary.groundTruthFrames} frames (n >= 20)`,
  );
  console.log("upper displacement by viseme (head-local max mm):");
  for (const [viseme, maxMm] of Object.entries(summary.upperDisplacementByVisemeMaxHeadLocalMm).sort()) {
    console.log(`  ${viseme}: ${maxMm}`);
  }
  console.log(`wall clock: ${summary.wallClockMs} ms`);
  console.log(`wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
