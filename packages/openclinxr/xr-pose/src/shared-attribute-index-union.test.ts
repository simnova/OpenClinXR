/**
 * S1 RED test for the aisha-sweater consumer fix (diag cap50 ruling: fix the
 * consumers, never the GLB). All mesh/index values below are ILLUSTRATIVE and
 * hand-built (say so): they pin the ONE helper contract, not any shipped GLB.
 *
 * Contract: every primitive/mesh that shares one attribute set may claim only
 * the vertex rows its indices reference, deduped per shared attribute set. The
 * solver reaches it through the single shared rows module
 * (supine-shared-position-rows.ts); the meters import it from the entrypoint.
 * A carrier alone on its set resolves shared:false (callers keep their legacy
 * all-rows path, so actors without shared sets measure bit-identical).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveSharedAttributeRows,
  type SharedAttributeCarrier,
} from "./index.js";

function carrier(
  set: unknown,
  rows: number[] | null,
  vertexCount = 12,
  ranges?: Array<{ start: number; count: number }>,
): SharedAttributeCarrier {
  if (rows === null) return { set, index: null, vertexCount, ...(ranges ? { ranges } : {}) };
  return { set, index: { count: rows.length, getX: (i: number) => rows[i]! }, vertexCount, ...(ranges ? { ranges } : {}) };
}

describe("resolveSharedAttributeRows (illustrative hand-built carriers, not GLB data)", () => {
  it("unions referenced rows across a shared set, deduped, never sampling unreferenced rows", () => {
    const set = { tag: "shared-attribute-set" };
    const a = carrier(set, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const b = carrier(set, [8, 9, 10]);
    const out = resolveSharedAttributeRows([a, b]);
    const res = out.get(set)!;
    expect(res.shared).toBe(true);
    expect([...res.union].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.union.has(11), "row 11 is referenced by no index and must never be sampled").toBe(false);
    expect([...res.perCarrier.get(a)!].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...res.perCarrier.get(b)!].sort((x, y) => x - y)).toEqual([8, 9, 10]);
  });

  it("a carrier alone on its set resolves shared:false (legacy all-rows path stays)", () => {
    const set = { tag: "singleton-set" };
    const solo = carrier(set, [0, 2, 4]);
    const res = resolveSharedAttributeRows([solo]).get(set)!;
    expect(res.shared).toBe(false);
  });

  it("CW-1: an appended carrier with an EMPTY index contributes 0 samples and 0 meter rows", () => {
    const set = { tag: "cw1-set" };
    const base = carrier(set, [0, 1, 2]);
    const appended = carrier(set, []);
    const res = resolveSharedAttributeRows([base, appended]).get(set)!;
    expect(res.shared).toBe(true);
    expect([...res.union].sort((x, y) => x - y)).toEqual([0, 1, 2]);
    expect(res.perCarrier.get(appended)!.size).toBe(0);
  });

  it("a non-indexed carrier claims every row; ranges restrict to rendered groups; OOB rows are skipped", () => {
    const set = { tag: "mixed-set" };
    const indexed = carrier(set, [2, 99, -1, 4], 12, [{ start: 0, count: 4 }]);
    const full = carrier(set, null, 12);
    const res = resolveSharedAttributeRows([indexed, full]).get(set)!;
    expect(res.shared).toBe(true);
    expect([...res.perCarrier.get(indexed)!].sort((x, y) => x - y)).toEqual([2, 4]);
    expect(res.perCarrier.get(full)!.size).toBe(12);
    expect(res.union.size).toBe(12);
    // ranges: only the first two index elements participate
    const ranged = carrier({ tag: "range-set" }, [5, 6, 7, 8], 12, [{ start: 2, count: 2 }]);
    const solo = carrier(ranged.set, [0], 12);
    const rr = resolveSharedAttributeRows([ranged, solo]).get(ranged.set)!;
    expect([...rr.perCarrier.get(ranged)!].sort((x, y) => x - y)).toEqual([7, 8]);
  });

  it("P3 one-contract: the solver and both meters reach the helper through one shared module, never a copy", () => {
    const root = new URL("../../../../", import.meta.url);
    const solver = readFileSync(new URL("packages/openclinxr/xr-pose/src/supine-support-skin-cache.ts", root), "utf8");
    const rows = readFileSync(new URL("packages/openclinxr/xr-pose/src/supine-shared-position-rows.ts", root), "utf8");
    const wrist = readFileSync(
      new URL("packages/openclinxr/stations/garment-surface-evidence/src/garment-surface/garment-shells-stop-at-the-wrist.test.ts", root),
      "utf8",
    );
    const hidden = readFileSync(
      new URL("packages/openclinxr/stations/garment-surface-evidence/src/garment-surface/mpfb2-body-is-hidden-under-cloth.test.ts", root),
      "utf8",
    );
    expect(solver, "solver uses the shared rows module").toContain("supine-shared-position-rows.js");
    expect(solver, "solver calls sharedPositionEntryFor").toContain("sharedPositionEntryFor");
    expect(rows, "rows module imports the helper module").toContain("shared-attribute-index-union.js");
    expect(rows, "rows module imports the helper symbol").toContain("resolveSharedAttributeRows");
    for (const [name, text] of [["wrist", wrist], ["hidden", hidden]] as const) {
      expect(text, `${name} meter imports the helper package`).toContain("@openclinxr/xr-pose");
      expect(text, `${name} meter imports the helper symbol`).toContain("resolveSharedAttributeRows");
    }
  });
});
