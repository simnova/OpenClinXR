import { globFiles, readJson, type Scorecard } from "./lib.js";

async function main(): Promise<void> {
  const files = await globFiles("iterations/**/*scorecard.json");
  const openDebt = [];

  for (const file of files) {
    const scorecard = await readJson<Scorecard>(file);
    for (const debt of scorecard.evidence_debt) {
      if (debt.status === "open") {
        openDebt.push({ file, ...debt });
      }
    }
  }

  if (openDebt.length === 0) {
    console.log("No open evidence debt found in scorecards.");
    return;
  }

  console.log("Open evidence debt:");
  for (const debt of openDebt) {
    console.log(`- ${debt.id} (${debt.file}) owner=${debt.owner}: ${debt.summary}`);
  }
}

await main();

