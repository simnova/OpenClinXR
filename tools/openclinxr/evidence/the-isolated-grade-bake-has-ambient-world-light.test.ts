import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The public street still (`docs/assets/mpfb-street-adult-clothed-2026-09-10.png`)
 * was baked with key-only AREA lights (energy 180/70, no world Background).
 * That produced a two-tone figure: dark chest, pale thighs. The isolated grade
 * bake (`finished_figure_grade.py`) must include a world/ambient term.
 *
 * SSOT: tools/openclinxr/asset-pipeline/makeclothes/grade-lighting.json
 * Applied by: finished_figure_grade.py apply_grade_lighting
 *
 * Key-only AREA lights fail this contract (worldBackgroundStrength must be > 0).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED
 * grade-lighting.json worldBackgroundStrength 0.55; apply_grade_lighting sets
 * the world Background node. --dump-lighting prints the live node strength.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const LIGHTING_JSON = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/grade-lighting.json",
);
const GRADE_PY = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/finished_figure_grade.py",
);

type GradeLighting = {
  worldBackgroundStrength: number;
  keyEnergy: number;
  fillEnergy: number;
};

function loadLighting(): GradeLighting {
  const raw = JSON.parse(readFileSync(LIGHTING_JSON, "utf8")) as GradeLighting;
  return raw;
}

describe("the isolated grade bake has ambient world light", () => {
  it("(1) RED: worldBackgroundStrength > 0 in the SSOT the bake loads", () => {
    const cfg = loadLighting();
    expect(
      cfg.worldBackgroundStrength,
      "key-only AREA lights (strength 0 / missing world) produced the 2026-09-10 two-tone still",
    ).toBeGreaterThan(0);
    expect(cfg.keyEnergy, "key remains").toBeGreaterThan(0);
    expect(cfg.fillEnergy, "fill remains").toBeGreaterThan(0);
  });

  it("(2) the public-still blender script applies that SSOT, not a second hardcoded key-only rig", () => {
    const py = readFileSync(GRADE_PY, "utf8");
    expect(py).toMatch(/grade-lighting\.json/);
    expect(py).toMatch(/apply_grade_lighting/);
    expect(py).toMatch(/worldBackgroundStrength/);
    expect(py).toMatch(/ShaderNodeBackground|BACKGROUND/);
  });

  it("(3) blender --dump-lighting reports live Background strength > 0 when blender is on PATH", () => {
    const blender = spawnSync("which", ["blender"], { encoding: "utf8" });
    if (blender.status !== 0) {
      expect(existsSync(LIGHTING_JSON), "blender missing; SSOT file must still exist").toBe(true);
      return;
    }
    const run = spawnSync(
      "blender",
      [
        "--background",
        "--python",
        GRADE_PY,
        "--",
        "--dump-lighting",
        "--out",
        join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/.dump-lighting-unused.png"),
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    const blob = `${run.stdout}\n${run.stderr}`;
    const match = blob.match(
      /\{[^{}]*"worldBackgroundStrength"[\s\S]*?"liveWorldBackgroundStrength"\s*:\s*[0-9.]+[\s\S]*?\}/,
    );
    expect(match, `dump-lighting produced no lighting JSON: ${blob.slice(-500)}`).toBeTruthy();
    const parsed = JSON.parse(match![0]) as {
      worldBackgroundStrength: number;
      liveWorldBackgroundStrength: number;
    };
    expect(parsed.worldBackgroundStrength).toBeGreaterThan(0);
    expect(parsed.liveWorldBackgroundStrength).toBeGreaterThan(0);
  });
});
