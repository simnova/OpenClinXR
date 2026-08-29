import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: delete on the authoring form is Form.List remove (array splice).
 * Compile has lock/stale for bakers, no tombstone family for a faculty-removed node.
 * Locked nodes must refuse delete. Descendants must go stale.
 *
 * MEASURED 2026-08-29. encounter-materialization-evidence.ts bakeDecision reasons:
 * first_bake | cache_hit | body_changed | locked_skip | locked_stale. No tombstone.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 */

const FACTORY = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = readFileSync(join(FACTORY, "encounter-materialization-evidence.ts"), "utf8");

describe("the worldview remove node tombstones and stales", () => {
  it.fails("(1) bakeDecision / compile node model names tombstone", () => {
    expect(EVIDENCE).toMatch(/tombstone/);
  });

  it("(2) COUNTERWEIGHT: locked_stale still exists so a lock is not a delete", () => {
    expect(EVIDENCE).toContain("locked_stale");
  });
});

// NOT TESTED: UI remove button wiring; live Mongo; #167.
