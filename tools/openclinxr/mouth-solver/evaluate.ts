/**
 * CLI: headless mouth-geometry evaluation for one GLB + cue track.
 *
 * Run: pnpm exec tsx tools/openclinxr/mouth-solver/evaluate.ts
 *   --glb <path> --track <metrics.json> --out <json>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluate, readEvaluatorTrack } from "./mouth-evaluator.js";

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`missing ${name} <value>`);
  return value;
}

async function main(): Promise<void> {
  const glbPath = flag("--glb");
  const trackPath = flag("--track");
  const outPath = flag("--out");
  const track = readEvaluatorTrack(trackPath);
  const { output } = await evaluate(glbPath, track);
  output.trackPath = trackPath;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  const summary = output.summary;
  const range = summary.forwardGapMaxMm - summary.forwardGapMinMm;
  console.log(`frames: ${summary.frames}`);
  console.log(
    `forward gap mm: min ${summary.forwardGapMinMm} max ${summary.forwardGapMaxMm} ` +
      `mean ${summary.forwardGapMeanMm} std ${summary.forwardGapStdMm} range ${Math.round(range * 1e6) / 1e6}`,
  );
  console.log(
    `"now" frames (${summary.nowViseme} ${summary.nowFrames[0]}-${summary.nowFrames[summary.nowFrames.length - 1]}): ` +
      `mean forward gap ${summary.nowForwardGapMeanMm} mm`,
  );
  console.log(`penetration frames: ${summary.penetrationFrames}`);
  console.log(
    `ground truth: median ${summary.groundTruthMedianPx} px, max ${summary.groundTruthMaxPx} px ` +
      `over ${summary.groundTruthFrames} frames (n >= 20)`,
  );
  console.log(`wall clock: ${summary.wallClockMs} ms`);
  console.log(`wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
