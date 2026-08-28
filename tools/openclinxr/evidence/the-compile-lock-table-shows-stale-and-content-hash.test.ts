import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model UI remaining: faculty lock rows do not show evidence.v1 stale / contentHash.
 * MEASURED 2026-08-28 FacultyCompileLockRow = { rowId, kind, compileSubject, locked, overridePath? }
 * in apps/ui-admin/src/faculty-compile-lock.tsx.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock.tsx"),
  "utf8",
);

describe("the compile lock table shows stale and contentHash", () => {
  it.fails("(1) FacultyCompileLockRow carries stale: boolean", () => {
    expect(SRC).toMatch(/stale:\s*boolean/);
  });

  it.fails("(2) FacultyCompileLockRow carries contentHash", () => {
    expect(SRC).toMatch(/contentHash\??:\s*string/);
  });

  it.fails("(3) lock table columns include a Stale or Content hash title", () => {
    expect(SRC).toMatch(/title:\s*"Stale"|title:\s*"Content hash"/);
  });
});
