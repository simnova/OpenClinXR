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
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock-types.ts"),
  "utf8",
);

describe("the persisted lock record includes overrideValue", () => {
  it.fails("(1) AdminFacultyCompileLockRecord locks include overrideValue", () => {
    const locks = SRC.slice(SRC.indexOf("locks: Array"));
    expect(locks).toMatch(/overrideValue\??:\s*unknown/);
  });
});
