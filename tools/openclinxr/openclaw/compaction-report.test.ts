import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compactionRows, formatRows } from "./compaction-report.js";

const boundary = (timestamp: string, trigger: string, preTokens: number) =>
  JSON.stringify({
    parentUuid: null,
    type: "system",
    subtype: "compact_boundary",
    content: "Conversation compacted",
    timestamp,
    compactMetadata: { trigger, preTokens, durationMs: 39397, preCompactDiscoveredTools: ["Monitor"] },
  });
const assistant = (input: number, created: number, read: number) =>
  JSON.stringify({
    type: "assistant",
    message: { usage: { input_tokens: input, cache_creation_input_tokens: created, cache_read_input_tokens: read } },
  });

describe("compaction-report", () => {
  it("emits one row per boundary with the first assistant context after it", () => {
    const text = [
      assistant(1, 1, 1),
      boundary("2026-11-10T08:08:37.754Z", "auto", 315186),
      "not json",
      assistant(3, 100, 1000),
      assistant(9, 9, 9),
      boundary("2026-11-10T09:00:00.000Z", "manual", 280000),
      assistant(5, 200, 2000),
    ].join("\n");
    expect(compactionRows(text)).toEqual([
      { timestamp: "2026-11-10T08:08:37.754Z", trigger: "auto", preTokens: 315186, firstContextAfter: 1103 },
      { timestamp: "2026-11-10T09:00:00.000Z", trigger: "manual", preTokens: 280000, firstContextAfter: 2205 },
    ]);
  });

  it("firstContextAfter is null when no assistant line follows", () => {
    const rows = compactionRows(boundary("2026-11-10T08:08:37.754Z", "auto", 1));
    expect(rows[0]?.firstContextAfter).toBeNull();
    expect(formatRows(rows)).toContain("null");
  });

  it("ignores compact_boundary text inside tool_result content", () => {
    const tool = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: '{"type":"system","subtype":"compact_boundary"}' }] },
    });
    expect(compactionRows(tool)).toEqual([]);
  });

  it("F3: uses the first assistant line after the boundary, missing usage fields count 0", () => {
    const partial = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 4, cache_creation_input_tokens: 50 } },
    });
    const rows = compactionRows([boundary("2026-11-10T08:08:37.754Z", "auto", 9), partial, assistant(1, 1, 1)].join("\n"));
    expect(rows[0]?.firstContextAfter).toBe(54);
  });

  it("CLI prints a JSON array with --json", () => {
    const root = mkdtempSync(join(tmpdir(), "ocxr-compaction-report-"));
    try {
      const file = join(root, "t.jsonl");
      writeFileSync(file, `${boundary("2026-11-10T08:08:37.754Z", "auto", 7)}\n${assistant(1, 2, 3)}\n`);
      const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
      const script = fileURLToPath(new URL("./compaction-report.ts", import.meta.url));
      const out = execFileSync(process.execPath, [tsxCli, script, file, "--json"], { encoding: "utf8" });
      expect(JSON.parse(out)).toEqual([
        { timestamp: "2026-11-10T08:08:37.754Z", trigger: "auto", preTokens: 7, firstContextAfter: 6 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
