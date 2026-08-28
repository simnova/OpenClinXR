import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model UI remaining: persist input has overrideValue, but
 * AdminFacultyCompileLockRecord.locks[] only returns nodeId/locked/overridePath.
 * Faculty cannot re-read the value they saved.
 *
 * MEASURED apps/ui-admin/src/faculty-compile-lock-types.ts:22-31.
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 *
 * ## FIXED (#0)
 * AdminFacultyCompileLockRecord.locks[] now declares overrideValue?: unknown
 * (apps/ui-admin/src/faculty-compile-lock-types.ts:30-36), and the API
 * round-trip persists it (apps/api/src/faculty-compile-lock-store.ts +
 * faculty-compile-lock-routes.ts) so the record returns the value faculty
 * saved. Assertion flipped it.fails -> it.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock-types.ts"),
  "utf8",
);

describe("the persisted lock record includes overrideValue", () => {
  it("(1) AdminFacultyCompileLockRecord locks include overrideValue", () => {
    const locks = SRC.slice(SRC.indexOf("locks: Array"));
    expect(locks).toMatch(/overrideValue\??:\s*unknown/);
  });
});
