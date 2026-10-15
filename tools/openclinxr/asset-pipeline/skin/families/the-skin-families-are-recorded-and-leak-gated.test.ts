/**
 * Skin families are recorded (manifest) and leak-gated (P2 baselines).
 *
 * Manifest rows carry a source sha256; leak-baselines holds measured rows
 * a/b/c with all leak fields; a family row with no leak stats is rejected;
 * the Aisha realism atlas (b) does not pass the gate set by the untouched
 * baseline (a), while the picked young source (c) does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(path.join(HERE, "manifest.json"), "utf8")) as {
  families: Record<string, unknown>[];
};
const BASELINES = JSON.parse(readFileSync(path.join(HERE, "leak-baselines.json"), "utf8")) as {
  rows: Record<string, Record<string, unknown>>;
};

const LEAK_FIELDS = ["r_S", "r_normal_y", "mirror_signed_L", "mirror_abs_L"] as const;

type FamilyRow = {
  family?: unknown;
  status?: unknown;
  source_sha256?: unknown;
  leak?: Record<string, unknown> | null;
};

/** A family row is valid iff it names its source and carries leak stats. */
export function isFamilyRowValid(row: FamilyRow): boolean {
  if (typeof row.family !== "string" || !row.family) return false;
  if (typeof row.source_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.source_sha256)) return false;
  if (!row.leak || typeof row.leak !== "object") return false;
  return LEAK_FIELDS.every((f) => typeof (row.leak as Record<string, unknown>)[f] === "number");
}

/** P2 gate: candidate passes iff within the untouched baseline, same method. */
export function passesLeakGate(candidate: Record<string, unknown>, baseline: Record<string, unknown>): boolean {
  return (
    Math.abs(candidate.r_S as number) <= Math.abs(baseline.r_S as number) &&
    Math.abs(candidate.mirror_signed_L as number) <= Math.abs(baseline.mirror_signed_L as number)
  );
}

describe("the skin families are recorded and leak-gated", () => {
  it("manifest rows have a source sha256", () => {
    expect(MANIFEST.families.length).toBeGreaterThan(0);
    for (const row of MANIFEST.families) {
      expect(typeof row.family).toBe("string");
      expect(row.source_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(isFamilyRowValid(row as FamilyRow)).toBe(true);
    }
  });

  it("leak-baselines has rows a, b, c with all leak fields", () => {
    for (const label of ["a", "b", "c"]) {
      const row = BASELINES.rows[label];
      expect(row, `baseline row ${label}`).toBeTruthy();
      for (const f of LEAK_FIELDS) expect(typeof row[f], `${label}.${f}`).toBe("number");
      expect(typeof row.glb_sha256, `${label}.glb_sha256`).toBe("string");
      expect(typeof row.s_sha256, `${label}.s_sha256`).toBe("string");
    }
  });

  it("rejects a family row with no leak stats (known-bad)", () => {
    expect(isFamilyRowValid({ family: "young", source_sha256: "9".repeat(64), leak: null })).toBe(false);
    expect(isFamilyRowValid({ family: "young", source_sha256: "9".repeat(64) })).toBe(false);
    expect(
      isFamilyRowValid({
        family: "young",
        source_sha256: "9".repeat(64),
        leak: { r_S: 0, r_normal_y: 0, mirror_signed_L: 0 },
      }),
    ).toBe(false);
  });

  it("gates the measured rows: b fails, the young pick passes", () => {
    const { a, b, c } = BASELINES.rows;
    expect(passesLeakGate(c, a)).toBe(true);
    expect(passesLeakGate(b, a)).toBe(false);
  });

  it("the rewritten young family carries locks, G1 and evidence", () => {
    const young = MANIFEST.families.find(
      (row) => (row as { family?: unknown }).family === "young",
    ) as unknown as {
      status?: unknown;
      family_sha256?: unknown;
      crops?: Array<{
        name?: unknown;
        role?: unknown;
        edit_sha256?: unknown;
        lock?: {
          disp_p95_px?: unknown;
          passed?: unknown;
          reasons?: unknown;
        } | null;
      }>;
      leak?: Record<string, unknown>;
      redness?: { family_mean_a?: unknown; source_mean_a?: unknown };
      g2?: { renders?: Array<{ sha256?: unknown }>; sheet_sha256?: unknown };
    };
    expect(young.status).toBe("rewritten");
    expect(young.family_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(young.crops?.length).toBeGreaterThan(0);
    for (const crop of young.crops ?? []) {
      expect(crop.edit_sha256).toMatch(/^[0-9a-f]{64}$/);
      // Every mosaic crop is geometrically UV-locked (residual <= 4px);
      // any crop that is not a clean pass names its reason and role.
      if (String(crop.role).startsWith("mosaic")) {
        expect(typeof crop.lock?.disp_p95_px).toBe("number");
        expect(crop.lock?.disp_p95_px as number).toBeLessThanOrEqual(4);
      }
      if (crop.lock?.passed !== true) {
        expect(Array.isArray(crop.lock?.reasons)).toBe(true);
        expect(typeof crop.role).toBe("string");
      }
    }
    // The rewritten family passes the same strict gate set by baseline (a).
    expect(passesLeakGate(young.leak as Record<string, unknown>, BASELINES.rows.a)).toBe(true);
    expect(typeof young.redness?.family_mean_a).toBe("number");
    expect(typeof young.redness?.source_mean_a).toBe("number");
    expect(young.g2?.renders?.length).toBeGreaterThan(0);
    for (const render of young.g2?.renders ?? []) {
      expect(render.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(young.g2?.sheet_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
