import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AgentDefinition, agentRoster } from "./agent-roster.js";

const today = "2026-05-03";

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function charter(agent: AgentDefinition): string {
  return `---
agent_id: ${agent.id}
team: ${agent.team}
name: ${agent.name}
---

# ${agent.name}

## Mission

${agent.mission}

## Owns

${bulletList(agent.owns)}

## Expected Outputs

${bulletList(agent.outputs)}

## Escalation Triggers

${bulletList(agent.escalationTriggers)}

## Memory Topics

${bulletList(agent.memoryTopics)}

## Tool Permissions

${bulletList(agent.toolPermissions)}

## Rubric Dimensions

${bulletList(agent.rubricDimensions)}

## Operating Instructions

1. Read the current iteration brief before producing output.
2. Retrieve relevant memory from this folder and the shared memory index.
3. Separate confirmed facts, reasonable inferences, strategic bets, and unknowns.
4. Record unresolved risks and evidence debt explicitly.
5. Update memory after each iteration with only durable lessons.

`;
}

function memory(agent: AgentDefinition): string {
  return `# ${agent.name} Memory

## Durable Lessons

- No durable lessons recorded yet.

## Active Risks

- No active risks recorded yet.

## Open Questions

- No open questions recorded yet.

## Preferred Review Heuristics

${agent.memoryTopics.map((topic) => `- Track ${topic} across iterations.`).join("\n")}

`;
}

function index(agent: AgentDefinition): string {
  return `${JSON.stringify(
    {
      agent_id: agent.id,
      team: agent.team,
      last_updated: today,
      entries: [
        {
          id: `${agent.id}-lesson-0001`,
          type: "lesson",
          topic: "initial-charter",
          summary: `${agent.name} initialized with persistent memory and rubric-linked responsibilities.`,
          confidence: 1,
          source_ids: ["src-internal-agent-factory-design-spec"],
          iteration: 0,
          status: "active",
          supersedes: [],
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function scoreHistory(agent: AgentDefinition): string {
  return `${JSON.stringify(
    {
      agent_id: agent.id,
      team: agent.team,
      history: [],
    },
    null,
    2,
  )}\n`;
}

async function writeIfMissing(filePath: string, content: string): Promise<"created" | "kept"> {
  if (await exists(filePath)) {
    return "kept";
  }
  await writeFile(filePath, content, "utf8");
  return "created";
}

async function generateAgent(agent: AgentDefinition): Promise<string[]> {
  const base = path.join("agents", agent.team, agent.id);
  await mkdir(base, { recursive: true });

  const subdirs = ["notes", "critiques", "decisions", "sources"];
  for (const subdir of subdirs) {
    const dir = path.join(base, subdir);
    await mkdir(dir, { recursive: true });
    await writeIfMissing(path.join(dir, ".gitkeep"), "");
  }

  const writes = await Promise.all([
    writeIfMissing(path.join(base, "charter.md"), charter(agent)),
    writeIfMissing(path.join(base, "memory.md"), memory(agent)),
    writeIfMissing(path.join(base, "index.json"), index(agent)),
    writeIfMissing(path.join(base, "score-history.json"), scoreHistory(agent)),
  ]);

  return writes;
}

async function main(): Promise<void> {
  const results = await Promise.all(agentRoster.map(generateAgent));
  const created = results.flat().filter((result) => result === "created").length;
  const kept = results.flat().filter((result) => result === "kept").length;
  console.log(`Generated scaffold for ${agentRoster.length} agents.`);
  console.log(`Created ${created} files; kept ${kept} existing files.`);
}

await main();
