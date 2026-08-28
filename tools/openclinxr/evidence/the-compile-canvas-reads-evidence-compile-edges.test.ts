import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * World-model UI remaining: buildCompileEdges walks the scene pipeline queue, not
 * stored evidence.v1 compileEdges (faculty-compile-lock.tsx).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails; append ## FIXED.
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ui-admin/src/faculty-compile-lock.tsx"),
  "utf8",
);

describe("the compile canvas reads evidence compileEdges", () => {
  it.fails("(1) buildCompileEdges prefers evidence.compileEdges when present", () => {
    expect(SRC).toMatch(/compileEdgesFromEvidence|evidence\.compileEdges/);
  });
});
