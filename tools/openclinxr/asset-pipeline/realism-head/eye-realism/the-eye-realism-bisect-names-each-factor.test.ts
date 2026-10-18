import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_10f393edc9ae3c5a: body2 eye-realism bisect (Oct-15 lid-conform
 * sheet vs current bake). The report names one verdict per factor from a
 * closed enum, cites finite measurements, and points at 2x2 sheets whose
 * shas must match disk when the asset store exists (CI has no store, so
 * the sha checks skip there; the report-shape checks always run).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = join(HERE, "eye-realism-bisect-report.json");
const FACTORS = ["f1-renderer", "f2-iris", "f3-lighting", "f4-lidgeo", "f5-shell"] as const;
const VERDICTS = ["worse", "better", "no_change", "renderer_only"] as const;

type Factor = {
  title: string;
  sheet?: { path: string; sha256: string };
  sheets?: Record<string, { path: string; sha256: string }>;
  measurements: unknown;
  verdict: string;
};

type Report = {
  card: string;
  factors: Record<string, Factor>;
  ranking: Array<{ factor: string; effect: string }>;
  probes: string[];
};

const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const report = JSON.parse(readFileSync(REPORT, "utf8")) as Report;

function finiteNumbers(value: unknown, trail: string, out: string[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(`${trail}=${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => finiteNumbers(v, `${trail}[${i}]`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      finiteNumbers(v, `${trail}.${k}`, out);
    }
  }
}

function sheetsOf(f: Factor): Array<{ path: string; sha256: string }> {
  if (f.sheet) return [f.sheet];
  if (f.sheets) return Object.values(f.sheets);
  return [];
}

describe("the eye realism bisect names each factor", () => {
  it("covers exactly f1..f5", () => {
    expect(Object.keys(report.factors).sort()).toEqual([...FACTORS].sort());
  });

  it("every factor has a verdict from the closed enum", () => {
    for (const key of FACTORS) {
      expect(VERDICTS, `${key} verdict`).toContain(report.factors[key]!.verdict);
    }
  });

  it("every factor cites finite measurements", () => {
    for (const key of FACTORS) {
      const bad: string[] = [];
      finiteNumbers(report.factors[key]!.measurements, key, bad);
      expect(bad, `${key} non-finite measurements`).toEqual([]);
    }
  });

  it("ranking names every factor once", () => {
    expect(report.ranking.map((r) => r.factor).sort()).toEqual([...FACTORS].sort());
    for (const r of report.ranking) expect(r.effect.length).toBeGreaterThan(0);
  });

  it("probe scripts are listed", () => {
    expect(report.probes.length).toBeGreaterThanOrEqual(5);
    const root = join(HERE, "..", "..", "..", "..", "..");
    for (const p of report.probes) {
      expect(existsSync(join(root, p)), p).toBe(true);
    }
  });

  const storeSheets = FACTORS.flatMap((key) =>
    sheetsOf(report.factors[key]!).map((s) => ({ factor: key, ...s })),
  ).filter((s) => existsSync(s.path));

  it.each(storeSheets.map((s) => [s.factor, s.path, s.sha256] as [string, string, string]))(
    "%s sheet sha matches disk when the store exists: %s",
    (_factor, path, sha) => {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256File(path)).toBe(sha);
    },
  );

  it("every factor has at least one sheet when the store exists", () => {
    const anySheetOnDisk = storeSheets.length > 0;
    if (!anySheetOnDisk) return;
    for (const key of FACTORS) {
      const onDisk = sheetsOf(report.factors[key]!).filter((s) => existsSync(s.path));
      expect(onDisk.length, `${key} sheets on disk`).toBeGreaterThan(0);
    }
  });
});
