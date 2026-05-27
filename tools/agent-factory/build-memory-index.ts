import { pathToFileURL } from "node:url";
import { type AgentIndex, globFiles, readJson, writeJson } from "./lib.js";

export type MemoryIndexAgentFile = AgentIndex & {
  source_file: string;
};

export type MemoryIndexEntry = AgentIndex["entries"][number] & {
  agent_id: string;
  team: string;
  source_file: string;
};

export type MemoryIndexOutput = {
  generated_by: "tools/agent-factory/build-memory-index.ts";
  agent_count: number;
  entry_count: number;
  superseded_entry_count: number;
  entries: MemoryIndexEntry[];
};

async function main(): Promise<void> {
  const agentIndexFiles = await loadAgentIndexFiles();
  const output = buildMemoryIndex(agentIndexFiles);

  await writeJson(".agent-factory/memory-index.json", output);
  console.log(`Indexed ${output.entry_count} active memory entries from ${output.agent_count} agents; hid ${output.superseded_entry_count} superseded entries.`);
}

async function loadAgentIndexFiles(): Promise<MemoryIndexAgentFile[]> {
  const indexFiles = await globFiles("agents/**/index.json");
  const agentIndexFiles: MemoryIndexAgentFile[] = [];

  for (const file of indexFiles) {
    const index = await readJson<AgentIndex>(file);
    agentIndexFiles.push({ ...index, source_file: file });
  }

  return agentIndexFiles;
}

export function buildMemoryIndex(agentIndexFiles: MemoryIndexAgentFile[]): MemoryIndexOutput {
  const entries = agentIndexFiles.flatMap((index) =>
    index.entries.map((entry) => ({
      ...entry,
      agent_id: index.agent_id,
      team: index.team,
      source_file: index.source_file,
    })),
  );
  const supersededIds = new Set<string>();
  for (const entry of entries) {
    if (entry.status === "superseded") {
      supersededIds.add(entry.id);
    }
    for (const superseded of entry.supersedes ?? []) {
      supersededIds.add(superseded);
    }
  }
  const activeEntries = entries
    .filter((entry) => entry.status === "active" && !supersededIds.has(entry.id))
    .sort((a, b) => `${a.topic}:${a.id}`.localeCompare(`${b.topic}:${b.id}`));

  return {
    generated_by: "tools/agent-factory/build-memory-index.ts",
    agent_count: agentIndexFiles.length,
    entry_count: activeEntries.length,
    superseded_entry_count: entries.length - activeEntries.length,
    entries: activeEntries,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
