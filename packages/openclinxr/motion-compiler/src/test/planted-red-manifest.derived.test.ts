import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  derivePlantedEntries,
  discoverPlantedClauses,
  PLANTED_REDS,
} from "@openclinxr/motion-compiler/planted-red-manifest";

/**
 * Retained literal, inlined: the hand-maintained PLANTED_REDS this derivation replaces, as
 * of 2026-09-08. Every entry the old list carried had already been removed — each comment
 * in planted-red-manifest.ts records a clause flipped to `it` with a `## FIXED` block — so
 * the retained literal is EMPTY. Kept inline (not a sibling import) so this test adds no
 * internal-import surface: the derivation test asserts the derived output still contains
 * every entry here, which pins the empty case.
 */
const RETAINED_PLANTED_REDS: readonly { file: string; select: string }[] = [];

/**
 * The manifest is DERIVED from the tree, not maintained by hand: a planted RED is a test
 * using `it.fails` (the repo's planted convention) with the immutable diagnosis header
 * above it. These clauses pin the derivation so it cannot silently lose an entry.
 */

const key = (file: string, select: string): string => `${file} ${select}`;

describe("the planted RED manifest is derived from the tree", () => {
  it("contains every entry the hand-written manifest carried", () => {
    const derived = new Set(PLANTED_REDS.map((entry) => key(entry.file, entry.select)));
    for (const retained of RETAINED_PLANTED_REDS) {
      expect(
        derived.has(key(retained.file, retained.select)),
        `retained entry ${retained.file} :: ${retained.select} is missing from the derived manifest`,
      ).toBe(true);
    }
  });

  it("derives file, select and stage for a planted clause and ignores live tests", () => {
    const dir = mkdtempSync(join(tmpdir(), "planted-red-derive-"));
    try {
      writeFileSync(
        join(dir, "live.test.ts"),
        'import { it } from "vitest";\n'
          + "it(\"(1) a live test with no header\", () => {});\n",
      );
      expect(discoverPlantedClauses(dir)).toEqual([]);
      expect(derivePlantedEntries(dir)).toEqual([]);
      writeFileSync(
        join(dir, "red.test.ts"),
        "/**\n"
          + " * PLANTED RED. IMMUTABLE DIAGNOSIS HEADER — do not rewrite.\n"
          + " *\n"
          + " * packages/openclinxr/motion-compiler/src/program/authored-source-binding.ts ABSENT\n"
          + " */\n"
          + 'import { it } from "vitest";\n'
          + 'it.fails("(1) RED: the product binder refuses a missing action source ref", () => {});\n',
      );
      expect(discoverPlantedClauses(dir)).toEqual([
        { file: "red.test.ts", title: "(1) RED: the product binder refuses a missing action source ref" },
      ]);
      expect(derivePlantedEntries(dir)).toEqual([
        {
          file: "red.test.ts",
          title: "(1) RED: the product binder refuses a missing action source ref",
          stage: "module_absent",
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a planted clause appears in the derived output and disappears when removed", () => {
    const dir = mkdtempSync(join(tmpdir(), "planted-red-control-"));
    try {
      const path = join(dir, "control.test.ts");
      writeFileSync(
        path,
        "/**\n"
          + " * PLANTED RED. IMMUTABLE DIAGNOSIS HEADER — do not rewrite.\n"
          + " */\n"
          + 'import { it } from "vitest";\n'
          + 'it.fails("(9) RED: positive control", () => {});\n',
      );
      expect(derivePlantedEntries(dir).map((entry) => entry.title)).toContain("(9) RED: positive control");
      writeFileSync(
        path,
        'import { it } from "vitest";\n' + 'it("(9) now live", () => {});\n',
      );
      expect(derivePlantedEntries(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
