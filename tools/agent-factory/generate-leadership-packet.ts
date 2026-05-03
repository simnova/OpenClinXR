import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { iterationScorecardPaths, readJson, requireArgs, scorecardSummary, type Scorecard } from "./lib.js";

const orderedFiles = [
  "00-brief.md",
  "01-core-plan.md",
  "03-adversarial-counterplan.md",
  "05-core-revision.md",
  "06-leadership-review.md",
  "07-final-synthesis.md",
  "08-memory-update-log.md",
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  requireArgs(args, "npm run agent:leadership -- <iteration-dir>");
  const iterationDir = args[0];
  const sections: string[] = [`# Leadership Packet: ${path.basename(iterationDir)}`];

  const scorecards = await iterationScorecardPaths(iterationDir);
  if (scorecards.length > 0) {
    sections.push("## Score Summary");
    for (const file of scorecards.sort()) {
      const scorecard = await readJson<Scorecard>(file);
      sections.push("```text\n" + scorecardSummary(file, scorecard) + "\n```");
    }
  }

  for (const fileName of orderedFiles) {
    const filePath = path.join(iterationDir, fileName);
    try {
      const text = await readFile(filePath, "utf8");
      sections.push(`\n---\n\n${text}`);
    } catch {
      sections.push(`\n---\n\n## Missing: ${fileName}\n\nThis expected iteration file was not found.`);
    }
  }

  const outputPath = path.join(iterationDir, "leadership-packet.md");
  await writeFile(outputPath, `${sections.join("\n\n")}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

await main();

