/**
 * Waist-fit coverage record drift (diagnosis): `waist-fit-coverage.json`
 * disagreed with the shipped GLB bytes it claims to record.
 *
 * Diagnosis (measured 2026-09-12, instrument-only, `measureWaistFit` /
 * `measureWaistAt` in `garments-meet-at-the-waist-measure.ts`, 36 angular
 * buckets, rim 0.12). Record at HEAD `bedd7e32` vs live shipped bytes:
 *
 * | actor | record overlapMm / gapped / buckets | live overlapMm / gapped / buckets |
 * |---|---|---|
 * | mpfb-clinical-nurse-adult | 2.6 / 0 / 36 | +5.0 / 0 / 36 |
 * | mpfb-clinical-physician-adult | 2.6 / 0 / 36 | +2.7 / 0 / 36 |
 * | mpfb-peds-nurse-kevin | 2.6 / 0 / 36 | +2.8 / 0 / 36 |
 * | mpfb-family-partner-adult | 5 / 0 / 35 | +5.0 / 0 / 32 |
 * | mpfb-ob-patient-aisha | 5 / 0 / 36 | +5.0 / 0 / 25 |
 * | mpfb-peds-parent-aisha.motion-bind | 5 / 0 / 36 | +5.0 / 0 / 32 |
 * | mpfb-street-adult-male | 5 / 0 / 34 cargo_pants | -16.8 / 4 / 31 straight_leg_jeans_pants |
 *
 * The nurse row is the named defect of card #0: the record said `gapped: 0`
 * while the shipped bytes it was generated from said `gapped: 2`
 * (nurse-waistband-gap-2026-09-12.md: front buckets 26-27, min -2.6 mm).
 * The hem-fix slice (38ff3505, clothing_consume) then moved the live nurse
 * to gapped 0 / min +5.0 mm without regenerating the record, so the row was
 * stale twice over. The street row drifted further: the shipped lower is now
 * `mat_makeclothes_library_straight_leg_jeans_pants` (e59925fc), not the
 * recorded `cargo_pants`, and the live bytes say gapped 4 / min -16.8 mm.
 *
 * No gate read the record back against the bytes, so every drift sat green.
 * This clause asserts the REPORT and that the record is recomputed from the
 * shipped bytes. Fixing the street hem is out of scope (tsk_056b778a1a8c9f00
 * owns the nurse hem; no GLB/mhclo/threshold change here).
 *
 * NOT TESTED: whether the record's other fields drifted beyond the compared
 * columns; whether any actor other than the adult nurse is stale beyond what
 * the recompute shows.
 *
 * ## FIXED (#0)
 *
 * Regenerated `waist-fit-coverage.json` via
 * `pnpm exec tsx tools/openclinxr/evidence/waist-fit-coverage-write.ts`
 * (same instrument, same population: library known-good + live cast from
 * `live-scenario-actor-cast.ts`). This contract recomputes every listed
 * actor from the shipped GLB bytes and refuses on any mismatch, so drift
 * fails closed. Report: waist-fit-record-staleness-2026-09-12.md.
 * Diagnosis report is unchanged.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_WAIST_SUBJECTS,
  measureWaistAt,
} from "../garments-meet-at-the-waist-measure.ts";
import { listUniqueLiveCastMpfbAssetPaths } from "../live-scenario-actor-cast.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const ARTIFACT = pathResolve(REPO_ROOT, "tools/openclinxr/evidence/waist-fit-coverage.json");

type Row = {
  id: string;
  source?: "library" | "cast";
  overlapMm?: number;
  bucketCount?: number;
  upperName?: string | null;
  lowerName?: string | null;
  skipped?: boolean;
  skipReason?: string;
  gapped?: number;
};

/** Resolve the shipped GLB path for a record row (D1: same enumerators as the writer). */
function glbPathFor(row: Row): string | null {
  if (row.source === "library") {
    const lib = LIBRARY_WAIST_SUBJECTS.find((l) => l.id === row.id);
    return lib ? lib.glbPath : null;
  }
  const rel = listUniqueLiveCastMpfbAssetPaths().find(
    (p) => p.split("/").pop()!.replace(/\.glb$/i, "") === row.id,
  );
  return rel ? pathResolve(REPO_ROOT, rel) : null;
}

describe("the waist-fit record matches the shipped bytes", () => {
  it("record exists and covers the shipped cast", async () => {
    expect(existsSync(ARTIFACT), `${ARTIFACT} exists`).toBe(true);
    const rows = (JSON.parse(readFileSync(ARTIFACT, "utf8")) as { subjects?: Row[] }).subjects ?? [];
    expect(rows.length, "record lists subjects").toBeGreaterThan(0);
    const seen = new Set(rows.map((r) => r.id));
    const missing = (await listUniqueLiveCastMpfbAssetPaths())
      .map((p) => p.split("/").pop()!.replace(/\.glb$/i, ""))
      .filter((b) => !seen.has(b))
      .sort();
    expect(missing, "shipped cast actors missing from the record").toEqual([]);
  });

  it("every listed actor recomputes to the recorded row", async () => {
    const rows = (JSON.parse(readFileSync(ARTIFACT, "utf8")) as { subjects?: Row[] }).subjects ?? [];
    expect(rows.length, "record lists subjects").toBeGreaterThan(0);
    for (const row of rows) {
      if (row.skipped) continue;
      const glbPath = glbPathFor(row);
      expect(glbPath, `${row.id}: shipped GLB resolvable`).not.toBeNull();
      expect(existsSync(glbPath!), `${row.id}: shipped GLB exists`).toBe(true);
      const live = await measureWaistAt(row.id, glbPath!, row.source ?? "cast");
      expect(live.skipped, `${row.id}: live bytes measurable`).not.toBe(true);
      expect(live.gapped, `${row.id}: gapped buckets`).toBe(row.gapped);
      expect(live.bucketCount, `${row.id}: comparable buckets`).toBe(row.bucketCount);
      expect(live.upperName, `${row.id}: upper garment`).toBe(row.upperName);
      expect(live.lowerName, `${row.id}: lower garment`).toBe(row.lowerName);
      expect(live.overlapMm ?? NaN, `${row.id}: min overlap mm`).toBeCloseTo(row.overlapMm ?? NaN, 1);
    }
  });

  it("skips are declared with a reason, never a silent pass", () => {
    const rows = (JSON.parse(readFileSync(ARTIFACT, "utf8")) as { subjects?: Row[] }).subjects ?? [];
    const bad = rows
      .filter((r) => r.skipped && !(typeof r.skipReason === "string" && r.skipReason.trim().length >= 12))
      .map((r) => r.id);
    expect(bad, "skipped subjects with no substantive reason").toEqual([]);
  });
});
