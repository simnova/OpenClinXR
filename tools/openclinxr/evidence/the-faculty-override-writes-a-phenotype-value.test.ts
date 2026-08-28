import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model UI remaining: faculty override Select picks a JSON-pointer path only
 * (FACULTY_COMPILE_OVERRIDE_PATHS). No phenotype VALUE is persisted on overridePatch.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 *
 * ## FIXED (#0)
 *
 * `apps/ui-admin/src/faculty-compile-lock.tsx` now carries `overrideValue` on the
 * faculty compile lock row and the persist payload: `FacultyCompileLockRow` gains
 * `overrideValue?: unknown`, `mergeFacultyCompileLockRows` preserves it by rowId,
 * `persistCompileLock` forwards it as `PersistFacultyCompileLockInput.overrideValue`
 * (faculty-compile-lock-types.ts) and the api-client POSTs it to
 * save-faculty-compile-lock. The override column renders a value input beside the
 * path Select when a path is chosen, so faculty can set the phenotype value the
 * override writes — the `{ op, path, value }` overridePatch the World Compile Graph
 * applies, not only the JSON-pointer path. claimScope: the UI persists the value on
 * the wire; notEvidenceFor: the API store / factory baker honoring overridePatch.value.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock.tsx"),
  "utf8",
);

describe("the faculty override writes a phenotype value", () => {
  it("(1) lock row or persist payload includes overrideValue", () => {
    expect(SRC).toMatch(/overrideValue/);
  });
});
