import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { knownRedTests } from "./test-touched.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("known-red-tests.json", () => {
  it("lists only test files that exist, each with a reason and a card", () => {
    const tests = knownRedTests();
    for (const t of tests) {
      expect(existsSync(path.join(REPO, t.path)), t.path).toBe(true);
      expect(t.path.endsWith(".test.ts"), t.path).toBe(true);
      expect(t.reason.length, t.path).toBeGreaterThan(20);
      expect(t.card.length, t.path).toBeGreaterThan(0);
    }
  });
});
