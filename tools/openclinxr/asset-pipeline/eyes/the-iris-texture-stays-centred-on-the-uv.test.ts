import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

type Row = {
  file: string | null;
  sha256: string;
  pupil_shift_texels: [number, number];
  limbus_radius_rel: [number, number];
  pass: boolean;
};

const gate = (r: Row) =>
  r.pupil_shift_texels.every((v) => v <= 2.0) &&
  r.limbus_radius_rel.every((v) => v <= 0.02);

describe("the iris texture stays centred on the uv", () => {
  const manifestPath = join(here, "texture-manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : null;

  it("manifest exists with a chosen row", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.chosen).toMatch(/\.png$/);
    expect(Array.isArray(manifest.textures)).toBe(true);
    expect(manifest.textures.length).toBeGreaterThanOrEqual(2);
  });

  it("chosen texture file sha256 matches the manifest (whole image)", () => {
    const row = manifest.textures.find(
      (r: Row) => r.file === manifest.chosen,
    ) as Row;
    expect(row).toBeDefined();
    const p = join(here, manifest.chosen as string);
    expect(existsSync(p)).toBe(true);
    expect(sha256File(p)).toBe(row.sha256);
  });

  it("chosen row holds the centre and radius gates", () => {
    const row = manifest.textures.find(
      (r: Row) => r.file === manifest.chosen,
    ) as Row;
    expect(row.pass).toBe(true);
    expect(gate(row)).toBe(true);
  });

  it("both candidates are recorded, rejected row fails", () => {
    const fails = manifest.textures.filter((r: Row) => !r.pass);
    expect(fails.length).toBeGreaterThanOrEqual(1);
    for (const r of fails) expect(gate(r as Row)).toBe(false);
  });

  it("producer source hash matches materialize.py", () => {
    expect(manifest.producerSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const prod = join(
      here,
      "..",
      "..",
      "evidence",
      "blender",
      "materialize_mpfb_humanoid_candidate.py",
    );
    expect(sha256File(prod)).toBe(manifest.producerSourceSha256);
  });

  it("generator argv is recorded", () => {
    expect(manifest.generatorArgv.trim().length).toBeGreaterThan(0);
  });

  it("a known-bad centre outside the gate is rejected", () => {
    const bad: Row = {
      file: null,
      sha256: "0".repeat(64),
      pupil_shift_texels: [5.0, 0.5],
      limbus_radius_rel: [0.0001, 0.0001],
      pass: true,
    };
    expect(gate(bad)).toBe(false);
  });
});
