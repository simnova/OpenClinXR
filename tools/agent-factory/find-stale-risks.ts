import { globFiles, readJson, type Scorecard } from "./lib.js";

async function main(): Promise<void> {
  const files = await globFiles("iterations/**/*scorecard.json");
  const openCritical = [];

  for (const file of files) {
    const scorecard = await readJson<Scorecard>(file);
    for (const risk of scorecard.critical_risks) {
      if (risk.severity === "critical" && risk.status === "open") {
        openCritical.push({ file, ...risk });
      }
    }
  }

  if (openCritical.length === 0) {
    console.log("No open critical risks found in scorecards.");
    return;
  }

  console.log("Open critical risks:");
  for (const risk of openCritical) {
    console.log(`- ${risk.id} (${risk.file}) owner=${risk.owner}: ${risk.summary}`);
  }
}

await main();

