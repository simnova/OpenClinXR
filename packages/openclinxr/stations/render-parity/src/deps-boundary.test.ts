import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = ["slotted-playwright", "portless-server", "evidence-page"];
const IMPORT_LINE = /^\s*(import|export)[^"']*["'][^"']*(slotted-playwright|portless-server|evidence-page)/;

async function nonTestSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await nonTestSources(abs)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
      out.push(abs);
    }
  }
  return out;
}

describe("deps boundary: station never imports evidence lib copies", () => {
  it("no non-test source imports a module path ending in the lib basenames", async () => {
    const files = await nonTestSources(HERE);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const line of text.split("\n")) {
        if (IMPORT_LINE.test(line)) violations.push(`${path.basename(file)}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
    expect(files.some((f) => f.endsWith("capture-deps.ts"))).toBe(true);
    for (const base of FORBIDDEN) {
      expect(files.some((f) => f.endsWith(`${base}.ts`))).toBe(false);
    }
  });
});
