import { compositeScore, readJson, requireArgs, type Scorecard, type ScoreDimension, scoreWeights, weightedScore } from "./lib.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    requireArgs(args, "npm run agent:compare -- <scorecard-a.json> <scorecard-b.json>");
  }

  const [beforePath, afterPath] = args;
  const before = await readJson<Scorecard>(beforePath);
  const after = await readJson<Scorecard>(afterPath);

  console.log(`before: ${beforePath}`);
  console.log(`after: ${afterPath}`);
  console.log(`weighted_delta: ${(weightedScore(after) - weightedScore(before)).toFixed(3)}`);
  console.log(`composite_delta: ${(compositeScore(after) - compositeScore(before)).toFixed(3)}`);
  console.log("dimension_deltas:");

  for (const dimension of Object.keys(scoreWeights) as ScoreDimension[]) {
    const delta = after.dimensions[dimension].score - before.dimensions[dimension].score;
    console.log(`  ${dimension}: ${delta.toFixed(2)}`);
  }
}

await main();

