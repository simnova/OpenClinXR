import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_c7302c32b3dcacdc (body2-defects): each body2 station-output defect
 * names the first of the 7 face-station stages whose render shows it.
 *
 * EXPECTED ROWS: (1) crown-paint (orange-red scalp patch with a lips-shaped
 * core) -> stage 3 (clean in S1/S2 base-GLB renders, present from the stage-3
 * input solved-albedo-bb.png on); (2) pink-eyes (red-brown iris, pink-grey
 * sclera) -> stage 1 (present in the S1 base-GLB render; the brown_eye asset
 * itself is reddish while Aisha's iris-centred-c is neutral).
 *
 * COUNTERWEIGHT: the cheapest false pass is two rows of prose with no
 * coordinates, no stage number, and no render files. Every row must therefore
 * carry a mesh + material + UV box, an integer stage 1..7, per-stage render
 * paths that exist whenever the asset store exists, a verdict from the fixed
 * enum, and the exact fix file. `cause_unknown` is the allowed escape for a
 * defect that reproduces but cannot be attributed; `not_reproduced` is the
 * falsifier outcome when a fresh render of r2's own outputs lacks the defect
 * (the r2 repro here is byte-identical, so neither row may claim it).
 */

const DIR = import.meta.dirname;
const FINDINGS = join(DIR, "findings.json");

const EXPECTED_IDS = ["crown-paint", "pink-eyes"] as const;
const EXPECTED_STAGE: Record<string, number> = { "crown-paint": 3, "pink-eyes": 1 };
const VERDICTS = ["cause_found", "cause_unknown", "not_reproduced"] as const;

type Row = {
  id: string;
  location: { uv_box: unknown; mesh: string; material: string };
  stage: number;
  per_stage_renders: string[];
  verdict: string;
  fix_file: string;
  text: string;
};

function load(): { rows: Row[] } {
  return JSON.parse(readFileSync(FINDINGS, "utf8")) as { rows: Row[] };
}

describe("each body2 defect names its stage", () => {
  it("findings.json exists with exactly one row per expected defect id", () => {
    expect(existsSync(FINDINGS)).toBe(true);
    const { rows } = load();
    expect(rows.map((r) => r.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(EXPECTED_IDS)("row %s has a location, a stage within 1..7, and a verdict in the enum", (id) => {
    const { rows } = load();
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row!.location.mesh.trim().length).toBeGreaterThan(0);
    expect(row!.location.material.trim().length).toBeGreaterThan(0);
    expect(JSON.stringify(row!.location.uv_box).length).toBeGreaterThan(10);
    expect(Number.isInteger(row!.stage)).toBe(true);
    expect(row!.stage).toBeGreaterThanOrEqual(1);
    expect(row!.stage).toBeLessThanOrEqual(7);
    expect(VERDICTS).toContain(row!.verdict);
    expect(row!.fix_file.trim().length).toBeGreaterThan(0);
    expect(row!.text.trim().length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_IDS)("row %s names the measured first stage", (id) => {
    const { rows } = load();
    const row = rows.find((r) => r.id === id)!;
    expect(row.stage).toBe(EXPECTED_STAGE[id]);
  });

  it.each(EXPECTED_IDS)("row %s lists per-stage renders that exist when the store exists", (id) => {
    const { rows } = load();
    const row = rows.find((r) => r.id === id)!;
    expect(Array.isArray(row.per_stage_renders)).toBe(true);
    expect(row.per_stage_renders.length).toBeGreaterThanOrEqual(7);
    const missing = row.per_stage_renders.filter((p) => !existsSync(p));
    // The asset store is machine-local: when NONE of the renders exist the
    // store is absent and the row is still well-formed; a PARTIAL miss means
    // the row cites files that were never rendered.
    if (missing.length > 0) {
      expect(missing.length).toBe(row.per_stage_renders.length);
    }
  });

  it("no row claims not_reproduced: the fresh r2 repro is byte-identical", () => {
    const { rows } = load();
    for (const row of rows) {
      expect(row.verdict).not.toBe("not_reproduced");
    }
  });
});
