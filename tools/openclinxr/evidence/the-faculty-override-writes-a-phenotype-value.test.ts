import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model UI remaining: faculty override Select picks a JSON-pointer path only
 * (FACULTY_COMPILE_OVERRIDE_PATHS). No phenotype VALUE is persisted on overridePatch.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock.tsx"),
  "utf8",
);

describe("the faculty override writes a phenotype value", () => {
  it.fails("(1) lock row or persist payload includes overrideValue", () => {
    expect(SRC).toMatch(/overrideValue/);
  });
});
