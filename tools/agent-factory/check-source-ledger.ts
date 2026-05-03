import { Ajv2020 } from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { globFiles, readJson } from "./lib.js";

const restrictedTypes = new Set(["vendor", "market-research", "financial-media", "internal-artifact", "preprint"]);
const forbiddenPhrases = ["validity proven", "regulatory approval", "clinical outcome proven", "licensure ready"];

async function main(): Promise<void> {
  const files = await globFiles(["agents/**/sources/*.json", "sources/**/*.json"]);
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(JSON.parse(await readFile("schemas/source-record.schema.json", "utf8")));
  const failures: string[] = [];

  for (const file of files) {
    const record = await readJson<{
      source_type: string;
      permitted_uses: string[];
    }>(file);

    if (!validate(record)) {
      failures.push(`${file}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
      continue;
    }

    if (restrictedTypes.has(record.source_type)) {
      const uses = record.permitted_uses.join(" ").toLowerCase();
      for (const phrase of forbiddenPhrases) {
        if (uses.includes(phrase)) {
          failures.push(`${file}: restricted source type cannot support "${phrase}"`);
        }
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Checked ${files.length} source records.`);
}

await main();
