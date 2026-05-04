import { describe, expect, it } from "vitest";
import { buildMemoryIndex, type MemoryIndexAgentFile } from "./build-memory-index.js";

describe("memory index builder", () => {
  it("indexes active memories while hiding entries superseded by newer active memories", () => {
    const output = buildMemoryIndex([
      agentIndex("agents/core/xr-systems-architect/index.json", {
        agent_id: "xr-systems-architect",
        team: "core",
        entries: [
          memoryEntry({
            id: "old-quest-claim",
            topic: "quest-webxr",
            summary: "Quest support still unverified.",
          }),
          memoryEntry({
            id: "quest-smoke-repeatable",
            topic: "quest-webxr",
            summary: "Quest Browser loads the local station shell and advances trace controls.",
            iteration: 8,
            confidence: 0.92,
            supersedes: ["old-quest-claim"],
          }),
        ],
      }),
      agentIndex("agents/legal/legal-regulatory-counsel/index.json", {
        agent_id: "legal-regulatory-counsel",
        team: "legal",
        entries: [
          memoryEntry({
            id: "legacy-equivalence-risk",
            topic: "claims-non-equivalence",
            summary: "Do not imply replacement of prior clinical skills exams.",
            status: "superseded",
          }),
        ],
      }),
    ]);

    expect(output.agent_count).toBe(2);
    expect(output.entry_count).toBe(1);
    expect(output.superseded_entry_count).toBe(2);
    expect(output.entries.map((entry) => entry.id)).toEqual(["quest-smoke-repeatable"]);
    expect(output.entries[0]).toMatchObject({
      agent_id: "xr-systems-architect",
      team: "core",
      source_file: "agents/core/xr-systems-architect/index.json",
    });
  });
});

function agentIndex(sourceFile: string, index: Omit<MemoryIndexAgentFile, "source_file" | "last_updated">): MemoryIndexAgentFile {
  return { ...index, last_updated: "2026-05-04T00:00:00.000Z", source_file: sourceFile };
}

function memoryEntry(overrides: Partial<MemoryIndexAgentFile["entries"][number]>): MemoryIndexAgentFile["entries"][number] {
  return {
    id: "memory-entry",
    type: "lesson",
    topic: "memory-quality",
    summary: "Detailed memory note.",
    confidence: 0.8,
    source_ids: [],
    iteration: 1,
    status: "active",
    supersedes: [],
    ...overrides,
  };
}
