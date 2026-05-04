import { Ajv2020 } from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildIwsdkSourceRecordIdContract } from "../../packages/openclinxr/iwsdk-spike/src/index.js";
import { globFiles, readJson } from "./lib.js";

const restrictedTypes = new Set(["vendor", "market-research", "financial-media", "internal-artifact", "preprint"]);
const forbiddenPhrases = ["validity proven", "regulatory approval", "clinical outcome proven", "licensure ready"];

export type SourceLedgerRecord = {
  source_id: string;
  source_type: string;
  permitted_uses: string[];
};

export type SourceLedgerCheckInput = {
  files?: string[];
  schemaPath?: string;
  requiredSourceIds?: string[];
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
  const observedSourceIds = new Set<string>();

  for (const file of files) {
    let record: SourceLedgerRecord;
    try {
      record = await readJson<SourceLedgerRecord>(file);
    } catch (error) {
      failures.push(`${file}: could not read source record: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!validate(record)) {
      failures.push(`${file}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
      continue;
    }
    observedSourceIds.add(record.source_id);

    if (restrictedTypes.has(record.source_type)) {
      const uses = record.permitted_uses.join(" ").toLowerCase();
      for (const phrase of forbiddenPhrases) {
        if (uses.includes(phrase)) {
          failures.push(`${file}: restricted source type cannot support "${phrase}"`);
        }
      }
    }
  }
  for (const requiredSourceId of input.requiredSourceIds ?? []) {
    if (!observedSourceIds.has(requiredSourceId)) {
      failures.push(`missing required source record ${requiredSourceId}`);
    }
  }

  return { checkedCount: files.length, failures };
}

async function main(): Promise<void> {
  const result = await checkSourceLedger({
    requiredSourceIds: buildIwsdkSourceRecordIdContract().sourceRecordIds,
  });

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
