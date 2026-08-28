import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model remaining: withFacultyLock writes overridePatch as {op, path} only
 * (encounter-materialization-faculty-locks.ts:187). Compile recipe keying uses
 * overridePatch.value (encounter-materialization-compile.ts:99). Persist then
 * drops the faculty value before bake.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 */

const SRC = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../factory/encounter-materialization-faculty-locks.ts",
  ),
  "utf8",
);

describe("the faculty lock persist copies overrideValue into compile nodes", () => {
  it.fails("(1) FacultyCompileLock includes overrideValue", () => {
    const t = SRC.slice(SRC.indexOf("export type FacultyCompileLock"));
    expect(t).toMatch(/overrideValue\??:\s*unknown/);
  });

  it.fails("(2) withFacultyLock copies lock.overrideValue onto overridePatch.value", () => {
    expect(SRC).toMatch(/overridePatch\s*=\s*\{\s*op:\s*"replace",\s*path:\s*lock\.overridePath,\s*value:\s*lock\.overrideValue/);
  });
});
