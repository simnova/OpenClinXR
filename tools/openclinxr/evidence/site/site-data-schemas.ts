import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AnySchema } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

const siteDataNames = ["claims", "media", "grades", "roadmap"] as const;

function candidatePaths(rootDir: string, fileName: string): string[] {
  return [path.join(rootDir, "docs", "site", "data", fileName), path.join(rootDir, fileName)];
}

async function readFirstExisting(files: string[]): Promise<string | undefined> {
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

export async function validateSiteData(rootDir: string): Promise<string[]> {
  const blockers: string[] = [];
  const ajv = new Ajv2020({ allErrors: true });
  for (const name of siteDataNames) {
    const schemaText = await readFirstExisting(candidatePaths(rootDir, `${name}.schema.json`));
    if (schemaText === undefined) {
      blockers.push(`site_data_schema_missing:${name}`);
      continue;
    }
    let schema: AnySchema;
    try {
      schema = JSON.parse(schemaText) as AnySchema;
    } catch {
      blockers.push(`site_data_schema_missing:${name}`);
      continue;
    }
    const dataText = await readFirstExisting(candidatePaths(rootDir, `${name}.json`));
    if (dataText === undefined) {
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(dataText) as unknown;
    } catch {
      blockers.push(`site_data_schema_invalid:${name}: not valid JSON`);
      continue;
    }
    const validate = ajv.compile(schema);
    if (!validate(data)) {
      for (const error of validate.errors ?? []) {
        blockers.push(`site_data_schema_invalid:${name}:${error.instancePath} ${error.message}`);
      }
    }
  }
  return blockers;
}
