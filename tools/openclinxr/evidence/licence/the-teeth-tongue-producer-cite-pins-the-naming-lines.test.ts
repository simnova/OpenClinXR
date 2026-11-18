/**
 * the-teeth-tongue-producer-cite-pins-the-naming-lines.test.ts (brow-land H3).
 *
 * The teeth/tongue producer cite in selected-scene-asset-lineage.ts names the
 * F lines that author the fitted mesh names. This test reads the cited line
 * numbers OUT OF lineage.ts and fails when those F lines no longer contain
 * both `_teeth_asset.data.name` and `_tongue_asset.data.name` — so the next
 * patch drift that moves the naming lines turns this red instead of leaving
 * a stale citation behind.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "../../../..");
const LINEAGE = join(REPO, "tools/openclinxr/evidence/licence/selected-scene-asset-lineage.ts");
const F = join(REPO, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function citedNamingRange(): { start: number; end: number } {
  const text = readFileSync(LINEAGE, "utf8");
  const m = text.match(
    /Producer: tools\/openclinxr\/evidence\/blender\/materialize_mpfb_humanoid_candidate\.py:(\d+)-(\d+)\s*\n\s*\/\/ names them openclinxr_/,
  );
  expect(m, "producer cite with teeth/tongue naming line range").not.toBeNull();
  return { start: Number(m?.[1]), end: Number(m?.[2]) };
}

describe("the teeth/tongue producer cite pins the naming lines", () => {
  it("cited F lines author both fitted mesh names", () => {
    const { start, end } = citedNamingRange();
    expect(end - start).toBe(1);
    const lines = readFileSync(F, "utf8").split("\n");
    const cited = lines.slice(start - 1, end).join("\n");
    expect(cited).toContain("_teeth_asset.data.name");
    expect(cited).toContain("_tongue_asset.data.name");
  });
});
