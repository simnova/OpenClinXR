import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "./decode-png.ts";

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

  it("(4) the public street PNG corner luma is world-fill, not key-only black", () => {
    /**
     * Measured 2026-09-10: key-only AREA bake corner luma ~20; ambient world bake
     * corner luma ~166. Floor 80 sits in the empty gap (not fitted to the new still).
     */
    const KEY_ONLY_BLACK_LUMA_CEILING = 80;
    const pngPath = join(REPO_ROOT, "docs/assets/mpfb-street-adult-clothed-2026-09-10.png");
    const decoded = decodePng(new Uint8Array(readFileSync(pngPath)));
    expect(decoded, `decodePng failed on ${pngPath}`).toBeTruthy();
    const { w, lum } = decoded!;
    let sum = 0;
    let n = 0;
    const box = 80;
    for (let y = 0; y < box; y += 1) {
      for (let x = 0; x < box; x += 1) {
        sum += lum[y * w + x]!;
        n += 1;
      }
    }
    const mean = sum / n;
    expect(
      mean,
      `public still corner luma ${mean.toFixed(1)} looks like the key-only black void (ceiling ${KEY_ONLY_BLACK_LUMA_CEILING})`,
    ).toBeGreaterThan(KEY_ONLY_BLACK_LUMA_CEILING);
  });

  it("(5) dump-bounds floorZ sits under the soles, not under the stray Icosphere (z=-1)", () => {
    const blender = spawnSync("which", ["blender"], { encoding: "utf8" });
    if (blender.status !== 0) {
      expect(existsSync(GRADE_PY), "blender missing; grade script must still exist").toBe(true);
      return;
    }
    const glb = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb");
    const run = spawnSync(
      "blender",
      [
        "--background",
        "--python",
        GRADE_PY,
        "--",
        "--dump-bounds",
        "--glb",
        glb,
        "--out",
        join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/.dump-bounds-unused.png"),
      ],
      { encoding: "utf8", timeout: 90_000 },
    );
    const blob = `${run.stdout}\n${run.stderr}`;
    const match = blob.match(/\{[^{}]*"floorZ"\s*:\s*(-?[0-9.]+)[^{}]*\}/);
    expect(match, `dump-bounds produced no AABB JSON: ${blob.slice(-600)}`).toBeTruthy();
    const parsed = JSON.parse(match![0]) as { floorZ: number };
    expect(
      parsed.floorZ,
      `grade floorZ ${parsed.floorZ} is the Icosphere basement (~-1), not the soles (~0)`,
    ).toBeGreaterThan(-0.05);
  });
});
