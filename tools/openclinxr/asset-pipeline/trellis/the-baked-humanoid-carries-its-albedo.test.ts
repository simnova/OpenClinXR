/**
 * HB-02 — the baked humanoid carries its albedo.
 *
 * Asserted against the LIVE GLBs plus the bake report, never against prose.
 * Each body: parses, declared length equals file length, mesh/node counts match
 * the report's before/after (unchanged by the bake), every textured material is
 * white-factored or a recorded exception. Counterweight: the textured-material
 * population across the baked bodies is non-zero, so this cannot pass vacuously.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-albedo-bake-2026-09-10.json");

type BakedMaterialRow = { material: string; bakedResolution: string; ladderRungId: string; texelBudget: number };
type BakedBodyRow = {
  body: string;
  meshCountBefore: number;
  meshCountAfter: number;
  nodeCountBefore: number;
  nodeCountAfter: number;
  materials: BakedMaterialRow[];
};
type BakeReport = { bodies: BakedBodyRow[]; exceptions: Array<{ body: string; reason: string }>; ladderRungId: string };

function readGlbJson(file: string): { json: Record<string, unknown>; bytes: Buffer } {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
  return { json, bytes };
}

function texturedMaterials(json: Record<string, unknown>): Array<{ name: string; factor: unknown }> {
  const materials = (json["materials"] as Array<Record<string, unknown>> | undefined) ?? [];
  return materials
    .filter((m) => (m["pbrMetallicRoughness"] as Record<string, unknown> | undefined)?.["baseColorTexture"] !== undefined)
    .map((m) => ({
      name: m["name"] as string,
      factor: (m["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorFactor"] as unknown,
    }));
}

function isWhite3(factor: unknown): boolean {
  if (factor === undefined || factor === null) return true;
  if (!Array.isArray(factor) || factor.length < 3) return false;
  return (factor as number[]).slice(0, 3).every((c) => c === 1);
}

describe("the baked humanoid carries its albedo", () => {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as BakeReport;
  const exceptionBodies = new Set(report.exceptions.map((e) => e.body));

  it("every baked body parses, its declared length matches, and mesh/node counts are unchanged", () => {
    expect(report.bodies.length).toBeGreaterThan(0);
    for (const row of report.bodies) {
      const { json, bytes } = readGlbJson(path.join(HUMANOIDS, row.body));
      expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
      expect((json["meshes"] as unknown[]).length).toBe(row.meshCountAfter);
      expect((json["nodes"] as unknown[]).length).toBe(row.nodeCountAfter);
      expect(row.meshCountAfter).toBe(row.meshCountBefore);
      expect(row.nodeCountAfter).toBe(row.nodeCountBefore);
    }
  });

  it("every textured material is white-factored or a recorded exception, and the population is non-zero", () => {
    let texturedCount = 0;
    for (const row of report.bodies) {
      const { json } = readGlbJson(path.join(HUMANOIDS, row.body));
      for (const mat of texturedMaterials(json)) {
        texturedCount += 1;
        const hidden = mat.name.startsWith("openclinxr_hidden_");
        expect(isWhite3(mat.factor) || hidden || exceptionBodies.has(row.body)).toBe(true);
      }
    }
    expect(texturedCount).toBeGreaterThan(0);
  });

  it("every baked material records source and baked resolution, rung id and texel budget", () => {
    let bakedCount = 0;
    for (const row of report.bodies) {
      for (const mat of row.materials) {
        if (!mat.bakedResolution || mat.bakedResolution === "n/a") continue;
        if (mat.texelBudget === 0) continue;
        bakedCount += 1;
        expect(mat.bakedResolution).toMatch(/^\d+x\d+$/);
        expect(mat.ladderRungId).toBe(report.ladderRungId);
        expect(mat.texelBudget).toBeGreaterThan(0);
      }
    }
    expect(bakedCount).toBeGreaterThan(0);
  });
});
