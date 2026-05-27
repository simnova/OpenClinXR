import { iterationScorecardPaths, missingScoreDimensions, readJson, type Scorecard, scorecardSummary } from "./lib.js";

async function main(): Promise<void> {
  const iterationDir = process.argv[2] ?? "iterations/iteration-0001";
  const files = await iterationScorecardPaths(iterationDir);

  if (files.length === 0) {
    throw new Error(`No scorecards found in ${iterationDir}`);
  }

  for (const file of files.sort()) {
    const scorecard = await readJson<Scorecard>(file);
    const missing = missingScoreDimensions(scorecard);
    if (missing.length > 0) {
      throw new Error(`${file} is missing score dimensions: ${missing.join(", ")}`);
    }
    console.log(scorecardSummary(file, scorecard));
  }
}

await main();

