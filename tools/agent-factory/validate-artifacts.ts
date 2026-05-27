import { readFile } from "node:fs/promises";
import { type AnySchema } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { globFiles, readJson, type AgentIndex } from "./lib.js";

type ValidationFailure = {
  file: string;
  message: string;
};

async function loadSchema(file: string): Promise<AnySchema> {
  return JSON.parse(await readFile(file, "utf8")) as AnySchema;
}

function parseSimpleYamlFrontmatter(source: string): Record<string, string> {
  const match = /^---\n(?<frontmatter>[\s\S]*?)\n---/u.exec(source);
  const frontmatter = match?.groups?.frontmatter;
  if (!frontmatter) {
    return {};
  }

  const data: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const keyValue = /^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*)$/u.exec(line);
    const key = keyValue?.groups?.key;
    const rawValue = keyValue?.groups?.value;
    if (!key || rawValue === undefined) {
      continue;
    }
    data[key] = rawValue.trim().replace(/^["']|["']$/gu, "");
  }
  return data;
}

async function main(): Promise<void> {
  const ajv = new Ajv2020({ allErrors: true });
  const agentIndexSchema = await loadSchema("schemas/agent-index.schema.json");
  const scoreHistorySchema = await loadSchema("schemas/score-history.schema.json");
  const scorecardSchema = await loadSchema("schemas/scorecard.schema.json");
  const sourceSchema = await loadSchema("schemas/source-record.schema.json");
  const decisionSchema = await loadSchema("schemas/decision-record.schema.json");

  const validateAgentIndex = ajv.compile(agentIndexSchema);
  const validateScoreHistory = ajv.compile(scoreHistorySchema);
  const validateScorecard = ajv.compile(scorecardSchema);
  const validateSource = ajv.compile(sourceSchema);
  const validateDecision = ajv.compile(decisionSchema);

  const failures: ValidationFailure[] = [];

  async function validateFile(file: string, validate: ReturnType<typeof ajv.compile>): Promise<void> {
    const data = await readJson<unknown>(file);
    if (!validate(data)) {
      failures.push({
        file,
        message: ajv.errorsText(validate.errors, { separator: "; " }),
      });
    }
  }

  for (const file of await globFiles("agents/**/index.json")) {
    await validateFile(file, validateAgentIndex);
  }

  for (const file of await globFiles("agents/**/score-history.json")) {
    await validateFile(file, validateScoreHistory);
  }

  for (const file of await globFiles("iterations/**/*scorecard.json")) {
    await validateFile(file, validateScorecard);
  }

  for (const file of await globFiles(["agents/**/sources/*.json", "sources/**/*.json"])) {
    await validateFile(file, validateSource);
  }

  for (const file of await globFiles(["agents/**/decisions/*.json", "decisions/**/*.json"])) {
    await validateFile(file, validateDecision);
  }

  const charterFiles = await globFiles("agents/**/charter.md");
  for (const file of charterFiles) {
    const frontmatter = parseSimpleYamlFrontmatter(await readFile(file, "utf8"));
    const agentId = frontmatter.agent_id;
    const team = frontmatter.team;
    const name = frontmatter.name;
    if (typeof agentId !== "string" || typeof team !== "string" || typeof name !== "string") {
      failures.push({ file, message: "charter frontmatter must include agent_id, team, and name" });
      continue;
    }
    const indexFile = file.replace(/charter\.md$/, "index.json");
    const index = await readJson<AgentIndex>(indexFile);
    if (index.agent_id !== agentId || index.team !== team) {
      failures.push({ file, message: "charter frontmatter does not match index.json" });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`${failure.file}: ${failure.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${charterFiles.length} agent charters and machine-readable artifacts.`);
}

await main();
