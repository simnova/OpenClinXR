import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const reportTools = [
  "tools/agent-factory/find-evidence-debt.ts",
  "tools/agent-factory/find-stale-risks.ts",
  "tools/agent-factory/build-maturity-report.ts",
];

describe("report tool import contract", () => {
  it("keeps report tools import-safe by guarding CLI execution", async () => {
    const sources = await Promise.all(reportTools.map(async (file) => ({ file, text: await readFile(file, "utf8") })));

    for (const source of sources) {
      expect(source.text, `${source.file} should use pathToFileURL for its CLI guard`).toContain("pathToFileURL");
      expect(source.text, `${source.file} should not execute main unconditionally`).not.toMatch(/\nawait main\(\);\s*$/);
    }
  });
});
