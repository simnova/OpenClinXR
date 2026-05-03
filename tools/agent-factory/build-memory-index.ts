import { globFiles, readJson, writeJson, type AgentIndex } from "./lib.js";

async function main(): Promise<void> {
  const indexFiles = await globFiles("agents/**/index.json");
  const entries = [];

  for (const file of indexFiles) {
    const index = await readJson<AgentIndex>(file);
    for (const entry of index.entries) {
      entries.push({
        ...entry,
        agent_id: index.agent_id,
        team: index.team,
        source_file: file,
      });
    }
  }

  const output = {
    generated_at: new Date().toISOString(),
    agent_count: indexFiles.length,
    entry_count: entries.length,
    entries: entries.sort((a, b) => `${a.topic}:${a.id}`.localeCompare(`${b.topic}:${b.id}`)),
  };

  await writeJson(".agent-factory/memory-index.json", output);
  console.log(`Indexed ${entries.length} memory entries from ${indexFiles.length} agents.`);
}

await main();

