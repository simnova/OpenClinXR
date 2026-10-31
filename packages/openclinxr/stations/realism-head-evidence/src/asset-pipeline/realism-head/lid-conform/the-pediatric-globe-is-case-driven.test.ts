import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_083b92e9c7ca5d7b handback 1: the pediatric globe is case-driven.
 *
 * pediatric_axial_length.py interpolates the Rauscher 2021 table
 * (doi 10.1111/opo.12814: 4y 22.2 mm .. 17y 23.9 mm) at the case phenotype's
 * own age (actor-phenotype.v1.json entries.<case>.<actor>.phenotype.age).
 * The age 8 must never be copied into the formula: a second child case gets
 * its own age's globe. Ages outside 4..17 refuse (no extrapolation); a case
 * with no age refuses (no fallback to 8 or any default). The module is
 * bpy-free and stdlib-only, so this test imports it without Blender.
 *
 * claimScope: the interpolation and its refusals. notEvidenceFor: the bake
 * wiring (see the materializer's _child_eye_target_mm_for_stem, proved by
 * --verify-eye-stem).
 */

const HERE = join(repoRoot(), "tools/openclinxr/asset-pipeline/realism-head/lid-conform");
const REPO_ROOT = repoRoot();
const HELPER = join(HERE, "pediatric_axial_length.py");
const ENTRIES = join(
  REPO_ROOT,
  "packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json",
);

function probe(extra: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("mise", ["exec", "--", "python3", HELPER, ...extra], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
    });
    return { ok: true, out: String(out) };
  } catch (error) {
    const err = error as { stdout?: unknown; stderr?: unknown };
    return { ok: false, out: String(err.stdout ?? "") + String(err.stderr ?? "") };
  }
}

function interpolated(age: number): number {
  return Math.round((22.2 + ((age - 4) / (17 - 4)) * (23.9 - 22.2)) * 1000) / 1000;
}

describe("the pediatric globe is case-driven", () => {
  it("two synthetic ages give two different axial lengths, 14 larger than 5", () => {
    expect(existsSync(HELPER), `helper exists: ${HELPER}`).toBe(true);
    const five = JSON.parse(probe(["--age", "5"]).out) as { axialLengthMm: number };
    const fourteen = JSON.parse(probe(["--age", "14"]).out) as { axialLengthMm: number };
    expect(five.axialLengthMm).toBe(interpolated(5));
    expect(fourteen.axialLengthMm).toBe(interpolated(14));
    expect(five.axialLengthMm).not.toBe(fourteen.axialLengthMm);
    expect(fourteen.axialLengthMm).toBeGreaterThan(five.axialLengthMm);
    expect(five.axialLengthMm).toBe(22.331);
    expect(fourteen.axialLengthMm).toBe(23.508);
  });

  it("a case without an age raises the named error (no fallback)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pal-noage-"));
    try {
      const entriesFile = join(dir, "entries.json");
      writeFileSync(entriesFile, JSON.stringify({ entries: { c1: { a1: { phenotype: {} } } } }));
      const r = probe(["--entries-file", entriesFile, "--case", "c1", "--actor", "a1"]);
      expect(r.ok, "missing age must refuse").toBe(false);
      expect(r.out).toContain("PediatricAxialAgeError");
      const r2 = probe(["--entries-file", entriesFile, "--case", "cx", "--actor", "ax"]);
      expect(r2.ok, "unknown case/actor must refuse").toBe(false);
      expect(r2.out).toContain("PediatricAxialAgeError");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an age outside 4..17 raises the named error (no extrapolation)", () => {
    for (const age of ["3", "18"]) {
      const r = probe(["--age", age]);
      expect(r.ok, `age ${age} must refuse`).toBe(false);
      expect(r.out).toContain("PediatricAxialAgeError");
    }
    for (const age of ["4", "17"]) {
      const r = probe(["--age", age]);
      expect(r.ok, `table endpoint ${age} must resolve`).toBe(true);
      expect((JSON.parse(r.out) as { axialLengthMm: number }).axialLengthMm).toBe(
        interpolated(Number(age)),
      );
    }
  });

  it("the cited case field drives the value (age 8 -> 22.723)", () => {
    const doc = JSON.parse(readFileSync(ENTRIES, "utf8")) as {
      entries: Record<string, Record<string, { phenotype?: { age?: unknown } }>>;
    };
    expect(doc.entries["peds_asthma_parent_anxiety_v1"]!["patient_maya_johnson_v1"]!.phenotype!.age).toBe(8);
    const r = probe([
      "--entries-file", ENTRIES,
      "--case", "peds_asthma_parent_anxiety_v1",
      "--actor", "patient_maya_johnson_v1",
    ]);
    expect(r.ok, "the cited field must resolve").toBe(true);
    expect((JSON.parse(r.out) as { axialLengthMm: number }).axialLengthMm).toBe(22.723);
  });
});
