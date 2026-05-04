import { Ajv2020 } from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { globFiles, readJson } from "./lib.js";

const restrictedTypes = new Set(["vendor", "market-research", "financial-media", "internal-artifact", "preprint"]);
const forbiddenPhrases = ["validity proven", "regulatory approval", "clinical outcome proven", "licensure ready"];

export type SourceLedgerRecord = {
  source_type: string;
  permitted_uses: string[];
};

export type SourceLedgerCheckInput = {
  files?: string[];
  schemaPath?: string;
};

export type SourceLedgerCheckResult = {
  checkedCount: number;
  failures: string[];
};

export async function checkSourceLedger(input: SourceLedgerCheckInput = {}): Promise<SourceLedgerCheckResult> {
  const files = input.files ?? await globFiles(["agents/**/sources/*.json", "sources/**/*.json"]);
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(JSON.parse(await readFile(input.schemaPath ?? "schemas/source-record.schema.json", "utf8")));
  const failures: string[] = [];

  for (const file of files) {
    const record = await readJson<SourceLedgerRecord>(file);

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

  return { checkedCount: files.length, failures };
}

async function main(): Promise<void> {
  const result = await checkSourceLedger();

  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(failure);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Checked ${result.checkedCount} source records.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
