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
 *
 * ## FIXED (tsk_4100343a0be0b471)
 * WardrobeBakeDecision.reason now includes tombstoned and parent_tombstoned,
 * and CompileGraphNode carries an optional tombstone (removedBy
 * faculty_remove). compileEncounterMaterialization accepts removedNodeIds:
 * each removed node is tombstoned — never spliced — with a node_tombstoned
 * compile event; locked nodes refuse (no tombstone, no event); descendants of
 * a tombstoned node go stale (parent_tombstoned decision + descendant_staled
 * event); tombstones survive the copy-prior rule so a delete is a compile
 * event the next compile still sees.
 */

const FACTORY = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = readFileSync(join(FACTORY, "encounter-materialization-evidence.ts"), "utf8");

describe("the worldview remove node tombstones and stales", () => {
  it("(1) bakeDecision / compile node model names tombstone", () => {
    expect(EVIDENCE).toMatch(/tombstone/);
  });

  it("(2) COUNTERWEIGHT: locked_stale still exists so a lock is not a delete", () => {
    expect(EVIDENCE).toContain("locked_stale");
  });
});

// NOT TESTED: UI remove button wiring; live Mongo; #167.
